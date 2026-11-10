import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { initialSchema } from './migrations/0001';
import { applicationId, migrationChecksum as checksum, inspectConnection } from './health';
import { recoverReplacement, replaceDataset, stagedLive } from './replacement';
import { syncDirectory } from '../platform/durable-files';

const markerSchema = z.object({ format: z.literal(1), datasetId: z.uuid() }).strict();
export type OwnerRow = {
  id: string;
  pharmacy_id: string;
  identifier: string;
  password_hash: string;
  recovery_hash: string;
  credential_version: number;
  active: number;
};

/** The service owns this connection. Construction never creates a database. */
export class PharmacyDatabase {
  private connection?: Database.Database;
  recoveryRequired = false;
  readonly filename: string;
  private readonly marker: string;
  constructor(
    readonly root: string,
    allowDamaged = false,
  ) {
    this.filename = path.join(root, 'data', 'live', 'medipharm.sqlite');
    this.marker = path.join(root, 'settings', 'installation.json');
    for (const folder of [
      'data',
      'settings',
      'operations',
      'backups',
      'staging',
      'recovery',
      'logs',
    ])
      mkdirSync(path.join(root, folder), { recursive: true, mode: 0o700 });
    syncDirectory(root);
    recoverReplacement(root);
    mkdirSync(path.join(root, 'data', 'live'), { recursive: true, mode: 0o700 });
    syncDirectory(path.join(root, 'data'));
    try {
      const marked = existsSync(this.marker);
      const database = existsSync(this.filename);
      const sidecars = ['-wal', '-shm', '-journal'].some((suffix) =>
        existsSync(this.filename + suffix),
      );
      if (!marked && !database && !sidecars) return;
      if (!marked || !database) throw new Error('Installation identity or database is missing.');
      const identity = markerSchema.parse(JSON.parse(readFileSync(this.marker, 'utf8')));
      this.connection = new Database(this.filename, { fileMustExist: true });
      this.validate(identity.datasetId);
      this.configure();
    } catch (error) {
      this.close();
      if (allowDamaged) this.recoveryRequired = true;
      else throw error;
    }
  }
  get initialized(): boolean {
    return Boolean(this.connection);
  }
  get db(): Database.Database {
    if (!this.connection) throw new Error('Explicit setup is required.');
    return this.connection;
  }
  owner(): OwnerRow {
    return this.db.prepare('SELECT * FROM users').get() as OwnerRow;
  }
  initialize(
    input: { name: string; identifier: string; passwordHash: string; recoveryHash: string },
    now: number,
  ): void {
    if (this.connection || existsSync(this.marker) || existsSync(this.filename))
      throw new Error('Installation already exists.');
    const datasetId = randomUUID();
    // Build privately first. No installation claim or live file exists until the
    // complete account is committed and verified. Abandoned staging is not live data.
    const jobId = randomUUID();
    const staged = stagedLive(this.root, jobId);
    mkdirSync(staged, { recursive: true, mode: 0o700 });
    const filename = path.join(staged, 'medipharm.sqlite');
    try {
      this.connection = new Database(filename);
      chmodSync(filename, 0o600);
      this.configure();
      this.db
        .transaction(() => {
          this.db.exec(initialSchema);
          this.db.pragma(`application_id = ${applicationId}`);
          this.db.prepare('INSERT INTO schema_migrations VALUES (1,?,?)').run(checksum, now);
          this.db.prepare('INSERT INTO app_meta VALUES (1,?,0,?)').run(datasetId, now);
          const pharmacyId = randomUUID();
          this.db
            .prepare('INSERT INTO pharmacies(id,name,created_at,updated_at) VALUES (?,?,?,?)')
            .run(pharmacyId, input.name, now, now);
          this.db
            .prepare(
              'INSERT INTO users(id,pharmacy_id,identifier,password_hash,recovery_hash) VALUES (?,?,?,?,?)',
            )
            .run(
              randomUUID(),
              pharmacyId,
              input.identifier,
              input.passwordHash,
              input.recoveryHash,
            );
          this.db.prepare("INSERT INTO number_counters VALUES (?,'purchase',1)").run(pharmacyId);
          this.db.prepare('INSERT INTO auth_attempts VALUES (1,0,0,?)').run(now);
        })
        .immediate();
      this.validate(datasetId);
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.pragma('journal_mode = DELETE');
      this.close();
      syncDirectory(staged);
      replaceDataset(this.root, jobId, 'setup');
      this.connection = new Database(this.filename, { fileMustExist: true });
      this.configure();
      this.validate(datasetId);
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private configure(): void {
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    for (const [name, value] of Object.entries({
      foreign_keys: 1,
      busy_timeout: 5000,
      journal_mode: 'wal',
      synchronous: 2,
    }))
      if (this.db.pragma(name, { simple: true }) !== value)
        throw new Error('Unsupported database configuration.');
  }
  private validate(datasetId: string): void {
    inspectConnection(this.db, datasetId);
  }
  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }
}
