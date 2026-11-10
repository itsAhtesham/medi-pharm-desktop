import path from 'node:path';

export function prototypeRoot(platform: string, home: string, env: NodeJS.ProcessEnv): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // This entire artifact is a synthetic prototype, never a production data profile.
  if (env.MEDIPHARM_PROTOTYPE_HOME) {
    if (!paths.isAbsolute(env.MEDIPHARM_PROTOTYPE_HOME)) throw new Error('Prototype home must be absolute.');
    return env.MEDIPHARM_PROTOTYPE_HOME;
  }
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA || !path.win32.isAbsolute(env.LOCALAPPDATA)) {
      throw new Error('Windows LocalAppData is unavailable.');
    }
    return path.win32.join(env.LOCALAPPDATA, 'MediPharm Prototype');
  }
  if (platform === 'linux') {
    const base = env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME : path.posix.join(home, '.local', 'share');
    return path.posix.join(base, 'medi-pharm-desktop-prototype');
  }
  throw new Error('This prototype supports Windows and Linux development.');
}

export function assetPath(root: string, rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'medipharm:' || url.hostname !== 'app' || url.username || url.password || url.port) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;
    return resolved;
  } catch { return null; }
}
