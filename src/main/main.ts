import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  channels,
  noInputSchema,
  saveRecordSchema,
  type DesktopStatus,
  type Result,
  type Lifecycle,
} from '../contracts/desktop';
import { LifecycleController, permits, type Operation } from '../application/lifecycle';
import { Diagnostics } from '../platform/diagnostics';
import { assetPath, prototypeRoot } from '../platform/paths';
import { ServiceClient } from './service-client';
import squirrelStartup from 'electron-squirrel-startup';

protocol.registerSchemesAsPrivileged([
  { scheme: 'medipharm', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('MediPharm Prototype');
app.setAppUserModelId('com.fructum.medipharm.prototype');
const root = prototypeRoot(process.platform, homedir(), process.env);
const runtime = path.join(root, 'runtime');
mkdirSync(runtime, { recursive: true, mode: 0o700 });
app.setPath('userData', runtime);
app.setPath('sessionData', runtime);
let window: BrowserWindow | null = null;
let service: ServiceClient | undefined;
let quitting = false;
let quitPrompt = false;
let draftDirty = false;
const diagnostics = new Diagnostics(path.join(root, 'logs'));
const lifecycle = new LifecycleController((value) => {
  if (window && !window.isDestroyed()) window.webContents.send(channels.lifecycleChanged, value);
});
const success = <T>(data: T): Result<T> => ({ ok: true, data });
const failure = (): Result<never> => ({
  ok: false,
  code: 'NOT_READY',
  message:
    'Local storage could not open. Preserve the prototype files and restart after checking the data directory.',
});
const devUrl = !app.isPackaged ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
const appUrl = devUrl ?? 'medipharm://app/';

async function startStorage(): Promise<void> {
  const instance = new ServiceClient(
    path.join(__dirname, 'service.cjs'),
    path.join(root, 'data'),
    (reason) => {
      diagnostics.record(`service.${reason}`);
      if (!quitting && lifecycle.value.state !== 'recoveryRequired') {
        lifecycle.move(
          'recoveryRequired',
          'Local storage stopped. Your draft is preserved. Restart storage before saving again.',
        );
      }
    },
  );
  service = instance;
  try {
    await instance.ready;
    if (!quitting && service === instance && lifecycle.value.state === 'starting') {
      lifecycle.move('ready', 'Local storage is ready.');
      diagnostics.record('service.ready');
    }
  } catch {
    if (!quitting && lifecycle.value.state !== 'recoveryRequired')
      lifecycle.move(
        'recoveryRequired',
        'Local storage could not open. Preserve its files and check the data directory.',
      );
  }
}

function registerApi(): void {
  const handle = <T extends z.ZodType>(
    channel: string,
    schema: T,
    operation: Operation | null,
    action: (input: z.infer<T>) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      const frame = event.senderFrame;
      if (
        !window ||
        event.sender !== window.webContents ||
        frame !== window.webContents.mainFrame ||
        !frame ||
        !trustedUrl(frame.url)
      ) {
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: 'This window is not allowed to use desktop services.',
        };
      }
      const envelope = z
        .object({ version: z.literal(PROTOCOL_VERSION), input: z.unknown() })
        .strict()
        .safeParse(raw);
      const parsed = schema.safeParse(envelope.success ? envelope.data.input : null);
      if (!envelope.success || !parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: 'The desktop request is invalid or incompatible.',
        };
      if (quitting || (operation && !permits(lifecycle.value.state, operation)))
        return {
          ok: false,
          code: lifecycle.value.state === 'maintenance' ? 'BUSY' : 'NOT_READY',
          message: lifecycle.value.message,
        };
      try {
        return await action(parsed.data);
      } catch {
        return {
          ok: false,
          code: 'STORAGE_ERROR',
          message: 'The operation could not be completed. Existing files have been preserved.',
        };
      }
    });
  };
  handle(channels.lifecycle, noInputSchema, null, () => success(lifecycle.value));
  handle(channels.setDraftDirty, z.boolean(), null, (dirty) => {
    draftDirty = dirty;
    return success(null);
  });
  handle(channels.restartStorage, noInputSchema, 'restart', async () => {
    lifecycle.move('starting', 'Restarting local storage…');
    diagnostics.record('service.restart');
    try {
      await service?.stop();
      if (!quitting) await startStorage();
    } catch {
      if (!quitting && lifecycle.value.state !== 'recoveryRequired')
        lifecycle.move(
          'recoveryRequired',
          'The previous storage process could not stop. Close and reopen the application.',
        );
    }
    return success<Lifecycle>(lifecycle.value);
  });
  handle(channels.status, noInputSchema, 'read', async () => {
    const result = service ? await service.request({ command: 'status' }) : failure();
    if (!result.ok) return result;
    return success<DesktopStatus>({
      ...result.data,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
      dataDirectory: root,
    });
  });
  handle(
    channels.saveRecord,
    saveRecordSchema,
    'write',
    (input) => service?.request({ command: 'save', input }) ?? failure(),
  );
  for (const [channel, command, operation] of [
    [channels.createSnapshot, 'snapshot', 'snapshot'],
    [channels.verifyRestore, 'verifyRestore', 'restoreCheck'],
  ] as const) {
    handle(channel, noInputSchema, 'snapshot', async () => {
      lifecycle.move(
        'maintenance',
        operation === 'snapshot'
          ? 'Creating and verifying the snapshot…'
          : 'Checking the restored copy…',
        operation,
      );
      diagnostics.record('operation.started');
      try {
        const result = await service!.request({ command });
        diagnostics.record(result.ok ? 'operation.finished' : 'operation.failed');
        return result;
      } finally {
        if (lifecycle.value.state === 'maintenance')
          lifecycle.move('ready', 'Local storage is ready.');
      }
    });
  }
  handle(channels.checkKeyStorage, noInputSchema, 'read', async () => {
    if (
      process.platform === 'linux' &&
      ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())
    ) {
      return success({
        protected: false,
        message:
          'A protected Linux key store is not available. Windows DPAPI must be checked on your laptop.',
      });
    }
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      return success({
        protected: false,
        message: 'Protected key storage is unavailable on this device.',
      });
    const sample = randomBytes(32).toString('hex');
    const encrypted = await safeStorage.encryptStringAsync(sample);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const matches = decrypted.result === sample;
    return success({
      protected: matches,
      message: matches
        ? 'The OS protected and recovered a temporary test key successfully.'
        : 'The protected key round trip failed.',
    });
  });
  handle(channels.chooseFolder, noInputSchema, 'read', async () => {
    if (!window) return failure();
    const result = await dialog.showOpenDialog(window, {
      title: 'Test the native folder picker',
      properties: ['openDirectory'],
    });
    return success(result.canceled ? null : { name: path.basename(result.filePaths[0]) });
  });
  handle(channels.exportDiagnostics, noInputSchema, 'diagnostics', async () => {
    if (!window) return failure();
    const result = await dialog.showSaveDialog(window, {
      title: 'Save local diagnostics',
      defaultPath: 'medipharm-diagnostics.json',
      filters: [{ name: 'Diagnostics', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return success({ saved: false });
    if (path.extname(result.filePath).toLowerCase() !== '.json') {
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Choose a new .json filename for the diagnostic report.',
      };
    }
    try {
      // Never overwrite a database, recovery marker, existing report, or symlink.
      await writeFile(result.filePath, diagnostics.export(), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: 'That file already exists. Choose a new filename for the diagnostic report.',
        };
      }
      throw error;
    }
    return success({ saved: true });
  });
}

function trustedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (devUrl) return url.origin === new URL(devUrl).origin;
    return (
      url.protocol === 'medipharm:' &&
      url.hostname === 'app' &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

async function requestQuit(): Promise<void> {
  if (quitting || quitPrompt) return;
  quitPrompt = true;
  try {
    if (draftDirty && window) {
      const decision = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Unsaved changes',
        message: 'Close without saving this draft?',
        detail:
          'Unsaved text and unconfirmed submissions will be lost. Saved records remain on this computer.',
        buttons: ['Keep editing', 'Discard and close'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (decision.response !== 1) return;
    }
    quitting = true;
    lifecycle.move('stopping', 'Finishing local operations and closing…');
    await service?.stop();
    diagnostics.record('app.stopped');
    app.quit();
  } catch {
    diagnostics.record('service.failed');
    app.exit(1);
  } finally {
    quitPrompt = false;
  }
}

async function start(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const csp = devUrl
    ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'`
    : `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed =
      url.protocol === 'medipharm:' ||
      url.protocol === 'devtools:' ||
      (Boolean(devUrl) &&
        (url.origin === new URL(devUrl!).origin ||
          ((url.protocol === 'ws:' || url.protocol === 'wss:') &&
            url.hostname === new URL(devUrl!).hostname)));
    callback({ cancel: !allowed });
  });
  protocol.handle('medipharm', async (request) => {
    const filename = assetPath(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
      request.url,
    );
    if (!filename || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    };
    const contentType = types[path.extname(filename)];
    if (!contentType) return new Response('Not found', { status: 404 });
    try {
      return new Response(new Uint8Array(await readFile(filename)), {
        headers: {
          'Content-Type': contentType,
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  diagnostics.record('app.started');
  await startStorage();
  registerApi();
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 650,
    show: false,
    backgroundColor: '#f5f7fa',
    title: 'MediPharm Prototype',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  await window.loadURL(appUrl);
}

if (squirrelStartup || !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  void app
    .whenReady()
    .then(start)
    .catch(() => {
      dialog.showErrorBox(
        'MediPharm could not start',
        'The desktop prototype could not start. No pharmacy records have been created.',
      );
      app.quit();
    });
}
