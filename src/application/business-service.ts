import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OwnerService } from './owner-service';
import { ApplicationFailure } from './failure';
import { mutate, nextPurchaseNumber } from './mutations';
import {
  businessMutationSchema,
  querySchema,
  queryResultSchema,
  mutationResultSchema,
  purchaseDraftSchema,
  previewSchema,
  textKey,
  type BusinessMutation,
  type BusinessQuery,
  type PurchaseDraft,
  type Purchase,
  type Preview,
  type Customer,
  type Medicine,
} from '../contracts/business';
import { pharmacyDay, quantityMilli } from '../domain/values';
import { chain, calculateChain, reconcile, followEvent, type ChainRow } from './supply-chain';
function invalid(message: string): never {
  throw new ApplicationFailure('INVALID_REQUEST', message);
}
function conflict(message = 'The records changed. Refresh and review before saving again.'): never {
  throw new ApplicationFailure('CONFLICT', message);
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) invalid(r.error.issues[0]?.message ?? 'Check the entered details.');
  return r.data;
}
export class BusinessService {
  constructor(
    private readonly owner: OwnerService,
    private readonly now = Date.now,
  ) {}
  private get db() {
    return this.owner.store.db;
  }
  private revision() {
    return this.db.prepare('SELECT revision FROM app_meta WHERE id=1').pluck().get() as number;
  }
  private purchase(id: string): Purchase {
    const p = this.db
      .prepare(
        'SELECT p.*,c.name AS customer_name FROM purchases p JOIN customers c ON c.id=p.customer_id WHERE p.id=?',
      )
      .get(id) as Purchase | undefined;
    if (!p) invalid('Purchase not found.');
    return {
      ...p,
      items: this.db
        .prepare('SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY position')
        .all(id) as Purchase['items'],
      supplies: this.db
        .prepare('SELECT * FROM medicine_supplies WHERE purchase_id=? AND included=1 ORDER BY id')
        .all(id) as Purchase['supplies'],
    };
  }
  query(raw: BusinessQuery) {
    this.owner.requireOwner();
    const q = parse(querySchema, raw);
    const db = this.db;
    const output = {
      revision: this.revision(),
      today: pharmacyDay(this.now()),
      total: 0,
      customers: [] as Customer[],
      medicines: [] as Medicine[],
      purchases: [] as Purchase[],
      followups: [] as unknown[],
      history: [] as unknown[],
    };
    const args: (string | number)[] = [];
    let where = '1=1';
    let from: string;
    let order: string;
    let projection = '*';
    if (q.kind === 'customers' || q.kind === 'medicines') {
      from = q.kind;
      where = 'archived_at IS ' + (q.archived ? 'NOT NULL' : 'NULL');
      if (q.search) {
        where +=
          q.kind === 'customers'
            ? ' AND (instr(name_key,?)>0 OR instr(phone_key,?)>0)'
            : ' AND instr(identity_key,?)>0';
        args.push(textKey(q.search));
        if (q.kind === 'customers') args.push(q.search.replace(/\D/g, '') || '!');
      }
      if (q.id) {
        where += ' AND id=?';
        args.push(q.id);
      }
      order = q.kind === 'customers' ? 'name_key,id' : 'identity_key,id';
    } else if (q.kind === 'purchases') {
      from = 'purchases p JOIN customers c ON c.id=p.customer_id';
      projection = 'p.id';
      order = 'p.purchase_date DESC,p.sequence DESC';
      if (q.customerId) {
        where += ' AND p.customer_id=?';
        args.push(q.customerId);
      }
      if (q.medicineId) {
        where +=
          ' AND EXISTS(SELECT 1 FROM purchase_items i WHERE i.purchase_id=p.id AND i.medicine_id=?)';
        args.push(q.medicineId);
      }
      if (q.id) {
        where += ' AND p.id=?';
        args.push(q.id);
      }
      if (q.search) {
        where += ' AND (instr(c.name_key,?)>0 OR CAST(p.sequence AS TEXT)=?)';
        args.push(textKey(q.search), q.search);
      }
    } else if (q.kind === 'history') {
      from = 'audit_events';
      projection = 'id,action,reason AS note,before_json,after_json,created_at';
      order = 'created_at DESC,id';
      if (q.id) {
        const follow = Boolean(db.prepare('SELECT id FROM follow_ups WHERE id=?').get(q.id));
        if (follow) {
          from = 'follow_up_events';
          projection = 'id,action,note,before_json,after_json,created_at';
        }
        where += follow ? ' AND follow_up_id=?' : ' AND entity_id=?';
        args.push(q.id);
      }
    } else {
      from =
        'follow_ups f JOIN customers c ON c.id=f.customer_id JOIN medicines m ON m.id=f.medicine_id JOIN purchases p ON p.id=f.purchase_id JOIN medicine_supplies s ON s.id=f.supply_id';
      projection = `f.*,c.name AS customer_name,c.phone,m.name||' '||m.strength||' '||m.form AS medicine_name,p.sequence,s.run_out_date`;
      if (q.customerId) {
        where += ' AND f.customer_id=?';
        args.push(q.customerId);
      }
      if (q.search) {
        where += ' AND (instr(c.name_key,?)>0 OR instr(c.phone_key,?)>0)';
        args.push(textKey(q.search), q.search.replace(/\D/g, '') || '!');
      }
      if (q.tab === 'due' || q.tab === 'scheduled') {
        where += ` AND f.status='open' AND f.next_date${q.tab === 'due' ? '<=' : '>'}?`;
        args.push(output.today);
      }
      if (q.tab === 'closed') where += " AND f.status<>'open'";
      // Page customers, not individual medicines, to keep a customer's actions together.
      const groups = db
        .prepare(
          `SELECT f.customer_id,MIN(f.next_date) AS due FROM ${from} WHERE ${where} GROUP BY f.customer_id ORDER BY due,f.customer_id LIMIT 20 OFFSET ?`,
        )
        .all(...args, q.page * 20) as { customer_id: string }[];
      output.total = db
        .prepare(`SELECT count(DISTINCT f.customer_id) FROM ${from} WHERE ${where}`)
        .pluck()
        .get(...args) as number;
      if (groups.length)
        output.followups = db
          .prepare(
            `SELECT ${projection} FROM ${from} WHERE ${where} AND f.customer_id IN (${groups.map(() => '?').join(',')}) ORDER BY f.next_date,c.name_key,f.id`,
          )
          .all(...args, ...groups.map((g) => g.customer_id));
      return queryResultSchema.parse(output);
    }
    output.total = db
      .prepare(`SELECT count(*) FROM ${from} WHERE ${where}`)
      .pluck()
      .get(...args) as number;
    const rows = db
      .prepare(
        `SELECT ${projection} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT 20 OFFSET ?`,
      )
      .all(...args, q.page * 20);
    if (q.kind === 'purchases')
      output.purchases = (rows as { id: string }[]).map((r) => this.purchase(r.id));
    else if (q.kind === 'customers') output.customers = rows as Customer[];
    else if (q.kind === 'medicines') output.medicines = rows as Medicine[];
    else output.history = rows;
    return queryResultSchema.parse(output);
  }
  preview(raw: PurchaseDraft): Preview {
    this.owner.requireOwner();
    const p = parse(purchaseDraftSchema, raw);
    return this.validatePurchase(p);
  }
  private validatePurchase(p: PurchaseDraft): Preview {
    if (p.date > pharmacyDay(this.now())) invalid('Purchase date cannot be in the future.');
    const old = p.id ? this.purchase(p.id) : null;
    if (old && (old.version !== p.expectedVersion || old.status !== 'active')) conflict();
    if (!old && p.expectedVersion !== null)
      invalid('A new purchase cannot have an existing version.');
    if (old && !p.reason.trim()) invalid('Enter a reason for this correction.');
    const customer = this.db.prepare('SELECT * FROM customers WHERE id=?').get(p.customerId) as
      Customer | undefined;
    if (!customer || (customer.archived_at !== null && old?.customer_id !== p.customerId))
      invalid('Choose an active customer.');
    const unique = new Set(p.items.map((i) => `${i.medicineId}|${i.unit}`));
    if (unique.size !== p.items.length) invalid('Combine duplicate medicine/unit rows.');
    const medicines = [...new Set(p.items.map((i) => i.medicineId))];
    if (
      p.supplies.length !== medicines.length ||
      new Set(p.supplies.map((s) => s.medicineId)).size !== medicines.length ||
      p.supplies.some((s) => !medicines.includes(s.medicineId))
    )
      invalid('Provide exactly one supply duration for each medicine.');
    const supplies: Preview['supplies'] = [];
    for (const s of p.supplies) {
      const med = this.db.prepare('SELECT * FROM medicines WHERE id=?').get(s.medicineId) as
        Medicine | undefined;
      if (!med || (med.archived_at !== null && !old?.items.some((i) => i.medicine_id === med.id)))
        invalid('Choose active medicines for new purchase rows.');
      if (s.start < p.date) invalid('Supply start cannot precede purchase.');
      if (s.manualDate && s.manualDate < p.date) invalid('Reminder date cannot precede purchase.');
      if (!s.reminder && s.manualDate) invalid('Enable the reminder before choosing its date.');
      if (s.mode !== 'extend' && s.remaining !== null)
        invalid('Choose extend to adjust remaining supply; replace always resets it.');
      const rows = chain(this.db, p.customerId, s.medicineId).filter((r) => r.purchase_id !== p.id);
      const sequence = old?.sequence ?? Number.MAX_SAFE_INTEGER;
      const before = rows.filter(
        (r) => r.purchase_date < p.date || (r.purchase_date === p.date && r.sequence < sequence),
      );
      if (before.length && s.mode === null) invalid('Choose extend or replace for each refill.');
      const candidate = {
        id: 'preview',
        pharmacy_id: '',
        customer_id: p.customerId,
        purchase_id: p.id ?? 'preview',
        medicine_id: s.medicineId,
        start_date: s.start,
        new_days: s.days,
        mode: s.mode ?? 'replace',
        remaining_override: s.remaining,
        remaining_used: 0,
        run_out_date: s.start,
        reminder_enabled: Number(s.reminder),
        manual_reminder_date: s.manualDate,
        purchase_date: p.date,
        sequence,
      } satisfies ChainRow;
      rows.push(candidate);
      rows.sort(
        (a, b) => a.purchase_date.localeCompare(b.purchase_date) || a.sequence - b.sequence,
      );
      const c = calculateChain(rows).find((c) => c.row === candidate)!;
      if (s.manualDate && s.manualDate >= c.runOut && !s.confirmLate)
        invalid('Confirm a reminder on or after run-out.');
      supplies.push({
        medicineId: s.medicineId,
        remaining: c.remaining,
        runOut: c.runOut,
        reminder: s.manualDate ?? c.reminder,
        hasPrevious: before.length > 0,
      });
    }
    return previewSchema.parse({ revision: this.revision(), supplies });
  }
  save(raw: BusinessMutation) {
    const input = parse(businessMutationSchema, raw);
    this.owner.requireOwner();
    const db = this.db;
    return mutate(
      db,
      () => this.owner.requireOwner(),
      {
        requestId: input.requestId,
        command: `business.${input.kind}`,
        payload: input,
        result: mutationResultSchema,
        apply: (owner) => {
          const now = this.now();
          let id = '';
          let before: unknown;
          let after: unknown;
          let version: number;
          if (input.kind === 'customer' || input.kind === 'medicine') {
            const table = input.kind === 'customer' ? 'customers' : 'medicines';
            id = input.id ?? randomUUID();
            const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as
              (Customer & Medicine) | undefined;
            if (input.id && (!old || old.version !== input.expectedVersion)) conflict();
            if (!input.id && input.expectedVersion !== null)
              invalid('A new record cannot have an existing version.');
            before = old ?? null;
            version = old ? old.version + 1 : 1;
            const archived = input.archived ? (old?.archived_at ?? now) : null;
            if (input.kind === 'customer') {
              const v = {
                id,
                pharmacy: owner.pharmacy_id,
                name: input.name,
                key: textKey(input.name),
                phone: input.phone,
                phoneKey: input.phone.replace(/\D/g, ''),
                age: input.age,
                notes: input.notes,
                archived,
                version,
                now,
              };
              if (old)
                db.prepare(
                  'UPDATE customers SET name=@name,name_key=@key,phone=@phone,phone_key=@phoneKey,age=@age,notes=@notes,archived_at=@archived,version=@version,updated_at=@now WHERE id=@id',
                ).run(v);
              else
                db.prepare(
                  'INSERT INTO customers(id,pharmacy_id,name,name_key,phone,phone_key,age,notes,archived_at,version,created_at,updated_at) VALUES (@id,@pharmacy,@name,@key,@phone,@phoneKey,@age,@notes,@archived,@version,@now,@now)',
                ).run(v);
            } else {
              const key = JSON.stringify([input.name, input.strength, input.form].map(textKey));
              const duplicate = db
                .prepare('SELECT id,archived_at FROM medicines WHERE identity_key=? AND id<>?')
                .get(key, id) as { archived_at: number | null } | undefined;
              if (duplicate)
                conflict(
                  duplicate.archived_at !== null
                    ? 'This medicine is archived. Find it under Archived and restore it.'
                    : 'This medicine already exists. Select the existing record.',
                );
              const v = {
                id,
                pharmacy: owner.pharmacy_id,
                name: input.name,
                strength: input.strength,
                form: input.form,
                key,
                archived,
                version,
                now,
              };
              if (old)
                db.prepare(
                  'UPDATE medicines SET name=@name,strength=@strength,form=@form,identity_key=@key,archived_at=@archived,version=@version,updated_at=@now WHERE id=@id',
                ).run(v);
              else
                db.prepare(
                  'INSERT INTO medicines(id,pharmacy_id,name,strength,form,identity_key,archived_at,version,created_at,updated_at) VALUES (@id,@pharmacy,@name,@strength,@form,@key,@archived,@version,@now,@now)',
                ).run(v);
            }
            after = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
          } else if (input.kind === 'purchase' || input.kind === 'cancel') {
            if (this.revision() !== input.expectedRevision)
              conflict(
                'Purchase context changed. Refresh the preview and review it before saving.',
              );
            id = input.id ?? randomUUID();
            const old = input.id ? this.purchase(input.id) : null;
            before = old;
            if (
              input.kind === 'cancel' &&
              (!old || old.version !== input.expectedVersion || old.status !== 'active')
            )
              conflict();
            if (input.kind === 'purchase') {
              const {
                kind: _kind,
                requestId: _request,
                expectedRevision: _revision,
                ...draft
              } = input;
              void _kind;
              void _request;
              void _revision;
              this.validatePurchase(draft);
            }
            const pairs = new Map<string, [string, string]>();
            const add = (c: string, m: string) => pairs.set(`${c}|${m}`, [c, m]);
            if (old)
              for (const s of db
                .prepare('SELECT medicine_id FROM medicine_supplies WHERE purchase_id=?')
                .all(id) as { medicine_id: string }[])
                add(old.customer_id, s.medicine_id);
            version = old ? old.version + 1 : 1;
            if (input.kind === 'cancel')
              db.prepare(
                "UPDATE purchases SET status='cancelled',version=?,updated_by=?,updated_at=? WHERE id=?",
              ).run(version, owner.id, now, id);
            else {
              const v = {
                id,
                pharmacy: owner.pharmacy_id,
                customer: input.customerId,
                date: input.date,
                notes: input.notes,
                version,
                actor: owner.id,
                now,
              };
              if (old)
                db.prepare(
                  'UPDATE purchases SET customer_id=@customer,purchase_date=@date,notes=@notes,version=@version,updated_by=@actor,updated_at=@now WHERE id=@id',
                ).run(v);
              else
                db.prepare(
                  "INSERT INTO purchases(id,pharmacy_id,customer_id,sequence,purchase_date,notes,status,version,created_by,updated_by,created_at,updated_at) VALUES (@id,@pharmacy,@customer,@sequence,@date,@notes,'active',@version,@actor,@actor,@now,@now)",
                ).run({ ...v, sequence: nextPurchaseNumber(db, owner.pharmacy_id) });
              db.prepare('DELETE FROM purchase_items WHERE purchase_id=?').run(id);
              input.items.forEach((item, position) => {
                const med = db
                  .prepare('SELECT * FROM medicines WHERE id=?')
                  .get(item.medicineId) as Medicine;
                const snapshot = old?.items.find((i) => i.medicine_id === item.medicineId);
                db.prepare(
                  'INSERT INTO purchase_items(id,pharmacy_id,purchase_id,medicine_id,name_snapshot,strength_snapshot,form_snapshot,quantity_milli,unit,position) VALUES (?,?,?,?,?,?,?,?,?,?)',
                ).run(
                  randomUUID(),
                  owner.pharmacy_id,
                  id,
                  med.id,
                  snapshot?.name_snapshot ?? med.name,
                  snapshot?.strength_snapshot ?? med.strength,
                  snapshot?.form_snapshot ?? med.form,
                  quantityMilli(item.quantity),
                  item.unit,
                  position,
                );
              });
              db.prepare(
                'UPDATE medicine_supplies SET included=0,customer_id=?,version=version+1 WHERE purchase_id=?',
              ).run(input.customerId, id);
              // Move all retained relationships together, including removed medicine cycles.
              // Vacate moved open slots first; reconciliation below restores the correct cycle.
              if (old && old.customer_id !== input.customerId) {
                for (const f of db
                  .prepare("SELECT * FROM follow_ups WHERE purchase_id=? AND status<>'superseded'")
                  .all(id) as {
                  id: string;
                  status: string;
                  manual_date: string | null;
                  next_date: string;
                  last_contact_at: number | null;
                  closed_at: number | null;
                  closure_reason: string | null;
                }[]) {
                  db.prepare(
                    "UPDATE follow_ups SET status='superseded',closed_at=?,closure_reason='Customer corrected',paused_state=?,version=version+1 WHERE id=?",
                  ).run(
                    now,
                    JSON.stringify({
                      version: 1,
                      status: f.status,
                      manual: f.manual_date,
                      next: f.next_date,
                      contact: f.last_contact_at,
                      closed: f.closed_at,
                      reason: f.closure_reason,
                    }),
                    f.id,
                  );
                }
              }
              db.prepare('UPDATE follow_ups SET customer_id=? WHERE purchase_id=?').run(
                input.customerId,
                id,
              );
              for (const s of input.supplies) {
                add(input.customerId, s.medicineId);
                const existing = db
                  .prepare(
                    'SELECT id,manual_reminder_date FROM medicine_supplies WHERE purchase_id=? AND medicine_id=?',
                  )
                  .get(id, s.medicineId) as
                  { id: string; manual_reminder_date: string | null } | undefined;
                const calc = calculateChain([
                  {
                    id: '',
                    pharmacy_id: '',
                    customer_id: '',
                    purchase_id: '',
                    medicine_id: '',
                    start_date: s.start,
                    new_days: s.days,
                    mode: s.mode ?? 'replace',
                    remaining_override: s.remaining,
                    remaining_used: 0,
                    run_out_date: s.start,
                    reminder_enabled: 0,
                    manual_reminder_date: null,
                    purchase_date: input.date,
                    sequence: 0,
                  },
                ])[0];
                const v = {
                  id: existing?.id ?? randomUUID(),
                  pharmacy: owner.pharmacy_id,
                  customer: input.customerId,
                  purchase: id,
                  medicine: s.medicineId,
                  start: s.start,
                  days: s.days,
                  mode: s.mode ?? 'replace',
                  remaining: s.remaining,
                  used: calc.remaining,
                  out: calc.runOut,
                  reminder: Number(s.reminder),
                  manual: s.manualDate,
                };
                if (existing)
                  db.prepare(
                    'UPDATE medicine_supplies SET included=1,start_date=@start,new_days=@days,mode=@mode,remaining_override=@remaining,remaining_used=@used,run_out_date=@out,reminder_enabled=@reminder,manual_reminder_date=@manual WHERE id=@id',
                  ).run(v);
                else
                  db.prepare(
                    'INSERT INTO medicine_supplies(id,pharmacy_id,customer_id,purchase_id,medicine_id,included,start_date,new_days,mode,remaining_override,remaining_used,run_out_date,reminder_enabled,manual_reminder_date) VALUES (@id,@pharmacy,@customer,@purchase,@medicine,1,@start,@days,@mode,@remaining,@used,@out,@reminder,@manual)',
                  ).run(v);
                if (existing && existing.manual_reminder_date !== s.manualDate) {
                  const f = db
                    .prepare('SELECT * FROM follow_ups WHERE supply_id=?')
                    .get(existing.id) as { id: string; paused_state: string | null } | undefined;
                  if (f) {
                    const paused = f.paused_state
                      ? { ...JSON.parse(f.paused_state), manual: s.manualDate }
                      : null;
                    db.prepare(
                      'UPDATE follow_ups SET manual_date=?,paused_state=?,version=version+1 WHERE id=?',
                    ).run(s.manualDate, paused ? JSON.stringify(paused) : null, f.id);
                  }
                }
              }
              // Include removed medicine chains under the new customer as well.
              for (const s of db
                .prepare('SELECT medicine_id FROM medicine_supplies WHERE purchase_id=?')
                .all(id) as { medicine_id: string }[])
                add(input.customerId, s.medicine_id);
            }
            for (const [customer, medicine] of pairs.values())
              reconcile(db, owner.pharmacy_id, owner.id, customer, medicine, now);
            after = this.purchase(id);
          } else {
            id = input.id;
            const f = db.prepare('SELECT * FROM follow_ups WHERE id=?').get(id) as
              | {
                  id: string;
                  version: number;
                  status: string;
                  customer_id: string;
                  medicine_id: string;
                  supply_id: string;
                  next_date: string;
                }
              | undefined;
            if (!f || f.version !== input.expectedVersion) conflict();
            before = f;
            version = f.version + 1;
            const latest = chain(db, f.customer_id, f.medicine_id).at(-1);
            if (latest?.id !== f.supply_id || !latest.reminder_enabled || f.status === 'superseded')
              invalid('Only the current reminder cycle can be changed.');
            if (input.action === 'reopen' && f.status !== 'closed')
              invalid('Only a manually closed reminder can be reopened.');
            if (input.action !== 'reopen' && f.status !== 'open')
              invalid('Reopen this reminder before recording contact.');
            if (input.date && input.date < pharmacyDay(now))
              invalid('Next contact cannot be in the past.');
            if ((input.action === 'close' || input.action === 'contact') && !input.note)
              invalid('Enter a contact outcome or closure reason.');
            if (input.action === 'snooze' && !input.date) invalid('Choose the next contact date.');
            if (input.action === 'close')
              db.prepare(
                "UPDATE follow_ups SET status='closed',closed_at=?,closure_reason=?,version=? WHERE id=?",
              ).run(now, input.note, version, id);
            else if (input.action === 'reopen')
              db.prepare(
                "UPDATE follow_ups SET status='open',closed_at=NULL,closure_reason=NULL,resolving_purchase_id=NULL,version=? WHERE id=?",
              ).run(version, id);
            else
              db.prepare(
                "UPDATE follow_ups SET last_contact_at=CASE WHEN ?='contact' THEN ? ELSE last_contact_at END,manual_date=COALESCE(?,manual_date),next_date=COALESCE(?,next_date),version=? WHERE id=?",
              ).run(input.action, now, input.date, input.date, version, id);
            after = db.prepare('SELECT * FROM follow_ups WHERE id=?').get(id);
            followEvent(
              db,
              owner.pharmacy_id,
              owner.id,
              id,
              input.action,
              input.note,
              before,
              after,
              now,
            );
          }
          return {
            value: { id, version, revision: this.revision() + 1 },
            entityType: input.kind === 'cancel' ? 'purchase' : input.kind,
            entityId: id,
            before,
            after,
            reason: 'reason' in input ? input.reason : input.kind === 'followup' ? input.note : '',
          };
        },
      },
      this.now,
    );
  }
}
