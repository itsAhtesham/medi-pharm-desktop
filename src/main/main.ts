import { csvInputSchema, supplyQuerySchema } from '../contracts/reports';
import { periodSchema } from '../contracts/dashboard';
import { querySchema, businessMutationSchema, purchaseDraftSchema } from '../contracts/business';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  safeStorage,
  powerMonitor,
  shell,
} from 'electron';
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { z } from 'zod';
import {
  backupRotationSchema,
  backupAccessSchema,
  restoreInputSchema,
  restoreConfirmSchema,
} from '../contracts/backup';
import { atomicJson } from '../platform/durable-files';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  PROTOCOL_VERSION,
  channels,
  noInputSchema,
  setupSchema,
  loginSchema,
  recoverSchema,
  changePasswordSchema,
  updatePharmacySchema,
  type Result,
  type Lifecycle,
  type ServiceCommand,
  type ServiceData,
} from '../contracts/desktop';
import { LifecycleController, permits, type Operation } from '../application/lifecycle';
import { Diagnostics } from '../platform/diagnostics';
import { assetPath, previewRoot } from '../platform/paths';
import { ServiceClient } from './service-client';
import squirrelStartup from 'electron-squirrel-startup';

protocol.registerSchemesAsPrivileged([
  { scheme: 'medipharm', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('MediPharm Desktop Preview');
app.setAppUserModelId('com.fructum.medipharm.preview');
const root = previewRoot(process.platform, homedir(), process.env);
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
    'Local storage could not open. Preserve the data files and restart after checking the data directory.',
});
const devUrl = !app.isPackaged ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
const appUrl = devUrl ?? 'medipharm://app/';

async function startStorage(): Promise<void> {
  const instance = new ServiceClient(path.join(__dirname, 'service.cjs'), root, (reason) => {
    diagnostics.record(`service.${reason}`);
    if (!quitting && lifecycle.value.state !== 'recoveryRequired') {
      lifecycle.move(
        'recoveryRequired',
        'Local storage stopped. Your draft is preserved. Restart storage before saving again.',
      );
    }
  });
  service = instance;
  try {
    await instance.ready;
    if (!quitting && service === instance && lifecycle.value.state === 'starting') {
      await syncAccountState();
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

async function syncAccountState(): Promise<void> {
  if (
    !service ||
    quitting ||
    !['starting', 'setupRequired', 'locked', 'ready'].includes(lifecycle.value.state)
  )
    return;
  const result = await service.request({ command: 'accountState' });
  if (!result.ok) return;
  if (quitting || !['starting', 'setupRequired', 'locked', 'ready'].includes(lifecycle.value.state))
    return;
  const next = result.data.state;
  if (next !== lifecycle.value.state)
    lifecycle.move(
      next,
      next === 'ready'
        ? 'Your pharmacy is ready.'
        : next === 'locked'
          ? 'Sign in to your local pharmacy.'
          : next === 'recoveryRequired'
            ? 'Existing local data could not be validated. Preserve the files, restart storage or recover from a verified backup.'
            : 'Set up your pharmacy on this computer.',
    );
}

async function keyStoreAvailable(): Promise<boolean> {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    return (
      process.platform !== 'linux' ||
      !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())
    );
  } catch {
    return false;
  }
}
const protectedKeyPath = path.join(root, 'settings', 'backup-key.protected');
async function rememberBackupKey(key: string, remember: boolean): Promise<void> {
  await rm(protectedKeyPath, { force: true });
  if (!remember || !(await keyStoreAvailable())) return;
  try {
    const encrypted = await safeStorage.encryptStringAsync(key);
    atomicJson(protectedKeyPath, { format: 1, encrypted: encrypted.toString('base64') });
  } catch {
    /* An unavailable OS vault leaves only the in-memory key. */
  }
}
async function backupStatus() {
  const result = service ? await service.request({ command: 'backupStatus' }) : failure();
  if (result.ok) result.data.osProtected = existsSync(protectedKeyPath);
  return result;
}
async function unlockDeviceBackup(): Promise<void> {
  if (!service || !existsSync(protectedKeyPath) || !(await keyStoreAvailable())) return;
  const status = await service.request({ command: 'backupStatus' });
  if (!status.ok || !status.data.configured || status.data.unlocked) return;
  try {
    const saved = z
      .object({ format: z.literal(1), encrypted: z.string().max(16384) })
      .strict()
      .parse(JSON.parse(await readFile(protectedKeyPath, 'utf8')));
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(saved.encrypted, 'base64'));
    const result = await service.request({
      command: 'backupUnlockDevice',
      input: { key: decrypted.result },
    });
    if (result.ok && decrypted.shouldReEncrypt) await rememberBackupKey(decrypted.result, true);
  } catch {
    /* The owner can use the portable backup passphrase instead. */
  }
}
async function storageJob<C extends ServiceCommand>(
  command: C,
  operation: 'backup' | 'restore' | 'export',
): Promise<Result<ServiceData<C['command']>>> {
  if (!service || !['ready', 'setupRequired', 'recoveryRequired'].includes(lifecycle.value.state))
    return failure();
  lifecycle.move(
    'maintenance',
    operation === 'export'
      ? 'Exporting CSV…'
      : operation === 'restore'
        ? 'Restoring the verified pharmacy backup…'
        : 'Verifying encrypted backups…',
    operation,
  );
  diagnostics.record('operation.started');
  try {
    const result = await service.request(command);
    diagnostics.record(result.ok ? 'operation.finished' : 'operation.failed');
    if (
      !result.ok &&
      result.code === 'RECOVERY_REQUIRED' &&
      lifecycle.value.state === 'maintenance'
    )
      lifecycle.move('recoveryRequired', result.message);
    return result;
  } finally {
    if (lifecycle.value.state === 'maintenance') {
      const state = await service.request({ command: 'accountState' });
      if (lifecycle.value.state === 'maintenance') {
        if (state.ok)
          lifecycle.move(
            state.data.state,
            state.data.state === 'ready'
              ? 'Your pharmacy is ready.'
              : 'Sign in to the restored pharmacy.',
          );
        else
          lifecycle.move(
            'recoveryRequired',
            'Restart storage to resolve the interrupted operation.',
          );
      }
    }
  }
}
let backupTickRunning = false;
async function scheduledBackup(): Promise<void> {
  if (backupTickRunning || quitting || lifecycle.value.state !== 'ready') return;
  backupTickRunning = true;
  try {
    await unlockDeviceBackup();
    if (lifecycle.value.state === 'ready') {
      const status = await backupStatus();
      if (status.ok && status.data.unlocked) await storageJob({ command: 'backupTick' }, 'backup');
    }
  } finally {
    backupTickRunning = false;
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
        const result = await action(parsed.data);
        if (
          result &&
          typeof result === 'object' &&
          'code' in result &&
          result.code === 'AUTH_REQUIRED' &&
          lifecycle.value.state === 'ready'
        )
          lifecycle.move('locked', 'Sign in to continue. Your draft is kept in this window.');
        return result;
      } catch {
        return {
          ok: false,
          code: 'STORAGE_ERROR',
          message: 'The operation could not be completed. Existing files have been preserved.',
        };
      }
    });
  };
  handle(
    channels.businessQuery,
    querySchema,
    'read',
    (input) => service?.request({ command: 'businessQuery', input }) ?? failure(),
  );
  handle(
    channels.businessSave,
    businessMutationSchema,
    'write',
    (input) => service?.request({ command: 'businessSave', input }) ?? failure(),
  );
  handle(
    channels.purchasePreview,
    purchaseDraftSchema,
    'read',
    (input) => service?.request({ command: 'purchasePreview', input }) ?? failure(),
  );
  handle(
    channels.customerSupplies,
    supplyQuerySchema,
    'read',
    (input) => service?.request({ command: 'customerSupplies', input }) ?? failure(),
  );
  handle(channels.exportCsv, csvInputSchema, 'read', async (input) => {
    if (!window || !service) return failure();
    const auth = await service.request({ command: 'status' });
    if (!auth.ok) return auth;
    const selection = await dialog.showSaveDialog(window, {
      title: 'Export CSV',
      defaultPath: `medipharm-${input.kind}.csv`,
      filters: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (selection.canceled || !selection.filePath)
      return success({ saved: false, rows: 0, bytes: 0 });
    if (lifecycle.value.state !== 'ready') return failure();
    return storageJob(
      { command: 'exportCsv', input: { selection: input, filename: selection.filePath } },
      'export',
    );
  });
  handle(
    channels.dashboard,
    periodSchema.default('daily'),
    'read',
    (input) => service?.request({ command: 'dashboard', input }) ?? failure(),
  );
  handle(channels.lifecycle, noInputSchema, null, async () => {
    await syncAccountState();
    return success(lifecycle.value);
  });
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
  handle(
    channels.status,
    noInputSchema,
    'read',
    () => service?.request({ command: 'status' }) ?? failure(),
  );
  handle(
    channels.updatePharmacy,
    updatePharmacySchema,
    'write',
    (input) => service?.request({ command: 'updatePharmacy', input }) ?? failure(),
  );
  const account = async (command: Parameters<ServiceClient['request']>[0]) => {
    const result = service ? await service.request(command) : failure();
    if (result.ok) {
      await syncAccountState();
      if (command.command === 'login')
        setTimeout(() => {
          void scheduledBackup();
        }, 1000).unref();
    } else if (
      command.command === 'setup' &&
      result.code === 'STORAGE_ERROR' &&
      lifecycle.value.state === 'setupRequired'
    )
      lifecycle.move(
        'recoveryRequired',
        'Setup could not finish. Preserve the data files before restarting storage.',
      );
    return result;
  };
  handle(channels.setup, setupSchema, 'setup', (input) => account({ command: 'setup', input }));
  handle(channels.login, loginSchema, 'login', (input) => account({ command: 'login', input }));
  handle(channels.recover, recoverSchema, 'login', (input) =>
    account({ command: 'recover', input }),
  );
  handle(channels.changePassword, changePasswordSchema, 'write', (input) =>
    account({ command: 'changePassword', input }),
  );
  handle(channels.logout, noInputSchema, 'read', () => account({ command: 'logout' }));
  handle(channels.openBackupFolder, noInputSchema, 'read', async () => {
    const status = await service!.request({ command: 'backupStatus' });
    if (!status.ok) return status;
    const error = await shell.openPath(path.join(root, 'backups'));
    if (error)
      return {
        ok: false,
        code: 'STORAGE_ERROR',
        message: 'The backup folder could not be opened.',
      };
    return success(null);
  });
  handle(channels.backupRotate, backupRotationSchema, 'write', async (input) => {
    const result = await service!.request({ command: 'backupRotate', input });
    if (!result.ok) return result;
    await rememberBackupKey(result.data.key, input.remember);
    const backup = await storageJob({ command: 'backupCreate' }, 'backup');
    if (!backup.ok)
      return {
        ok: false,
        code: backup.code,
        message:
          'Backup credentials changed, but the new archive was not confirmed. Unlock with the new passphrase and create a backup.',
      };
    return backupStatus();
  });
  handle(channels.backupStatus, noInputSchema, 'read', backupStatus);
  for (const [channel, command] of [
    [channels.backupConfigure, 'backupConfigure'],
    [channels.backupUnlock, 'backupUnlock'],
  ] as const) {
    handle(channel, backupAccessSchema, 'write', async (input) => {
      const result = await service!.request({ command, input });
      if (!result.ok) return result;
      await rememberBackupKey(result.data.key, input.remember);
      return backupStatus();
    });
  }
  handle(channels.backupCreate, noInputSchema, 'read', async () => {
    const result = await storageJob({ command: 'backupCreate' }, 'backup');
    if (result.ok) result.data.osProtected = existsSync(protectedKeyPath);
    return result;
  });
  handle(channels.backupExternal, noInputSchema, 'read', async () => {
    const chosen = await dialog.showOpenDialog(window!, {
      title: 'Choose external backup folder',
      properties: ['openDirectory'],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return success(null);
    const result = await service!.request({
      command: 'backupExternal',
      input: { directory: chosen.filePaths[0] },
    });
    if (!result.ok) return result;
    // Explicit reselection verifies a fresh copy, even if device history says an
    // older archive was copied to this destination before it went missing.
    const backup = await storageJob({ command: 'backupCreate' }, 'backup');
    if (!backup.ok) return backup;
    return backupStatus();
  });
  handle(channels.restorePreview, restoreInputSchema, 'restore', async (input) => {
    const chosen = await dialog.showOpenDialog(window!, {
      title: 'Select an encrypted MediPharm backup',
      properties: ['openFile'],
      filters: [{ name: 'MediPharm backup', extensions: ['mpbackup'] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return success(null);
    return service!.request({
      command: 'restorePreview',
      input: { ...input, filename: chosen.filePaths[0] },
    });
  });
  handle(channels.restoreConfirm, restoreConfirmSchema, 'restore', async (input) => {
    const confirmation = await dialog.showMessageBox(window!, {
      type: 'warning',
      title: 'Replace this pharmacy?',
      message: 'Restore the verified backup and replace the local pharmacy?',
      detail: input.salvage
        ? 'The damaged original files will be retained. They cannot be verified as a safety backup. Restore the selected archive and sign in with its owner account.'
        : 'Later local changes and unsaved drafts will be replaced. Any existing pharmacy gets a verified safety backup and its old data directory is retained. Sign in with the restored owner account afterwards.',
      buttons: ['Cancel', 'Restore pharmacy'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1)
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Restore cancelled. Current pharmacy data is unchanged.',
      };
    const result = await storageJob({ command: 'restoreConfirm', input }, 'restore');
    if (result.ok) draftDirty = false;
    return result;
  });
  handle(channels.restoreCancel, noInputSchema, 'restore', () =>
    service!.request({ command: 'restoreCancel' }),
  );
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
  setInterval(() => {
    void scheduledBackup();
  }, 5 * 60_000).unref();
  powerMonitor.on('resume', () => {
    void scheduledBackup();
  });
  setInterval(() => {
    void syncAccountState();
  }, 30_000).unref();
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 650,
    show: false,
    backgroundColor: '#f5f7fa',
    title: 'MediPharm Desktop Preview',
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
        'The desktop app could not start. Preserve the local data directory and check diagnostics.',
      );
      app.quit();
    });
}
