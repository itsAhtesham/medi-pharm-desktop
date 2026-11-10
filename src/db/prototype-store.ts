import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  writeFileSync,
  renameSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SaveRecord, StorageStatus, Verification } from '../contracts/desktop';

const APPLICATION_ID = 0x4d505030;

/** Synthetic-only database. This is not the pharmacy schema or production backup engine. */
export class PrototypeStore {
  private readonly db: Database.Database;
  private readonly snapshotPath: string;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const filename = path.join(root, 'prototype.sqlite');
    const marker = path.join(root, 'initialized.json');
    if (existsSync(marker) && !existsSync(filename))
      throw new Error('Previously initialized database is missing.');
    const existing = existsSync(filename);
    this.db = new Database(filename, { fileMustExist: existing });
    this.snapshotPath = path.join(root, 'snapshot.sqlite');
    try {
      if (existing) this.validate(this.db);
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('busy_timeout = 5000');
      if (!existing) {
        this.db.transaction(() => {
          this.db.pragma(`application_id = ${APPLICATION_ID}`);
          this.db.pragma('user_version = 1');
          this.db.exec(`CREATE TABLE records (
            request_id TEXT PRIMARY KEY NOT NULL,
            note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 160),
            saved_at TEXT NOT NULL
          ) STRICT`);
        })();
      }
      if (!existsSync(marker))
        writeFileSync(marker, JSON.stringify({ format: 1, prototype: true }), {
          mode: 0o600,
          flag: 'wx',
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private validate(db: Database.Database): void {
    if (
      db.pragma('application_id', { simple: true }) !== APPLICATION_ID ||
      db.pragma('user_version', { simple: true }) !== 1
    ) {
      throw new Error('Unsupported prototype database.');
    }
    if (
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (db.pragma('foreign_key_check') as unknown[]).length
    ) {
      throw new Error('Database verification failed.');
    }
    db.prepare('SELECT request_id, note, saved_at FROM records LIMIT 1').all();
  }

  status(): StorageStatus {
    const journalMode = this.db.pragma('journal_mode', { simple: true });
    if (journalMode !== 'wal') throw new Error('Unexpected database journal mode.');
    const count = this.db.prepare('SELECT count(*) AS count FROM records').get() as {
      count: number;
    };
    const record = this.db
      .prepare('SELECT note, saved_at AS savedAt FROM records ORDER BY rowid DESC LIMIT 1')
      .get() as StorageStatus['lastRecord'];
    return {
      recordCount: count.count,
      lastRecord: record ?? null,
      sqliteVersion: (
        this.db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
      ).version,
      journalMode,
      snapshotExists: existsSync(this.snapshotPath),
    };
  }

  save(input: SaveRecord): StorageStatus {
    this.db
      .transaction(() => {
        const existing = this.db
          .prepare('SELECT note FROM records WHERE request_id = ?')
          .get(input.requestId) as { note: string } | undefined;
        if (existing) {
          if (existing.note !== input.note)
            throw new Error('Request ID already belongs to another record.');
          return;
        }
        this.db
          .prepare('INSERT INTO records(request_id, note, saved_at) VALUES (?, ?, ?)')
          .run(input.requestId, input.note, new Date().toISOString());
      })
      .immediate();
    return this.status();
  }

  async snapshot(): Promise<Verification> {
    const temporary = path.join(this.root, `snapshot-${randomUUID()}.partial`);
    try {
      await this.db.backup(temporary);
      // A portable snapshot has no live WAL/SHM dependency. Switching this closed,
      // job-owned snapshot to DELETE also prevents verification from creating sidecars.
      const detached = new Database(temporary, { fileMustExist: true });
      try {
        detached.pragma('journal_mode = DELETE');
      } finally {
        detached.close();
      }
      const result = this.verifyFile(temporary);
      // Prototype snapshots are synthetic. Full archive publication/retention belongs to phase 05.
      renameSync(temporary, this.snapshotPath);
      return result;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  verifyRestore(): Verification {
    if (!existsSync(this.snapshotPath)) throw new Error('Create a snapshot first.');
    const target = path.join(this.root, `restore-check-${randomUUID()}.sqlite`);
    try {
      copyFileSync(this.snapshotPath, target);
      return this.verifyFile(target);
    } finally {
      rmSync(target, { force: true });
    }
  }

  private verifyFile(filename: string): Verification {
    // Detect empty/truncated files before SQLite gets a chance to initialize one.
    const fd = openSync(filename, 'r');
    const header = Buffer.alloc(16);
    try {
      readSync(fd, header, 0, 16, 0);
    } finally {
      closeSync(fd);
    }
    if (header.toString() !== 'SQLite format 3\0') throw new Error('Invalid snapshot.');
    const snapshot = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      this.validate(snapshot);
      return {
        recordCount: (
          snapshot.prepare('SELECT count(*) AS count FROM records').get() as { count: number }
        ).count,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      snapshot.close();
    }
  }

  close(): void {
    this.db.close();
  }
}
