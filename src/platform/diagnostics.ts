import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Deliberate allowlist: raw errors, paths, credentials and form data never enter logs.
const eventSchema = z.enum([
  'app.started',
  'app.stopped',
  'service.ready',
  'service.failed',
  'service.timeout',
  'service.protocol',
  'service.transport',
  'service.restart',
  'operation.started',
  'operation.finished',
  'operation.failed',
]);
const entrySchema = z.object({ at: z.iso.datetime(), event: eventSchema }).strict();
export type DiagnosticEvent = z.infer<typeof eventSchema>;

export class Diagnostics {
  constructor(
    private readonly directory: string,
    private readonly maxBytes = 128 * 1024,
  ) {}
  record(event: DiagnosticEvent): void {
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success) return;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const current = path.join(this.directory, 'events.jsonl');
      const line = JSON.stringify({ at: new Date().toISOString(), event: parsed.data }) + '\n';
      if (existsSync(current) && statSync(current).size + Buffer.byteLength(line) > this.maxBytes) {
        rmSync(path.join(this.directory, 'events.2.jsonl'), { force: true });
        if (existsSync(path.join(this.directory, 'events.1.jsonl')))
          renameSync(
            path.join(this.directory, 'events.1.jsonl'),
            path.join(this.directory, 'events.2.jsonl'),
          );
        renameSync(current, path.join(this.directory, 'events.1.jsonl'));
      }
      appendFileSync(current, line, { mode: 0o600 });
    } catch {
      /* Diagnostics must not prevent storage or shutdown. */
    }
  }
  export(): string {
    const entries: z.infer<typeof entrySchema>[] = [];
    for (const name of ['events.2.jsonl', 'events.1.jsonl', 'events.jsonl']) {
      try {
        const file = path.join(this.directory, name);
        if (statSync(file).size > this.maxBytes) continue;
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          try {
            const result = entrySchema.safeParse(JSON.parse(line));
            if (result.success) entries.push(result.data);
          } catch {
            /* Ignore partial/malformed lines; never export raw content. */
          }
        }
      } catch {
        /* Logs may be absent or unavailable. */
      }
    }
    return JSON.stringify(
      { format: 1, exportedAt: new Date().toISOString(), events: entries },
      null,
      2,
    );
  }
}
