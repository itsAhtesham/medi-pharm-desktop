import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { initialSchema } from './migrations/0001';
import { validateHash } from '../application/credentials';

const applicationId = 0x4d504431;
const checksum = createHash('sha256').update(initialSchema).digest('hex');
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
  readonly filename: string;
  private readonly marker: string;
  constructor(readonly root: string) {
    this.filename = path.join(root, 'data', 'live', 'medipharm.sqlite');
    this.marker = path.join(root, 'settings', 'installation.json');
    for (const folder of [
      'data/live',
      'settings',
      'operations',
      'backups',
      'staging',
      'recovery',
      'logs',
    ])
      mkdirSync(path.join(root, folder), { recursive: true, mode: 0o700 });
    const marked = existsSync(this.marker);
    const database = existsSync(this.filename);
    const sidecars = ['-wal', '-shm', '-journal'].some((suffix) =>
      existsSync(this.filename + suffix),
    );
    if (!marked && !database && !sidecars) return;
    if (!marked || !database) throw new Error('Installation identity or database is missing.');
    const identity = markerSchema.parse(JSON.parse(readFileSync(this.marker, 'utf8')));
    try {
      this.connection = new Database(this.filename, { fileMustExist: true });
      this.validate(identity.datasetId);
      this.configure();
    } catch (error) {
      this.close();
      throw error;
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
    // Persist the claim before SQLite can create anything. A partial setup fails closed;
    // never silently replace an installation whose commit outcome is uncertain.
    const fd = openSync(this.marker, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ format: 1, datasetId }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (process.platform !== 'win32') {
      const directory = openSync(path.dirname(this.marker), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
    try {
      this.connection = new Database(this.filename);
      chmodSync(this.filename, 0o600);
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
    if (this.db.pragma('application_id', { simple: true }) !== applicationId)
      throw new Error('Unrecognized database.');
    const migrations = this.db
      .prepare('SELECT id,checksum FROM schema_migrations ORDER BY id')
      .all();
    if (
      migrations.length !== 1 ||
      (migrations[0] as { id: number }).id !== 1 ||
      (migrations[0] as { checksum: string }).checksum !== checksum
    )
      throw new Error('Unsupported or modified migration ledger.');
    const meta = this.db.prepare('SELECT dataset_id FROM app_meta WHERE id=1').get() as
      { dataset_id: string } | undefined;
    if (meta?.dataset_id !== datasetId) throw new Error('Dataset identity mismatch.');
    if (
      this.db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (this.db.pragma('foreign_key_check') as unknown[]).length
    )
      throw new Error('Database health check failed.');
    const owners = this.db.prepare('SELECT * FROM users').all() as OwnerRow[];
    if (owners.length !== 1 || owners[0].active !== 1) throw new Error('Invalid owner account.');
    validateHash(owners[0].password_hash);
    validateHash(owners[0].recovery_hash);
    if (!this.db.prepare('SELECT id FROM auth_attempts WHERE id=1').get())
      throw new Error('Missing authentication state.');
  }
  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }
}
