import {
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  lstatSync,
  realpathSync,
  type Stats,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { syncDirectory } from './durable-files';
import { isWithinDirectory } from './paths';
import { ApplicationFailure } from '../application/failure';

/** Quoted UTF-8 cells; spreadsheet formulas are always literal text. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  // Control prefixes must be checked: spreadsheet importers can ignore them before formulas.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csvLine(values: readonly (string | number | null)[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}
function stat(filename: string): Stats | null {
  try {
    return lstatSync(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function sameFile(a: Stats | null, b: Stats | null): boolean {
  return a === null
    ? b === null
    : b !== null &&
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs &&
        a.ctimeMs === b.ctimeMs;
}
/** Writes to a private sibling file and publishes only after a complete, flushed export. */
export function writeCsvFile(
  root: string,
  filename: string,
  produce: (write: (row: readonly (string | number | null)[]) => void) => number,
) {
  if (
    !path.isAbsolute(filename) ||
    path.extname(filename).toLowerCase() !== '.csv' ||
    path.basename(filename).includes(':')
  )
    throw new ApplicationFailure(
      'INVALID_REQUEST',
      'Choose a .csv file outside the application data folder.',
    );
  const directory = realpathSync(path.dirname(filename));
  const target = path.join(directory, path.basename(filename));
  if (isWithinDirectory(directory, realpathSync(root)))
    throw new ApplicationFailure('INVALID_REQUEST', 'Export outside the application data folder.');
  const original = stat(target);
  if (original && !original.isFile())
    throw new ApplicationFailure(
      'INVALID_REQUEST',
      'Choose a regular CSV file, not a link or folder.',
    );
  const temporary = path.join(directory, `.medipharm-export-${randomUUID()}.partial`);
  let fd: number | undefined;
  let published = false;
  let created = false;
  let bytes = 0;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    created = true;
    const write = (text: string) => {
      const buffer = Buffer.from(text, 'utf8');
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(fd!, buffer, offset, buffer.length - offset);
        if (!written) throw new Error('Incomplete CSV write.');
        offset += written;
      }
      bytes += buffer.length;
    };
    write('\ufeff');
    const rows = produce((row) => write(csvLine(row)));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (!sameFile(original, stat(target)))
      throw new ApplicationFailure(
        'CONFLICT',
        'The selected file changed during export. Choose the destination again.',
      );
    renameSync(temporary, target);
    published = true;
    syncDirectory(directory);
    return { saved: true, rows, bytes };
  } catch (error) {
    if (published)
      throw new ApplicationFailure(
        'OUTCOME_UNKNOWN',
        'The CSV file was created, but its final disk flush could not be confirmed. Check the destination before exporting again.',
      );
    throw error;
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      if (created && !published) {
        try {
          unlinkSync(temporary);
        } catch {
          /* A disconnected drive may retain a partial file; never claim completion. */
        }
      }
    }
  }
}
