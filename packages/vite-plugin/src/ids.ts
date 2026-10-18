// Decides whether a Vite module id gets tagged, and with which repo-relative path. Pure.
import { normalizePath, toRepoRelative } from '@change-spotlight/core';

export type IdTarget = { file: string; relPath: string; lang: 'jsx' | 'tsx' };

const SKIP_QUERIES = new Set(['raw', 'url', 'inline', 'worker', 'sharedworker']);

/** Returns what to tag for `id`, or null when the module must be left alone. */
export function resolveId(id: string, repoRoot: string): IdTarget | null {
  if (id.startsWith('\0')) return null;
  const q = id.indexOf('?');
  const file = q === -1 ? id : id.slice(0, q);
  if (q !== -1) {
    const params = id.slice(q + 1).split('&').map((p) => p.split('=')[0]);
    if (params.some((p) => p !== undefined && SKIP_QUERIES.has(p))) return null;
  }

  const ext = /\.([cm]?[jt]sx?)$/.exec(file)?.[1];
  let lang: 'jsx' | 'tsx';
  if (ext === 'tsx') lang = 'tsx';
  else if (ext === 'jsx' || ext === 'js' || ext === 'mjs' || ext === 'cjs') lang = 'jsx';
  else return null; // .ts/.mts/.cts cannot contain JSX; anything else is not a script

  const relPath = toRepoRelative(file, repoRoot);
  if (relPath === null || relPath === '') return null; // outside the repo
  return { file: normalizePath(file), relPath, lang };
}
