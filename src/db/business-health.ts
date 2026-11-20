import type Database from 'better-sqlite3';
import { z } from 'zod';
import { dateSchema } from '../contracts/business';
import { calculateSupply } from '../domain/supply';

export const pausedFollowSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(['open', 'closed']),
    manual: dateSchema.nullable(),
    next: dateSchema,
    contact: z.number().nullable(),
    closed: z.number().nullable(),
    reason: z.string().nullable(),
  })
  .strict()
  .refine((s) =>
    s.status === 'open'
      ? s.closed === null && s.reason === null
      : s.closed !== null && Boolean(s.reason),
  );
/** Cross-record checks used for startup, backup verification and restore candidates. */
export function inspectBusiness(db: Database.Database) {
  const counter = db
    .prepare("SELECT next_number FROM number_counters WHERE kind='purchase'")
    .pluck()
    .get() as number;
  const max = db.prepare('SELECT COALESCE(MAX(sequence),0) FROM purchases').pluck().get() as number;
  if (!Number.isSafeInteger(counter) || counter <= max)
    throw new Error('Invalid purchase counter.');
  if (
    db
      .prepare(
        `SELECT 1 FROM purchase_items i WHERE NOT EXISTS(SELECT 1 FROM medicine_supplies s WHERE s.purchase_id=i.purchase_id AND s.medicine_id=i.medicine_id AND s.included=1) UNION ALL SELECT 1 FROM medicine_supplies s WHERE s.included=1 AND NOT EXISTS(SELECT 1 FROM purchase_items i WHERE i.purchase_id=s.purchase_id AND i.medicine_id=s.medicine_id) LIMIT 1`,
      )
      .get()
  )
    throw new Error('Purchase quantity/supply mismatch.');
  if (
    db
      .prepare(
        'SELECT 1 FROM purchases p WHERE NOT EXISTS(SELECT 1 FROM purchase_items i WHERE i.purchase_id=p.id) LIMIT 1',
      )
      .get()
  )
    throw new Error('Empty purchase.');
  if (
    db
      .prepare(
        `SELECT 1 FROM purchases p WHERE p.subtotal_minor <>
    (SELECT SUM(i.amount_minor) FROM purchase_items i WHERE i.pharmacy_id=p.pharmacy_id AND i.purchase_id=p.id) LIMIT 1`,
      )
      .get()
  )
    throw new Error('Purchase subtotal differs from its item amounts.');
  type Supply = {
    id: string;
    customer_id: string;
    medicine_id: string;
    purchase_date: string;
    start_date: string;
    new_days: number;
    mode: 'extend' | 'replace';
    remaining_override: number | null;
    remaining_used: number;
    run_out_date: string;
    reminder_enabled: number;
  };
  let key = '';
  let previous: string | null = null;
  let previousStart = '';
  const current = new Map<string, { s: Supply; reminder: string }>();
  for (const s of db
    .prepare(
      "SELECT s.*,p.purchase_date FROM medicine_supplies s JOIN purchases p ON p.id=s.purchase_id WHERE s.included=1 AND p.status='active' ORDER BY s.customer_id,s.medicine_id,p.purchase_date,p.sequence",
    )
    .iterate() as Iterable<Supply>) {
    const nextKey = `${s.customer_id}|${s.medicine_id}`;
    if (nextKey !== key) {
      key = nextKey;
      previous = null;
      previousStart = '';
    }
    if (s.start_date < s.purchase_date || s.start_date < previousStart)
      throw new Error('Invalid supply order.');
    const c = calculateSupply(s.start_date, s.new_days, s.mode, s.remaining_override, previous);
    if (c.remaining !== s.remaining_used || c.runOut !== s.run_out_date)
      throw new Error('Invalid carried supply.');
    previous = c.runOut;
    previousStart = s.start_date;
    current.set(key, { s, reminder: c.reminder });
  }
  const found = new Set<string>();
  type Follow = {
    supply_id: string;
    customer_id: string;
    medicine_id: string;
    status: string;
    paused_state: string | null;
    calculated_date: string;
    manual_date: string | null;
    next_date: string;
  };
  for (const f of db.prepare('SELECT * FROM follow_ups').iterate() as Iterable<Follow>) {
    if (f.status === 'superseded') {
      pausedFollowSchema.parse(JSON.parse(f.paused_state ?? 'null'));
      continue;
    }
    const c = current.get(`${f.customer_id}|${f.medicine_id}`);
    if (
      !c ||
      !c.s.reminder_enabled ||
      c.s.id !== f.supply_id ||
      c.reminder !== f.calculated_date ||
      f.next_date !== (f.manual_date ?? f.calculated_date) ||
      f.paused_state !== null
    )
      throw new Error('Invalid current reminder cycle.');
    found.add(c.s.id);
  }
  for (const { s } of current.values())
    if (s.reminder_enabled && !found.has(s.id)) throw new Error('Missing current reminder.');
}
