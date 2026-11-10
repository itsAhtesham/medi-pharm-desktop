import { OwnerService } from './owner-service';
import { ApplicationFailure } from './failure';
import { csvInputSchema, csvResultSchema, type CsvInput } from '../contracts/reports';
import { textKey } from '../contracts/business';
import { pharmacyDay } from '../domain/values';
import { writeCsvFile } from '../platform/csv-file';
type Cell = string | number | null;
type Column = { key: string; label: string; format?: (v: Cell) => Cell };
const column = (key: string, label: string): Column => ({ key, label });
const timestamp = (key: string, label: string): Column => ({
  key,
  label,
  format: (v) => (v === null ? '' : new Date(Number(v)).toISOString()),
});
const quantity = (v: Cell): string => {
  const value = Number(v);
  return `${Math.trunc(value / 1000)}.${String(value % 1000).padStart(3, '0')}`;
};
export class CsvExporter {
  constructor(
    private readonly owner: OwnerService,
    private readonly now = Date.now,
  ) {}
  export(raw: CsvInput, filename: string) {
    const owner = this.owner.requireOwner();
    const parsed = csvInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new ApplicationFailure(
        'INVALID_REQUEST',
        'Choose a supported CSV export and valid filters.',
      );
    const input = parsed.data;
    const today = pharmacyDay(this.now());
    const db = this.owner.store.db;
    let from: string;
    let projection: string;
    let order: string;
    let columns: Column[];
    let where: string;
    const args: (string | number)[] = [owner.pharmacy_id];
    if (input.kind === 'customers' || input.kind === 'medicines') {
      from = input.kind;
      projection = '*';
      where = 'pharmacy_id=?';
      order = input.kind === 'customers' ? 'name_key,id' : 'identity_key,id';
      if (input.status !== 'all')
        where += ' AND archived_at IS ' + (input.status === 'active' ? 'NULL' : 'NOT NULL');
      if (input.search) {
        where +=
          input.kind === 'customers'
            ? ' AND (instr(name_key,?)>0 OR instr(phone_key,?)>0)'
            : ' AND instr(identity_key,?)>0';
        args.push(
          input.kind === 'customers'
            ? textKey(input.search)
            : JSON.stringify(textKey(input.search)).slice(1, -1),
        );
        if (input.kind === 'customers') args.push(input.search.replace(/\D/g, '') || '!');
      }
      columns =
        input.kind === 'customers'
          ? [
              column('name', 'Customer'),
              column('phone', 'Phone'),
              column('age', 'Age'),
              column('notes', 'Notes'),
            ]
          : [column('name', 'Medicine'), column('strength', 'Strength'), column('form', 'Form')];
      columns.push({
        key: 'archived_at',
        label: 'Record status',
        format: (v) => (v === null ? 'active' : 'archived'),
      });
    } else if (input.kind === 'purchases') {
      from =
        'purchases p JOIN customers c ON c.id=p.customer_id JOIN purchase_items i ON i.purchase_id=p.id JOIN medicine_supplies s ON s.purchase_id=p.id AND s.medicine_id=i.medicine_id AND s.included=1';
      projection =
        'p.sequence,p.purchase_date,p.status,c.name AS customer,c.phone,p.notes,i.name_snapshot AS medicine,i.strength_snapshot AS strength,i.form_snapshot AS form,i.quantity_milli,i.unit,s.start_date,s.new_days,s.mode,s.remaining_override,s.remaining_used,s.run_out_date,s.reminder_enabled,s.manual_reminder_date';
      where = 'p.pharmacy_id=?';
      order = 'p.purchase_date DESC,p.sequence DESC,i.position';
      if (input.customerId) {
        where += ' AND p.customer_id=?';
        args.push(input.customerId);
      }
      if (input.medicineId) {
        where +=
          ' AND EXISTS(SELECT 1 FROM purchase_items matched WHERE matched.purchase_id=p.id AND matched.medicine_id=?)';
        args.push(input.medicineId);
      }
      if (input.search) {
        where += ' AND (instr(c.name_key,?)>0 OR CAST(p.sequence AS TEXT)=?)';
        args.push(textKey(input.search), input.search);
      }
      columns = [
        column('sequence', 'Purchase number'),
        column('purchase_date', 'Purchase date'),
        column('status', 'Purchase status'),
        column('customer', 'Customer'),
        column('phone', 'Phone'),
        column('medicine', 'Medicine at purchase'),
        column('strength', 'Strength at purchase'),
        column('form', 'Form at purchase'),
        { key: 'quantity_milli', label: 'Quantity', format: quantity },
        column('unit', 'Unit'),
        column('start_date', 'Supply start'),
        column('new_days', 'New days'),
        column('mode', 'Refill mode'),
        column('remaining_override', 'Remaining override'),
        column('remaining_used', 'Carried days'),
        column('run_out_date', 'Run-out date'),
        { key: 'reminder_enabled', label: 'Reminder enabled', format: (v) => (v ? 'yes' : 'no') },
        column('manual_reminder_date', 'Initial manual reminder'),
        column('notes', 'Purchase notes'),
      ];
    } else {
      from =
        'follow_ups f JOIN customers c ON c.id=f.customer_id JOIN medicines m ON m.id=f.medicine_id JOIN purchases p ON p.id=f.purchase_id JOIN medicine_supplies s ON s.id=f.supply_id';
      projection =
        'c.name AS customer,c.phone,m.name AS medicine,m.strength,m.form,p.sequence,f.status,f.next_date,s.run_out_date,f.last_contact_at,f.closed_at,f.closure_reason';
      where = 'f.pharmacy_id=?';
      order = 'f.next_date,c.name_key,f.id';
      if (input.customerId) {
        where += ' AND f.customer_id=?';
        args.push(input.customerId);
      }
      if (input.search) {
        where += ' AND (instr(c.name_key,?)>0 OR instr(c.phone_key,?)>0)';
        args.push(textKey(input.search), input.search.replace(/\D/g, '') || '!');
      }
      if (input.tab === 'due' || input.tab === 'scheduled') {
        where += ` AND f.status='open' AND f.next_date${input.tab === 'due' ? '<=' : '>'}?`;
        args.push(today);
      }
      if (input.tab === 'closed') where += " AND f.status<>'open'";
      columns = [
        column('customer', 'Customer'),
        column('phone', 'Phone'),
        column('medicine', 'Medicine'),
        column('strength', 'Strength'),
        column('form', 'Form'),
        column('sequence', 'Purchase number'),
        column('status', 'Current cycle status'),
        column('next_date', 'Next contact date'),
        column('run_out_date', 'Run-out date'),
        timestamp('last_contact_at', 'Last contact (UTC)'),
        timestamp('closed_at', 'Closed (UTC)'),
        column('closure_reason', 'Closure reason'),
      ];
      if (input.kind === 'followupHistory') {
        from += ' JOIN follow_up_events h ON h.follow_up_id=f.id';
        order = 'h.created_at,h.id';
        projection += `,h.action,h.note,h.created_at,
          json_extract(h.before_json,'$.value.status') AS before_status,json_extract(h.after_json,'$.value.status') AS after_status,
          json_extract(h.before_json,'$.value.next_date') AS before_date,json_extract(h.after_json,'$.value.next_date') AS after_date,
          json_extract(h.before_json,'$.value.closure_reason') AS before_reason,json_extract(h.after_json,'$.value.closure_reason') AS after_reason`;
        columns.push(
          timestamp('created_at', 'Event time (UTC)'),
          column('action', 'Action'),
          column('note', 'Contact outcome / note'),
          column('before_status', 'Previous cycle status'),
          column('after_status', 'New cycle status'),
          column('before_date', 'Previous next contact'),
          column('after_date', 'New next contact'),
          column('before_reason', 'Previous closure reason'),
          column('after_reason', 'New closure reason'),
        );
      }
    }
    try {
      // One read transaction and a serialized service command keep every row in one database view.
      return csvResultSchema.parse(
        writeCsvFile(this.owner.store.root, filename, (write) =>
          db
            .transaction(() => {
              let count = 0;
              const started = performance.now();
              write(columns.map((c) => c.label));
              for (const row of db
                .prepare(`SELECT ${projection} FROM ${from} WHERE ${where} ORDER BY ${order}`)
                .iterate(...args) as Iterable<Record<string, Cell>>) {
                if (performance.now() - started > 90_000)
                  throw new ApplicationFailure(
                    'BUSY',
                    'The export exceeded its time limit. Narrow the search and try again.',
                  );
                write(columns.map((c) => (c.format ? c.format(row[c.key]) : row[c.key])));
                count++;
              }
              this.owner.requireOwner();
              return count;
            })
            .deferred(),
        ),
      );
    } catch (error) {
      if (error instanceof ApplicationFailure) throw error;
      throw new ApplicationFailure(
        'STORAGE_ERROR',
        'CSV export failed. Check the destination and free space. Any existing destination file was preserved.',
      );
    }
  }
}
