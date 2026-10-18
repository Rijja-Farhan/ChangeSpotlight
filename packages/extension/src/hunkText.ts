// Short text for a hunk, shared by the tree and the browser overlay so both say the same thing.
import type { HunkStatus } from '@change-spotlight/core';

const PREVIEW_MAX = 60;

/** First non-blank added line (whitespace collapsed, max 60 chars), or "deleted: <first removed line>". */
export function preview(h: Pick<HunkStatus, 'hunk'>): string {
  const pick = (lines: string[]) => lines.map((l) => l.trim().replace(/\s+/g, ' ')).find((l) => l !== '') ?? '';
  const cut = (text: string) => (text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + '…' : text);
  if (h.hunk.newCount === 0) return `deleted: ${cut(pick(h.hunk.removed))}`;
  return cut(pick(h.hunk.added));
}

/** The line a hunk starts on (a deletion at the top of a file shows on line 1). */
export function lineOf(h: Pick<HunkStatus, 'hunk'>): number {
  return Math.max(h.hunk.newStart, 1);
}

/** Last line a hunk covers; a deletion covers only its line. */
export function endLineOf(h: Pick<HunkStatus, 'hunk'>): number {
  return Math.max(lineOf(h), h.hunk.newStart + h.hunk.newCount - 1);
}
