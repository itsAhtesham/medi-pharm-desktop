import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { OwnerRow } from '../db/pharmacy-database';
import { ApplicationFailure } from './failure';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Invalid mutation payload.');
  return encoded;
}
export function mutate<T>(
  db: Database.Database,
  authorize: () => OwnerRow,
  input: {
    requestId: string;
    command: string;
    payload: unknown;
    result: z.ZodType<T>;
    apply: (owner: OwnerRow) => {
      value: T;
      entityType: string;
      entityId: string;
      before: unknown;
      after: unknown;
      reason?: string;
    };
  },
  now = Date.now,
): T {
  z.uuid().parse(input.requestId);
  const hash = createHash('sha256').update(canonical(input.payload)).digest('hex');
  return db
    .transaction(() => {
      const owner = authorize();
      const previous = db
        .prepare(
          'SELECT command,payload_hash,result_json FROM mutation_receipts WHERE pharmacy_id=? AND actor_id=? AND request_id=?',
        )
        .get(owner.pharmacy_id, owner.id, input.requestId) as
        { command: string; payload_hash: string; result_json: string } | undefined;
      if (previous) {
        if (previous.command !== input.command || previous.payload_hash !== hash)
          throw new ApplicationFailure(
            'CONFLICT',
            'This submission ID was already used with different details.',
          );
        return input.result.parse(JSON.parse(previous.result_json));
      }
      const change = input.apply(owner);
      const result = input.result.parse(change.value);
      db.prepare(
        'INSERT INTO audit_events(id,pharmacy_id,actor_id,entity_type,entity_id,action,reason,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        owner.pharmacy_id,
        owner.id,
        change.entityType,
        change.entityId,
        input.command,
        change.reason ?? '',
        JSON.stringify({ version: 1, value: change.before }),
        JSON.stringify({ version: 1, value: change.after }),
        now(),
      );
      db.prepare('UPDATE app_meta SET revision=revision+1 WHERE id=1').run();
      db.prepare('INSERT INTO mutation_receipts VALUES (?,?,?,?,?,?,?,?)').run(
        randomUUID(),
        owner.pharmacy_id,
        owner.id,
        input.requestId,
        input.command,
        hash,
        JSON.stringify(result),
        now(),
      );
      return result;
    })
    .immediate();
}
/** Must be called from the surrounding business mutation transaction. */
export function nextPurchaseNumber(db: Database.Database, pharmacyId: string): number {
  if (!db.inTransaction) throw new Error('Number allocation requires a transaction.');
  const row = db
    .prepare(
      "UPDATE number_counters SET next_number=next_number+1 WHERE pharmacy_id=? AND kind='purchase' RETURNING next_number-1 AS allocated",
    )
    .get(pharmacyId) as { allocated: number } | undefined;
  if (!row || !Number.isSafeInteger(row.allocated))
    throw new Error('Purchase counter is unavailable.');
  return row.allocated;
}
