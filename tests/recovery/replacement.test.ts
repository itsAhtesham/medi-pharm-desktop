import { describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { OwnerService } from '../../src/application/owner-service';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { fileHash, stagedLive } from '../../src/db/replacement';
import { inspectDatabase } from '../../src/db/health';
import { atomicJson } from '../../src/platform/durable-files';

const setup = {
  pharmacyName: 'Restorable pharmacy',
  identifier: 'owner',
  password: 'testing passphrase',
  recoveryCode: 'ab'.repeat(32),
};
describe('journal recovery at filesystem interruption boundaries', () => {
  for (const phase of ['prepared', 'oldMoved', 'newMoved', 'markerWritten'] as const)
    it(`recovers a verified generation after ${phase}`, async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'medipharm-replace-'));
      let owner = new OwnerService(new PharmacyDatabase(root));
      try {
        await owner.setup(setup);
        await owner.login({ identifier: setup.identifier, password: setup.password });
        const jobId = crypto.randomUUID();
        const staged = stagedLive(root, jobId);
        mkdirSync(staged, { recursive: true });
        const filename = path.join(staged, 'medipharm.sqlite');
        await owner.store.db.backup(filename);
        const info = inspectDatabase(filename);
        owner.updatePharmacy({
          requestId: crypto.randomUUID(),
          expectedVersion: 1,
          name: 'Later data retained',
        });
        owner.close();
        const recovery = path.join(root, 'recovery', jobId);
        mkdirSync(recovery);
        const live = path.join(root, 'data', 'live');
        atomicJson(path.join(root, 'operations', 'replacement.json'), {
          format: 1,
          jobId,
          datasetId: info.datasetId,
          sha256: fileHash(filename),
          kind: 'restore',
        });
        if (phase !== 'prepared') {
          copyFileSync(
            path.join(root, 'settings', 'installation.json'),
            path.join(recovery, 'installation.json'),
          );
          renameSync(live, path.join(recovery, 'live'));
        }
        if (phase === 'newMoved' || phase === 'markerWritten') renameSync(staged, live);
        if (phase === 'markerWritten')
          atomicJson(path.join(root, 'settings', 'installation.json'), {
            format: 1,
            datasetId: info.datasetId,
          });
        owner = new OwnerService(new PharmacyDatabase(root));
        expect(owner.accountState().state).toBe('locked');
        await owner.login({ identifier: setup.identifier, password: setup.password });
        expect(owner.status().pharmacy.name).toBe(setup.pharmacyName);
        expect(existsSync(path.join(root, 'operations', 'replacement.json'))).toBe(false);
        expect(inspectDatabase(path.join(recovery, 'live', 'medipharm.sqlite')).pharmacyName).toBe(
          'Later data retained',
        );
      } finally {
        owner.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
  it('blocks a damaged journal candidate without deleting either generation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'medipharm-replace-bad-'));
    const owner = new OwnerService(new PharmacyDatabase(root));
    try {
      await owner.setup(setup);
      owner.close();
      const original = readFileSync(path.join(root, 'data', 'live', 'medipharm.sqlite'));
      const jobId = crypto.randomUUID();
      const staged = stagedLive(root, jobId);
      mkdirSync(staged, { recursive: true });
      writeFileSync(path.join(staged, 'medipharm.sqlite'), 'damaged');
      atomicJson(path.join(root, 'operations', 'replacement.json'), {
        format: 1,
        jobId,
        datasetId: crypto.randomUUID(),
        sha256: 'ab'.repeat(32),
        kind: 'restore',
      });
      expect(() => new PharmacyDatabase(root)).toThrow('candidate changed');
      expect(readFileSync(path.join(root, 'data', 'live', 'medipharm.sqlite'))).toEqual(original);
      expect(existsSync(staged)).toBe(true);
    } finally {
      owner.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it('completes a prepared first setup after interruption without offering a second owner account', async () => {
  const source = mkdtempSync(path.join(tmpdir(), 'medipharm-setup-source-'));
  const root = mkdtempSync(path.join(tmpdir(), 'medipharm-setup-recover-'));
  const sourceOwner = new OwnerService(new PharmacyDatabase(source));
  let recovered: OwnerService | undefined;
  try {
    await sourceOwner.setup(setup);
    sourceOwner.close();
    const staging = new PharmacyDatabase(root);
    staging.close();
    const jobId = crypto.randomUUID();
    const directory = stagedLive(root, jobId);
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'medipharm.sqlite');
    copyFileSync(path.join(source, 'data', 'live', 'medipharm.sqlite'), file);
    const info = inspectDatabase(file);
    atomicJson(path.join(root, 'operations', 'replacement.json'), {
      format: 1,
      jobId,
      datasetId: info.datasetId,
      sha256: fileHash(file),
      kind: 'setup',
    });
    recovered = new OwnerService(new PharmacyDatabase(root));
    expect(recovered.accountState().state).toBe('locked');
    await recovered.login({ identifier: setup.identifier, password: setup.password });
    expect(recovered.status().pharmacy.name).toBe(setup.pharmacyName);
  } finally {
    sourceOwner.close();
    recovered?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});
