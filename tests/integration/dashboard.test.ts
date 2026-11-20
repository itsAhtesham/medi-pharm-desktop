import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OwnerService } from '../../src/application/owner-service';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { BusinessService } from '../../src/application/business-service';
import Database from 'better-sqlite3';
import { readPurchaseValue, DashboardService } from '../../src/application/dashboard-service';
import type { PurchaseDraft } from '../../src/contracts/business';
let root: string, owner: OwnerService, business: BusinessService, dashboard: DashboardService;
const today = '2026-11-20';
const now = () => Date.parse('2026-11-19T18:30:00Z'); // Midnight in Asia/Kolkata, previous UTC day.
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'medipharm-dashboard-'));
  owner = new OwnerService(new PharmacyDatabase(root), now);
  await owner.setup({
    pharmacyName: 'Dashboard',
    identifier: 'owner',
    password: 'dashboard test password',
    recoveryCode: 'ab'.repeat(32),
  });
  await owner.login({ identifier: 'owner', password: 'dashboard test password' });
  business = new BusinessService(owner, now);
  dashboard = new DashboardService(owner, now);
});
afterEach(() => {
  owner.close();
  rmSync(root, { recursive: true, force: true });
});
const customer = (name = 'Asha', notes = '') =>
  business.save({
    kind: 'customer',
    requestId: randomUUID(),
    id: null,
    expectedVersion: null,
    name,
    phone: '+91 98765 43210',
    age: 0,
    notes,
    archived: false,
  }).id;
const medicine = (name = 'Medicine A') =>
  business.save({
    kind: 'medicine',
    requestId: randomUUID(),
    id: null,
    expectedVersion: null,
    name,
    strength: '10 mg',
    form: 'tablet',
    archived: false,
  }).id;
function purchase(
  customerId: string,
  medicineId: string,
  date = today,
  days = 7,
  start = date,
  reminder = true,
) {
  const p: PurchaseDraft = {
    id: null,
    expectedVersion: null,
    customerId,
    date,
    notes: 'Supply note',
    reason: '',
    pricing: { currencyCode: 'INR' as const, discount: { type: 'percentage', percent: '12.50' } },
    items: [
      { medicineId, amount: '125.50', quantity: '1.250', unit: 'tablets' },
      { medicineId, amount: '74.50', quantity: '2', unit: 'strips' },
    ],
    supplies: [
      {
        medicineId,
        start,
        days,
        mode: 'extend',
        remaining: null,
        reminder,
        manualDate: null,
        confirmLate: false,
      },
    ],
  };
  const preview = business.preview(p);
  return business.save({
    ...p,
    kind: 'purchase',
    requestId: randomUUID(),
    previewFingerprint: preview.fingerprint,
    expectedRevision: preview.revision,
  });
}
function cancel(id: string) {
  const d = business.query({ kind: 'purchases', id });
  business.save({
    kind: 'cancel',
    requestId: randomUUID(),
    id,
    expectedVersion: d.purchases[0].version,
    expectedRevision: d.revision,
    reason: 'Wrong entry',
  });
}

it('returns empty honest metrics, uses the pharmacy day, and requires authentication', () => {
  const d = dashboard.read();
  expect(d).toMatchObject({
    today,
    activeCustomers: 0,
    activeMedicines: 0,
    purchasesToday: 0,
    dueCycles: 0,
    dueCustomers: 0,
    endingSupplies: 0,
    recent: [],
    ending: [],
    due: [],
    upcoming: [],
  });
  expect(d.purchasesByDay).toHaveLength(7);
  expect(d.purchasesByDay[0]).toEqual({ day: '2026-11-14', count: 0 });
  expect(d.purchasesByDay[6]).toEqual({ day: today, count: 0 });
  owner.logout();
  expect(() => dashboard.read()).toThrow('Sign in');
});
it('counts active purchases and catalogs, separates customers from reminders, and omits cancelled history from the chart', () => {
  const c = customer(),
    a = medicine('First'),
    b = medicine('Second'),
    c2 = customer('Other');
  purchase(c, a, '2026-11-18', 1); // Overdue reminder, exhausted supply.
  purchase(c, b, today, 1); // Due today, current coverage.
  const cancelled = purchase(c2, a);
  cancel(cancelled.id);
  business.save({
    kind: 'customer',
    requestId: randomUUID(),
    id: c2,
    expectedVersion: 1,
    name: 'Other',
    phone: '1234567890',
    age: null,
    notes: '',
    archived: true,
  });
  business.save({
    kind: 'medicine',
    requestId: randomUUID(),
    id: a,
    expectedVersion: 1,
    name: 'First',
    strength: '10 mg',
    form: 'tablet',
    archived: true,
  });
  const d = dashboard.read();
  expect(d).toMatchObject({
    activeCustomers: 1,
    activeMedicines: 1,
    purchasesToday: 1,
    dueCycles: 2,
    dueCustomers: 1,
    overdueCycles: 1,
    overdueCustomers: 1,
    endingSupplies: 1,
    endingCustomers: 1,
  });
  expect(d.purchasesByDay.reduce((n, r) => n + r.count, 0)).toBe(2);
  expect(d.purchaseValue).toMatchObject({ period: 'daily', totalMinor: '35000', count: 2 });
  expect(d.purchaseValue.buckets.at(-1)).toEqual({ start: today, count: 1, totalMinor: '17500' });
  const month = dashboard.read('monthly').purchaseValue;
  expect(month.start).toBe('2025-12-01');
  expect(month.buckets).toHaveLength(12);
  expect(month.buckets.at(-1)).toEqual({ start: '2026-11-01', count: 2, totalMinor: '35000' });
  expect(d.due.map((r) => r.customer_id)).toEqual([c, c]);
  expect(d.recent).toHaveLength(5);
  expect(d.recent.some((r) => r.action === 'business.cancel')).toBe(true);
  expect(JSON.stringify(d)).not.toMatch(/password_hash|recovery_hash/);
});
it('keeps effective current coverage visible when a future refill supersedes its reminder', () => {
  const c = customer(),
    m = medicine();
  purchase(c, m, '2026-11-18', 7);
  const future = purchase(c, m, today, 3, '2026-11-23');
  let d = dashboard.read();
  expect(d.ending).toEqual([
    expect.objectContaining({ customerId: c, runOut: '2026-11-25', daysLeft: 5 }),
  ]);
  expect(d.upcoming[0]).toMatchObject({ run_out_date: '2026-11-28' });
  cancel(future.id);
  d = dashboard.read();
  expect(d.ending[0].runOut).toBe('2026-11-25');
  expect(d.upcoming[0].run_out_date).toBe('2026-11-25');
});
it('caps preview rows without truncating totals and respects snoozed/closed reminders', () => {
  const c = customer();
  for (let i = 0; i < 8; i++) purchase(c, medicine(`Medicine ${i}`), today, 1);
  let d = dashboard.read();
  expect(d.dueCycles).toBe(8);
  expect(d.due).toHaveLength(6);
  expect(d.endingSupplies).toBe(8);
  expect(d.ending).toHaveLength(6);
  const first = d.due[0],
    second = d.due[1];
  business.save({
    kind: 'followup',
    requestId: randomUUID(),
    id: first.id,
    expectedVersion: first.version,
    action: 'snooze',
    note: 'Call later',
    date: '2026-11-25',
  });
  business.save({
    kind: 'followup',
    requestId: randomUUID(),
    id: second.id,
    expectedVersion: second.version,
    action: 'close',
    note: 'No more calls',
    date: null,
  });
  d = dashboard.read();
  expect(d.dueCycles).toBe(6);
  expect(d.scheduledCycles).toBe(1);
  expect(d.upcoming[0].next_date).toBe('2026-11-25');
  expect(d.endingSupplies).toBe(8);
});

it('keeps large period totals exact across leap-day and year boundaries', () => {
  const db = new Database(':memory:');
  try {
    // Generate bounded purchase totals lazily so the fixture fits in memory.
    db.exec(`CREATE VIEW purchases AS WITH RECURSIVE series(n) AS (
      SELECT 1 UNION ALL SELECT n+1 FROM series WHERE n<900721
    ) SELECT 'test' AS pharmacy_id, 'active' AS status, '2024-02-29' AS purchase_date,
      9999999999 AS total_amount_minor FROM series`);
    const result = readPurchaseValue(db, 'test', '2024-03-01', 'monthly');
    expect(result.start).toBe('2023-04-01');
    const expected = String(900721n * 9999999999n);
    expect(result.totalMinor).toBe(expected);
    expect(result.buckets.at(-2)).toEqual({
      start: '2024-02-01',
      count: 900721,
      totalMinor: expected,
    });
    expect(result.buckets.at(-1)).toEqual({ start: '2024-03-01', count: 0, totalMinor: '0' });
  } finally {
    db.close();
  }
});
