import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OwnerService } from '../../src/application/owner-service';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { BackupManager, retentionSet } from '../../src/backup/manager';
import { decodeArchive, readBounded, MAX_ARCHIVE_BYTES } from '../../src/backup/archive';

const account = {
  pharmacyName: 'Private Test Pharmacy',
  identifier: 'owner',
  password: 'owner test passphrase',
  recoveryCode: 'ab'.repeat(32),
};
const login = { identifier: account.identifier, password: account.password };
const passphrase = 'separate backup passphrase';
let root: string;
let owner: OwnerService;
let backup: BackupManager;
let extras: string[];
const archivePath = () =>
  path.join(
    root,
    'backups',
    readdirSync(path.join(root, 'backups')).find((file) => file.endsWith('.mpbackup'))!,
  );
beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'medipharm-backup-'));
  extras = [];
  owner = new OwnerService(new PharmacyDatabase(root));
  await owner.setup(account);
  await owner.login(login);
  backup = new BackupManager(owner);
});
afterEach(() => {
  backup.close();
  owner.close();
  for (const directory of [root, ...extras]) rmSync(directory, { recursive: true, force: true });
});
async function configure() {
  await backup.configure(passphrase);
  await backup.create();
}

describe('encrypted backups and restore', () => {
  it('publishes only verified encrypted archives and decrypts them without any OS key', async () => {
    await configure();
    const filename = archivePath();
    const bytes = readFileSync(filename);
    expect(bytes.toString()).not.toContain(account.pharmacyName);
    expect(bytes.toString()).not.toContain('SQLite format 3');
    const decoded = await decodeArchive(bytes, passphrase);
    expect(decoded.manifest).toMatchObject({
      pharmacyName: account.pharmacyName,
      revision: 0,
      customers: 0,
    });
    expect(decoded.database.subarray(0, 16).toString()).toBe('SQLite format 3\0');
    decoded.key.fill(0);
    expect(backup.status()).toMatchObject({ configured: true, unlocked: true, archiveCount: 1 });
    expect(readdirSync(path.join(root, 'backups')).some((file) => file.endsWith('.partial'))).toBe(
      false,
    );
    backup.close();
    backup = new BackupManager(owner);
    expect(backup.status().unlocked).toBe(false);
    await expect(backup.unlock('incorrect passphrase')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    await backup.unlock(passphrase);
    expect(backup.status().unlocked).toBe(true);
  });
  it('rejects wrong passphrases, tampering, truncation, oversized KDFs and trailing bytes without touching live data', async () => {
    await configure();
    const filename = archivePath();
    const original = readFileSync(filename);
    const corrupt = path.join(root, 'bad.mpbackup');
    await expect(backup.preview(filename, 'wrong passphrase value')).rejects.toThrow(
      'could not be opened',
    );
    const altered = Buffer.from(original);
    altered[altered.length - 20] ^= 1;
    const excessiveKdf = Buffer.from(
      original.toString('latin1').replace('32768', '99999'),
      'latin1',
    );
    for (const bytes of [
      altered,
      original.subarray(0, -1),
      excessiveKdf,
      Buffer.concat([original, Buffer.from('x')]),
    ]) {
      writeFileSync(corrupt, bytes);
      await expect(backup.preview(corrupt, passphrase)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
    expect(owner.status().pharmacy.name).toBe(account.pharmacyName);
    expect(owner.status().revision).toBe(0);
    expect(readdirSync(path.join(root, 'staging'))).toEqual([]);
  });
  it('checks preview revision, creates a safety archive, restores old data and requires owner login', async () => {
    await configure();
    const filename = archivePath();
    let preview = await backup.preview(filename, passphrase);
    owner.updatePharmacy({
      requestId: crypto.randomUUID(),
      name: 'Later local change',
      expectedVersion: 1,
    });
    await expect(backup.restore(preview.token)).rejects.toMatchObject({ code: 'CONFLICT' });
    preview = await backup.preview(filename, passphrase);
    const result = await backup.restore(preview.token);
    expect(result).toEqual({ restored: true, backupCreated: true });
    expect(owner.accountState().state).toBe('locked');
    await owner.login(login);
    expect(owner.status().pharmacy.name).toBe(account.pharmacyName);
    const history = JSON.parse(readFileSync(path.join(root, 'operations', 'backups.json'), 'utf8'));
    const safety = history.records.find((record: { kind: string }) => record.kind === 'safety');
    expect(existsSync(path.join(root, 'backups', safety.filename))).toBe(true);
    const decoded = await decodeArchive(
      readFileSync(path.join(root, 'backups', safety.filename)),
      passphrase,
    );
    expect(decoded.manifest.pharmacyName).toBe('Later local change');
    decoded.key.fill(0);
    expect(readdirSync(path.join(root, 'recovery')).length).toBeGreaterThanOrEqual(2);
  });
  it('aborts existing-pharmacy restore when a verified safety backup cannot be produced', async () => {
    await configure();
    const preview = await backup.preview(archivePath(), passphrase);
    const blocked = path.join(root, 'backups');
    renameSync(blocked, `${blocked}-preserved`);
    writeFileSync(blocked, 'not a directory');
    await expect(backup.restore(preview.token)).rejects.toThrow();
    expect(owner.status().pharmacy.name).toBe(account.pharmacyName);
    expect(backup.broken).toBe(false);
    expect(existsSync(path.join(root, 'operations', 'replacement.json'))).toBe(false);
  });
  it('restores on a fresh profile with no original device key or account session', async () => {
    await configure();
    const filename = archivePath();
    const freshRoot = mkdtempSync(path.join(tmpdir(), 'medipharm-fresh-'));
    extras.push(freshRoot);
    const freshOwner = new OwnerService(new PharmacyDatabase(freshRoot));
    const freshBackup = new BackupManager(freshOwner);
    try {
      const preview = await freshBackup.preview(filename, passphrase);
      await freshBackup.restore(preview.token);
      expect(freshOwner.accountState().state).toBe('locked');
      await freshOwner.login(login);
      expect(freshOwner.status().pharmacy.name).toBe(account.pharmacyName);
      expect(freshBackup.status()).toMatchObject({
        configured: true,
        unlocked: true,
        archiveCount: 1,
      });
    } finally {
      freshBackup.close();
      freshOwner.close();
    }
  });
  it('verifies an external destination identity and reports local/external success separately', async () => {
    await configure();
    const external = mkdtempSync(path.join(tmpdir(), 'medipharm-external-'));
    extras.push(external);
    expect(() => backup.configureExternal(path.join(root, 'data'))).toThrow('outside');
    backup.configureExternal(external);
    await backup.tick();
    expect(backup.status().externalLast).not.toBeNull();
    owner.updatePharmacy({
      requestId: crypto.randomUUID(),
      name: 'New revision',
      expectedVersion: 1,
    });
    writeFileSync(
      path.join(external, '.medipharm-destination.json'),
      JSON.stringify({ format: 1, id: crypto.randomUUID() }),
    );
    const status = await backup.create();
    expect(status.localLast).not.toBeNull();
    expect(status.externalPending).toBe(true);
    expect(status.message).toContain('External backup is pending');
  });
  it('does not publish or prune an archive after a failed destination write', async () => {
    await configure();
    const original = readFileSync(archivePath());
    const blocked = path.join(root, 'backups');
    renameSync(blocked, `${blocked}-preserved`);
    writeFileSync(blocked, 'blocked');
    await expect(backup.create()).rejects.toThrow();
    const existing = readdirSync(`${blocked}-preserved`).find((file) =>
      file.endsWith('.mpbackup'),
    )!;
    expect(readFileSync(path.join(`${blocked}-preserved`, existing))).toEqual(original);
  });
  it('never backs up while locked and does not produce duplicate unchanged daily backups', async () => {
    await configure();
    await backup.tick();
    expect(backup.status().archiveCount).toBe(1);
    owner.logout();
    await expect(backup.create()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(backup.tick()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(() => backup.status()).toThrow('Sign in');
  });
  it('bounds file reads and retains daily, weekly, and pinned safety archives', () => {
    const file = path.join(root, 'oversized');
    writeFileSync(file, Buffer.alloc(32));
    expect(() => readBounded(file, 16)).toThrow('size');
    expect(MAX_ARCHIVE_BYTES).toBe(64 * 1024 * 1024);
    const datasetId = crypto.randomUUID();
    const now = Date.now();
    const records = Array.from({ length: 70 }, (_, index) => ({
      filename: `file-${index}`,
      at: now - index * 86400000,
      revision: index,
      datasetId,
      kind: 'daily' as const,
      externalId: null,
      externalAt: null,
      envelopeHash: null,
    }));
    const safety = { ...records[69], filename: 'safety', kind: 'safety' as const };
    const keep = retentionSet([...records, safety]);
    for (let i = 0; i < 14; i++) expect(keep.has(`file-${i}`)).toBe(true);
    expect(keep.has('safety')).toBe(true);
    expect(keep.size).toBeLessThanOrEqual(23);
    expect(keep.has('file-69')).toBe(false);
  });
});

it('recovers a damaged installation only with explicit salvage confirmation and retains the original files', async () => {
  await configure();
  const filename = archivePath();
  backup.close();
  owner.close();
  const damaged = Buffer.from('damaged original database');
  writeFileSync(path.join(root, 'data', 'live', 'medipharm.sqlite'), damaged);
  owner = new OwnerService(new PharmacyDatabase(root, true));
  backup = new BackupManager(owner);
  expect(owner.accountState().state).toBe('recoveryRequired');
  await expect(owner.setup(account)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  const preview = await backup.preview(filename, passphrase);
  expect(preview.damagedLocal).toBe(true);
  await expect(backup.restore(preview.token)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await backup.restore(preview.token, true);
  await owner.login(login);
  expect(owner.status().pharmacy.name).toBe(account.pharmacyName);
  const retained = readdirSync(path.join(root, 'recovery')).some((job) => {
    const file = path.join(root, 'recovery', job, 'live', 'medipharm.sqlite');
    return existsSync(file) && readFileSync(file).equals(damaged);
  });
  expect(retained).toBe(true);
});

for (const rotateMasterKey of [false, true])
  it(`rotates backup credentials (new master key: ${rotateMasterKey}) without changing existing archives`, async () => {
    await configure();
    const previous = readFileSync(archivePath());
    const nextPassphrase = 'replacement backup passphrase';
    await backup.rotate({
      currentPassphrase: passphrase,
      passphrase: nextPassphrase,
      remember: false,
      rotateMasterKey,
    });
    await backup.tick();
    const history = JSON.parse(readFileSync(path.join(root, 'operations', 'backups.json'), 'utf8'));
    const latest = history.records.at(-1);
    const bytes = readFileSync(path.join(root, 'backups', latest.filename));
    const old = await decodeArchive(previous, passphrase);
    old.key.fill(0);
    const next = await decodeArchive(bytes, nextPassphrase);
    next.key.fill(0);
    await expect(decodeArchive(bytes, passphrase)).rejects.toThrow();
    backup.close();
    backup = new BackupManager(owner);
    await expect(backup.unlock(passphrase)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await backup.unlock(nextPassphrase);
    expect(backup.status().unlocked).toBe(true);
  });

it('binds OS-unlocked keys to the portable envelope so damaged settings cannot produce unrestorable backups', async () => {
  const { key } = await backup.configure(passphrase);
  backup.close();
  backup = new BackupManager(owner);
  backup.unlockDevice(key);
  expect(backup.status().unlocked).toBe(true);
  backup.close();
  const configFile = path.join(root, 'settings', 'backup-key-envelope.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.envelope.nonce =
    (config.envelope.nonce[0] === '0' ? '1' : '0') + config.envelope.nonce.slice(1);
  writeFileSync(configFile, JSON.stringify(config));
  backup = new BackupManager(owner);
  expect(() => backup.unlockDevice(key)).toThrow('envelope needs verification');
  expect(backup.status().unlocked).toBe(false);
  await expect(backup.unlock(passphrase)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  await expect(backup.create()).rejects.toMatchObject({ code: 'NOT_READY' });
  expect(readdirSync(path.join(root, 'backups'))).toEqual([]);
});
