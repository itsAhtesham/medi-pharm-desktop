import { OwnerService } from './owner-service';
import { ApplicationFailure } from './failure';
import { supplyQuerySchema, supplyResultSchema, type SupplyQuery } from '../contracts/reports';
import { textKey } from '../contracts/business';
import { pharmacyDay } from '../domain/values';
import { daysBetween } from '../domain/supply';
export class SupplyReport {
  constructor(
    private readonly owner: OwnerService,
    private readonly now = Date.now,
  ) {}
  query(raw: SupplyQuery) {
    const owner = this.owner.requireOwner();
    const input = supplyQuerySchema.safeParse(raw);
    if (!input.success)
      throw new ApplicationFailure('INVALID_REQUEST', 'Choose a customer and valid supply search.');
    const { customerId, search, page } = input.data;
    const db = this.owner.store.db;
    const today = pharmacyDay(this.now());
    return db
      .transaction(() => {
        const customer = db
          .prepare('SELECT * FROM customers WHERE pharmacy_id=? AND id=?')
          .get(owner.pharmacy_id, customerId);
        if (!customer) throw new ApplicationFailure('INVALID_REQUEST', 'Customer not found.');
        const base = `WITH active AS (
        SELECT s.*,p.sequence,p.purchase_date,
          ROW_NUMBER() OVER(PARTITION BY s.medicine_id ORDER BY p.purchase_date DESC,p.sequence DESC) AS rank
        FROM medicine_supplies s JOIN purchases p ON p.id=s.purchase_id
        WHERE s.pharmacy_id=@pharmacy AND s.customer_id=@customer AND s.included=1 AND p.status='active'
      )`;
        const from = `FROM active a JOIN medicines m ON m.id=a.medicine_id LEFT JOIN follow_ups f ON f.supply_id=a.id
        WHERE a.rank=1 AND instr(m.identity_key,@search)>0`;
        const args = {
          pharmacy: owner.pharmacy_id,
          customer: customerId,
          search: JSON.stringify(textKey(search)).slice(1, -1),
        };
        const total = db.prepare(`${base} SELECT count(*) ${from}`).pluck().get(args) as number;
        type Row = {
          medicineId: string;
          name: string;
          strength: string;
          form: string;
          archived: number;
          purchaseId: string;
          sequence: number;
          purchaseDate: string;
          start: string;
          newDays: number;
          carriedDays: number;
          runOut: string;
          coverageRunOut: string | null;
          nextStart: string | null;
          enabled: number;
          status: string | null;
          nextContact: string | null;
          lastContact: number | null;
          closureReason: string | null;
        };
        const rows = db
          .prepare(
            `${base} SELECT a.medicine_id AS medicineId,m.name,m.strength,m.form,m.archived_at IS NOT NULL AS archived,
        a.purchase_id AS purchaseId,a.sequence,a.purchase_date AS purchaseDate,a.start_date AS start,a.new_days AS newDays,a.remaining_used AS carriedDays,a.run_out_date AS runOut,
        (SELECT run_out_date FROM active e WHERE e.medicine_id=a.medicine_id AND e.start_date<=@today ORDER BY e.purchase_date DESC,e.sequence DESC LIMIT 1) AS coverageRunOut,
        (SELECT MIN(start_date) FROM active e WHERE e.medicine_id=a.medicine_id AND e.start_date>@today) AS nextStart,
        a.reminder_enabled AS enabled,f.status,f.next_date AS nextContact,f.last_contact_at AS lastContact,f.closure_reason AS closureReason
        ${from} ORDER BY m.identity_key,m.id LIMIT 20 OFFSET @offset`,
          )
          .all({ ...args, today, offset: page * 20 }) as Row[];
        return supplyResultSchema.parse({
          customer,
          today,
          total,
          revision: db.prepare('SELECT revision FROM app_meta WHERE id=1').pluck().get(),
          supplies: rows.map((r) => ({
            ...r,
            archived: Boolean(r.archived),
            remainingDays: r.coverageRunOut ? Math.max(0, daysBetween(today, r.coverageRunOut)) : 0,
            coverage: !r.coverageRunOut
              ? 'notStarted'
              : r.coverageRunOut > today
                ? 'available'
                : r.coverageRunOut === today
                  ? 'runsOutToday'
                  : 'ranOut',
            reminder: !r.enabled
              ? 'disabled'
              : r.status === 'closed'
                ? 'closed'
                : r.nextContact! < today
                  ? 'overdue'
                  : r.nextContact === today
                    ? 'due'
                    : 'scheduled',
            nextContact: r.enabled ? r.nextContact : null,
            lastContact: r.enabled ? r.lastContact : null,
            closureReason: r.enabled ? r.closureReason : null,
          })),
        });
      })
      .deferred();
  }
}
