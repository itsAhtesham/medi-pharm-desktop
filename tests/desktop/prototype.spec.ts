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
  await page.getByLabel('Pharmacy name', { exact: true }).fill('Later pharmacy name');
  await page.getByRole('button', { name: 'Save pharmacy details' }).click();
  await expect(page.getByText('Pharmacy details saved on this computer.')).toBeVisible();
  await app!.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, filename);
  await page.getByLabel('Passphrase for the archive').fill(backupPassphrase);
  await page.getByRole('button', { name: 'Choose and verify backup' }).click();
  await expect(page.getByRole('heading', { name: 'Verified: Test Pharmacy' })).toBeVisible();
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
  await page.getByLabel('Quantity 1', { exact: true }).fill('1.250');
  await page.getByLabel('New days 1', { exact: true }).fill('1');
  await page.getByLabel('Enable reminder for Test medicine · 10 mg · tablet').check();
  await page.getByRole('button', { name: 'Refresh supply preview' }).click();
  await expect(page.locator('.supply-estimate')).toContainText('Carry 0 days');
  await page.screenshot({ path: 'test-results/purchase-supply-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await page.getByRole('button', { name: 'View purchase #1', exact: true }).click();
  await expect(page.locator('.purchase-detail')).toContainText('1.25 tablets');
  await page.getByRole('button', { name: 'Correct purchase', exact: true }).click();
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
  await page.getByRole('button', { name: 'Record refill', exact: true }).click();
  await page.getByLabel('New days 1', { exact: true }).fill('3');
  await page.getByLabel('Refill choice 1', { exact: true }).selectOption('extend');
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
    restarted.getByRole('button', { name: 'View purchase #1', exact: true }),
  ).toBeVisible();
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
      items: medicines.map((medicineId) => ({
        medicineId,
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
  await expect(supplies.locator('.supply-report-row')).toHaveCount(2);
  await expect(supplies).toContainText('1 estimated days remaining');
  await expect(supplies).toContainText('7 estimated days remaining');
  await expect(supplies).toContainText('Reminder disabled');
  await expect(supplies).toContainText('Due today');
  await page.screenshot({ path: 'test-results/current-supplies.png', fullPage: true });
  await supplies.getByRole('button', { name: 'View source purchase #1' }).first().click();
  await expect(page.locator('.purchase-detail')).toContainText('Report purchase');
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
      items: [{ medicineId, quantity: '10', unit: 'tablets' as const }],
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
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
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
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
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
