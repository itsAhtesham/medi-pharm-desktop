import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const packagedExecutable =
  process.env.MEDIPHARM_TEST_EXECUTABLE ??
  path.resolve(
    'out',
    `MediPharm Desktop Preview-${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'medipharm-preview.exe' : 'medipharm-preview',
  );
let root: string;
let app: ElectronApplication | undefined;

async function launch() {
  app = await electron.launch({
    executablePath: packagedExecutable,
    chromiumSandbox: true,
    env: { ...process.env, MEDIPHARM_PREVIEW_HOME: root },
    timeout: 20_000,
  });
  // Refuse an incompatible executable/profile before any fixture mutation.
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(root, 'runtime'));
  return app.firstWindow();
}
test.beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'medipharm-desktop-test-'));
});
test.afterEach(async () => {
  if (app) {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      })
      .catch(() => {});
  }
  await app?.close();
  app = undefined;
  await rm(root, { recursive: true, force: true });
});

const password = 'local test passphrase';
async function login(page: import('@playwright/test').Page, secret = password) {
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Owner identifier').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock workspace' })).toBeVisible();
}
async function setup(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Set up your pharmacy' })).toBeVisible();
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Test Pharmacy');
  await page.getByLabel('Owner identifier').fill('owner');
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  const code = (await page.getByTestId('recovery-code').textContent())!;
  await expect(page.getByRole('button', { name: 'Create pharmacy' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create pharmacy' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await login(page);
  return code;
}

test('packaged setup, settings save and restart require owner authentication', async () => {
  let page = await launch();
  expect(page.url()).toBe('medipharm://app/');
  await setup(page);
  await expect(page.getByTestId('customers-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Renamed Pharmacy');
  await page.getByRole('button', { name: 'Save pharmacy details' }).click();
  await expect(page.getByRole('status')).toContainText('Pharmacy details saved');
  await app!.close();
  app = undefined;
  page = await launch();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await page.evaluate(() => window.mediPharm.status())).toMatchObject({ ok: false });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Welcome to Renamed Pharmacy' })).toBeVisible();
  await page.screenshot({ path: 'test-results/owner-overview.png', fullPage: true });
});

test('password change and offline recovery rotate access without losing the pharmacy', async () => {
  const page = await launch();
  const code = await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await page.getByLabel('New password', { exact: true }).fill('changed test passphrase');
  await page.getByLabel('Confirm new password', { exact: true }).fill('changed test passphrase');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Owner identifier').fill('owner');
  await page.getByLabel('Saved recovery code', { exact: true }).fill(code);
  await page.getByLabel('New password', { exact: true }).fill('recovered test passphrase');
  await page.getByLabel('Confirm password', { exact: true }).fill('recovered test passphrase');
  expect(await page.getByTestId('recovery-code').textContent()).not.toBe(code);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Reset owner password' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await login(page, 'recovered test passphrase');
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveValue('Test Pharmacy');
});

test('renderer is sandboxed, remote requests are blocked and inputs are validated', async () => {
  const page = await launch();
  await setup(page);
  const isolated = await page.evaluate(() => ({
    node: typeof (window as unknown as { require?: unknown }).require,
    methods: Object.keys(window.mediPharm),
  }));
  expect(isolated.node).toBe('undefined');
  expect(isolated.methods.sort()).toEqual(
    [
      'exportCsv',
      'customerSupplies',
      'dashboard',
      'businessQuery',
      'businessSave',
      'purchasePreview',
      'openBackupFolder',
      'backupStatus',
      'backupConfigure',
      'backupRotate',
      'backupUnlock',
      'backupCreate',
      'backupExternal',
      'restorePreview',
      'restoreConfirm',
      'restoreCancel',
      'status',
      'setup',
      'login',
      'recover',
      'changePassword',
      'logout',
      'updatePharmacy',
      'lifecycle',
      'restartStorage',
      'setDraftDirty',
      'exportDiagnostics',
      'onLifecycle',
    ].sort(),
  );
  expect(
    await page.evaluate(() =>
      window.mediPharm.updatePharmacy({ requestId: 'invalid', name: 'x', expectedVersion: 1 }),
    ),
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com');
        return true;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
});

test('service death requires reauthentication and preserves the unsaved pharmacy draft', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Draft survives a crash');
  const pid = await app!.evaluate(
    ({ app }) => app.getAppMetrics().find((item) => item.name === 'MediPharm local storage')!.pid,
  );
  process.kill(pid, 'SIGKILL');
  await expect(page.getByRole('heading', { name: 'Local storage needs attention' })).toBeVisible();
  await page.getByRole('button', { name: 'Restart storage' }).click();
  await login(page);
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveValue(
    'Draft survives a crash',
  );
  expect(await page.evaluate(() => window.mediPharm.status())).toMatchObject({
    data: { pharmacy: { name: 'Test Pharmacy', version: 1 } },
  });
  await page.getByRole('button', { name: 'Save pharmacy details' }).click();
  await expect(page.getByRole('status')).toContainText('Pharmacy details saved');
});

test('locking preserves drafts and unsaved close can be cancelled', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Unsaved draft');
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveCount(0);
  await login(page);
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveValue('Unsaved draft');
  await page.evaluate(() => window.mediPharm.setDraftDirty(true));
  await app!.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveValue('Unsaved draft');
  await app!.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  const closed = app!.waitForEvent('close');
  await page.close();
  await closed;
  app = undefined;
});

test('diagnostics omit pharmacy details, secrets and local paths and refuse overwrites', async () => {
  const page = await launch();
  const code = await setup(page);
  const filename = path.join(root, 'diagnostics.json');
  await app!.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filename);
  await page.getByRole('button', { name: 'Save diagnostics' }).click();
  await expect(page.getByRole('status')).toContainText('Diagnostics saved');
  const exported = await readFile(filename, 'utf8');
  for (const secret of ['Test Pharmacy', password, code, root])
    expect(exported).not.toContain(secret);
  expect(JSON.parse(exported).events).toEqual(
    expect.arrayContaining([expect.objectContaining({ event: 'service.ready' })]),
  );
  await page.getByRole('button', { name: 'Save diagnostics' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  expect(await readFile(filename, 'utf8')).toBe(exported);
});

test('another renderer cannot invoke the trusted window API', async () => {
  const page = await launch();
  await setup(page);
  const rejected = await app!.evaluate(async ({ BrowserWindow }) => {
    const foreign = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    try {
      await foreign.loadURL('about:blank');
      return await foreign.webContents.executeJavaScript(
        "require('electron').ipcRenderer.invoke('desktop:status', { version: 1 })",
      );
    } finally {
      foreign.destroy();
    }
  });
  expect(rejected).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
});

test('lifecycle listeners unsubscribe and navigation works by keyboard', async () => {
  const page = await launch();
  await setup(page);
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { removedListenerEvents: unknown[] }).removedListenerEvents = events;
    const unsubscribe = window.mediPharm.onLifecycle((event) => events.push(event));
    unsubscribe();
  });
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await login(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { removedListenerEvents: unknown[] }).removedListenerEvents,
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Overview', exact: true }).focus();
  for (const section of ['Customers', 'Medicines', 'Purchases', 'Follow-ups', 'Reports']) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Pharmacy details', exact: true })).toBeVisible();
});

test('a missing initialized database enters recovery without replacing it', async () => {
  let page = await launch();
  await setup(page);
  await app!.close();
  app = undefined;
  await rm(path.join(root, 'data', 'live', 'medipharm.sqlite'));
  page = await launch();
  await expect(page.getByRole('heading', { name: 'Local storage needs attention' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create pharmacy' })).toHaveCount(0);
});

test('second launch reuses the window and closing stops the database service', async () => {
  const page = await launch();
  await setup(page);
  const pid = await app!.evaluate(
    ({ app }) => app.getAppMetrics().find((item) => item.name === 'MediPharm local storage')?.pid,
  );
  expect(pid).toBeDefined();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(packagedExecutable, [], {
      env: { ...process.env, MEDIPHARM_PREVIEW_HOME: root },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Second instance did not exit.'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Second instance exited ${code}`));
    });
  });
  expect(app!.windows()).toHaveLength(1);
  const closed = app!.waitForEvent('close');
  await page.close();
  await closed;
  app = undefined;
  await expect
    .poll(() => {
      try {
        process.kill(pid!, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
});

const backupPassphrase = 'separate desktop backup phrase';
async function configureBackups(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Open backups & restore', exact: true }).click();
  await page.getByLabel('New backup passphrase', { exact: true }).fill(backupPassphrase);
  await page.getByLabel('Confirm backup passphrase', { exact: true }).fill(backupPassphrase);
  await page.getByLabel('I have saved this backup passphrase separately').check();
  await page.getByLabel('Remember securely on this computer', { exact: false }).uncheck();
  await page.getByRole('button', { name: 'Set up encrypted backups' }).click();
  await expect(page.getByRole('button', { name: 'Create encrypted backup' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create encrypted backup' }).click();
  await expect(page.getByRole('status')).toContainText('Local encrypted backup verified');
  return path.join(
    root,
    'backups',
    (await readdir(path.join(root, 'backups'))).find((file) => file.endsWith('.mpbackup'))!,
  );
}

test('encrypted backup, verified restore, safety copy and restored owner login work in the package', async () => {
  const page = await launch();
  await setup(page);
  const filename = await configureBackups(page);
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Later pharmacy name');
  await page.getByRole('button', { name: 'Save pharmacy details' }).click();
  await expect(page.getByText('Pharmacy details saved on this computer.')).toBeVisible();
  await page.getByRole('button', { name: 'Open backups & restore', exact: true }).click();
  await app!.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, filename);
  await page.getByLabel('Passphrase for the archive').fill(backupPassphrase);
  await page.getByRole('button', { name: 'Choose and verify backup' }).click();
  await expect(page.getByRole('heading', { name: 'Verified: Test Pharmacy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review restore', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Create encrypted backup' })).toBeHidden();
  await expect(page.getByLabel('Passphrase for the archive')).toBeHidden();
  await page.getByRole('button', { name: 'Back to backups & restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review restore', exact: true })).toHaveCount(0);
  await page.getByLabel('Passphrase for the archive').fill(backupPassphrase);
  await page.getByRole('button', { name: 'Choose and verify backup' }).click();
  await expect(page.getByRole('button', { name: 'Restore this pharmacy' })).toBeDisabled();
  await page.getByLabel('Type RESTORE to confirm replacement').fill('RESTORE');
  await page.screenshot({ path: 'test-results/backup-restore-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Restore this pharmacy' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Welcome to Test Pharmacy' })).toBeVisible();
  const history = JSON.parse(await readFile(path.join(root, 'operations', 'backups.json'), 'utf8'));
  expect(history.records.some((record: { kind: string }) => record.kind === 'safety')).toBe(true);
});

test('fresh profile restores a portable archive without the previous OS key and rejects a wrong passphrase', async () => {
  let page = await launch();
  await setup(page);
  const filename = await configureBackups(page);
  const saved = await mkdtemp(path.join(tmpdir(), 'medipharm-portable-desktop-'));
  try {
    const archive = path.join(saved, 'portable.mpbackup');
    await copyFile(filename, archive);
    await app!.close();
    app = undefined;
    await rm(root, { recursive: true, force: true });
    root = await mkdtemp(path.join(tmpdir(), 'medipharm-fresh-desktop-'));
    page = await launch();
    await app!.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, archive);
    await page.getByLabel('Passphrase for the archive').fill('incorrect archive phrase');
    await page.getByRole('button', { name: 'Choose and verify backup' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be opened');
    await page.getByLabel('Passphrase for the archive').fill(backupPassphrase);
    await page.getByRole('button', { name: 'Choose and verify backup' }).click();
    await expect(page.getByRole('heading', { name: 'Verified: Test Pharmacy' })).toBeVisible();
    await page.getByLabel('Type RESTORE to confirm replacement').fill('RESTORE');
    await page.getByRole('button', { name: 'Restore this pharmacy' }).click();
    await login(page);
    await expect(page.getByRole('heading', { name: 'Welcome to Test Pharmacy' })).toBeVisible();
  } finally {
    await rm(saved, { recursive: true, force: true });
  }
});

test('unavailable OS protection keeps the backup key in memory and requires unlocking after restart', async () => {
  let page = await launch();
  await setup(page);
  await app!.evaluate(({ safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => false;
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Open backups & restore', exact: true }).click();
  await page.getByLabel('New backup passphrase', { exact: true }).fill(backupPassphrase);
  await page.getByLabel('Confirm backup passphrase', { exact: true }).fill(backupPassphrase);
  await page.getByLabel('I have saved this backup passphrase separately').check();
  await page.getByRole('button', { name: 'Set up encrypted backups' }).click();
  await expect(page.getByText('Unlocked for this app session', { exact: false })).toBeVisible();
  expect((await readdir(path.join(root, 'settings'))).includes('backup-key.protected')).toBe(false);
  await app!.close();
  app = undefined;
  page = await launch();
  await login(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Open backups & restore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create encrypted backup' })).toBeDisabled();
  await page.getByLabel('Backup passphrase', { exact: true }).fill(backupPassphrase);
  await page.getByLabel('Remember securely on this computer', { exact: false }).uncheck();
  await page.getByRole('button', { name: 'Unlock backups' }).click();
  await expect(page.getByRole('button', { name: 'Create encrypted backup' })).toBeEnabled();
});

test('recovery mode explicitly preserves a damaged installation while restoring a verified archive', async () => {
  let page = await launch();
  await setup(page);
  const filename = await configureBackups(page);
  await app!.close();
  app = undefined;
  await rm(path.join(root, 'data', 'live', 'medipharm.sqlite'));
  page = await launch();
  await expect(page.getByRole('heading', { name: 'Local storage needs attention' })).toBeVisible();
  await app!.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, filename);
  await page.getByLabel('Passphrase for the archive').fill(backupPassphrase);
  await page.getByRole('button', { name: 'Choose and verify backup' }).click();
  await expect(
    page.getByText('The current installation is damaged.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Type RESTORE to confirm replacement').fill('RESTORE');
  await page.getByRole('button', { name: 'Restore this pharmacy' }).click();
  await expect(
    page.getByText('Restore completed. A new backup was not created;', { exact: false }),
  ).toBeVisible();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Welcome to Test Pharmacy' })).toBeVisible();
});

test('external folder reselection verifies a fresh copy instead of relying on an old success record', async () => {
  const page = await launch();
  await setup(page);
  await configureBackups(page);
  const external = await mkdtemp(path.join(tmpdir(), 'medipharm-reselect-'));
  try {
    await app!.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, external);
    await page.getByRole('button', { name: 'Choose external backup folder' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Local and external encrypted backups verified',
    );
    const first = (await readdir(external)).filter((file) => file.endsWith('.mpbackup'));
    expect(first.length).toBeGreaterThan(0);
    for (const file of first) await rm(path.join(external, file));
    await page.getByRole('button', { name: 'Reselect external folder', exact: false }).click();
    await expect(page.getByRole('status')).toContainText(
      'Local and external encrypted backups verified',
    );
    const verified = (await readdir(external)).filter((file) => file.endsWith('.mpbackup'));
    expect(verified.length).toBeGreaterThan(0);
    expect(verified.some((file) => first.includes(file))).toBe(false);
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});

test('customer, medicine, purchase, contact, refill and cancellation work through desktop screens', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase', exact: true }).click();
  await page.getByLabel('Purchase notes').fill('First desktop supply');
  await page.getByRole('button', { name: 'Add customer here' }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Asha Rao');
  await page.getByLabel('Phone', { exact: true }).fill('+91 98765 43210');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByLabel('Purchase notes')).toHaveValue('First desktop supply');
  await page.getByRole('button', { name: 'Add medicine here' }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Test medicine');
  await page.getByLabel('Strength', { exact: true }).fill('10 mg');
  await page.getByRole('button', { name: 'Save medicine', exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('1.250');
  await page.getByLabel('Amount (₹)', { exact: true }).fill('0');
  await page.getByLabel('Days supplied', { exact: true }).fill('1');
  await page.getByLabel('Enable reminder for Test medicine · 10 mg · tablet').check();
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await expect(page.locator('.supply-estimate')).toContainText('Carry 0 days');
  await page.screenshot({ path: 'test-results/purchase-supply-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await page.getByRole('button', { name: 'View purchase #1', exact: true }).click();
  await expect(page.locator('.purchase-detail')).toContainText('1.25 tablets');
  await page.getByRole('button', { name: 'Correct purchase', exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('99');
  await page.getByLabel('Days supplied', { exact: true }).fill('30');
  await page.getByLabel('Purchase notes').fill('Unsaved correction');
  await page.getByLabel('Correction reason').fill('Test reset');
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await expect(page.getByRole('button', { name: 'Save purchase', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('1.25');
  await expect(page.getByLabel('Days supplied', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Purchase notes')).toHaveValue('First desktop supply');
  await expect(page.getByLabel('Correction reason')).toHaveValue('');
  await expect(page.locator('.supply-estimate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save purchase', exact: true })).toBeDisabled();
  await page.getByLabel('Purchase notes').fill('Corrected supply note');
  await page.getByLabel('Correction reason').fill('Clarify the note');
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Follow-ups', exact: true }).click();
  await page.getByRole('button', { name: 'Record follow-up', exact: true }).click();
  await page.getByLabel('Contact outcome / note').fill('Reached customer; call tomorrow');
  const tomorrow = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const day = new Date(`${parts}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    return day.toISOString().slice(0, 10);
  });
  await page.getByLabel('Next contact date (optional for contact)').fill(tomorrow);
  await page.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await page.getByLabel('Follow-up view').selectOption('scheduled');
  await expect(page.locator('.follow-row')).toContainText('Awaiting refill');
  await page.getByRole('button', { name: 'Contact history', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Contact history · Asha Rao/ })).toBeVisible();
  await expect(page.getByLabel('Follow-up view')).toBeHidden();
  await expect(page.locator('.history-view')).toContainText('Reached customer; call tomorrow');
  await page.getByRole('button', { name: 'Back to follow-ups', exact: true }).click();
  await expect(page.getByLabel('Follow-up view')).toHaveValue('scheduled');
  await page.getByRole('button', { name: 'Record refill', exact: true }).click();
  await page.getByLabel('Days supplied', { exact: true }).fill('21');
  await page.getByLabel('Refill choice', { exact: true }).selectOption('replace');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByLabel('Days supplied', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Refill choice', { exact: true })).toHaveValue('');
  await expect(page.locator('.business-editor')).toContainText('Customer: Asha Rao');
  await page.getByLabel('Days supplied', { exact: true }).fill('3');
  await page.getByLabel('Amount (₹)', { exact: true }).fill('0');
  await page.getByLabel('Refill choice', { exact: true }).selectOption('extend');
  await page.getByLabel('Enable reminder for Test medicine 10 mg tablet').check();
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await expect(page.locator('.supply-estimate')).toContainText('Carry 1 days');
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'View purchase #2', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel purchase', exact: true }).click();
  await page.getByLabel('Cancellation reason').fill('Duplicate refill');
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await page.getByRole('button', { name: 'Follow-ups', exact: true }).click();
  await page.getByLabel('Follow-up view').selectOption('scheduled');
  await expect(page.locator('.follow-row')).toHaveCount(1);
  await expect(page.locator('.follow-row')).toContainText(tomorrow);
  await expect(page.locator('.follow-row')).toContainText('Awaiting refill');
  await page.screenshot({ path: 'test-results/customer-followups.png', fullPage: true });
  await app!.close();
  app = undefined;
  const restarted = await launch();
  await login(restarted);
  await restarted.getByRole('button', { name: 'Customers', exact: true }).click();
  await restarted.getByLabel('Search customers', { exact: true }).fill('98765');
  await expect(restarted.locator('.record-row')).toContainText('Asha Rao');
  await restarted.getByRole('button', { name: 'View purchases', exact: true }).click();
  await expect(
    restarted.getByRole('heading', { name: 'Purchase history · Asha Rao', exact: true }),
  ).toBeFocused();
  await expect(restarted.getByLabel('Search customers', { exact: true })).toBeHidden();
  await restarted.screenshot({ path: 'test-results/dedicated-purchase-history.png' });
  await expect(
    restarted.getByRole('button', { name: 'View purchase #1', exact: true }),
  ).toBeVisible();
  await restarted.getByRole('button', { name: 'View purchase #1', exact: true }).click();
  await expect(restarted.locator('.purchase-history')).toBeHidden();
  await expect(restarted.locator('.purchase-detail h2')).toBeFocused();
  await expect.poll(() => restarted.locator('.main-layout').evaluate((e) => e.scrollTop)).toBe(0);
  await restarted.screenshot({ path: 'test-results/dedicated-purchase-details.png' });
  await restarted.getByRole('button', { name: 'View audit history', exact: true }).click();
  await expect(restarted.locator('.purchase-detail')).toBeHidden();
  await expect(
    restarted.getByRole('heading', { name: 'Audit history · Purchase #1', exact: true }),
  ).toBeFocused();
  await expect(restarted.locator('.audit-history article').first()).toBeVisible();
  await restarted.getByRole('button', { name: 'Back to purchase #1', exact: true }).click();
  await restarted.getByRole('button', { name: 'Back to purchase history', exact: true }).click();
  await expect(restarted.locator('.purchase-history h2')).toBeFocused();
  await expect(
    restarted.getByRole('button', { name: 'View purchase #1', exact: true }),
  ).toBeVisible();
  await restarted.getByRole('button', { name: 'Back to customers', exact: true }).click();
  await expect(restarted.locator('.related-history')).toHaveCount(0);
  await expect(restarted.getByLabel('Search customers', { exact: true })).toHaveValue('98765');
});

test('business drafts survive locking and catalogue archive/restore preserves the original record', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Preserved draft');
  await page.getByLabel('Phone', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await login(page);
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Preserved draft');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await page.getByRole('button', { name: 'Edit customer', exact: true }).click();
  await page.getByLabel('Archived — retain history and exclude from new purchases').check();
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible();
  await page.getByLabel('Record status', { exact: true }).selectOption('archived');
  await page.getByRole('button', { name: 'Edit customer', exact: true }).click();
  await page.getByLabel('Archived — retain history and exclude from new purchases').uncheck();
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await page.getByLabel('Record status', { exact: true }).selectOption('active');
  await expect(page.locator('.record-row')).toHaveCount(1);
  await expect(page.locator('.record-row')).toContainText('Preserved draft');
});

test('current supplies and native CSV exports preserve filters, history and existing files', async () => {
  const page = await launch();
  await setup(page);
  const ids = await page.evaluate(async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const c = await window.mediPharm.businessSave({
      kind: 'customer',
      requestId: crypto.randomUUID(),
      id: null,
      expectedVersion: null,
      name: 'Report Customer',
      phone: '+91 98765 43210',
      age: null,
      notes: 'Export example',
      archived: false,
    });
    if (!c.ok) throw new Error(c.message);
    const medicines: string[] = [];
    for (const name of ['Report medicine A', 'Report medicine B']) {
      const m = await window.mediPharm.businessSave({
        kind: 'medicine',
        requestId: crypto.randomUUID(),
        id: null,
        expectedVersion: null,
        name,
        strength: '10 mg',
        form: 'tablet',
        archived: false,
      });
      if (!m.ok) throw new Error(m.message);
      medicines.push(m.data.id);
    }
    const p = {
      id: null,
      expectedVersion: null,
      customerId: c.data.id,
      date: today,
      notes: 'Report purchase',
      reason: '',
      pricing: { currencyCode: 'INR' as const, discount: { type: 'none' as const } },
      items: medicines.map((medicineId) => ({
        medicineId,
        amount: '125.50',
        quantity: '1.250',
        unit: 'tablets' as const,
      })),
      supplies: medicines.map((medicineId, index) => ({
        medicineId,
        start: today,
        days: index ? 7 : 1,
        mode: 'replace' as const,
        remaining: null,
        reminder: !index,
        manualDate: null,
        confirmLate: false,
      })),
    };
    const preview = await window.mediPharm.purchasePreview(p);
    if (!preview.ok) throw new Error(preview.message);
    const saved = await window.mediPharm.businessSave({
      ...p,
      kind: 'purchase',
      requestId: crypto.randomUUID(),
      previewFingerprint: preview.data.fingerprint,
      expectedRevision: preview.data.revision,
    });
    if (!saved.ok) throw new Error(saved.message);
    const list = await window.mediPharm.businessQuery({ kind: 'followups', customerId: c.data.id });
    if (!list.ok) throw new Error(list.message);
    const f = list.data.followups[0];
    const contact = await window.mediPharm.businessSave({
      kind: 'followup',
      requestId: crypto.randomUUID(),
      id: f.id,
      expectedVersion: f.version,
      action: 'contact',
      note: 'Reached customer for report',
      date: null,
    });
    if (!contact.ok) throw new Error(contact.message);
    return { customerId: c.data.id, purchaseId: saved.data.id };
  });
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'View current supplies', exact: true }).click();
  const supplies = page.getByRole('region', { name: 'Current medicine supplies' });
  await expect(page.getByLabel('Search customers', { exact: true })).toBeHidden();
  await expect(supplies.locator('.supply-report-row')).toHaveCount(2);
  await expect(supplies).toContainText('1 estimated days remaining');
  await expect(supplies).toContainText('7 estimated days remaining');
  await expect(supplies).toContainText('Reminder disabled');
  await expect(supplies).toContainText('Due today');
  await page.screenshot({ path: 'test-results/current-supplies.png', fullPage: true });
  await supplies.getByLabel('Search current medicines').fill('Report medicine A');
  await expect(supplies.locator('.supply-report-row')).toHaveCount(1);
  await supplies.getByRole('button', { name: 'View source purchase #1' }).first().click();
  await expect(page.locator('.purchase-detail')).toContainText('Report purchase');
  await expect(supplies).toBeHidden();
  await page.getByRole('button', { name: 'Correct purchase', exact: true }).click();
  await page.getByLabel('Purchase notes').fill('Unsaved correction');
  await page.getByRole('button', { name: 'Back to purchase #1', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await expect(page.locator('.purchase-detail h2')).toBeFocused();
  await expect(page.locator('.purchase-detail')).toContainText('Report purchase');
  await page.getByRole('button', { name: 'Back to current supplies', exact: true }).click();
  await expect(supplies.getByLabel('Search current medicines')).toHaveValue('Report medicine A');
  await expect(supplies.locator('.supply-report-row')).toHaveCount(1);
  await expect(supplies.getByRole('heading', { level: 2 })).toBeFocused();
  await supplies.getByRole('button', { name: 'Back to customers', exact: true }).click();
  await expect(supplies).toHaveCount(0);
  const output = await mkdtemp(path.join(tmpdir(), 'medipharm-csv-desktop-'));
  const file = path.join(output, 'customers.csv');
  try {
    await app!.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    }, file);
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('CSV saved: 1 data rows.');
    expect(await readFile(file, 'utf8')).toContain('Report Customer');
    await page.getByLabel('Search customers', { exact: true }).fill('Not a match');
    await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible();
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('CSV saved: 0 data rows.');
    const empty = await readFile(file, 'utf8');
    expect(empty).not.toContain('Report Customer');
    await app!.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
    });
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('CSV export cancelled.');
    expect(await readFile(file, 'utf8')).toBe(empty);
    await app!.evaluate(
      ({ dialog }, filename) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
      },
      path.join(root, 'data', 'live', 'bad.csv'),
    );
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('outside the application data folder');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Open CSV exports', exact: true }).click();
    await page.getByLabel('Records to export', { exact: true }).selectOption('followupHistory');
    const history = path.join(output, 'history.csv');
    await app!.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    }, history);
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('CSV saved: 2 data rows.');
    expect(await readFile(history, 'utf8')).toContain('Reached customer for report');
    const denied = await page.evaluate(async () => ({
      invalid: await window.mediPharm.exportCsv({ kind: 'constructor' } as never),
      path: await window.mediPharm.exportCsv({
        kind: 'customers',
        filename: '/tmp/unrequested.csv',
      } as never),
    }));
    expect(denied.invalid).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(denied.path).toMatchObject({ code: 'INVALID_REQUEST' });
    await page.getByRole('button', { name: 'Lock workspace' }).click();
    expect(
      await page.evaluate(
        async (id) => ({
          supply: await window.mediPharm.customerSupplies({ customerId: id }),
          csv: await window.mediPharm.exportCsv({ kind: 'customers' }),
        }),
        ids.customerId,
      ),
    ).toMatchObject({ supply: { ok: false }, csv: { ok: false } });
    await login(page);
    await page.getByRole('button', { name: 'Customers', exact: true }).click();
    await page.getByRole('button', { name: 'View current supplies', exact: true }).click();
    await expect(page.locator('.supply-report-row')).toHaveCount(2);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('dashboard quick actions preserve drafts, show saved totals and fit desktop sizes and zoom', async () => {
  const page = await launch();
  await setup(page);
  const quick = page.getByRole('complementary', { name: 'Quick actions' });
  await quick.getByRole('button', { name: 'New customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Dashboard Customer');
  await page.getByLabel('Phone', { exact: true }).fill('9876543210');
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  expect(await page.evaluate(() => window.mediPharm.dashboard())).toMatchObject({
    ok: false,
    code: 'NOT_READY',
  });
  await login(page);
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Dashboard Customer');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('customers-count')).toHaveText('1');
  await quick.getByRole('button', { name: 'New medicine', exact: true }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Dashboard Medicine');
  await page.getByRole('button', { name: 'Save medicine', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('medicines-count')).toHaveText('1');
  await quick.getByRole('button', { name: 'Record purchase', exact: true }).click();
  await expect(page.getByLabel('Purchase date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.evaluate(async () => {
    const api = window.mediPharm;
    const customers = await api.businessQuery({ kind: 'customers' }),
      medicines = await api.businessQuery({ kind: 'medicines' });
    if (!customers.ok || !medicines.ok) throw new Error('Fixture catalogs unavailable');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const medicineId = medicines.data.medicines[0].id;
    const draft = {
      id: null,
      expectedVersion: null,
      customerId: customers.data.customers[0].id,
      date: today,
      notes: 'Dashboard example',
      reason: '',
      pricing: { currencyCode: 'INR' as const, discount: { type: 'none' as const } },
      items: [{ medicineId, amount: '125.50', quantity: '10', unit: 'tablets' as const }],
      supplies: [
        {
          medicineId,
          start: today,
          days: 1,
          mode: 'replace' as const,
          remaining: null,
          reminder: true,
          manualDate: null,
          confirmLate: false,
        },
      ],
    };
    const preview = await api.purchasePreview(draft);
    if (!preview.ok) throw new Error(preview.message);
    const saved = await api.businessSave({
      ...draft,
      kind: 'purchase',
      requestId: crypto.randomUUID(),
      previewFingerprint: preview.data.fingerprint,
      expectedRevision: preview.data.revision,
    });
    if (!saved.ok) throw new Error(saved.message);
  });
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByTestId('purchases-count')).toHaveText('1');
  await expect(page.getByTestId('ending-count')).toHaveText('1');
  await expect(page.getByRole('img', { name: /Active purchase counts/ })).toBeVisible();
  await page.locator('#ending-panel').getByRole('button', { name: 'Dashboard Customer' }).click();
  await expect(page.getByRole('region', { name: 'Current medicine supplies' })).toContainText(
    'Dashboard Medicine',
  );
  await page.getByRole('button', { name: 'Back to overview', exact: true }).click();
  await quick.getByRole('button', { name: 'Due follow-ups', exact: true }).click();
  await expect(page.getByLabel('Follow-up view')).toHaveValue('due');
  await expect(page.locator('.follow-row')).toContainText('Dashboard Medicine');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await quick.getByRole('button', { name: 'Create backup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Encrypted backups & restore' })).toBeVisible();
  await configureBackups(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await quick.getByRole('button', { name: 'Create backup', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Encrypted backup created and verified.');
  await expect(page.getByLabel('Storage status')).toContainText('Last verified backup:');
  for (const [width, height, zoom] of [
    [1920, 1080, 1],
    [1366, 768, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    const contentWidth = await app!.evaluate(
      ({ BrowserWindow }, size) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setSize(size[0], size[1]);
        w.webContents.setZoomFactor(size[2]);
        return w.getContentBounds().width;
      },
      [width, height, zoom],
    );
    await expect
      .poll(() =>
        page.evaluate(() => Math.abs(window.innerWidth - document.documentElement.clientWidth)),
      )
      .toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await page.locator('.main-layout').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await expect
      .poll(() => page.evaluate(() => window.innerWidth))
      .toBeCloseTo(contentWidth / zoom, 0);
    await expect(page.getByTestId('customers-count')).toBeVisible();
    for (const selector of ['.dashboard-metrics', '.header-lock', '.status-bar']) {
      expect(
        await page
          .locator(selector)
          .evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth + 1),
      ).toBe(true);
    }
    // Quick actions can scroll the workspace; frame each overview capture from the top.
    await page.locator('.main-layout').evaluate(async (element) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      element.scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    // Native capture respects Electron zoom; CDP page screenshots crop zoomed windows.
    const png = await app!.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
    );
    await writeFile(`test-results/dashboard-${width}-${zoom}.png`, Buffer.from(png, 'base64'));
    if (zoom === 1.5) {
      await page.getByRole('button', { name: 'Toggle workspace shortcuts' }).click();
      await expect(page.getByRole('complementary', { name: 'Workspace shortcuts' })).toBeVisible();
      await page.getByRole('button', { name: 'Toggle workspace shortcuts' }).click();
    }
    await page.getByRole('button', { name: 'Customers', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add customer', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
  }
});

for (const kind of ['customer', 'medicine'] as const) {
  test(`${kind} form clears, resets edits, and confirms draft navigation`, async () => {
    const page = await launch();
    await setup(page);
    const section = kind === 'customer' ? 'Customers' : 'Medicines';
    const other = kind === 'customer' ? 'Medicines' : 'Customers';
    const name = page.getByLabel(kind === 'customer' ? 'Customer name' : 'Medicine name', {
      exact: true,
    });
    const secondary = page.getByLabel(kind === 'customer' ? 'Phone' : 'Strength', { exact: true });
    await page.getByRole('button', { name: section, exact: true }).click();
    await page.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
    await name.fill('Unsaved entry');
    await secondary.fill(kind === 'customer' ? '9876543210' : '10 mg');
    await page.getByRole('button', { name: other, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard unsaved draft?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue editing' })).toBeFocused();
    if (kind === 'customer') await page.screenshot({ path: 'test-results/discard-navigation.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(name).toHaveValue('Unsaved entry');
    await page.getByRole('button', { name: other, exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue editing' }).click();
    await expect(name).toHaveValue('Unsaved entry');
    if (kind === 'customer') {
      await page.screenshot({ path: 'test-results/customer-form-actions.png' });
      await page.getByRole('button', { name: other, exact: true }).click();
      await page.evaluate(() => window.mediPharm.logout());
      await login(page);
      await expect(dialog).toHaveCount(0);
      await expect(name).toHaveValue('Unsaved entry');
    }
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(name).toHaveValue('');
    await expect(secondary).toHaveValue('');
    if (kind === 'medicine')
      await expect(page.getByLabel('Form', { exact: true })).toHaveValue('tablet');
    await name.fill('Saved entry');
    await secondary.fill(kind === 'customer' ? '9876543210' : '10 mg');
    await page.getByRole('button', { name: `Save ${kind}`, exact: true }).click();
    await expect(page.locator('.record-row')).toContainText('Saved entry');
    await page.getByLabel(`Search ${section.toLowerCase()}`, { exact: true }).fill('Saved');
    await page.getByRole('button', { name: `Edit ${kind}`, exact: true }).click();
    await name.fill('Changed entry');
    await secondary.fill(kind === 'customer' ? '9123456789' : '20 mg');
    await page.getByLabel('Archived — retain history and exclude from new purchases').check();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(name).toHaveValue('Saved entry');
    await expect(secondary).toHaveValue(kind === 'customer' ? '9876543210' : '10 mg');
    await expect(
      page.getByLabel('Archived — retain history and exclude from new purchases'),
    ).not.toBeChecked();
    await name.fill('Discard these edits');
    await page
      .getByRole('button', { name: `Back to ${section.toLowerCase()}`, exact: true })
      .click();
    await expect(dialog.getByRole('button', { name: 'Continue editing' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(name).toHaveValue('Discard these edits');
    await page
      .getByRole('button', { name: `Back to ${section.toLowerCase()}`, exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Discard and leave' }).click();
    await expect(page.getByLabel(`Search ${section.toLowerCase()}`, { exact: true })).toHaveValue(
      'Saved',
    );
    await expect(page.getByLabel(`Search ${section.toLowerCase()}`, { exact: true })).toBeFocused();
    await expect(page.locator('.record-row')).toContainText('Saved entry');
    await page.getByRole('button', { name: `Add ${kind}`, exact: true }).click();
    await name.fill('Do not save this');
    await page.getByRole('button', { name: other, exact: true }).click();
    await dialog.getByRole('button', { name: 'Discard and switch' }).click();
    await expect(page.getByRole('heading', { name: other, exact: true })).toBeVisible();
    await page.getByRole('button', { name: section, exact: true }).click();
    await expect(page.locator('.record-row')).toHaveCount(1);
    await expect(page.locator('.business-editor')).toHaveCount(0);
  });
}

test('inline clear and discard retain the purchase, while confirmed shortcut navigation discards the whole draft', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase', exact: true }).click();
  await page.getByLabel('Purchase notes').fill('Keep the parent purchase');
  await page.getByRole('button', { name: 'Add customer here' }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Inline draft');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Discard inline changes', exact: true }).click();
  await expect(page.getByLabel('Purchase notes')).toHaveValue('Keep the parent purchase');
  await page.getByRole('button', { name: 'Add medicine here' }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Inline medicine draft');
  await page.getByRole('button', { name: 'Back to purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page.getByLabel('Medicine name', { exact: true })).toHaveValue(
    'Inline medicine draft',
  );
  await page.getByRole('button', { name: 'Back to purchase', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toContainText('will also be discarded');
  await page.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await expect(page.getByLabel('Purchase notes')).toHaveValue('Keep the parent purchase');
  await expect(page.locator('.business-editor h2')).toBeFocused();
  await page.getByRole('button', { name: 'Add medicine here' }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Inline medicine draft');
  await page.getByRole('button', { name: 'Register customer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved draft?' });
  await dialog.getByRole('button', { name: 'Continue editing' }).click();
  await expect(page.getByLabel('Medicine name', { exact: true })).toHaveValue(
    'Inline medicine draft',
  );
  await page.getByRole('button', { name: 'Register customer', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await expect(page.locator('.business-editor')).toHaveCount(0);
  expect(await page.evaluate(() => window.mediPharm.status())).toMatchObject({
    ok: true,
    data: { customers: 0, medicines: 0, purchases: 0 },
  });
});

test('an uncertain save keeps the submitted form frozen instead of allowing navigation or clear', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Frozen submission');
  await page.getByLabel('Phone', { exact: true }).fill('9876543210');
  // Simulate an unknown response at the IPC boundary without weakening the app's API.
  await app!.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('desktop:business-save');
    ipcMain.handle('desktop:business-save', () => ({
      ok: false,
      code: 'OUTCOME_UNKNOWN',
      message: 'Test save outcome is unknown.',
    }));
  });
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same submission' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Medicines', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lock workspace' }).click();
  await login(page);
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Frozen submission');
  await expect(page.getByRole('button', { name: 'Medicines', exact: true })).toBeDisabled();
});

test('purchase amounts, supplies and calendar fields survive save, restart, export and restore', async () => {
  test.setTimeout(90_000);
  let page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer here' }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Calendar Customer');
  await page.getByLabel('Phone', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  for (const name of ['First medicine', 'Second medicine']) {
    await page.getByRole('button', { name: 'Add medicine here' }).click();
    await page.getByLabel('Medicine name', { exact: true }).fill(name);
    await page.getByLabel('Strength', { exact: true }).fill('10 mg');
    await page.getByRole('button', { name: 'Save medicine', exact: true }).click();
  }
  const firstRow = page.getByRole('group', {
    name: 'Quantity row for First medicine · 10 mg · tablet',
    exact: true,
  });
  const secondRow = page.getByRole('group', {
    name: 'Quantity row for Second medicine · 10 mg · tablet',
    exact: true,
  });
  await firstRow.getByLabel('Amount (₹)').fill('125.50');
  await secondRow.getByLabel('Amount (₹)').fill('74.50');
  await page.getByLabel('Discount (₹)', { exact: true }).fill('200.01');
  await expect(page.locator('.business-editor')).toContainText('The discount exceeds the subtotal');
  await page.getByLabel('Enter discount as percentage').check();
  await expect(page.getByLabel('Discount (%)', { exact: true })).toHaveValue('');
  await page.getByLabel('Discount (%)', { exact: true }).fill('12.50');
  await firstRow.getByLabel('Quantity', { exact: true }).fill('2');
  await secondRow.getByLabel('Quantity', { exact: true }).fill('3.5');
  await secondRow.getByLabel('Unit', { exact: true }).selectOption('strips');
  await expect(firstRow.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await expect(firstRow.getByLabel('Unit', { exact: true })).toHaveValue('tablets');
  const firstSupply = page.getByRole('region', {
    name: 'Supply for First medicine · 10 mg · tablet',
    exact: true,
  });
  const secondSupply = page.getByRole('region', {
    name: 'Supply for Second medicine · 10 mg · tablet',
    exact: true,
  });
  await firstSupply.getByLabel('Days supplied', { exact: true }).fill('7');
  await secondSupply.getByLabel('Days supplied', { exact: true }).fill('14');
  const choice = firstSupply.getByLabel('Refill choice', { exact: true });
  await expect(choice.locator('option:enabled')).toHaveText([
    'Extend remaining supply',
    'Replace — start fresh',
  ]);
  await expect(choice.locator('option[value=""]')).toBeDisabled();
  await expect(choice.locator('option[value=""]')).toHaveAttribute('hidden', '');
  await choice.focus();
  await page.keyboard.press('ArrowDown');
  await expect(choice).toHaveValue('extend');
  await page.keyboard.press('ArrowDown');
  await expect(choice).toHaveValue('replace');
  await expect(
    firstSupply.getByLabel('Remaining days adjustment (optional)', { exact: true }),
  ).toBeDisabled();
  await choice.selectOption('extend');
  await firstSupply.getByLabel('Remaining days adjustment (optional)', { exact: true }).fill('0');
  await expect(secondSupply.getByLabel('Refill choice', { exact: true })).toHaveValue('');
  await firstSupply.getByLabel('Enable reminder for First medicine · 10 mg · tablet').check();

  // Call the real native picker and count only successful calls from trusted clicks.
  await page.evaluate(() => {
    const showPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () {
      showPicker.call(this);
      this.dataset.pickerOpened = String(Number(this.dataset.pickerOpened ?? '0') + 1);
    };
  });
  const dates = [
    page.getByLabel('Purchase date', { exact: true }),
    firstSupply.getByLabel('Supply start date', { exact: true }),
    firstSupply.getByLabel('Manual reminder date (optional)', { exact: true }),
  ];
  for (const field of dates) {
    await field.scrollIntoViewIfNeeded();
    const size = (await field.boundingBox())!;
    for (const [i, x] of [20, size.width / 2, size.width - 20].entries()) {
      await field.click({ position: { x, y: size.height / 2 } });
      await expect(field).toHaveAttribute('data-picker-opened', String(i + 1));
      await page.keyboard.press('Escape');
    }
  }
  const today = await dates[0].inputValue();
  await dates[2].fill(today);
  await expect(dates[2]).toHaveValue(today);
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await expect(page.locator('.purchase-money')).toContainText('₹175.00');
  await firstRow.getByLabel('Amount (₹)').fill('125.501');
  await expect(page.getByRole('button', { name: 'Save purchase', exact: true })).toBeDisabled();
  await expect(page.locator('.business-editor')).toContainText('at most two decimal places');
  await firstRow.getByLabel('Amount (₹)').fill('125.50');
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await expect(firstSupply.locator('.supply-estimate')).toContainText('Carry 0 days');
  await expect(secondSupply.getByLabel('Days supplied', { exact: true })).toHaveValue('14');
  for (const size of [
    [1366, 768, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
    [1920, 1080, 1],
  ]) {
    const actual = await app!.evaluate(({ BrowserWindow }, [width, height, zoom]) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(width, height);
      window.webContents.setZoomFactor(zoom);
      return window.getContentBounds().width / zoom;
    }, size);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeCloseTo(actual, 0);
    for (const control of [
      firstRow.getByLabel('Amount (₹)'),
      page.getByLabel('Discount (%)', { exact: true }),
      page.getByRole('button', { name: 'Save purchase', exact: true }),
    ]) {
      await control.focus();
      await expect(control).toBeFocused();
      await expect(control).toBeInViewport({ ratio: 0.95 });
    }
  }
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await page.getByRole('button', { name: 'View purchase #1', exact: true }).click();
  await expect(page.locator('.purchase-detail')).toContainText('2 tablets');
  await expect(page.locator('.purchase-detail')).toContainText('3.5 strips');
  await expect(page.locator('.purchase-detail')).toContainText('₹175.00');
  await page.getByRole('button', { name: 'View audit history' }).click();
  await expect(page.locator('.history-view')).toContainText('₹175.00');
  await expect(page.locator('.history-view')).toContainText('12.50%');
  await app!.close();
  app = undefined;
  page = await launch();
  await login(page);
  await expect(page.getByTestId('purchase-value')).toHaveText('₹175.00');
  await page.getByLabel('Purchase value period').selectOption('monthly');
  await page.getByText('View exact amounts').click();
  await expect(page.getByRole('table', { name: 'Purchase value over time' })).toContainText(
    'month to date',
  );
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await expect(page.locator('.record-row')).toContainText('₹175.00');
  const output = await mkdtemp(path.join(tmpdir(), 'medipharm-purchase-csv-'));
  try {
    for (const [index, label] of ['Export purchase items', 'Export purchase summaries'].entries()) {
      const filename = path.join(output, index + '.csv');
      await app!.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      }, filename);
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(
        page.getByText('CSV saved: ' + (index === 0 ? 2 : 1) + ' data rows.'),
      ).toBeVisible();
      const content = await readFile(filename, 'utf8');
      if (index === 0) {
        expect(content).toContain('"125.50"');
        expect(content).toContain('"74.50"');
      } else expect(content).toContain('"200.00","percentage","12.50","25.00","175.00"');
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
  const archive = await configureBackups(page);
  await app!.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, archive);
  await page.getByLabel('Passphrase for the archive').fill(backupPassphrase);
  await page.getByRole('button', { name: 'Choose and verify backup' }).click();
  await page.getByLabel('Type RESTORE to confirm replacement').fill('RESTORE');
  await page.getByRole('button', { name: 'Restore this pharmacy' }).click();
  await login(page);
  await expect(page.getByTestId('purchase-value')).toHaveText('₹175.00');
  await page.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'View purchase #1' }).click();
  await expect(page.locator('.purchase-detail')).toContainText('₹125.50');
  await expect(page.locator('.purchase-detail')).toContainText('₹74.50');
  await page.getByRole('button', { name: 'Correct purchase' }).click();
  await expect(page.getByLabel('Discount (%)', { exact: true })).toHaveValue('12.50');
  await page.getByLabel('Enter discount as percentage').uncheck();
  await page.getByLabel('Discount (₹)', { exact: true }).fill('10');
  await page.getByLabel('Correction reason').fill('Apply fixed discount');
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await page.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.locator('.record-row')).toContainText('₹190.00');
  await page.getByRole('button', { name: 'View purchase #1' }).click();
  await page.getByRole('button', { name: 'Cancel purchase', exact: true }).click();
  await page.getByLabel('Cancellation reason').fill('Duplicate record');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.locator('.record-row')).toContainText('cancelled');
  await expect(page.locator('.record-row')).toContainText('₹190.00');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('purchase-value')).toHaveText('No purchases');
});

test('purchase clear resets the draft and preview, discard leaves records intact, and uncertain saves freeze all actions', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Enter purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer here' }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Reset Customer');
  await page.getByLabel('Phone', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await page.getByRole('button', { name: 'Add medicine here' }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Reset Medicine');
  await page.getByRole('button', { name: 'Save medicine', exact: true }).click();
  const today = await page.getByLabel('Purchase date', { exact: true }).inputValue();
  await page.getByLabel('Purchase date', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Days supplied', { exact: true }).fill('7');
  await page.getByLabel('Purchase notes').fill('Discard these notes');
  await page.getByLabel('Amount (₹)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  const save = page.getByRole('button', { name: 'Save purchase', exact: true });
  await expect(save).toBeEnabled();
  await expect(page.locator('.form-actions button')).toHaveText(['Clear', 'Save', 'Discard']);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.business-editor')).toContainText('Customer: Choose a customer');
  await expect(page.getByLabel('Purchase date', { exact: true })).toHaveValue(today);
  await expect(page.getByLabel('Purchase notes')).toHaveValue('');
  await expect(page.locator('.quantity-row')).toHaveCount(0);
  await expect(page.locator('.supply-card')).toHaveCount(0);
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.locator('.business-editor')).toHaveCount(0);
  expect(await page.evaluate(() => window.mediPharm.status())).toMatchObject({
    ok: true,
    data: { customers: 1, medicines: 1, purchases: 0 },
  });
  await page.getByRole('button', { name: 'New purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Customer · 9876543210', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Medicine · tablet', exact: true }).click();
  await page.getByLabel('Amount (₹)', { exact: true }).fill('0');
  await page.getByLabel('Days supplied', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await app!.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('desktop:business-save');
    ipcMain.handle('desktop:business-save', () => ({
      ok: false,
      code: 'OUTCOME_UNKNOWN',
      message: 'Test purchase outcome is unknown.',
    }));
  });
  await save.click();
  await expect(page.getByRole('button', { name: 'Retry same submission' })).toBeVisible();
  for (const name of [
    'Clear',
    'Save purchase',
    'Discard draft',
    'Refresh supply preview',
    'Back to purchases',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByLabel('Days supplied', { exact: true })).toHaveValue('7');
});

test('Back preserves list pagination and archived filters and cancels its dialog when locked', async () => {
  const page = await launch();
  await setup(page);
  await page.evaluate(async () => {
    for (let i = 0; i < 25; i++) {
      const result = await window.mediPharm.businessSave({
        kind: 'customer',
        requestId: crypto.randomUUID(),
        id: null,
        expectedVersion: null,
        name: `Back customer ${String(i).padStart(2, '0')}`,
        phone: '9876543210',
        age: null,
        notes: '',
        archived: true,
      });
      if (!result.ok) throw new Error(result.message);
    }
  });
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Back to / })).toHaveCount(0);
  await page.getByLabel('Search customers', { exact: true }).fill('Back customer');
  await page.getByLabel('Record status', { exact: true }).selectOption('archived');
  await expect(page.locator('.record-row')).toHaveCount(20);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.record-row')).toHaveCount(5);
  const names = await page.locator('.record-row strong').allTextContents();
  await page.getByRole('button', { name: 'Edit customer', exact: true }).first().click();
  await page.getByLabel('Customer name', { exact: true }).fill('Unsaved back edit');
  await page.getByRole('button', { name: 'Back to customers', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.mediPharm.logout());
  await login(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Unsaved back edit');
  await page.getByRole('button', { name: 'Back to customers', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await expect(page.getByLabel('Search customers', { exact: true })).toHaveValue('Back customer');
  await expect(page.getByLabel('Record status', { exact: true })).toHaveValue('archived');
  await expect(page.locator('.pagination')).toContainText('Page 2');
  await expect(page.locator('.record-row strong')).toHaveText(names);
});

test('Settings opens separate backup and export views while retaining pharmacy drafts', async () => {
  const page = await launch();
  await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Keep this settings draft');
  await expect(page.getByLabel('Records to export')).toHaveCount(0);
  await expect(page.getByLabel('New backup passphrase', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open CSV exports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CSV exports', exact: true })).toBeFocused();
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Records to export')).toBeVisible();
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveValue(
    'Keep this settings draft',
  );
  await page.getByRole('button', { name: 'Open backups & restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Encrypted backups & restore' })).toBeFocused();
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Records to export')).toHaveCount(0);
  await expect(page.getByLabel('New backup passphrase', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
  await expect(page.getByLabel('Pharmacy name', { exact: true })).toHaveValue(
    'Keep this settings draft',
  );
});

test('customer and medicine purchase history are dedicated views and preserve their page through details', async () => {
  const page = await launch();
  await setup(page);
  await page.evaluate(async () => {
    const api = window.mediPharm;
    const customer = await api.businessSave({
      kind: 'customer',
      requestId: crypto.randomUUID(),
      id: null,
      expectedVersion: null,
      name: 'History Customer',
      phone: '9876543210',
      age: null,
      notes: '',
      archived: false,
    });
    const medicine = await api.businessSave({
      kind: 'medicine',
      requestId: crypto.randomUUID(),
      id: null,
      expectedVersion: null,
      name: 'History Medicine',
      strength: '10 mg',
      form: 'tablet',
      archived: false,
    });
    if (!customer.ok || !medicine.ok) throw new Error('Fixture catalogue creation failed');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    for (let i = 0; i < 21; i++) {
      const draft = {
        id: null,
        expectedVersion: null,
        customerId: customer.data.id,
        date: today,
        notes: `History purchase ${i}`,
        reason: '',
        pricing: { currencyCode: 'INR' as const, discount: { type: 'none' as const } },
        items: [
          {
            medicineId: medicine.data.id,
            amount: '125.50',
            quantity: '1',
            unit: 'tablets' as const,
          },
        ],
        supplies: [
          {
            medicineId: medicine.data.id,
            start: today,
            days: 7,
            mode: 'replace' as const,
            remaining: null,
            reminder: false,
            manualDate: null,
            confirmLate: false,
          },
        ],
      };
      const preview = await api.purchasePreview(draft);
      if (!preview.ok) throw new Error(preview.message);
      const result = await api.businessSave({
        ...draft,
        kind: 'purchase',
        requestId: crypto.randomUUID(),
        previewFingerprint: preview.data.fingerprint,
        expectedRevision: preview.data.revision,
      });
      if (!result.ok) throw new Error(result.message);
    }
  });
  for (const section of ['Customers', 'Medicines']) {
    await page.getByRole('button', { name: section, exact: true }).click();
    const search = page.getByLabel(`Search ${section.toLowerCase()}`, { exact: true });
    await search.fill('History');
    await page.getByRole('button', { name: 'View purchases', exact: true }).click();
    const history = page.locator('.purchase-history');
    await expect(search).toBeHidden();
    await expect(history.locator('.record-row')).toHaveCount(20);
    await history.getByRole('button', { name: 'More purchases', exact: true }).click();
    await expect(history.locator('.record-row')).toHaveCount(1);
    const purchaseName = await history
      .getByRole('button', { name: /^View purchase #/ })
      .textContent();
    await history.getByRole('button', { name: purchaseName!, exact: true }).click();
    await expect(history).toBeHidden();
    await expect(page.locator('.purchase-detail')).toBeVisible();
    await expect.poll(() => page.locator('.main-layout').evaluate((e) => e.scrollTop)).toBe(0);
    await page.getByRole('button', { name: 'Back to purchase history', exact: true }).click();
    await expect(history).toContainText('Page 2');
    await expect(history.locator('.record-row')).toHaveCount(1);
    await expect(history.getByRole('button', { name: purchaseName!, exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: `Back to ${section.toLowerCase()}`, exact: true })
      .click();
    await expect(search).toHaveValue('History');
    await expect(search).toBeVisible();
  }
});

test('dashboard entry views return to Overview and active section tabs return to their list', async () => {
  const page = await launch();
  await setup(page);
  const quick = page.getByRole('complementary', { name: 'Quick actions' });
  await quick.getByRole('button', { name: 'New customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Unfinished dashboard customer');
  await page.getByRole('button', { name: 'Back to overview', exact: true }).click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Unfinished dashboard customer',
  );
  await page.getByRole('button', { name: 'Back to overview', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Test Pharmacy' })).toBeVisible();
  await expect(page.getByTestId('customers-count')).toHaveText('0');
  await quick.getByRole('button', { name: 'Create backup', exact: true }).click();
  await page.getByRole('button', { name: 'Back to overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Test Pharmacy' })).toBeVisible();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Tab customer');
  await page.getByLabel('Phone', { exact: true }).fill('9876543210');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await page.getByLabel('Search customers', { exact: true }).fill('Tab');
  await page.getByRole('button', { name: 'View purchases', exact: true }).click();
  await expect(page.locator('.purchase-history')).toBeVisible();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.locator('.purchase-history')).toHaveCount(0);
  await expect(page.getByLabel('Search customers', { exact: true })).toHaveValue('Tab');
  await expect(page.getByLabel('Search customers', { exact: true })).toBeVisible();
});
