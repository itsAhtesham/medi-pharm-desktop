import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { PrototypeStore } from '../../src/db/prototype-store';
import { RequestBroker } from '../../src/application/request-broker';
import type { ServiceRequest } from '../../src/contracts/desktop';

it('replays a committed save exactly once after its response is lost and the database reopens', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'medipharm-lost-save-'));
  let store: PrototypeStore | undefined;
  try {
    store = new PrototypeStore(root);
    const input = { requestId: crypto.randomUUID(), note: 'Saved but response lost' };
    const first = new RequestBroker(
      (raw) => {
        const request = raw as ServiceRequest;
        if (request.command === 'save') store!.save(request.input);
        // Simulate death after SQLite commits but before IPC delivers success.
      },
      () => {},
    );
    const uncertain = first.request({ command: 'save', input });
    first.close();
    expect(await uncertain).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    store.close();
    store = new PrototypeStore(root);
    const replay = store.save(input);
    expect(replay.recordCount).toBe(1);
    expect(replay.lastRecord?.note).toBe(input.note);
    expect(() => store!.save({ ...input, note: 'Changed frozen payload' })).toThrow();
    expect(store.status().recordCount).toBe(1);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
