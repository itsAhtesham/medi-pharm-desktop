import { OwnerService } from './owner-service';
import { dashboardSchema } from '../contracts/dashboard';
import { addDays, pharmacyDay } from '../domain/values';
import { daysBetween } from '../domain/supply';
export class DashboardService {
  constructor(
    private readonly owner: OwnerService,
    private readonly now = Date.now,
  ) {}
  read() {
    const owner = this.owner.requireOwner();
    const db = this.owner.store.db;
    const today = pharmacyDay(this.now());
    return db
      .transaction(() => {
        const count = (sql: string, ...args: (string | number)[]) =>
          db
            .prepare(sql)
            .pluck()
            .get(...args) as number;
        const totals = db
          .prepare(
            `SELECT
        COUNT(CASE WHEN next_date<=@today THEN 1 END) AS dueCycles,
        COUNT(DISTINCT CASE WHEN next_date<=@today THEN customer_id END) AS dueCustomers,
        COUNT(CASE WHEN next_date<@today THEN 1 END) AS overdueCycles,
        COUNT(DISTINCT CASE WHEN next_date<@today THEN customer_id END) AS overdueCustomers,
        COUNT(CASE WHEN next_date>@today THEN 1 END) AS scheduledCycles
        FROM follow_ups WHERE pharmacy_id=@pharmacy AND status='open'`,
          )
          .get({ today, pharmacy: owner.pharmacy_id }) as Record<string, number>;
        const follow = (scheduled: boolean) =>
          db
            .prepare(
              `SELECT f.*,c.name AS customer_name,c.phone,m.name||' '||m.strength||' '||m.form AS medicine_name,p.sequence,s.run_out_date
        FROM follow_ups f JOIN customers c ON c.id=f.customer_id JOIN medicines m ON m.id=f.medicine_id JOIN purchases p ON p.id=f.purchase_id JOIN medicine_supplies s ON s.id=f.supply_id
        WHERE f.pharmacy_id=? AND f.status='open' AND f.next_date${scheduled ? '>' : '<='}? ORDER BY f.next_date,c.name_key,f.id LIMIT 6`,
            )
            .all(owner.pharmacy_id, today);
        // Rank only supplies that have started. Future refills must not hide current coverage.
        const coverage = `WITH coverage AS (SELECT s.*,ROW_NUMBER() OVER(PARTITION BY s.customer_id,s.medicine_id ORDER BY p.purchase_date DESC,p.sequence DESC) AS rank
        FROM medicine_supplies s JOIN purchases p ON p.id=s.purchase_id
        WHERE s.pharmacy_id=@pharmacy AND s.included=1 AND p.status='active' AND s.start_date<=@today)
      `;
        const args = { pharmacy: owner.pharmacy_id, today, until: addDays(today, 5) };
        const endingWhere =
          'FROM coverage s WHERE s.rank=1 AND s.run_out_date BETWEEN @today AND @until';
        const endingTotals = db
          .prepare(
            `${coverage} SELECT COUNT(*) AS endingSupplies,COUNT(DISTINCT customer_id) AS endingCustomers ${endingWhere}`,
          )
          .get(args) as Record<string, number>;
        const ending = db
          .prepare(
            `${coverage} SELECT s.customer_id AS customerId,c.name AS customer,m.name||' '||m.strength||' '||m.form AS medicine,s.run_out_date AS runOut
        FROM coverage s JOIN customers c ON c.id=s.customer_id JOIN medicines m ON m.id=s.medicine_id
        WHERE s.rank=1 AND s.run_out_date BETWEEN @today AND @until ORDER BY s.run_out_date,c.name_key,m.identity_key,s.id LIMIT 6`,
          )
          .all(args) as {
          customerId: string;
          customer: string;
          medicine: string;
          runOut: string;
        }[];
        const daily = db
          .prepare(
            "SELECT purchase_date AS day,COUNT(*) AS count FROM purchases WHERE pharmacy_id=? AND status='active' AND purchase_date BETWEEN ? AND ? GROUP BY purchase_date",
          )
          .all(owner.pharmacy_id, addDays(today, -6), today) as { day: string; count: number }[];
        const recent = db
          .prepare(
            `SELECT a.id,a.action,a.created_at AS at,COALESCE(json_extract(a.after_json,'$.value.customer_name'),json_extract(a.after_json,'$.value.name'),c.name,'Pharmacy record') AS label
        FROM audit_events a LEFT JOIN follow_ups f ON a.entity_type='followup' AND f.id=a.entity_id LEFT JOIN customers c ON c.id=f.customer_id
        WHERE a.pharmacy_id=? AND a.action IN ('business.customer','business.medicine','business.purchase','business.cancel','business.followup') ORDER BY a.created_at DESC,a.rowid DESC LIMIT 5`,
          )
          .all(owner.pharmacy_id);
        return dashboardSchema.parse({
          today,
          revision: count('SELECT revision FROM app_meta WHERE id=1'),
          activeCustomers: count(
            'SELECT COUNT(*) FROM customers WHERE pharmacy_id=? AND archived_at IS NULL',
            owner.pharmacy_id,
          ),
          activeMedicines: count(
            'SELECT COUNT(*) FROM medicines WHERE pharmacy_id=? AND archived_at IS NULL',
            owner.pharmacy_id,
          ),
          purchasesToday: count(
            "SELECT COUNT(*) FROM purchases WHERE pharmacy_id=? AND status='active' AND purchase_date=?",
            owner.pharmacy_id,
            today,
          ),
          ...totals,
          ...endingTotals,
          purchasesByDay: Array.from({ length: 7 }, (_, i) => {
            const day = addDays(today, i - 6);
            return { day, count: daily.find((d) => d.day === day)?.count ?? 0 };
          }),
          due: follow(false),
          upcoming: follow(true),
          ending: ending.map((r) => ({ ...r, daysLeft: daysBetween(today, r.runOut) })),
          recent,
        });
      })
      .deferred();
  }
}
