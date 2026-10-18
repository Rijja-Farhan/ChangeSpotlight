import { normalizePath } from './paths.js';

/** Where a rendered element comes from: repo-relative file and 1-based inclusive line range. */
export interface ElementLoc {
  path: string;
  start: number;
  end: number;
}

/**
 * Parses a data-cs-loc value "path:start-end". Splits on the last ":" so paths may
 * contain colons. Returns null for anything malformed.
 */
export function parseLoc(value: string): ElementLoc | null {
  const colon = value.lastIndexOf(':');
  if (colon <= 0) return null;

  const range = /^(\d+)-(\d+)$/.exec(value.slice(colon + 1));
  if (!range) return null;
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return null;

  const path = normalizePath(value.slice(0, colon));
  if (path === '') return null;
  return { path, start, end };
}

export function formatLoc(loc: ElementLoc): string {
  return `${loc.path}:${loc.start}-${loc.end}`;
}
