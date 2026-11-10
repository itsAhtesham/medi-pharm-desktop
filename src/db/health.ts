import { inspectBusiness } from './business-health';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { initialSchema } from './migrations/0001';
import { validateHash } from '../application/credentials';
import { businessDate, addDays } from '../domain/values';
import { z } from 'zod';

export const applicationId = 0x4d504431;
export const migrationChecksum = createHash('sha256').update(initialSchema).digest('hex');
export const databaseInfoSchema = z
  .object({
    datasetId: z.uuid(),
    revision: z.number().int().nonnegative(),
    pharmacyName: z.string().min(1).max(120),
    schemaVersion: z.literal(1),
    schemaChecksum: z.literal(migrationChecksum),
    customers: z.number().int().nonnegative(),
    medicines: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
  })
  .strict();
export type DatabaseInfo = z.infer<typeof databaseInfoSchema>;
export function inspectConnection(db: Database.Database, expectedDataset?: string): DatabaseInfo {
  db.pragma('trusted_schema = OFF');
  if (db.pragma('application_id', { simple: true }) !== applicationId)
    throw new Error('Unrecognized database.');
  const migrations = db.prepare('SELECT id,checksum FROM schema_migrations ORDER BY id').all() as {
    id: number;
    checksum: string;
  }[];
  if (
    migrations.length !== 1 ||
    migrations[0].id !== 1 ||
    migrations[0].checksum !== migrationChecksum
  )
    throw new Error('Unsupported or modified migration ledger.');
  if (
    db.pragma('integrity_check', { simple: true }) !== 'ok' ||
    (db.pragma('foreign_key_check') as unknown[]).length
  )
    throw new Error('Database health check failed.');
  const meta = db.prepare('SELECT dataset_id,revision FROM app_meta WHERE id=1').get() as {
    dataset_id: string;
    revision: number;
  };
  if (expectedDataset && meta?.dataset_id !== expectedDataset)
    throw new Error('Dataset identity mismatch.');
  const owners = db.prepare('SELECT password_hash,recovery_hash,active FROM users').all() as {
    password_hash: string;
    recovery_hash: string;
    active: number;
  }[];
  if (owners.length !== 1 || owners[0].active !== 1) throw new Error('Invalid owner account.');
  validateHash(owners[0].password_hash);
  validateHash(owners[0].recovery_hash);
  if (!db.prepare('SELECT id FROM auth_attempts WHERE id=1').get())
    throw new Error('Missing authentication state.');
  // Compare the actual schema with the reviewed initial DDL, including indexes/triggers.
  // A valid ledger alone does not prove that required constraints still exist.
  const expected = new Database(':memory:');
  const schemaSql =
    "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
  try {
    expected.exec(initialSchema);
    if (
      JSON.stringify(db.prepare(schemaSql).all()) !==
      JSON.stringify(expected.prepare(schemaSql).all())
    )
      throw new Error('Database schema does not match its migration.');
  } finally {
    expected.close();
  }
  if (
    db
      .prepare(
        `SELECT 1 FROM medicine_supplies s JOIN purchases p ON p.id=s.purchase_id WHERE s.customer_id<>p.customer_id LIMIT 1`,
      )
      .get()
  )
    throw new Error('Supply relationship mismatch.');
  if (
    db
      .prepare(
        `SELECT 1 FROM follow_ups f JOIN medicine_supplies s ON s.id=f.supply_id WHERE f.customer_id<>s.customer_id OR f.medicine_id<>s.medicine_id OR f.purchase_id<>s.purchase_id LIMIT 1`,
      )
      .get()
  )
    throw new Error('Follow-up relationship mismatch.');
  for (const row of db.prepare('SELECT purchase_date FROM purchases').iterate() as Iterable<{
    purchase_date: string;
  }>)
    businessDate(row.purchase_date);
  for (const row of db
    .prepare(
      'SELECT start_date,new_days,remaining_used,run_out_date,manual_reminder_date FROM medicine_supplies',
    )
    .iterate() as Iterable<{
    start_date: string;
    new_days: number;
    remaining_used: number;
    run_out_date: string;
    manual_reminder_date: string | null;
  }>) {
    if (addDays(row.start_date, row.new_days + row.remaining_used) !== row.run_out_date)
      throw new Error('Invalid supply calculation.');
    if (row.manual_reminder_date) businessDate(row.manual_reminder_date);
  }
  for (const row of db
    .prepare('SELECT calculated_date,manual_date,next_date FROM follow_ups')
    .iterate() as Iterable<{
    calculated_date: string;
    manual_date: string | null;
    next_date: string;
  }>) {
    businessDate(row.calculated_date);
    businessDate(row.next_date);
    if (row.manual_date) businessDate(row.manual_date);
  }
  inspectBusiness(db);
  const count = (table: 'customers' | 'medicines' | 'purchases') =>
    db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
  return databaseInfoSchema.parse({
    datasetId: meta.dataset_id,
    revision: meta.revision,
    pharmacyName: db.prepare('SELECT name FROM pharmacies').pluck().get(),
    schemaVersion: 1,
    schemaChecksum: migrationChecksum,
    customers: count('customers'),
    medicines: count('medicines'),
    purchases: count('purchases'),
  });
}
export function inspectDatabase(filename: string, expectedDataset?: string): DatabaseInfo {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    return inspectConnection(db, expectedDataset);
  } finally {
    db.close();
  }
}
