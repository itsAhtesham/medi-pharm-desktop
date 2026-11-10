import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { assetPath, previewRoot, isWithinDirectory } from '../../src/platform/paths';

describe('isolated platform storage', () => {
  it('uses local Windows profile storage without guessing a drive or user', () => {
    expect(
      previewRoot('win32', 'unused', { LOCALAPPDATA: 'D:\\Users\\Test User\\AppData\\Local' }),
    ).toBe('D:\\Users\\Test User\\AppData\\Local\\MediPharm Desktop Preview');
    expect(() => previewRoot('win32', 'unused', {})).toThrow();
    expect(previewRoot('win32', 'unused', { MEDIPHARM_PREVIEW_HOME: 'D:\\Temp\\prototype' })).toBe(
      'D:\\Temp\\prototype',
    );
  });
  it('uses an isolated Linux directory and ignores relative XDG paths', () => {
    expect(previewRoot('linux', '/home/example', {})).toBe(
      '/home/example/.local/share/medi-pharm-desktop-preview',
    );
    expect(previewRoot('linux', '/home/example', { XDG_DATA_HOME: 'relative' })).toBe(
      '/home/example/.local/share/medi-pharm-desktop-preview',
    );
    expect(previewRoot('linux', '/home/example', { XDG_DATA_HOME: '/custom/data' })).toBe(
      '/custom/data/medi-pharm-desktop-preview',
    );
    expect(() =>
      previewRoot('linux', '/home/example', { MEDIPHARM_PREVIEW_HOME: 'relative' }),
    ).toThrow();
  });
});

describe('packaged asset boundary', () => {
  const root = path.resolve('/assets/renderer');
  it('serves the shell and bundled assets', () => {
    expect(assetPath(root, 'medipharm://app/')).toBe(path.join(root, 'index.html'));
    expect(assetPath(root, 'medipharm://app/assets/main.js')).toBe(
      path.join(root, 'assets/main.js'),
    );
  });
  it('rejects different origins, encoded traversal, malformed paths, and Windows separators', () => {
    for (const url of [
      'https://app/',
      'medipharm://evil/',
      'medipharm://user@app/',
      'medipharm://app:80/',
      'medipharm://app/..%2fsecret',
      'medipharm://app/%5c..%5csecret',
      'medipharm://app/%00',
      'medipharm://app/%ZZ',
    ]) {
      expect(assetPath(root, url), url).toBeNull();
    }
  });
});

it('recognizes Windows case variations and drive boundaries when excluding internal backup folders', () => {
  expect(isWithinDirectory('c:\\Users\\Test\\Data\\live', 'C:\\Users\\Test\\Data', 'win32')).toBe(
    true,
  );
  expect(isWithinDirectory('C:\\Users\\Test\\DATA', 'c:\\users\\test\\data', 'win32')).toBe(true);
  expect(isWithinDirectory('D:\\Backups', 'C:\\Users\\Test\\Data', 'win32')).toBe(false);
  expect(isWithinDirectory('/data/profile-copy', '/data/profile', 'linux')).toBe(false);
  expect(isWithinDirectory('/data/profile/staging', '/data/profile', 'linux')).toBe(true);
});
