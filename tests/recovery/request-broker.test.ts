import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestBroker } from '../../src/application/request-broker';
import type { ServiceRequest } from '../../src/contracts/desktop';

afterEach(() => vi.useRealTimers());
const data = {
  pharmacy: { name: 'Test Pharmacy', version: 1 },
  identifier: 'owner',
  customers: 0,
  medicines: 0,
  purchases: 0,
  revision: 0,
  sqliteVersion: '3.53.4',
  journalMode: 'wal',
};

describe('transport failures and uncertain results', () => {
  it('correlates responses even when replies arrive in a different order', async () => {
    const requests: ServiceRequest[] = [];
    const broker = new RequestBroker(
      (message) => requests.push(message as ServiceRequest),
      () => {},
    );
    const first = broker.request({ command: 'status' });
    const second = broker.request({ command: 'accountState' });
    broker.receive({
      version: 1,
      type: 'result',
      id: requests[1].id,
      result: { ok: true, data: { state: 'locked' } },
    });
    broker.receive({ version: 1, type: 'result', id: requests[0].id, result: { ok: true, data } });
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
  });
  it('reports an unknown mutation outcome after a timeout and never sends an automatic retry', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const fault = vi.fn();
    const broker = new RequestBroker(send, fault, 100);
    const result = broker.request({
      command: 'updatePharmacy',
      input: { requestId: crypto.randomUUID(), name: 'Sample', expectedVersion: 1 },
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toMatchObject({ ok: false, code: 'OUTCOME_UNKNOWN' });
    expect(fault).toHaveBeenCalledWith('timeout');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await broker.request({ command: 'status' })).toMatchObject({
      ok: false,
      code: 'NOT_READY',
    });
  });
  it('bounds pending requests and distinguishes an unavailable read from an uncertain write', async () => {
    const broker = new RequestBroker(
      () => {},
      () => {},
      1000,
      1,
    );
    const pending = broker.request({ command: 'status' });
    expect(await broker.request({ command: 'status' })).toMatchObject({ code: 'BUSY' });
    broker.close();
    expect(await pending).toMatchObject({ code: 'NOT_READY' });
  });
  it('rejects malformed results and incompatible protocol versions instead of trusting TypeScript types', async () => {
    for (const version of [1, 2]) {
      let request!: ServiceRequest;
      const fault = vi.fn();
      const broker = new RequestBroker((message) => {
        request = message as ServiceRequest;
      }, fault);
      const pending = broker.request({ command: 'status' });
      broker.receive({
        version,
        type: 'result',
        id: request.id,
        result: { ok: true, data: { ...data, recordCount: 'invalid' } },
      });
      expect(await pending).toMatchObject({ code: 'NOT_READY' });
      expect(fault).toHaveBeenCalledWith('protocol');
    }
  });
});
