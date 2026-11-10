import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { PrototypeStore } from '../../src/db/prototype-store';

describe('real file-backed prototype storage', () => {
  let root: string;
  let store: PrototypeStore | undefined;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'medipharm-store-test-'));
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('reopens committed records and deduplicates uncertain retries', () => {
    const request = { requestId: randomUUID(), note: 'Synthetic persisted record' };
    store = new PrototypeStore(root);
    expect(store.status().journalMode).toBe('wal');
    expect(store.save(request).recordCount).toBe(1);
    store.close();
    store = undefined;
    store = new PrototypeStore(root);
    expect(store.status().lastRecord?.note).toBe(request.note);
    expect(store.save(request).recordCount).toBe(1);
    expect(() => store!.save({ ...request, note: 'Different payload' })).toThrow();
    expect(store.status().recordCount).toBe(1);
  });

  it('rejects invalid SQL writes without adding partial records', () => {
    store = new PrototypeStore(root);
    expect(() => store!.save({ requestId: randomUUID(), note: '' })).toThrow();
    expect(store.status().recordCount).toBe(0);
  });

  it('restores the snapshot generation without replacing newer live records', async () => {
    store = new PrototypeStore(root);
    store.save({ requestId: randomUUID(), note: 'Before snapshot' });
    expect((await store.snapshot()).recordCount).toBe(1);
    store.save({ requestId: randomUUID(), note: 'After snapshot' });
    expect(store.verifyRestore().recordCount).toBe(1);
    expect(store.status().recordCount).toBe(2);
    expect((await store.snapshot()).recordCount).toBe(2);
    expect(store.verifyRestore().recordCount).toBe(2);
    expect(
      readdirSync(root).some(
        (name) => name.startsWith('restore-check-') || name.endsWith('.partial'),
      ),
    ).toBe(false);
  });

  it('rejects a corrupted snapshot and preserves live data', async () => {
    store = new PrototypeStore(root);
    store.save({ requestId: randomUUID(), note: 'Preserve this' });
    await store.snapshot();
    writeFileSync(path.join(root, 'snapshot.sqlite'), 'broken');
    expect(() => store!.verifyRestore()).toThrow();
    expect(store.status().recordCount).toBe(1);
  });

  it('does not silently recreate a missing initialized database', () => {
    store = new PrototypeStore(root);
    store.close();
    store = undefined;
    rmSync(path.join(root, 'prototype.sqlite'));
    expect(() => new PrototypeStore(root)).toThrow('missing');
    expect(existsSync(path.join(root, 'prototype.sqlite'))).toBe(false);
  });

  it('rejects newer schema versions without changing them', () => {
    store = new PrototypeStore(root);
    store.close();
    store = undefined;
    const db = new Database(path.join(root, 'prototype.sqlite'));
    db.pragma('user_version = 99');
    db.close();
    expect(() => new PrototypeStore(root)).toThrow('Unsupported');
    const check = new Database(path.join(root, 'prototype.sqlite'), { readonly: true });
    expect(check.pragma('user_version', { simple: true })).toBe(99);
    check.close();
  });
});
