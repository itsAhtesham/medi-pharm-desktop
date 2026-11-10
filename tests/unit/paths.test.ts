import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { assetPath, prototypeRoot } from '../../src/platform/paths';

describe('isolated platform storage', () => {
  it('uses local Windows profile storage without guessing a drive or user', () => {
    expect(prototypeRoot('win32', 'unused', { LOCALAPPDATA: 'D:\\Users\\Test User\\AppData\\Local' })).toBe('D:\\Users\\Test User\\AppData\\Local\\MediPharm Prototype');
    expect(() => prototypeRoot('win32', 'unused', {})).toThrow();
    expect(prototypeRoot('win32', 'unused', { MEDIPHARM_PROTOTYPE_HOME: 'D:\\Temp\\prototype' })).toBe('D:\\Temp\\prototype');
  });
  it('uses an isolated Linux directory and ignores relative XDG paths', () => {
    expect(prototypeRoot('linux', '/home/example', {})).toBe('/home/example/.local/share/medi-pharm-desktop-prototype');
    expect(prototypeRoot('linux', '/home/example', { XDG_DATA_HOME: 'relative' })).toBe('/home/example/.local/share/medi-pharm-desktop-prototype');
    expect(prototypeRoot('linux', '/home/example', { XDG_DATA_HOME: '/custom/data' })).toBe('/custom/data/medi-pharm-desktop-prototype');
    expect(() => prototypeRoot('linux', '/home/example', { MEDIPHARM_PROTOTYPE_HOME: 'relative' })).toThrow();
  });
});

describe('packaged asset boundary', () => {
  const root = path.resolve('/assets/renderer');
  it('serves the shell and bundled assets', () => {
    expect(assetPath(root, 'medipharm://app/')).toBe(path.join(root, 'index.html'));
    expect(assetPath(root, 'medipharm://app/assets/main.js')).toBe(path.join(root, 'assets/main.js'));
  });
  it('rejects different origins, encoded traversal, malformed paths, and Windows separators', () => {
    for (const url of ['https://app/', 'medipharm://evil/', 'medipharm://user@app/', 'medipharm://app:80/', 'medipharm://app/..%2fsecret', 'medipharm://app/%5c..%5csecret', 'medipharm://app/%00', 'medipharm://app/%ZZ']) {
      expect(assetPath(root, url), url).toBeNull();
    }
  });
});
