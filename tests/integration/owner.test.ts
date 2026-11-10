import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { OwnerService } from '../../src/application/owner-service';
import { hashSecret, verifySecret } from '../../src/application/credentials';

const setup = {
  pharmacyName: 'Test Pharmacy',
  identifier: 'owner',
  password: 'test passphrase 123',
  recoveryCode: 'ab'.repeat(32),
};
let root: string;
let service: OwnerService;
let now: number;
function reopen() {
  service.close();
  service = new OwnerService(new PharmacyDatabase(root), () => now);
}
async function initialize() {
  await service.setup(setup);
  await service.login({ identifier: setup.identifier, password: setup.password });
}
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'medipharm-owner-'));
  now = 1_800_000_000_000;
  service = new OwnerService(new PharmacyDatabase(root), () => now);
});
afterEach(() => {
  service.close();
  rmSync(root, { recursive: true, force: true });
});

describe('owner access and durable application storage', () => {
  it('creates nothing before explicit setup, stores salted hashes and opens an empty locked workspace', async () => {
    expect(service.accountState().state).toBe('setupRequired');
    expect(existsSync(service.store.filename)).toBe(false);
    expect(() => service.status()).toThrow('Sign in');
    expect(await service.setup({ ...setup, identifier: ' OWNER ' })).toEqual({ state: 'locked' });
    const owner = service.store.owner();
    expect(owner.password_hash).not.toContain(setup.password);
    expect(owner.recovery_hash).not.toContain(setup.recoveryCode);
    expect(await verifySecret(setup.password, owner.password_hash)).toBe(true);
    expect(await hashSecret(setup.password)).not.toBe(owner.password_hash);
    await service.login({ identifier: setup.identifier, password: setup.password });
    expect(service.status()).toMatchObject({
      customers: 0,
      medicines: 0,
      purchases: 0,
      revision: 0,
    });
    reopen();
    expect(service.accountState().state).toBe('locked');
    await expect(service.setup(setup)).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.login({ identifier: setup.identifier, password: setup.password });
    expect(service.status().pharmacy.name).toBe('Test Pharmacy');
  });
  it('enforces logout, restart, absolute session expiry and backward clock checks in the service', async () => {
    await initialize();
    service.logout();
    expect(() => service.status()).toThrow('Sign in');
    expect(() =>
      service.updatePharmacy({
        requestId: crypto.randomUUID(),
        expectedVersion: 1,
        name: 'Blocked',
      }),
    ).toThrow('Sign in');
    await service.login({ identifier: setup.identifier, password: setup.password });
    now += 8 * 60 * 60 * 1000;
    expect(service.accountState().state).toBe('locked');
    await service.login({ identifier: setup.identifier, password: setup.password });
    now -= 1;
    expect(() => service.status()).toThrow('Sign in');
    await expect(
      service.login({ identifier: setup.identifier, password: setup.password }),
    ).rejects.toMatchObject({ code: 'THROTTLED' });
  });
  it('persists a shared throttle across restarts and varying identifiers, then permits a correct login', async () => {
    await service.setup(setup);
    for (let i = 0; i < 5; i++)
      await expect(
        service.login({ identifier: `wrong${i}`, password: 'wrong' }),
      ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    reopen();
    await expect(
      service.login({ identifier: setup.identifier, password: setup.password }),
    ).rejects.toMatchObject({ code: 'THROTTLED' });
    await expect(
      service.recover({
        identifier: setup.identifier,
        password: setup.password,
        recoveryCode: setup.recoveryCode,
        newRecoveryCode: 'cd'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'THROTTLED' });
    now += 30_001;
    await service.login({ identifier: setup.identifier, password: setup.password });
    expect(service.accountState().state).toBe('ready');
  });
  it('rotates recovery credentials atomically and invalidates the old password and recovery code', async () => {
    await initialize();
    const replacement = {
      identifier: setup.identifier,
      recoveryCode: setup.recoveryCode,
      password: 'replacement passphrase',
      newRecoveryCode: 'cd'.repeat(32),
    };
    expect(await service.recover(replacement)).toEqual({ state: 'locked' });
    await expect(
      service.login({ identifier: setup.identifier, password: setup.password }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(
      service.recover({ ...replacement, newRecoveryCode: 'ef'.repeat(32) }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await service.login({ identifier: replacement.identifier, password: replacement.password });
    expect(service.status().revision).toBe(1);
    await service.changePassword({
      currentPassword: replacement.password,
      password: 'another passphrase',
    });
    expect(service.accountState().state).toBe('locked');
    await service.recover({
      ...replacement,
      recoveryCode: replacement.newRecoveryCode,
      newRecoveryCode: 'ef'.repeat(32),
    });
    await service.login({ identifier: replacement.identifier, password: replacement.password });
    const logs = JSON.stringify(service.store.db.prepare('SELECT * FROM audit_events').all());
    expect(logs).not.toContain(replacement.password);
    expect(logs).not.toContain(replacement.newRecoveryCode);
  });
  it('deduplicates exact mutations, rejects changed request IDs and detects stale versions', async () => {
    await initialize();
    const input = {
      requestId: crypto.randomUUID(),
      expectedVersion: 1,
      name: ' Renamed Pharmacy ',
    };
    const result = service.updatePharmacy(input);
    expect(result).toEqual({ name: 'Renamed Pharmacy', version: 2 });
    expect(service.updatePharmacy(input)).toEqual(result);
    expect(() => service.updatePharmacy({ ...input, name: 'Different' })).toThrow('submission ID');
    expect(() => service.updatePharmacy({ ...input, requestId: crypto.randomUUID() })).toThrow(
      'details changed',
    );
    expect(service.status().revision).toBe(1);
    expect(service.store.db.prepare('SELECT count(*) FROM audit_events').pluck().get()).toBe(1);
  });
  it('rolls back record, audit and revision when receipt insertion fails, then safely retries', async () => {
    await initialize();
    const input = { requestId: crypto.randomUUID(), expectedVersion: 1, name: 'Atomic change' };
    service.store.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
    );
    expect(() => service.updatePharmacy(input)).toThrow('injected failure');
    expect(service.status()).toMatchObject({
      pharmacy: { name: setup.pharmacyName, version: 1 },
      revision: 0,
    });
    expect(service.store.db.prepare('SELECT count(*) FROM audit_events').pluck().get()).toBe(0);
    service.store.db.exec('DROP TRIGGER fail_receipt');
    expect(service.updatePharmacy(input).version).toBe(2);
  });
  it('refuses missing, mismatched, tampered and newer databases without creating replacements', async () => {
    await initialize();
    const filename = service.store.filename;
    service.close();
    const original = readFileSync(filename);
    for (const sql of [
      "UPDATE schema_migrations SET checksum='tampered'",
      "INSERT INTO schema_migrations VALUES (2,'future',0)",
      "UPDATE app_meta SET dataset_id='different'",
      "UPDATE users SET password_hash='{}'",
    ]) {
      const db = new Database(filename);
      db.exec(sql);
      db.close();
      expect(() => new PharmacyDatabase(root)).toThrow();
      writeFileSync(filename, original);
    }
    rmSync(filename);
    expect(() => new PharmacyDatabase(root)).toThrow('missing');
    expect(existsSync(filename)).toBe(false);
  });
  it('preserves an interrupted setup claim instead of silently making an empty pharmacy', () => {
    const marker = path.join(root, 'settings', 'installation.json');
    writeFileSync(marker, JSON.stringify({ format: 1, datasetId: crypto.randomUUID() }));
    expect(() => new PharmacyDatabase(root)).toThrow('missing');
    expect(existsSync(service.store.filename)).toBe(false);
  });
  it('rejects unsupported KDF costs before doing expensive work', async () => {
    const hash = JSON.parse(await hashSecret('test password'));
    await expect(
      verifySecret('test password', JSON.stringify({ ...hash, N: 2 ** 30 })),
    ).rejects.toThrow();
  });
  it('enforces SQL foreign keys, strict types, catalog identity, and positive versions', async () => {
    await initialize();
    const db = service.store.db;
    const owner = service.store.owner();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(() => db.prepare('UPDATE pharmacies SET version=0').run()).toThrow();
    expect(() => db.prepare("UPDATE pharmacies SET version='bad'").run()).toThrow();
    const insert = db.prepare(
      "INSERT INTO medicines(id,pharmacy_id,name,strength,form,identity_key,created_at,updated_at) VALUES (?,?,'Test','10mg','tablet','test|10mg|tablet',0,0)",
    );
    insert.run(crypto.randomUUID(), owner.pharmacy_id);
    expect(() => insert.run(crypto.randomUUID(), owner.pharmacy_id)).toThrow('UNIQUE');
    expect(() => insert.run(crypto.randomUUID(), crypto.randomUUID())).toThrow('FOREIGN KEY');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
