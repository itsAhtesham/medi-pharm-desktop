import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
  await expect(page.getByRole('heading', { name: 'Customers is planned' })).toBeVisible();
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
  for (const section of ['Customers', 'Medicines', 'Purchases', 'Follow-ups', 'History']) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: `${section} is planned` })).toBeVisible();
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
