import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function syncDirectory(directory: string): void {
  // Windows directory flush semantics require native filesystem verification.
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function writeDurable(filename: string, data: string | Buffer): void {
  const fd = openSync(filename, 'wx', 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(path.dirname(filename));
}
export function atomicJson(filename: string, value: unknown): void {
  const temporary = `${filename}.${randomUUID()}.partial`;
  writeDurable(temporary, JSON.stringify(value));
  renameSync(temporary, filename);
  syncDirectory(path.dirname(filename));
}
export function durableRename(source: string, destination: string): void {
  renameSync(source, destination);
  syncDirectory(path.dirname(source));
  syncDirectory(path.dirname(destination));
}
export function durableUnlink(filename: string): void {
  unlinkSync(filename);
  syncDirectory(path.dirname(filename));
}
