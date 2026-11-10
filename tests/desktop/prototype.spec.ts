import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const packagedExecutable = process.env.MEDIPHARM_TEST_EXECUTABLE ?? path.resolve('out', `MediPharm Prototype-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'medipharm-prototype.exe' : 'medipharm-prototype');
let root: string;
let app: ElectronApplication | undefined;

async function launch() {
  app = await electron.launch({ executablePath: packagedExecutable, chromiumSandbox: true, env: { ...process.env, MEDIPHARM_PROTOTYPE_HOME: root }, timeout: 20_000 });
  return app.firstWindow();
}
test.beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'medipharm-desktop-test-')); });
test.afterEach(async () => { await app?.close(); app = undefined; await rm(root, { recursive: true, force: true }); });

test('packaged offline shell persists records and restores a separate snapshot copy', async () => {
  let page = await launch();
  await expect(page.getByTestId('record-count')).toHaveText('0');
  expect(page.url()).toBe('medipharm://app/');
  await page.getByLabel('Sample note').fill('Desktop restart verification');
  await page.getByRole('button', { name: 'Save sample record' }).click();
  await expect(page.getByTestId('record-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Create test snapshot' }).click();
  await expect(page.getByRole('status')).toContainText('Snapshot verified with 1');
  await app!.close(); app = undefined;
  page = await launch();
  await expect(page.getByTestId('last-record')).toHaveText('Desktop restart verification');
  await expect(page.getByTestId('record-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Verify restored copy' }).click();
  await expect(page.getByRole('status')).toContainText('Restore verified: 1');
  await page.screenshot({ path: 'test-results/prototype-overview.png', fullPage: true });
});

test('renderer is sandboxed and invalid mutations are rejected', async () => {
  const page = await launch();
  await expect(page.getByTestId('record-count')).toHaveText('0');
  const isolated = await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, methods: Object.keys(window.mediPharm) }));
  expect(isolated.node).toBe('undefined');
  expect(isolated.methods.sort()).toEqual(['status', 'saveRecord', 'createSnapshot', 'verifyRestore', 'checkKeyStorage', 'chooseFolder'].sort());
  const bad = await page.evaluate(() => window.mediPharm.saveRecord({ requestId: 'invalid', note: 'x' }));
  expect(bad.ok).toBe(false);
  const remote = await page.evaluate(async () => { try { await fetch('https://example.com'); return true; } catch { return false; } });
  expect(remote).toBe(false);
  await page.getByRole('button', { name: 'Customers' }).click();
  await expect(page.getByRole('heading', { name: 'Customers is planned' })).toBeVisible();
});

test('a missing initialized database opens a recovery message without replacing it', async () => {
  let page = await launch();
  await expect(page.getByTestId('record-count')).toHaveText('0');
  await app!.close(); app = undefined;
  await rm(path.join(root, 'data', 'prototype.sqlite'));
  page = await launch();
  await expect(page.getByRole('alert')).toContainText('storage');
  await expect(page.getByRole('button', { name: 'Save sample record' })).toBeDisabled();
});

test('a second launch reuses the window and closing it stops the database service', async () => {
  const page = await launch();
  await expect(page.getByTestId('record-count')).toHaveText('0');
  const servicePid = await app!.evaluate(({ app }) => app.getAppMetrics().find((item) => item.name === 'MediPharm local storage')?.pid);
  expect(servicePid).toBeDefined();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(packagedExecutable, [], { env: { ...process.env, MEDIPHARM_PROTOTYPE_HOME: root }, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Second instance did not exit.')); }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Second instance exited ${code}`)); });
  });
  expect(app!.windows()).toHaveLength(1);
  const closed = app!.waitForEvent('close');
  await page.close();
  await closed;
  app = undefined;
  await expect.poll(() => { try { process.kill(servicePid!, 0); return true; } catch { return false; } }).toBe(false);
});
