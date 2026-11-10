import path from 'node:path';

/** Compare already-resolved filesystem paths using the target OS's path rules. */
export function isWithinDirectory(
  directory: string,
  root: string,
  platform = process.platform,
): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(directory) || !paths.isAbsolute(root))
    throw new Error('Absolute paths are required.');
  const relative = paths.relative(root, directory);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative))
  );
}

export function previewRoot(platform: string, home: string, env: NodeJS.ProcessEnv): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // Preview builds stay isolated from both the old prototype and future production data.
  if (env.MEDIPHARM_PREVIEW_HOME) {
    if (!paths.isAbsolute(env.MEDIPHARM_PREVIEW_HOME))
      throw new Error('Preview home must be absolute.');
    return env.MEDIPHARM_PREVIEW_HOME;
  }
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA || !path.win32.isAbsolute(env.LOCALAPPDATA)) {
      throw new Error('Windows LocalAppData is unavailable.');
    }
    return path.win32.join(env.LOCALAPPDATA, 'MediPharm Desktop Preview');
  }
  if (platform === 'linux') {
    const base =
      env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : path.posix.join(home, '.local', 'share');
    return path.posix.join(base, 'medi-pharm-desktop-preview');
  }
  throw new Error('This preview supports Windows and Linux development.');
}

export function assetPath(root: string, rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'medipharm:' ||
      url.hostname !== 'app' ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;
    return resolved;
  } catch {
    return null;
  }
}
