import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { OwnerService } from '../../src/application/owner-service';
import { BusinessService } from '../../src/application/business-service';
import { inspectConnection } from '../../src/db/health';
import { BackupManager } from '../../src/backup/manager';
import { type PurchaseDraft } from '../../src/contracts/business';
let root: string;
let owner: OwnerService;
let app: BusinessService;
const now = () => Date.parse('2026-11-20T09:00:00Z');
const access = { identifier: 'owner', password: 'test passphrase 123' };
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'medipharm-business-'));
  owner = new OwnerService(new PharmacyDatabase(root), now);
  await owner.setup({ ...access, pharmacyName: 'Business test', recoveryCode: 'ab'.repeat(32) });
  await owner.login(access);
  app = new BusinessService(owner, now);
});
afterEach(() => {
  owner.close();
  rmSync(root, { recursive: true, force: true });
});
const customer = (name = 'Asha') =>
  app.save({
    kind: 'customer',
    requestId: randomUUID(),
    id: null,
    expectedVersion: null,
    name,
    phone: '+91 98765 43210',
    age: null,
    notes: '',
    archived: false,
  }).id;
const medicine = (name = 'Medicine A') =>
  app.save({
    kind: 'medicine',
    requestId: randomUUID(),
    id: null,
    expectedVersion: null,
    name,
    strength: '10 mg',
    form: 'tablet',
    archived: false,
  }).id;
function draft(c: string, m: string, date = '2026-11-01', days = 7): PurchaseDraft {
  return {
    id: null,
    expectedVersion: null,
    customerId: c,
    date,
    notes: '',
    reason: '',
    items: [{ medicineId: m, quantity: '1.250', unit: 'tablets' }],
    supplies: [
      {
        medicineId: m,
        start: date,
        days,
        mode: 'extend',
        remaining: null,
        reminder: true,
        manualDate: null,
        confirmLate: false,
      },
    ],
  };
}
function save(p: PurchaseDraft) {
  const preview = app.preview(p);
  return app.save({
    ...p,
    kind: 'purchase',
    requestId: randomUUID(),
    expectedRevision: preview.revision,
  });
}
function correction(id: string): PurchaseDraft {
  const p = app.query({ kind: 'purchases', id }).purchases[0];
  return {
    id: p.id,
    expectedVersion: p.version,
    customerId: p.customer_id,
    date: p.purchase_date,
    notes: p.notes,
    reason: 'Correct entered details',
    items: p.items.map((i) => ({
      medicineId: i.medicine_id,
      quantity: String(i.quantity_milli / 1000),
      unit: i.unit,
    })),
    supplies: p.supplies.map((s) => ({
      medicineId: s.medicine_id,
      start: s.start_date,
      days: s.new_days,
      mode: s.mode,
      remaining: s.remaining_override,
      reminder: Boolean(s.reminder_enabled),
      manualDate: s.manual_reminder_date,
      confirmLate: false,
    })),
  };
}
function cancel(id: string) {
  const data = app.query({ kind: 'purchases', id });
  return app.save({
    kind: 'cancel',
    id,
    expectedVersion: data.purchases[0].version,
    expectedRevision: data.revision,
    requestId: randomUUID(),
    reason: 'Entered in error',
  });
}
function follow() {
  return app.query({ kind: 'followups', tab: 'all' }).followups;
}
function action(
  id: string,
  action: 'contact' | 'snooze' | 'close' | 'reopen',
  date: string | null = null,
) {
  const f = follow().find((f) => f.id === id)!;
  return app.save({
    kind: 'followup',
    id,
    requestId: randomUUID(),
    expectedVersion: f.version,
    action,
    note: 'Spoke with customer',
    date,
  });
}

describe('catalogue and purchase workflows', () => {
  it('normalizes search and identities, permits shared phone numbers, and deduplicates retry receipts', () => {
    const command = {
      kind: 'customer' as const,
      requestId: randomUUID(),
      id: null,
      expectedVersion: null,
      name: '  Ａsha  Rao ',
      phone: '+91 (98765) 43210',
      age: 0,
      notes: 'Family',
      archived: false,
    };
    const saved = app.save(command);
    expect(app.save(command)).toEqual(saved);
    customer('Other family member');
    expect(app.query({ kind: 'customers', search: 'asha rao' }).customers[0]).toMatchObject({
      age: 0,
      notes: 'Family',
    });
    expect(app.query({ kind: 'customers', search: '98765-43210' }).total).toBe(2);
    medicine('  Test   Tablet ');
    expect(() => medicine('test tablet')).toThrow('already exists');
    expect(() => app.save({ ...command, requestId: randomUUID(), phone: '123' })).toThrow();
    expect(() => app.save({ ...command, name: 'Changed' })).toThrow('submission ID');
  });
  it('archives and restores without duplicating medicine identity; rejects stale edits and inactive selections', () => {
    const c = customer();
    const m = medicine();
    const record = app.query({ kind: 'medicines' }).medicines[0];
    const edit = {
      kind: 'medicine' as const,
      requestId: randomUUID(),
      id: m,
      expectedVersion: record.version,
      name: record.name,
      strength: record.strength,
      form: record.form,
      archived: true,
    };
    const saved = app.save(edit);
    expect(app.query({ kind: 'medicines' }).total).toBe(0);
    expect(() => medicine()).toThrow('archived');
    expect(() => save(draft(c, m))).toThrow('active medicines');
    expect(() => app.save({ ...edit, requestId: randomUUID() })).toThrow('changed');
    app.save({ ...edit, requestId: randomUUID(), expectedVersion: saved.version, archived: false });
    expect(app.query({ kind: 'medicines' }).total).toBe(1);
  });
  it('calculates early refills, exact mixed-unit rows, and independent medicines', () => {
    const c = customer(),
      m = medicine(),
      m2 = medicine('Medicine B');
    save(draft(c, m));
    const p = draft(c, m, '2026-11-04', 11);
    p.items.push(
      { medicineId: m, quantity: '2', unit: 'strips' },
      { medicineId: m2, quantity: '0.001', unit: 'bottles' },
    );
    p.supplies.push({ ...p.supplies[0], medicineId: m2, days: 1 });
    expect(app.preview(p).supplies).toMatchObject([
      { remaining: 4, runOut: '2026-11-19', reminder: '2026-11-16' },
      { remaining: 0, runOut: '2026-11-05', reminder: '2026-11-04' },
    ]);
    const saved = save(p);
    const result = app.query({ kind: 'purchases', id: saved.id }).purchases[0];
    expect(result.items.map((i) => i.quantity_milli)).toEqual([1250, 2000, 1]);
    expect(result.supplies).toHaveLength(2);
    expect(follow().filter((f) => f.status === 'open')).toHaveLength(2);
    inspectConnection(owner.store.db);
  });
  it('requires deliberate refill choice and distinguishes zero override from estimate and replace', () => {
    const c = customer(),
      m = medicine();
    save(draft(c, m));
    const p = draft(c, m, '2026-11-04', 11);
    p.supplies[0].mode = null;
    expect(() => app.preview(p)).toThrow('Choose extend');
    p.supplies[0].mode = 'replace';
    expect(app.preview(p).supplies[0]).toMatchObject({
      remaining: 0,
      runOut: '2026-11-15',
      reminder: '2026-11-12',
    });
    p.supplies[0].mode = 'extend';
    p.supplies[0].remaining = 0;
    expect(app.preview(p).supplies[0].remaining).toBe(0);
    p.supplies[0].remaining = null;
    expect(app.preview(p).supplies[0].remaining).toBe(4);
  });
  it('rejects future/invalid dates, duplicate units, invalid precision and unconfirmed late reminders', () => {
    const c = customer(),
      m = medicine();
    const p = draft(c, m);
    p.items.push({ ...p.items[0] });
    expect(() => app.preview(p)).toThrow('duplicate');
    p.items.pop();
    expect(() => app.preview({ ...p, date: '2026-02-30' })).toThrow('calendar');
    expect(() => app.preview({ ...p, date: '2026-11-21' })).toThrow('future');
    p.items[0].quantity = '1.0001';
    expect(() => app.preview(p)).toThrow('decimal');
    p.items[0].quantity = '1';
    p.supplies[0].manualDate = '2026-11-08';
    expect(() => app.preview(p)).toThrow('Confirm');
    p.supplies[0].confirmLate = true;
    save(p);
  });
  it('restores contact and snooze after cancellation, including a reminder-disabled later supply', () => {
    const c = customer(),
      m = medicine();
    save(draft(c, m));
    const id = follow()[0].id;
    action(id, 'contact', '2026-11-25');
    const p = draft(c, m, '2026-11-04', 11);
    p.supplies[0].reminder = false;
    const later = save(p);
    expect(follow().find((f) => f.id === id)?.status).toBe('superseded');
    expect(app.query({ kind: 'followups', tab: 'due' }).total).toBe(0);
    cancel(later.id);
    expect(follow().find((f) => f.id === id)).toMatchObject({
      status: 'open',
      next_date: '2026-11-25',
      last_contact_at: now(),
    });
    expect(app.query({ kind: 'followups', tab: 'scheduled' }).total).toBe(1);
    expect(app.query({ kind: 'history', id }).history.map((h) => h.action)).toContain('contact');
    inspectConnection(owner.store.db);
  });
  it('restores manual closure, supports explicit reopen, and does not close another medicine', () => {
    const c = customer(),
      m = medicine(),
      m2 = medicine('Other');
    save(draft(c, m));
    const id = follow()[0].id;
    action(id, 'close');
    save(draft(c, m2));
    expect(follow().find((f) => f.id === id)?.status).toBe('closed');
    const p = save(draft(c, m, '2026-11-04'));
    cancel(p.id);
    expect(follow().find((f) => f.id === id)?.status).toBe('closed');
    action(id, 'reopen');
    expect(follow().find((f) => f.id === id)?.status).toBe('open');
  });
  it('reconciles earlier correction through extends and preserves replace boundaries', () => {
    const c = customer(),
      m = medicine();
    const first = save(draft(c, m));
    const second = save(draft(c, m, '2026-11-04', 11));
    const third = draft(c, m, '2026-11-06', 5);
    third.supplies[0].mode = 'replace';
    const last = save(third);
    const p = correction(first.id);
    p.supplies[0].days = 14;
    save(p);
    expect(
      app.query({ kind: 'purchases', id: second.id }).purchases[0].supplies[0].run_out_date,
    ).toBe('2026-11-26');
    expect(
      app.query({ kind: 'purchases', id: last.id }).purchases[0].supplies[0].run_out_date,
    ).toBe('2026-11-11');
    const invalid = correction(first.id);
    invalid.supplies[0].start = '2026-11-05';
    expect(() => save(invalid)).toThrow('nondecreasing');
    inspectConnection(owner.store.db);
  });
  it('retains stable supply/follow-up identity after removal and re-addition', () => {
    const c = customer(),
      m = medicine(),
      m2 = medicine('Other');
    const p = draft(c, m);
    p.items.push({ medicineId: m2, quantity: '1', unit: 'packs' });
    p.supplies.push({ ...p.supplies[0], medicineId: m2 });
    const saved = save(p);
    const id = follow().find((f) => f.medicine_id === m)!.id;
    action(id, 'contact', '2026-11-25');
    const edit = correction(saved.id);
    edit.items = edit.items.filter((i) => i.medicineId !== m);
    edit.supplies = edit.supplies.filter((s) => s.medicineId !== m);
    save(edit);
    expect(follow().find((f) => f.id === id)?.status).toBe('superseded');
    const again = correction(saved.id);
    again.items.push(p.items[0]);
    again.supplies.push(p.supplies[0]);
    save(again);
    expect(follow().find((f) => f.id === id)).toMatchObject({
      status: 'open',
      next_date: '2026-11-25',
    });
    inspectConnection(owner.store.db);
  });
  it('moves a purchase between customers and reconciles both old and new chains', () => {
    const c = customer(),
      c2 = customer('Second'),
      m = medicine();
    save(draft(c, m));
    save(draft(c2, m));
    const later = save(draft(c, m, '2026-11-04'));
    const edit = correction(later.id);
    edit.customerId = c2;
    save(edit);
    expect(
      follow()
        .filter((f) => f.status === 'open')
        .map((f) => f.customer_id)
        .sort(),
    ).toEqual([c, c2].sort());
    expect(app.query({ kind: 'purchases', id: later.id }).purchases[0].customer_id).toBe(c2);
    inspectConnection(owner.store.db);
  });
  it('preserves medicine snapshots when renamed and audited before/after correction details', () => {
    const c = customer(),
      m = medicine();
    const saved = save(draft(c, m));
    app.save({
      kind: 'medicine',
      id: m,
      requestId: randomUUID(),
      expectedVersion: 1,
      name: 'Renamed',
      strength: '20 mg',
      form: 'tablet',
      archived: false,
    });
    const p = correction(saved.id);
    p.notes = 'Corrected note';
    save(p);
    const result = app.query({ kind: 'purchases', id: saved.id }).purchases[0];
    expect(result.items[0].name_snapshot).toBe('Medicine A');
    expect(result.items[0].strength_snapshot).toBe('10 mg');
    const audit = app.query({ kind: 'history', id: saved.id }).history;
    expect(audit).toHaveLength(2);
    expect(
      audit.some(
        (a) => a.note === 'Correct entered details' && a.after_json.includes('Corrected note'),
      ),
    ).toBe(true);
  });
  it('detects stale context including contact changes, and safely replays purchase/cancellation receipts', () => {
    const c = customer(),
      m = medicine();
    const p = draft(c, m);
    const preview = app.preview(p);
    customer('Concurrent edit');
    expect(() =>
      app.save({
        ...p,
        kind: 'purchase',
        requestId: randomUUID(),
        expectedRevision: preview.revision,
      }),
    ).toThrow('context changed');
    const cmd = {
      ...p,
      kind: 'purchase' as const,
      requestId: randomUUID(),
      expectedRevision: app.preview(p).revision,
    };
    const saved = app.save(cmd);
    expect(app.save(cmd)).toEqual(saved);
    expect(app.query({ kind: 'purchases' }).total).toBe(1);
    const edit = correction(saved.id);
    const stale = app.preview(edit);
    action(follow()[0].id, 'contact');
    expect(() =>
      app.save({
        ...edit,
        kind: 'purchase',
        requestId: randomUUID(),
        expectedRevision: stale.revision,
      }),
    ).toThrow('context changed');
    owner.logout();
    expect(() => app.save(cmd)).toThrow('Sign in');
    expect(() => app.query({ kind: 'customers' })).toThrow('Sign in');
  });
  it('rolls back header, items, supplies, events, counter and receipt on a late write failure', () => {
    const c = customer(),
      m = medicine();
    const p = draft(c, m);
    const before = owner.status().revision;
    owner.store.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
    );
    expect(() => save(p)).toThrow('injected failure');
    for (const table of [
      'purchases',
      'purchase_items',
      'medicine_supplies',
      'follow_ups',
      'follow_up_events',
    ])
      expect(owner.store.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    expect(owner.status().revision).toBe(before);
    owner.store.db.exec('DROP TRIGGER fail_receipt');
    const saved = save(p);
    expect(app.query({ kind: 'purchases', id: saved.id }).purchases[0].sequence).toBe(1);
  });
  it('pages catalogue deterministically and keeps a customer’s matching medicines together', () => {
    for (let n = 0; n < 23; n++) customer(`Customer ${String(n).padStart(2, '0')}`);
    const first = app.query({ kind: 'customers' }),
      second = app.query({ kind: 'customers', page: 1 });
    expect(first.customers).toHaveLength(20);
    expect(second.customers).toHaveLength(3);
    expect(new Set([...first.customers, ...second.customers].map((c) => c.id)).size).toBe(23);
    const c = first.customers[0].id;
    for (let n = 0; n < 21; n++) save(draft(c, medicine(`Medicine ${n}`)));
    const due = app.query({ kind: 'followups' });
    expect(due.total).toBe(1);
    expect(due.followups).toHaveLength(21);
  });
  it('survives reopening and includes real business records in verified encrypted backup', async () => {
    const c = customer(),
      m = medicine();
    save(draft(c, m));
    owner.close();
    owner = new OwnerService(new PharmacyDatabase(root), now);
    await owner.login(access);
    app = new BusinessService(owner, now);
    expect(app.query({ kind: 'purchases' }).total).toBe(1);
    expect(follow()).toHaveLength(1);
    const backups = new BackupManager(owner);
    await backups.configure('portable backup passphrase');
    const status = await backups.create();
    expect(status.localLast).not.toBeNull();
    backups.close();
    inspectConnection(owner.store.db);
  });
  it('rejects inconsistent supply chains and reminder state during backup/restore health checks', () => {
    const c = customer(),
      m = medicine();
    save(draft(c, m));
    save(draft(c, m, '2026-11-04'));
    const db = owner.store.db;
    const tamper = (sql: string) => {
      const run = db.transaction(() => {
        db.exec(sql);
        expect(() => inspectConnection(db)).toThrow();
        throw new Error('rollback fixture');
      });
      expect(() => run()).toThrow('rollback fixture');
      inspectConnection(db);
    };
    tamper(
      "UPDATE medicine_supplies SET remaining_used=remaining_used+1,run_out_date=date(run_out_date,'+1 day') WHERE remaining_used>0",
    );
    tamper("UPDATE follow_ups SET paused_state='{}' WHERE status='superseded'");
    tamper("UPDATE follow_ups SET calculated_date='2026-11-01' WHERE status='open'");
    tamper('UPDATE number_counters SET next_number=1');
  });
  it('restores populated business data and follow-up history from an authenticated archive', async () => {
    const c = customer(),
      m = medicine();
    save(draft(c, m));
    const f = follow()[0];
    action(f.id, 'contact', '2026-11-25');
    const backups = new BackupManager(owner);
    await backups.configure('portable business passphrase');
    await backups.create();
    const folder = path.join(root, 'backups');
    const archive = readdirSync(folder).find((n) => n.endsWith('.mpbackup'))!;
    customer('After backup');
    const preview = await backups.preview(
      path.join(folder, archive),
      'portable business passphrase',
    );
    await backups.restore(preview.token, false);
    await owner.login(access);
    expect(app.query({ kind: 'customers' }).total).toBe(1);
    expect(follow()[0]).toMatchObject({
      id: f.id,
      next_date: '2026-11-25',
      last_contact_at: now(),
    });
    expect(
      app.query({ kind: 'history', id: f.id }).history.some((h) => h.action === 'contact'),
    ).toBe(true);
    inspectConnection(owner.store.db);
    backups.close();
  });
});
