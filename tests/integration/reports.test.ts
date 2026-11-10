import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OwnerService } from '../../src/application/owner-service';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { BusinessService } from '../../src/application/business-service';
import { CsvExporter } from '../../src/application/csv-export';
import { SupplyReport } from '../../src/application/supply-report';
import type { CsvInput } from '../../src/contracts/reports';
import type { PurchaseDraft } from '../../src/contracts/business';
let root: string,
  external: string,
  owner: OwnerService,
  business: BusinessService,
  exports: CsvExporter,
  report: SupplyReport;
const today = '2026-11-20';
const now = () => Date.parse(`${today}T09:00:00Z`);
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'medipharm-reports-'));
  external = mkdtempSync(path.join(tmpdir(), 'medipharm-csv-'));
  owner = new OwnerService(new PharmacyDatabase(root), now);
  await owner.setup({
    pharmacyName: 'Reports',
    identifier: 'owner',
    password: 'report test password',
    recoveryCode: 'ab'.repeat(32),
  });
  await owner.login({ identifier: 'owner', password: 'report test password' });
  business = new BusinessService(owner, now);
  exports = new CsvExporter(owner, now);
  report = new SupplyReport(owner, now);
});
afterEach(() => {
  owner.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(external, { recursive: true, force: true });
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
    items: [
      { medicineId, quantity: '1.250', unit: 'tablets' },
      { medicineId, quantity: '2', unit: 'strips' },
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
  return business.save({
    ...p,
    kind: 'purchase',
    requestId: randomUUID(),
    expectedRevision: business.preview(p).revision,
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
function csv(selection: CsvInput) {
  const file = path.join(external, 'export.csv');
  const result = exports.export(selection, file);
  return { ...result, text: readFileSync(file, 'utf8') };
}
describe('CSV exports', () => {
  it('exports every matching customer across pages, quoted Unicode/multiline values and harmless formulas', () => {
    customer('=SUM(1,2)', 'First line\nSecond "quoted" line, café');
    customer('आशा');
    for (let n = 0; n < 22; n++) customer(`Family ${n}`);
    expect(business.query({ kind: 'customers' }).customers).toHaveLength(20);
    const all = csv({ kind: 'customers' });
    expect(all.rows).toBe(24);
    expect(all.text.startsWith('\ufeff"Customer"')).toBe(true);
    expect(all.text).toContain('"\'=SUM(1,2)"');
    expect(all.text).toContain('"First line\nSecond ""quoted"" line, café"');
    expect(all.text).toContain('"आशा"');
    expect(all.text).toContain('"\'+91 98765 43210"');
    expect(all.text).not.toContain('password_hash');
    expect(all.text).not.toContain('recovery_hash');
    expect(csv({ kind: 'customers', search: 'family' }).rows).toBe(22);
    expect(csv({ kind: 'customers', search: 'no-match' }).rows).toBe(0);
  });
  it('exports medicines including archived entries and uses historical purchase labels with exact quantities', () => {
    const c = customer(),
      m = medicine();
    const p = purchase(c, m);
    business.save({
      kind: 'medicine',
      id: m,
      requestId: randomUUID(),
      expectedVersion: 1,
      name: 'Renamed',
      strength: '20 mg',
      form: 'tablet',
      archived: true,
    });
    expect(csv({ kind: 'medicines', status: 'active' }).rows).toBe(0);
    expect(csv({ kind: 'medicines', status: 'archived' }).text).toContain(
      '"Renamed","20 mg","tablet","archived"',
    );
    const rows = csv({ kind: 'purchases' });
    expect(rows.rows).toBe(2);
    expect(rows.text).toContain('"Medicine A","10 mg","tablet","1.250","tablets"');
    expect(rows.text).toContain('"2.000","strips"');
    expect(rows.text).not.toContain('Renamed');
    cancel(p.id);
    expect(csv({ kind: 'purchases' }).text).toContain('"cancelled"');
  });
  it('matches purchase and follow-up filters and exports dated contact/reconciliation history', () => {
    const c = customer(),
      m = medicine();
    purchase(c, m, today, 1);
    const other = customer('Other');
    purchase(other, medicine('Other medicine'));
    const f = business.query({ kind: 'followups', customerId: c, tab: 'all' }).followups[0];
    business.save({
      kind: 'followup',
      requestId: randomUUID(),
      id: f.id,
      expectedVersion: f.version,
      action: 'contact',
      note: '=HYPERLINK("unsafe")',
      date: '2026-11-25',
    });
    expect(csv({ kind: 'purchases', customerId: c }).rows).toBe(2);
    expect(csv({ kind: 'purchases', medicineId: m }).rows).toBe(2);
    expect(csv({ kind: 'purchases', search: '1' }).rows).toBe(2);
    expect(csv({ kind: 'followups', customerId: c, tab: 'due' }).rows).toBe(0);
    expect(csv({ kind: 'followups', search: '98765', tab: 'scheduled' }).rows).toBe(2);
    const history = csv({ kind: 'followupHistory', customerId: c });
    expect(history.rows).toBe(2);
    expect(history.text).toContain('"contact"');
    expect(history.text).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(history.text).toContain('2026-11-25');
    expect(history.text).toContain('2026-11-20T09:00:00.000Z');
  });
  it('rejects invalid/inherited export kinds and unauthorized access before creating files', () => {
    for (const kind of ['constructor', 'toString', '__proto__', 'users'])
      expect(() =>
        exports.export({ kind } as unknown as CsvInput, path.join(external, 'invalid.csv')),
      ).toThrow('supported');
    expect(readdirSync(external)).toEqual([]);
    owner.logout();
    expect(() => csv({ kind: 'customers' })).toThrow('Sign in');
    expect(readdirSync(external)).toEqual([]);
  });
  it('refuses internal destinations and symlinks, reports destination failures and remains usable', () => {
    customer();
    const target = path.join(root, 'data', 'live', 'export.csv');
    expect(() => exports.export({ kind: 'customers' }, target)).toThrow('outside');
    expect(existsSync(target)).toBe(false);
    symlinkSync(path.join(root, 'data', 'live'), path.join(external, 'alias'), 'dir');
    expect(() =>
      exports.export({ kind: 'customers' }, path.join(external, 'alias', 'export.csv')),
    ).toThrow('outside');
    writeFileSync(path.join(external, 'original.csv'), 'original');
    symlinkSync(path.join(external, 'original.csv'), path.join(external, 'link.csv'));
    expect(() => exports.export({ kind: 'customers' }, path.join(external, 'link.csv'))).toThrow(
      'regular',
    );
    expect(readFileSync(path.join(external, 'original.csv'), 'utf8')).toBe('original');
    expect(() =>
      exports.export({ kind: 'customers' }, path.join(external, 'missing', 'output.csv')),
    ).toThrow('destination');
    expect(owner.store.db.inTransaction).toBe(false);
    expect(csv({ kind: 'customers' }).rows).toBe(1);
    expect(readdirSync(external).filter((f) => f.endsWith('.partial'))).toEqual([]);
  });
});
describe('consolidated customer supply report', () => {
  it('shows each medicine once, including reminders off and exhausted/archived supplies', () => {
    const c = customer(),
      a = medicine('Available'),
      b = medicine('Exhausted'),
      d = medicine('Today'),
      e = medicine('Future');
    purchase(c, a, today, 7, today, false);
    purchase(c, b, '2026-11-01', 1);
    purchase(c, d, '2026-11-19', 1);
    purchase(c, e, today, 3, '2026-11-22');
    business.save({
      kind: 'medicine',
      requestId: randomUUID(),
      id: b,
      expectedVersion: 1,
      name: 'Exhausted',
      strength: '10 mg',
      form: 'tablet',
      archived: true,
    });
    const result = report.query({ customerId: c });
    expect(result.total).toBe(4);
    expect(result.supplies.find((s) => s.medicineId === a)).toMatchObject({
      remainingDays: 7,
      coverage: 'available',
      reminder: 'disabled',
      nextContact: null,
    });
    expect(result.supplies.find((s) => s.medicineId === b)).toMatchObject({
      remainingDays: 0,
      coverage: 'ranOut',
      archived: true,
    });
    expect(result.supplies.find((s) => s.medicineId === d)?.coverage).toBe('runsOutToday');
    expect(result.supplies.find((s) => s.medicineId === e)).toMatchObject({
      coverage: 'notStarted',
      coverageRunOut: null,
      nextStart: '2026-11-22',
      remainingDays: 0,
    });
  });
  it('separates current coverage from a future refill and restores earlier supply after cancellation', () => {
    const c = customer(),
      m = medicine();
    purchase(c, m, '2026-11-18', 7);
    const future = purchase(c, m, today, 3, '2026-11-23');
    let s = report.query({ customerId: c }).supplies[0];
    expect(s).toMatchObject({
      remainingDays: 5,
      coverageRunOut: '2026-11-25',
      nextStart: '2026-11-23',
      start: '2026-11-23',
      runOut: '2026-11-28',
      carriedDays: 2,
      sequence: 2,
    });
    cancel(future.id);
    s = report.query({ customerId: c }).supplies[0];
    expect(s).toMatchObject({
      sequence: 1,
      remainingDays: 5,
      runOut: '2026-11-25',
      nextStart: null,
    });
    expect(report.query({ customerId: c }).total).toBe(1);
  });
  it('reflects contact dates and manual closure without losing coverage', () => {
    const c = customer(),
      m = medicine();
    purchase(c, m, today, 1);
    let f = business.query({ kind: 'followups', customerId: c }).followups[0];
    business.save({
      kind: 'followup',
      requestId: randomUUID(),
      id: f.id,
      expectedVersion: f.version,
      action: 'contact',
      note: 'Reached',
      date: '2026-11-25',
    });
    expect(report.query({ customerId: c }).supplies[0]).toMatchObject({
      reminder: 'scheduled',
      remainingDays: 1,
      nextContact: '2026-11-25',
      lastContact: now(),
    });
    f = business.query({ kind: 'followups', customerId: c, tab: 'all' }).followups[0];
    business.save({
      kind: 'followup',
      requestId: randomUUID(),
      id: f.id,
      expectedVersion: f.version,
      action: 'close',
      note: 'Customer requested closure',
      date: null,
    });
    expect(report.query({ customerId: c }).supplies[0]).toMatchObject({
      reminder: 'closed',
      coverage: 'available',
      closureReason: 'Customer requested closure',
    });
  });
  it('pages/searches independently, includes archived customers and rejects unauthenticated reads', () => {
    const c = customer();
    for (let i = 0; i < 23; i++) purchase(c, medicine(`Medicine ${String(i).padStart(2, '0')}`));
    expect(report.query({ customerId: c }).supplies).toHaveLength(20);
    expect(report.query({ customerId: c, page: 1 }).supplies).toHaveLength(3);
    expect(report.query({ customerId: c, search: 'medicine 22' }).total).toBe(1);
    business.save({
      kind: 'customer',
      requestId: randomUUID(),
      id: c,
      expectedVersion: 1,
      name: 'Asha',
      phone: '9876543210',
      age: null,
      notes: '',
      archived: true,
    });
    expect(report.query({ customerId: c }).customer.archived_at).not.toBeNull();
    expect(() => report.query({ customerId: randomUUID() })).toThrow('not found');
    owner.logout();
    expect(() => report.query({ customerId: c })).toThrow('Sign in');
  });
});
