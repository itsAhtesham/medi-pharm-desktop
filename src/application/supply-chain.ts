import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { pausedFollowSchema } from '../db/business-health';
import { calculateSupply } from '../domain/supply';
import { ApplicationFailure } from './failure';
export type ChainRow = {
  id: string;
  pharmacy_id: string;
  customer_id: string;
  purchase_id: string;
  medicine_id: string;
  start_date: string;
  new_days: number;
  mode: 'extend' | 'replace';
  remaining_override: number | null;
  remaining_used: number;
  run_out_date: string;
  reminder_enabled: number;
  manual_reminder_date: string | null;
  purchase_date: string;
  sequence: number;
};
export function chain(db: Database.Database, customer: string, medicine: string): ChainRow[] {
  return db
    .prepare(
      `SELECT s.*,p.purchase_date,p.sequence FROM medicine_supplies s JOIN purchases p ON p.id=s.purchase_id WHERE s.customer_id=? AND s.medicine_id=? AND s.included=1 AND p.status='active' ORDER BY p.purchase_date,p.sequence`,
    )
    .all(customer, medicine) as ChainRow[];
}
export function calculateChain(rows: ChainRow[]) {
  let previous: string | null = null;
  let previousStart = '';
  return rows.map((row) => {
    if (row.start_date < row.purchase_date || row.start_date < previousStart)
      throw new ApplicationFailure(
        'INVALID_REQUEST',
        'Supply starts must be on/after purchase and in nondecreasing purchase order.',
      );
    const result = calculateSupply(
      row.start_date,
      row.new_days,
      row.mode,
      row.remaining_override,
      previous,
    );
    previous = result.runOut;
    previousStart = row.start_date;
    return { ...result, row };
  });
}
type FollowRow = {
  id: string;
  status: 'open' | 'closed' | 'superseded';
  manual_date: string | null;
  next_date: string;
  last_contact_at: number | null;
  closed_at: number | null;
  closure_reason: string | null;
  paused_state: string | null;
  calculated_date: string;
  version: number;
  resolving_purchase_id: string | null;
  supply_id: string;
  purchase_id: string;
};
export function followEvent(
  db: Database.Database,
  pharmacy: string,
  actor: string,
  id: string,
  action: string,
  note: string,
  before: unknown,
  after: unknown,
  now: number,
) {
  db.prepare('INSERT INTO follow_up_events VALUES (?,?,?,?,?,?,?,?,?)').run(
    randomUUID(),
    pharmacy,
    id,
    actor,
    action,
    note,
    JSON.stringify({ version: 1, value: before }),
    JSON.stringify({ version: 1, value: after }),
    now,
  );
}
export function reconcile(
  db: Database.Database,
  pharmacy: string,
  actor: string,
  customer: string,
  medicine: string,
  now: number,
) {
  const calculated = calculateChain(chain(db, customer, medicine));
  for (const c of calculated)
    db.prepare(
      'UPDATE medicine_supplies SET remaining_used=?,run_out_date=?,version=version+1 WHERE id=? AND (remaining_used<>? OR run_out_date<>?)',
    ).run(c.remaining, c.runOut, c.row.id, c.remaining, c.runOut);
  const latest = calculated.at(-1);
  const current = latest?.row.reminder_enabled ? latest : undefined;
  const rows = db
    .prepare('SELECT * FROM follow_ups WHERE customer_id=? AND medicine_id=?')
    .all(customer, medicine) as FollowRow[];
  // Vacate the unique open slot before restoring/creating a current cycle.
  for (const f of rows) {
    if (f.supply_id === current?.row.id || f.status === 'superseded') continue;
    const paused = JSON.stringify({
      version: 1,
      status: f.status,
      manual: f.manual_date,
      next: f.next_date,
      contact: f.last_contact_at,
      closed: f.closed_at,
      reason: f.closure_reason,
    });
    db.prepare(
      "UPDATE follow_ups SET status='superseded',closed_at=?,closure_reason='Supply superseded or removed',resolving_purchase_id=?,paused_state=?,version=version+1 WHERE id=?",
    ).run(now, latest?.row.purchase_id ?? null, paused, f.id);
    followEvent(
      db,
      pharmacy,
      actor,
      f.id,
      'superseded',
      '',
      f,
      db.prepare('SELECT * FROM follow_ups WHERE id=?').get(f.id),
      now,
    );
  }
  if (!current) return;
  const s = current.row;
  const f = rows.find((r) => r.supply_id === s.id);
  if (!f) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO follow_ups(id,pharmacy_id,customer_id,medicine_id,purchase_id,supply_id,status,calculated_date,manual_date,next_date) VALUES (?,?,?,?,?,?,'open',?,?,?)",
    ).run(
      id,
      pharmacy,
      customer,
      medicine,
      s.purchase_id,
      s.id,
      current.reminder,
      s.manual_reminder_date,
      s.manual_reminder_date ?? current.reminder,
    );
    followEvent(
      db,
      pharmacy,
      actor,
      id,
      'created',
      '',
      null,
      db.prepare('SELECT * FROM follow_ups WHERE id=?').get(id),
      now,
    );
  } else {
    const state =
      f.status === 'superseded'
        ? pausedFollowSchema.parse(JSON.parse(f.paused_state!))
        : {
            version: 1 as const,
            status: f.status,
            manual: f.manual_date,
            next: f.next_date,
            contact: f.last_contact_at,
            closed: f.closed_at,
            reason: f.closure_reason,
          };
    // A later manual contact/snooze date takes precedence over the supply's initial choice.
    const next = state.manual ?? current.reminder;
    if (f.status === state.status && f.calculated_date === current.reminder && f.next_date === next)
      return;
    db.prepare(
      'UPDATE follow_ups SET status=?,calculated_date=?,manual_date=?,next_date=?,last_contact_at=?,closed_at=?,closure_reason=?,resolving_purchase_id=NULL,paused_state=NULL,version=version+1 WHERE id=?',
    ).run(
      state.status,
      current.reminder,
      state.manual,
      next,
      state.contact,
      state.closed,
      state.reason,
      f.id,
    );
    followEvent(
      db,
      pharmacy,
      actor,
      f.id,
      'reconciled',
      '',
      f,
      db.prepare('SELECT * FROM follow_ups WHERE id=?').get(f.id),
      now,
    );
  }
}
