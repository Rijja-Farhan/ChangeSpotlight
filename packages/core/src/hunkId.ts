import type { Hunk } from './diff.js';

/** cyrb53: small, fast, pure-JS 53-bit string hash; identical on every platform. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Stable ids for a file's hunks, built from the path and the hunk's content only (never line
 * numbers), so a hunk that just moves keeps its id while any edit gives it a new one. Identical
 * hunks in the same file get "#1", "#2"… in file order.
 */
export function hunkIds(path: string, hunks: readonly Hunk[]): string[] {
  const counts = new Map<string, number>();
  return hunks.map((h) => {
    const key = JSON.stringify([path, h.kind, h.removed, h.added]);
    const base = cyrb53(key, 1).toString(16).padStart(14, '0') + cyrb53(key, 2).toString(16).padStart(14, '0');
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return `${base}#${n}`;
  });
}
