import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OwnerService } from '../../src/application/owner-service';
import { PharmacyDatabase } from '../../src/db/pharmacy-database';
import { nextPurchaseNumber } from '../../src/application/mutations';
it('allocates purchase sequence numbers inside the business transaction and rolls them back on failure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'medipharm-number-'));
  const owner = new OwnerService(new PharmacyDatabase(root));
  try {
    await owner.setup({
      pharmacyName: 'Test',
      identifier: 'owner',
      password: 'test passphrase',
      recoveryCode: 'ab'.repeat(32),
    });
    const db = owner.store.db;
    const id = owner.store.owner().pharmacy_id;
    expect(() => nextPurchaseNumber(db, id)).toThrow('transaction');
    expect(() =>
      db
        .transaction(() => {
          expect(nextPurchaseNumber(db, id)).toBe(1);
          throw new Error('rollback');
        })
        .immediate(),
    ).toThrow('rollback');
    expect(db.transaction(() => nextPurchaseNumber(db, id)).immediate()).toBe(1);
    expect(db.transaction(() => nextPurchaseNumber(db, id)).immediate()).toBe(2);
  } finally {
    owner.close();
    rmSync(root, { recursive: true, force: true });
  }
});
