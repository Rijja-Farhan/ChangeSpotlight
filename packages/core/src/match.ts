import type { Hunk } from './diff.js';
import type { ElementLoc } from './loc.js';

export interface HunkMatch {
  /** Hunks entirely inside the element's line range. Always a subset of `intersecting`. */
  covered: Hunk[];
  /** Hunks that share at least one line with the element's line range. */
  intersecting: Hunk[];
}

/**
 * Relates one element (1-based inclusive [start, end] in the new file) to a file's hunks.
 * A pure deletion has no new lines; it sits in the gap after line `newStart`, and counts for
 * the element only when that gap is strictly inside it (start <= newStart < end), because
 * then the element visibly lost something. A gap at an edge could belong to a neighbour.
 */
export function matchHunks(element: ElementLoc, hunks: readonly Hunk[]): HunkMatch {
  const covered: Hunk[] = [];
  const intersecting: Hunk[] = [];
  const { start: s, end: e } = element;

  for (const hunk of hunks) {
    if (hunk.newCount === 0) {
      const gapAfter = hunk.newStart;
      if (s <= gapAfter && gapAfter < e) {
        covered.push(hunk);
        intersecting.push(hunk);
      }
      continue;
    }
    const first = hunk.newStart;
    const last = hunk.newStart + hunk.newCount - 1;
    if (s <= last && first <= e) {
      intersecting.push(hunk);
      if (s <= first && last <= e) covered.push(hunk);
    }
  }
  return { covered, intersecting };
}
