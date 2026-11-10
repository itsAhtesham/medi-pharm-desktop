import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { atomicJson, durableRename, durableUnlink, syncDirectory } from '../platform/durable-files';
import { inspectDatabase } from './health';

const journalSchema = z
  .object({
    format: z.literal(1),
    jobId: z.uuid(),
    datasetId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(['setup', 'restore']),
  })
  .strict();
export const fileHash = (filename: string) =>
  createHash('sha256').update(readFileSync(filename)).digest('hex');
const journalPath = (root: string) => path.join(root, 'operations', 'replacement.json');
export function stagedLive(root: string, jobId: string): string {
  z.uuid().parse(jobId);
  return path.join(root, 'staging', jobId, 'live');
}
/** Derive every path locally; journal data cannot name arbitrary files. */
export function recoverReplacement(root: string): void {
  const journal = journalPath(root);
  if (!existsSync(journal)) return;
  const job = journalSchema.parse(JSON.parse(readFileSync(journal, 'utf8')));
  const candidate = stagedLive(root, job.jobId);
  const live = path.join(root, 'data', 'live');
  const retained = path.join(root, 'recovery', job.jobId);
  const old = path.join(retained, 'live');
  const marker = path.join(root, 'settings', 'installation.json');
  mkdirSync(retained, { recursive: true, mode: 0o700 });
  syncDirectory(path.join(root, 'recovery'));
  const verify = (directory: string) => {
    const filename = path.join(directory, 'medipharm.sqlite');
    if (fileHash(filename) !== job.sha256) throw new Error('Replacement candidate changed.');
    inspectDatabase(filename, job.datasetId);
  };
  if (existsSync(candidate)) {
    verify(candidate);
    if (existsSync(live)) {
      if (existsSync(old)) throw new Error('Ambiguous replacement generations.');
      if (existsSync(marker) && !existsSync(path.join(retained, 'installation.json')))
        durableRename(marker, path.join(retained, 'installation.json'));
      durableRename(live, old);
    }
    durableRename(candidate, live);
  }
  // Covers interruption between either rename and marker publication. A missing or
  // damaged candidate blocks startup; preserved generations are never deleted.
  verify(live);
  atomicJson(marker, { format: 1, datasetId: job.datasetId });
  atomicJson(path.join(retained, 'replacement.json'), { ...job, completedAt: Date.now() });
  durableUnlink(journal);
  rmSync(path.join(root, 'staging', job.jobId), { recursive: true, force: true });
}
export function replaceDataset(root: string, jobId: string, kind: 'setup' | 'restore'): void {
  if (existsSync(journalPath(root))) throw new Error('An earlier replacement needs recovery.');
  const filename = path.join(stagedLive(root, jobId), 'medipharm.sqlite');
  const info = inspectDatabase(filename);
  syncDirectory(path.dirname(filename));
  syncDirectory(path.dirname(path.dirname(filename)));
  syncDirectory(path.join(root, 'staging'));
  atomicJson(journalPath(root), {
    format: 1,
    jobId,
    kind,
    datasetId: info.datasetId,
    sha256: fileHash(filename),
  });
  recoverReplacement(root);
}
