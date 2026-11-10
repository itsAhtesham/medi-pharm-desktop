import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { csvCell, writeCsvFile } from '../../src/platform/csv-file';
const directories: string[] = [];
const dir = () => {
  const value = mkdtempSync(path.join(tmpdir(), 'medipharm-csv-file-'));
  directories.push(value);
  return value;
};
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});
it('quotes delimiters/newlines and neutralizes formula/control prefixes without damaging ordinary values', () => {
  for (const text of [
    '=1+1',
    '+cmd',
    '-cmd',
    '@SUM(1)',
    '  =1',
    '\ufeff=1',
    '\ttext',
    '\ntext',
    '\rtext',
  ])
    expect(csvCell(text)).toBe('"\'' + text + '"');
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(csvCell(1.25)).toBe('"1.25"');
  expect(csvCell(null)).toBe('""');
  expect(csvCell('हिंदी')).toBe('"हिंदी"');
});
it('publishes a flushed CSV and safely replaces an explicitly selected existing destination', () => {
  const root = dir(),
    out = dir(),
    file = path.join(out, 'result.csv');
  writeFileSync(file, 'old');
  const result = writeCsvFile(root, file, (write) => {
    write(['Header']);
    write(['value']);
    return 1;
  });
  expect(result).toMatchObject({ saved: true, rows: 1 });
  expect(result.bytes).toBe(Buffer.byteLength('\ufeff"Header"\r\n"value"\r\n'));
  expect(readFileSync(file, 'utf8')).toBe('\ufeff"Header"\r\n"value"\r\n');
  expect(readdirSync(out)).toEqual(['result.csv']);
});
it('cleans up after a partial write failure, preserves the old file and releases handles for retry', () => {
  const root = dir(),
    out = dir(),
    file = path.join(out, 'result.csv');
  writeFileSync(file, 'old');
  expect(() =>
    writeCsvFile(root, file, (write) => {
      write(['partial']);
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    }),
  ).toThrow('disk full');
  expect(readFileSync(file, 'utf8')).toBe('old');
  expect(readdirSync(out)).toEqual(['result.csv']);
  expect(
    writeCsvFile(root, file, (write) => {
      write(['retry']);
      return 0;
    }).saved,
  ).toBe(true);
});
it('does not overwrite a destination that changed while exporting', () => {
  const root = dir(),
    out = dir(),
    file = path.join(out, 'result.csv');
  expect(() =>
    writeCsvFile(root, file, (write) => {
      write(['header']);
      writeFileSync(file, 'created by another writer');
      return 0;
    }),
  ).toThrow('changed');
  expect(readFileSync(file, 'utf8')).toBe('created by another writer');
  expect(readdirSync(out)).toEqual(['result.csv']);
});
it('reports removal of the destination without leaving a successful final file', () => {
  const root = dir(),
    out = dir(),
    file = path.join(out, 'result.csv');
  expect(() =>
    writeCsvFile(root, file, (write) => {
      write(['row']);
      rmSync(out, { recursive: true, force: true });
      return 1;
    }),
  ).toThrow();
  expect(existsSync(file)).toBe(false);
});
