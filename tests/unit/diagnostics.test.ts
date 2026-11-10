import { mkdtempSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Diagnostics, type DiagnosticEvent } from '../../src/platform/diagnostics';

describe('local diagnostics', () => {
  it('bounds rotation and excludes unknown events, payloads, and tampered log lines from export', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'medipharm-log-test-'));
    try {
      const logs = new Diagnostics(root, 512);
      for (let i = 0; i < 100; i++) logs.record('service.ready');
      expect(readdirSync(root).sort()).toEqual([
        'events.1.jsonl',
        'events.2.jsonl',
        'events.jsonl',
      ]);
      for (const file of readdirSync(root))
        expect(readFileSync(path.join(root, file)).length).toBeLessThanOrEqual(512);
      logs.record('password=do-not-export' as DiagnosticEvent);
      appendFileSync(
        path.join(root, 'events.jsonl'),
        '\n{"at":"2026-11-10T12:00:00.000Z","event":"service.failed","password":"secret"}\n',
      );
      const exported = logs.export();
      expect(exported).not.toContain('password');
      expect(exported).not.toContain('secret');
      expect(exported).not.toContain(root);
      expect(JSON.parse(exported).events.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
