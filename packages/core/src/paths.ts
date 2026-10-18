/**
 * Normalizes a path to the project convention: forward slashes, no "." segments,
 * ".." resolved where possible, no leading "./", no duplicate or trailing slashes.
 * Absolute POSIX ("/x") and Windows drive ("C:/x") prefixes are kept.
 */
export function normalizePath(p: string): string {
  let rest = p.replace(/\\/g, '/');
  let prefix = '';
  const drive = /^([a-zA-Z]:)(\/|$)/.exec(rest);
  if (drive) {
    prefix = drive[1]! + '/';
    rest = rest.slice(drive[0].length);
  } else if (rest.startsWith('/')) {
    prefix = '/';
  }

  const out: string[] = [];
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!prefix) out.push('..'); // relative path climbing above its start
      continue;
    }
    out.push(segment);
  }
  return prefix + out.join('/');
}

/**
 * Converts an absolute path to a path relative to `repoRoot`, normalized.
 * Returns "" for the root itself and null when the path is outside the root.
 * Windows drive paths are compared case-insensitively.
 */
export function toRepoRelative(absPath: string, repoRoot: string): string | null {
  const file = normalizePath(absPath);
  const root = normalizePath(repoRoot); // only "/" and "C:/" keep a trailing slash
  const insensitive = /^[a-zA-Z]:/.test(root);
  const cmpFile = insensitive ? file.toLowerCase() : file;
  const cmpRoot = insensitive ? root.toLowerCase() : root;

  if (cmpFile === cmpRoot) return '';
  const prefix = cmpRoot.endsWith('/') ? cmpRoot : cmpRoot + '/';
  if (!cmpFile.startsWith(prefix)) return null;
  return file.slice(prefix.length);
}
