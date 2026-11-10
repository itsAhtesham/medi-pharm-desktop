import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { channels, saveRecordSchema, type DesktopStatus, type Result, type StorageStatus, type Verification } from '../contracts/desktop';
import { assetPath, prototypeRoot } from '../platform/paths';
import { ServiceClient } from './service-client';
import squirrelStartup from 'electron-squirrel-startup';

protocol.registerSchemesAsPrivileged([{ scheme: 'medipharm', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
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
const success = <T>(data: T): Result<T> => ({ ok: true, data });
const failure = (): Result<never> => ({ ok: false, code: 'NOT_READY', message: 'Local storage could not open. Preserve the prototype files and restart after checking the data directory.' });
const devUrl = !app.isPackaged ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
const appUrl = devUrl ?? 'medipharm://app/';

function registerApi(): void {
  const handle = (channel: string, action: (input: unknown) => unknown) => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame || !frame || new URL(frame.url).origin !== new URL(appUrl).origin || (!devUrl && !frame.url.startsWith('medipharm://app/'))) {
        return { ok: false, code: 'INVALID_REQUEST', message: 'This window is not allowed to use desktop services.' };
      }
      try { return await action(input); }
      catch { return { ok: false, code: 'STORAGE_ERROR', message: 'The operation could not be completed. Please try again.' }; }
    });
  };
  handle(channels.status, async () => {
    const result = service ? await service.request<StorageStatus>({ command: 'status' }) : failure();
    if (!result.ok) return result;
    return success<DesktopStatus>({ ...result.data, appVersion: app.getVersion(), electronVersion: process.versions.electron, platform: process.platform, architecture: process.arch, dataDirectory: root });
  });
  handle(channels.saveRecord, async (input) => {
    const parsed = saveRecordSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: 'Enter a sample note between 1 and 160 characters.' };
    return service?.request<StorageStatus>({ command: 'save', input: parsed.data }) ?? failure();
  });
  handle(channels.createSnapshot, () => service?.request<Verification>({ command: 'snapshot' }) ?? failure());
  handle(channels.verifyRestore, () => service?.request<Verification>({ command: 'verifyRestore' }) ?? failure());
  handle(channels.checkKeyStorage, async () => {
    if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) {
      return success({ protected: false, message: 'A protected Linux key store is not available. Windows DPAPI must be checked on your laptop.' });
    }
    if (!await safeStorage.isAsyncEncryptionAvailable()) return success({ protected: false, message: 'Protected key storage is unavailable on this device.' });
    const sample = randomBytes(32).toString('hex');
    const encrypted = await safeStorage.encryptStringAsync(sample);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const matches = decrypted.result === sample;
    return success({ protected: matches, message: matches ? 'The OS protected and recovered a temporary test key successfully.' : 'The protected key round trip failed.' });
  });
  handle(channels.chooseFolder, async () => {
    if (!window) return failure();
    const result = await dialog.showOpenDialog(window, { title: 'Test the native folder picker', properties: ['openDirectory'] });
    return success(result.canceled ? null : { name: path.basename(result.filePaths[0]) });
  });
}

async function start(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const csp = devUrl
    ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'`
    : `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed = url.protocol === 'medipharm:' || url.protocol === 'devtools:' || (Boolean(devUrl) && (url.origin === new URL(devUrl!).origin || ((url.protocol === 'ws:' || url.protocol === 'wss:') && url.hostname === new URL(devUrl!).hostname)));
    callback({ cancel: !allowed });
  });
  protocol.handle('medipharm', async (request) => {
    const filename = assetPath(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`), request.url);
    if (!filename || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    const contentType = types[path.extname(filename)];
    if (!contentType) return new Response('Not found', { status: 404 });
    try {
      return new Response(new Uint8Array(await readFile(filename)), { headers: { 'Content-Type': contentType, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  service = new ServiceClient(path.join(__dirname, 'service.cjs'), path.join(root, 'data'));
  try { await service.ready; } catch { /* The window presents a recovery message; no empty replacement is created. */ }
  registerApi();
  window = new BrowserWindow({
    width: 1180, height: 820, minWidth: 820, minHeight: 650, show: false,
    backgroundColor: '#f5f7fa', title: 'MediPharm Prototype', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  await window.loadURL(appUrl);
}

if (squirrelStartup || !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    quitting = true;
    void service.stop().finally(() => app.quit());
  });
  void app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('MediPharm could not start', 'The desktop prototype could not start. No pharmacy records have been created.');
    app.quit();
  });
}
