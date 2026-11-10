import Database from 'better-sqlite3';
import { randomBytes, randomUUID, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { version as appVersion } from '../../package.json';
import type { OwnerService } from '../application/owner-service';
import { ApplicationFailure } from '../application/failure';
import { PharmacyDatabase } from '../db/pharmacy-database';
import { inspectDatabase, inspectConnection, type DatabaseInfo } from '../db/health';
import { replaceDataset, stagedLive } from '../db/replacement';
import { atomicJson, durableRename, writeDurable } from '../platform/durable-files';
import { pharmacyDay } from '../domain/values';
import { isWithinDirectory } from '../platform/paths';
import type { BackupStatus, RestorePreview, BackupRotation } from '../contracts/backup';
import {
  MAX_ARCHIVE_BYTES,
  decodeArchive,
  decodeWithKey,
  encodeArchive,
  envelopeSchema,
  readBounded,
  sha256,
  unwrapKey,
  wrapKey,
  type KeyEnvelope,
  type Manifest,
} from './archive';

function envelopeProof(key: Buffer, envelope: KeyEnvelope): string {
  const proofKey = Buffer.from(
    hkdfSync('sha256', key, Buffer.alloc(0), 'MediPharm local envelope proof v1', 32),
  );
  try {
    return createHmac('sha256', proofKey)
      .update(JSON.stringify(envelopeSchema.parse(envelope)))
      .digest('hex');
  } finally {
    proofKey.fill(0);
  }
}
const configSchema = z
  .object({
    format: z.literal(1),
    envelope: envelopeSchema,
    keyHash: z.string().regex(/^[a-f0-9]{64}$/),
    proof: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const destinationSchema = z.object({ directory: z.string().max(4096), id: z.uuid() }).strict();
const filenameSchema = z.string().regex(/^medi-pharm-[0-9]{13}-[a-f0-9-]{36}\.mpbackup$/);
const recordSchema = z
  .object({
    filename: filenameSchema,
    at: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    datasetId: z.uuid(),
    kind: z.enum(['manual', 'daily', 'safety', 'restored']),
    externalId: z.uuid().nullable(),
    externalAt: z.number().int().nonnegative().nullable(),
    envelopeHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .strict();
type Record = z.infer<typeof recordSchema>;
const historySchema = z
  .object({
    records: z.array(recordSchema).max(1000),
    message: z.string().max(400),
    pending: z.boolean(),
  })
  .strict();
type PendingRestore = {
  token: string;
  jobId: string;
  manifest: Manifest;
  envelope: KeyEnvelope;
  key: Buffer;
  expires: number;
  base: { datasetId: string; revision: number } | null;
};

/** Owned and serialized by the local service. No renderer-supplied file paths. */
export class BackupManager {
  private key?: Buffer;
  private config?: z.infer<typeof configSchema>;
  private destination?: z.infer<typeof destinationSchema>;
  private history: z.infer<typeof historySchema> = { records: [], message: '', pending: false };
  private pendingRestore?: PendingRestore;
  broken = false;
  private readonly root: string;
  constructor(private readonly owner: OwnerService) {
    this.root = owner.store.root;
    const deviceFile = path.join(this.root, 'settings', 'device-identity.json');
    if (!existsSync(deviceFile))
      writeDurable(deviceFile, JSON.stringify({ format: 1, id: randomUUID() }));
    this.config = this.readOptional('settings/backup-key-envelope.json', configSchema);
    this.destination = this.readOptional('settings/backup-destination.json', destinationSchema);
    this.history = this.readOptional('operations/backups.json', historySchema) ?? this.history;
    if (this.history.pending) {
      this.history.pending = false;
      this.history.message =
        'A previous backup was interrupted. Earlier completed archives are preserved.';
      this.saveHistory();
    }
    // Journal recovery has already run in PharmacyDatabase. These private jobs were
    // never published; retain recovery/ generations and completed archives.
    for (const name of readdirSync(path.join(this.root, 'staging')))
      if (z.uuid().safeParse(name).success)
        rmSync(path.join(this.root, 'staging', name), { recursive: true, force: true });
    for (const name of readdirSync(path.join(this.root, 'backups')))
      if (/^medi-pharm-\d{13}-[a-f0-9-]{36}\.mpbackup\.partial$/.test(name))
        rmSync(path.join(this.root, 'backups', name));
  }
  private readOptional<T>(relative: string, schema: z.ZodType<T>): T | undefined {
    const filename = path.join(this.root, relative);
    if (!existsSync(filename)) return;
    return schema.parse(JSON.parse(readBounded(filename, 1024 * 1024).toString('utf8')));
  }
  private saveHistory(): void {
    atomicJson(path.join(this.root, 'operations/backups.json'), this.history);
  }
  private authorizeFresh(): void {
    if (this.owner.store.initialized) this.owner.requireOwner();
  }
  status(): BackupStatus {
    this.authorizeFresh();
    const records = this.history.records.filter((record) =>
      existsSync(path.join(this.root, 'backups', record.filename)),
    );
    const currentDataset = this.owner.store.initialized
      ? (this.owner.store.db.prepare('SELECT dataset_id FROM app_meta').pluck().get() as string)
      : null;
    const current = records.filter((record) => record.datasetId === currentDataset);
    const latest = current.at(-1);
    const external = this.history.records
      .filter(
        (record) =>
          record.datasetId === currentDataset &&
          record.externalId === this.destination?.id &&
          record.externalAt !== null,
      )
      .at(-1);
    return {
      configured: Boolean(this.config),
      unlocked: Boolean(this.key),
      osProtected: false,
      localLast: latest?.at ?? null,
      externalLast: external?.externalAt ?? null,
      externalName: this.destination ? path.basename(this.destination.directory) : null,
      externalPending: Boolean(
        this.destination && (!latest || latest.externalId !== this.destination.id),
      ),
      message: this.history.message,
      archiveCount: records.length,
    };
  }
  async configure(passphrase: string): Promise<{ key: string }> {
    this.owner.requireOwner();
    if (this.config)
      throw new ApplicationFailure(
        'CONFLICT',
        'Backups are already configured. Unlock them with the backup passphrase.',
      );
    const key = randomBytes(32);
    try {
      const envelope = await wrapKey(key, passphrase);
      this.owner.requireOwner();
      const config = {
        format: 1 as const,
        envelope,
        keyHash: sha256(key),
        proof: envelopeProof(key, envelope),
      };
      atomicJson(path.join(this.root, 'settings/backup-key-envelope.json'), config);
      this.config = config;
      this.key = key;
      return { key: key.toString('hex') };
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
  async rotate(input: BackupRotation): Promise<{ key: string }> {
    this.owner.requireOwner();
    if (!this.config) throw new ApplicationFailure('NOT_READY', 'Set up backups first.');
    let oldKey: Buffer;
    try {
      oldKey = await unwrapKey(this.config.envelope, input.currentPassphrase);
    } catch {
      throw new ApplicationFailure(
        'AUTH_FAILED',
        'The current backup passphrase could not be verified.',
      );
    }
    const key = input.rotateMasterKey ? randomBytes(32) : Buffer.from(oldKey);
    oldKey.fill(0);
    try {
      const envelope = await wrapKey(key, input.passphrase);
      this.owner.requireOwner();
      const config = {
        format: 1 as const,
        envelope,
        keyHash: sha256(key),
        proof: envelopeProof(key, envelope),
      };
      atomicJson(path.join(this.root, 'settings/backup-key-envelope.json'), config);
      this.config = config;
      this.key?.fill(0);
      this.key = key;
      return { key: key.toString('hex') };
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
  async unlock(passphrase: string): Promise<{ key: string }> {
    this.owner.requireOwner();
    if (!this.config) throw new ApplicationFailure('NOT_READY', 'Set up backups first.');
    let key: Buffer;
    try {
      key = await unwrapKey(this.config.envelope, passphrase);
    } catch {
      throw new ApplicationFailure('AUTH_FAILED', 'The backup passphrase could not be verified.');
    }
    this.owner.requireOwner();
    this.installKey(key, true);
    return { key: key.toString('hex') };
  }
  unlockDevice(key: string): null {
    this.owner.requireOwner();
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(key);
    this.installKey(Buffer.from(key, 'hex'));
    return null;
  }
  private installKey(key: Buffer, passphraseVerified = false): void {
    if (!this.config || sha256(key) !== this.config.keyHash) {
      key.fill(0);
      throw new ApplicationFailure('AUTH_FAILED', 'Unlock backups with the backup passphrase.');
    }
    const proof = envelopeProof(key, this.config.envelope);
    if (passphraseVerified) {
      // A successful portable unwrap can upgrade/repair local proof metadata.
      const config = { ...this.config, proof };
      atomicJson(path.join(this.root, 'settings/backup-key-envelope.json'), config);
      this.config = config;
    } else if (
      !this.config.proof ||
      !timingSafeEqual(Buffer.from(this.config.proof, 'hex'), Buffer.from(proof, 'hex'))
    ) {
      key.fill(0);
      throw new ApplicationFailure(
        'AUTH_FAILED',
        'The saved backup envelope needs verification. Unlock using the backup passphrase.',
      );
    }
    this.key?.fill(0);
    this.key = key;
  }
  async create(kind: Record['kind'] = 'manual', internal = false): Promise<BackupStatus> {
    if (!internal) this.owner.requireOwner();
    if (this.history.records.length >= 1000)
      throw new ApplicationFailure(
        'NOT_READY',
        'The preview backup history limit has been reached. Preserve the existing archives before arranging history maintenance.',
      );
    if (!this.key || !this.config)
      throw new ApplicationFailure(
        'NOT_READY',
        'Unlock backups with your backup passphrase first.',
      );
    this.history.pending = true;
    this.history.message = 'Creating a verified encrypted backup…';
    this.saveHistory();
    const job = randomUUID();
    const directory = path.join(this.root, 'staging', job);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const estimated =
        Number(this.owner.store.db.pragma('page_count', { simple: true })) *
        Number(this.owner.store.db.pragma('page_size', { simple: true }));
      if (estimated > MAX_ARCHIVE_BYTES - 16384)
        throw new ApplicationFailure(
          'INVALID_REQUEST',
          'This preview supports archives up to 64 MiB. The pharmacy database exceeds that limit.',
        );
      this.checkSpace(path.join(this.root, 'staging'), estimated * 2 + 1024 * 1024);
      const startedAt = Date.now();
      const snapshot = path.join(directory, 'snapshot.sqlite');
      await this.owner.store.db.backup(snapshot);
      const db = new Database(snapshot, { fileMustExist: true });
      try {
        db.pragma('journal_mode = DELETE');
        inspectConnection(db);
      } finally {
        db.close();
      }
      const info = inspectDatabase(snapshot);
      const archive = encodeArchive(
        readBounded(snapshot),
        info,
        this.key,
        this.config.envelope,
        startedAt,
        appVersion,
      );
      const filename = `medi-pharm-${archive.manifest.completedAt}-${archive.manifest.backupId}.mpbackup`;
      this.publish(path.join(this.root, 'backups'), filename, archive.bytes);
      const record: Record = {
        filename,
        at: archive.manifest.completedAt,
        revision: info.revision,
        datasetId: info.datasetId,
        kind,
        externalId: null,
        externalAt: null,
        envelopeHash: sha256(Buffer.from(JSON.stringify(this.config.envelope))),
      };
      this.history.records.push(record);
      this.history.pending = false;
      this.history.message = 'Local encrypted backup verified.';
      this.saveHistory();
      await this.copyExternal(record);
      this.retain(path.join(this.root, 'backups'));
      // Internal restore backup runs before login; return status only to its caller.
      return internal
        ? {
            configured: true,
            unlocked: true,
            osProtected: false,
            localLast: record.at,
            externalLast: record.externalAt,
            externalName: null,
            externalPending: false,
            message: this.history.message,
            archiveCount: this.history.records.length,
          }
        : this.status();
    } catch (error) {
      this.history.pending = false;
      this.history.message =
        'Backup did not finish. Earlier archives are preserved; check disk space and unlock status.';
      this.saveHistory();
      throw error;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  private checkSpace(directory: string, bytes: number): void {
    const space = statfsSync(directory);
    if (space.bavail * space.bsize < bytes)
      throw new ApplicationFailure(
        'STORAGE_ERROR',
        `Not enough free space. This operation needs approximately ${Math.ceil(bytes / 1024 / 1024)} MiB of additional space.`,
      );
  }
  private publish(directory: string, filename: string, bytes: Buffer): void {
    const final = path.join(directory, filename);
    const partial = `${final}.partial`;
    if (existsSync(final)) {
      if (sha256(readBounded(final)) !== sha256(bytes))
        throw new Error('An archive with this name already exists.');
      return;
    }
    try {
      this.checkSpace(directory, bytes.length);
      writeDurable(partial, bytes);
      const verified = readBounded(partial);
      if (sha256(verified) !== sha256(bytes)) throw new Error('Archive write verification failed.');
      decodeWithKey(verified, this.key!);
      durableRename(partial, final);
    } catch (error) {
      rmSync(partial, { force: true });
      throw error;
    }
  }
  configureExternal(directory: string): BackupStatus {
    this.owner.requireOwner();
    const resolved = realpathSync(directory);
    const root = realpathSync(this.root);
    if (!statSync(resolved).isDirectory() || isWithinDirectory(resolved, root))
      throw new ApplicationFailure(
        'INVALID_REQUEST',
        'Choose a backup folder outside the application data directory.',
      );
    const marker = path.join(resolved, '.medipharm-destination.json');
    let id: string;
    if (existsSync(marker))
      id = z
        .object({ format: z.literal(1), id: z.uuid() })
        .strict()
        .parse(JSON.parse(readBounded(marker, 4096).toString('utf8'))).id;
    else {
      id = randomUUID();
      writeDurable(marker, JSON.stringify({ format: 1, id }));
    }
    this.destination = { directory: resolved, id };
    atomicJson(path.join(this.root, 'settings/backup-destination.json'), this.destination);
    return this.status();
  }
  private async copyExternal(record: Record): Promise<void> {
    if (!this.destination) return;
    try {
      const marker = JSON.parse(
        readBounded(
          path.join(this.destination.directory, '.medipharm-destination.json'),
          4096,
        ).toString('utf8'),
      );
      if (marker.format !== 1 || marker.id !== this.destination.id)
        throw new Error('Destination identity changed.');
      this.publish(
        this.destination.directory,
        record.filename,
        readBounded(path.join(this.root, 'backups', record.filename)),
      );
      record.externalId = this.destination.id;
      record.externalAt = Date.now();
      this.history.message = 'Local and external encrypted backups verified.';
      this.saveHistory();
      this.retain(this.destination.directory, this.destination.id);
    } catch {
      this.history.message =
        'Local backup verified. External backup is pending; reconnect or reselect the registered drive and check its free space.';
      this.saveHistory();
    }
  }
  private retain(directory: string, externalId?: string): void {
    const records = this.history.records.filter(
      (record) => !externalId || record.externalId === externalId,
    );
    const keep = retentionSet(records);
    for (const record of records)
      if (!keep.has(record.filename)) {
        try {
          rmSync(path.join(directory, record.filename), { force: true });
        } catch {
          /* Retry retention only after a future verified backup. */
        }
      }
    // Keep bounded device history without ever deleting unregistered files.
    if (this.history.records.length > 900)
      this.history.records = this.history.records.filter(
        (record) =>
          keep.has(record.filename) || existsSync(path.join(this.root, 'backups', record.filename)),
      );
    this.saveHistory();
  }
  async tick(): Promise<BackupStatus> {
    this.owner.requireOwner();
    if (!this.key || !this.config) return this.status();
    const info = inspectConnection(this.owner.store.db);
    const latest = this.history.records
      .filter(
        (record) =>
          record.datasetId === info.datasetId &&
          existsSync(path.join(this.root, 'backups', record.filename)),
      )
      .at(-1);
    if (
      !latest ||
      latest.envelopeHash !== sha256(Buffer.from(JSON.stringify(this.config.envelope))) ||
      (latest.revision !== info.revision &&
        (pharmacyDay(latest.at) !== pharmacyDay(Date.now()) ||
          Date.now() - latest.at >= 86_400_000))
    )
      return this.create('daily');
    if (this.destination && latest.externalId !== this.destination.id)
      await this.copyExternal(latest);
    return this.status();
  }
  async preview(filename: string, passphrase: string): Promise<RestorePreview> {
    this.authorizeFresh();
    this.cancelPreview();
    let decoded: Awaited<ReturnType<typeof decodeArchive>>;
    try {
      decoded = await decodeArchive(readBounded(filename), passphrase);
    } catch {
      throw new ApplicationFailure(
        'INVALID_REQUEST',
        'The backup could not be opened. Check its passphrase, format, size and integrity.',
      );
    }
    const jobId = randomUUID();
    const directory = stagedLive(this.root, jobId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      this.authorizeFresh();
      const staged = path.join(directory, 'medipharm.sqlite');
      writeDurable(staged, decoded.database);
      const info = inspectDatabase(staged, decoded.manifest.datasetId);
      for (const key of Object.keys(info) as (keyof DatabaseInfo)[])
        if (info[key] !== decoded.manifest[key]) throw new Error('Manifest and database disagree.');
      const base = this.owner.store.initialized ? inspectConnection(this.owner.store.db) : null;
      const token = randomUUID();
      this.pendingRestore = {
        token,
        jobId,
        manifest: decoded.manifest,
        envelope: decoded.envelope,
        key: decoded.key,
        expires: Date.now() + 10 * 60_000,
        base,
      };
      return {
        token,
        pharmacyName: info.pharmacyName,
        capturedAt: decoded.manifest.completedAt,
        datasetId: info.datasetId,
        revision: info.revision,
        differentDataset: Boolean(base && base.datasetId !== info.datasetId),
        damagedLocal: this.owner.store.recoveryRequired,
        customers: info.customers,
        medicines: info.medicines,
        purchases: info.purchases,
      };
    } catch (error) {
      decoded.key.fill(0);
      rmSync(path.join(this.root, 'staging', jobId), { recursive: true, force: true });
      throw error;
    }
  }
  async restore(
    token: string,
    salvage = false,
  ): Promise<{ restored: true; backupCreated: boolean }> {
    this.authorizeFresh();
    if (this.owner.store.recoveryRequired && !salvage)
      throw new ApplicationFailure(
        'INVALID_REQUEST',
        'Confirm recovery of the damaged installation explicitly. Its original files will be preserved.',
      );
    const preview = this.pendingRestore;
    if (!preview || preview.token !== token || Date.now() > preview.expires)
      throw new ApplicationFailure(
        'CONFLICT',
        'The restore preview expired. Select and verify the archive again.',
      );
    const current = this.owner.store.initialized ? inspectConnection(this.owner.store.db) : null;
    if (
      current?.datasetId !== preview.base?.datasetId ||
      current?.revision !== preview.base?.revision
    )
      throw new ApplicationFailure(
        'CONFLICT',
        'Local data changed after the preview. Verify the archive again before restoring.',
      );
    if (current) await this.create('safety');
    this.authorizeFresh();
    // A key and portable envelope must exist for the post-restore archive. Existing
    // device configuration is retained; fresh restores adopt this archive's envelope.
    if (!this.config) {
      this.config = {
        format: 1,
        envelope: preview.envelope,
        keyHash: sha256(preview.key),
        proof: envelopeProof(preview.key, preview.envelope),
      };
      atomicJson(path.join(this.root, 'settings/backup-key-envelope.json'), this.config);
      this.key = Buffer.from(preview.key);
    }
    this.owner.logout();
    this.broken = true;
    this.owner.store.close();
    replaceDataset(this.root, preview.jobId, 'restore');
    this.owner.store = new PharmacyDatabase(this.root);
    this.pendingRestore = undefined;
    preview.key.fill(0);
    this.broken = false;
    let backupCreated = false;
    try {
      await this.create('restored', true);
      backupCreated = true;
    } catch {
      this.history.message = 'Restore completed. Unlock backups and create a new verified archive.';
      try {
        this.saveHistory();
      } catch {
        /* Replacement succeeded even if history cannot be written. */
      }
    }
    return { restored: true, backupCreated };
  }
  cancelPreview(): null {
    if (this.pendingRestore && !this.broken) {
      this.pendingRestore.key.fill(0);
      rmSync(path.join(this.root, 'staging', this.pendingRestore.jobId), {
        recursive: true,
        force: true,
      });
      this.pendingRestore = undefined;
    }
    return null;
  }
  close(): void {
    this.key?.fill(0);
    this.key = undefined;
    this.cancelPreview();
  }
}

/** Preserve the newest 14 daily and 8 weekly archives per dataset, plus all safety copies. */
export function retentionSet(records: Record[]): Set<string> {
  const keep = new Set<string>();
  const daily = new Map<string, Set<string>>();
  const weekly = new Map<string, Set<string>>();
  for (const record of [...records].reverse().sort((a, b) => b.at - a.at)) {
    if (record.kind === 'safety') {
      keep.add(record.filename);
      continue;
    }
    const days = daily.get(record.datasetId) ?? new Set<string>();
    const weeks = weekly.get(record.datasetId) ?? new Set<string>();
    daily.set(record.datasetId, days);
    weekly.set(record.datasetId, weeks);
    const day = pharmacyDay(record.at);
    const week = String(
      Math.floor((Date.parse(`${day}T00:00:00Z`) + 3 * 86400000) / (7 * 86400000)),
    );
    if ((!days.has(day) && days.size < 14) || (!weeks.has(week) && weeks.size < 8))
      keep.add(record.filename);
    days.add(day);
    weeks.add(week);
  }
  return keep;
}
