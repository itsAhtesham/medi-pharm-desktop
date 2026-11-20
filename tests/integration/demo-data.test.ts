import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDemoProfile, demoAccess, demoMarker } from '../../src/tools/demo-data';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { OwnerService } from '../../src/application/owner-service';
import { BusinessService } from '../../src/application/business-service';
import { DashboardService } from '../../src/application/dashboard-service';
import { inspectDatabase } from '../../src/db/health';

const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});
function directory() {
  const root = mkdtempSync(path.join(tmpdir(), 'medipharm-demo-test-'));
  temporary.push(root);
  return root;
}

it('creates a reopenable priced demo with history, calendar spread and valid supply chains without reseeding it', async () => {
  const root = path.join(directory(), 'pharmacy');
  const timestamp = Date.parse('2026-11-20T09:00:00Z');
  const seeded = await createDemoProfile(root, timestamp);
  expect(seeded.summary).toMatchObject({
    customers: 50,
    medicines: 60,
    purchases: 180,
    activeCustomers: 47,
    activeMedicines: 55,
    activePurchases: 170,
    cancelledPurchases: 10,
  });
  expect(seeded.summary.dueCycles).toBeGreaterThan(0);
  expect(seeded.summary.scheduledCycles).toBeGreaterThan(0);
  const filename = path.join(root, 'data', 'live', 'medipharm.sqlite');
  expect(inspectDatabase(filename)).toMatchObject({ customers: 50, medicines: 60, purchases: 180 });
  const owner = new OwnerService(new PharmacyDatabase(root), () => timestamp);
  try {
    await owner.login(demoAccess);
    const db = owner.store.db;
    expect(
      db.prepare("SELECT COUNT(*) FROM purchases WHERE status='cancelled'").pluck().get(),
    ).toBe(10);
    expect(
      db
        .prepare('SELECT DISTINCT discount_type FROM purchases ORDER BY discount_type')
        .pluck()
        .all(),
    ).toEqual(['fixed', 'none', 'percentage']);
    expect(
      db
        .prepare("SELECT COUNT(*) FROM purchases WHERE total_amount_minor=0 AND status='active'")
        .pluck()
        .get(),
    ).toBeGreaterThan(0);
    expect(
      db
        .prepare('SELECT MAX(n) FROM (SELECT COUNT(*) n FROM purchases GROUP BY customer_id)')
        .pluck()
        .get(),
    ).toBeGreaterThan(20);
    expect(
      db
        .prepare(
          'SELECT COUNT(*) FROM (SELECT purchase_id,medicine_id FROM purchase_items GROUP BY purchase_id,medicine_id HAVING COUNT(*)>1)',
        )
        .pluck()
        .get(),
    ).toBeGreaterThan(0);
    expect(
      db
        .prepare("SELECT COUNT(*) FROM purchases WHERE version>1 AND status='active'")
        .pluck()
        .get(),
    ).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) FROM follow_ups WHERE status='closed'").pluck().get()).toBe(
      5,
    );
    const business = new BusinessService(owner, () => timestamp);
    expect(business.query({ kind: 'customers', page: 2 }).customers).toHaveLength(7);
    expect(business.query({ kind: 'medicines', page: 2 }).medicines).toHaveLength(15);
    const dashboard = new DashboardService(owner, () => timestamp);
    expect(dashboard.read('daily').purchaseValue.buckets.every((bucket) => bucket.count > 0)).toBe(
      true,
    );
    expect(
      dashboard.read('monthly').purchaseValue.buckets.every((bucket) => bucket.count > 0),
    ).toBe(true);
  } finally {
    owner.close();
  }
  const before = readFileSync(filename);
  const marker = readFileSync(path.join(root, demoMarker), 'utf8');
  await expect(createDemoProfile(root, timestamp)).rejects.toThrow('Profile already exists');
  expect(readFileSync(filename)).toEqual(before);
  expect(readFileSync(path.join(root, demoMarker), 'utf8')).toBe(marker);
  expect(JSON.parse(marker).status).toBe('ready');
}, 30_000);

it('refuses any pre-existing folder before touching its contents', async () => {
  const root = directory();
  const sentinel = path.join(root, 'keep.txt');
  writeFileSync(sentinel, 'existing data');
  await expect(createDemoProfile(root)).rejects.toThrow('Profile already exists');
  expect(readFileSync(sentinel, 'utf8')).toBe('existing data');
});
