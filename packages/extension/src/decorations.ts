// Which lines get which gutter mark. No vscode import, so it is unit-tested.
import type { HunkStatus, LineRange } from '@change-spotlight/core';

export type MarkStyle = 'unseen' | 'seen' | 'untrackable';
export type FileMarks = Record<MarkStyle, LineRange[]>;

/** Higher wins when two hunks mark the same line. */
const PRIORITY: Record<MarkStyle, number> = { unseen: 3, seen: 2, untrackable: 1 };

function merge(lines: number[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of lines.sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && line <= last.end + 1) last.end = Math.max(last.end, line);
    else ranges.push({ start: line, end: line });
  }
  return ranges;
}

/** Per file: 1-based, merged line ranges for each mark style. */
export function decorationRanges(hunks: readonly HunkStatus[]): Map<string, FileMarks> {
  const perFile = new Map<string, Map<number, MarkStyle>>();
  for (const h of hunks) {
    if (h.reason === 'deleted-file') continue;
    const style: MarkStyle = h.status;
    // A pure deletion has no new lines: mark the line above the gap (or the first line).
    const first = h.hunk.newCount === 0 ? Math.max(h.hunk.newStart, 1) : h.hunk.newStart;
    const count = Math.max(h.hunk.newCount, 1);
    const lines = perFile.get(h.path) ?? new Map<number, MarkStyle>();
    perFile.set(h.path, lines);
    for (let line = first; line < first + count; line++) {
      const current = lines.get(line);
      if (!current || PRIORITY[style] > PRIORITY[current]) lines.set(line, style);
    }
  }
  const result = new Map<string, FileMarks>();
  for (const [path, lines] of perFile) {
    const by: Record<MarkStyle, number[]> = { unseen: [], seen: [], untrackable: [] };
    for (const [line, style] of lines) by[style].push(line);
    result.set(path, { unseen: merge(by.unseen), seen: merge(by.seen), untrackable: merge(by.untrackable) });
  }
  return result;
}
