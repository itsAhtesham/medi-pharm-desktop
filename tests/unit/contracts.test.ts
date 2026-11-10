import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { saveRecordSchema, serviceRequestSchema } from '../../src/contracts/desktop';

describe('desktop request boundary', () => {
  it('normalizes notes and rejects invalid, oversized, or additional input', () => {
    const requestId = randomUUID();
    expect(saveRecordSchema.parse({ requestId, note: '  Synthetic sample  ' }).note).toBe(
      'Synthetic sample',
    );
    for (const input of [
      null,
      'SQL',
      { requestId, note: '' },
      { requestId, note: ' ' },
      { requestId, note: 'x'.repeat(161) },
      { requestId: 'bad', note: 'x' },
      { requestId, note: 'x', path: '/tmp/arbitrary' },
    ]) {
      expect(saveRecordSchema.safeParse(input).success).toBe(false);
    }
  });
  it('accepts only registered commands with exact fields', () => {
    expect(
      serviceRequestSchema.safeParse({ version: 1, id: randomUUID(), command: 'status' }).success,
    ).toBe(true);
    for (const command of ['exec', 'query', 'constructor', '__proto__', 'toString']) {
      expect(
        serviceRequestSchema.safeParse({ version: 1, id: randomUUID(), command }).success,
      ).toBe(false);
    }
    expect(
      serviceRequestSchema.safeParse({
        version: 1,
        id: randomUUID(),
        command: 'snapshot',
        path: '/tmp/other',
      }).success,
    ).toBe(false);
  });
});
