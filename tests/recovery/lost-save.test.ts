import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { OwnerService } from '../../src/application/owner-service';
import { RequestBroker } from '../../src/application/request-broker';
import type { ServiceRequest } from '../../src/contracts/desktop';

it('replays one committed mutation after reply loss, service restart and reauthentication', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'medipharm-lost-save-'));
  let service = new OwnerService(new PharmacyDatabase(root));
  const credentials = {
    pharmacyName: 'Test',
    identifier: 'owner',
    password: 'test passphrase',
    recoveryCode: 'ab'.repeat(32),
  };
  try {
    await service.setup(credentials);
    await service.login({ identifier: credentials.identifier, password: credentials.password });
    const input = {
      requestId: crypto.randomUUID(),
      name: 'Saved but response lost',
      expectedVersion: 1,
    };
    const first = new RequestBroker(
      (raw) => {
        const request = raw as ServiceRequest;
        if (request.command === 'updatePharmacy') service.updatePharmacy(request.input);
      },
      () => {},
    );
    const uncertain = first.request({ command: 'updatePharmacy', input });
    first.close();
    expect(await uncertain).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    service.close();
    service = new OwnerService(new PharmacyDatabase(root));
    expect(() => service.updatePharmacy(input)).toThrow('Sign in');
    await service.login({ identifier: credentials.identifier, password: credentials.password });
    expect(service.updatePharmacy(input)).toEqual({ name: input.name, version: 2 });
    expect(service.status().revision).toBe(1);
    expect(service.store.db.prepare('SELECT count(*) FROM mutation_receipts').pluck().get()).toBe(
      1,
    );
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
