import type { Hunk } from './diff.js';
import type { ElementLoc } from './loc.js';

/** A tagged host element as found in the source: its data-cs-loc range plus host nesting depth. */
export interface HostElement extends ElementLoc {
  /** 0 for an outermost host element, +1 per enclosing host element. */
  depth: number;
}

/** Innermost of `candidates`: smallest line span, ties broken by greatest depth. Several may tie. */
function innermost(candidates: HostElement[]): HostElement[] {
  let best: HostElement[] = [];
  for (const el of candidates) {
    const b = best[0];
    const span = el.end - el.start;
    const bestSpan = b ? b.end - b.start : Infinity;
    if (!b || span < bestSpan || (span === bestSpan && el.depth > b.depth)) best = [el];
    else if (span === bestSpan && el.depth === b.depth) best.push(el);
  }
  return best;
}

/**
 * The elements that "show" a hunk. Each changed line belongs to the innermost element(s)
 * containing it, so an outer <main> spanning the whole file does not claim every hunk inside it.
 * A pure deletion belongs to the innermost element(s) strictly around the gap (as in matchHunks).
 * Result is deduplicated by range and sorted by (start, end).
 */
export function hunkOwners(hunk: Hunk, elements: readonly HostElement[]): HostElement[] {
  const owners = new Map<string, HostElement>();
  const add = (els: HostElement[]) => {
    for (const el of els) owners.set(`${el.start}-${el.end}`, el);
  };

  if (hunk.newCount === 0) {
    const gap = hunk.newStart;
    add(innermost(elements.filter((el) => el.start <= gap && gap < el.end)));
  } else {
    for (let line = hunk.newStart; line < hunk.newStart + hunk.newCount; line++) {
      add(innermost(elements.filter((el) => el.start <= line && line <= el.end)));
    }
  }
  return [...owners.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
