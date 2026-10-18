import type { DiffFile } from './diff.js';
import { normalizePath } from './paths.js';

/** Git's heuristic: a file is binary if its first 8000 bytes contain a NUL byte. */
export function isBinaryContent(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * Describes an untracked file as if git had diffed it against nothing, so it can be treated
 * exactly like a new file from `parseDiff`. Pass `null` for binary content.
 */
export function addedFileDiff(path: string, text: string | null): DiffFile {
  const file: DiffFile = { path: normalizePath(path), oldPath: null, status: 'added', binary: text === null, hunks: [] };
  if (text === null || text === '') return file;

  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop(); // final newline does not start another line
  const added = lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  file.hunks.push({ oldStart: 0, oldCount: 0, newStart: 1, newCount: added.length, kind: 'add', removed: [], added });
  return file;
}
