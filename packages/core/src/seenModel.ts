import type { DiffFile, Hunk } from './diff.js';
import { hunkOwners, type HostElement } from './elements.js';
import { hunkIds } from './hunkId.js';
import { formatLoc } from './loc.js';

export type UntrackableReason = 'not-jsx' | 'deleted-file' | 'binary' | 'parse-error' | 'no-element';

export interface HunkStatus {
  id: string;
  path: string;
  hunk: Hunk;
  status: 'seen' | 'unseen' | 'untrackable';
  reason?: UntrackableReason;
  /** data-cs-loc values of the elements that show this hunk. */
  owners: string[];
  /** Indexes into `owners` that have been seen. */
  seenOwners: number[];
  /** Pages the hunk's owners were seen on. */
  pages: string[];
  /** Marked as seen by hand ("Mark as Seen"), not by the browser. */
  manual?: boolean;
}

export interface SeenEntry {
  ownerCount: number;
  seenOwners: number[];
  pages: string[];
  /** Epoch ms when the last owner was seen. */
  seenAt?: number;
  /** Set by "Mark as Seen". Optional, so version-1 snapshots without it still load. */
  manual?: boolean;
  /** Epoch ms when the hunk was last part of the diff (for pruning). */
  lastInDiffAt: number;
}

export interface SeenSnapshot {
  version: 1;
  entries: Record<string, SeenEntry>;
}

export interface SeenTotals {
  seen: number;
  /** Trackable hunks only. */
  total: number;
  untrackable: number;
}

export const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 5000;

const JSX_FILE = /\.[jt]sx$/;

/**
 * "Seen X of Y": which changed hunks have been shown in the browser. Pure: feed it the diff and
 * the host elements of each changed file, then the seen locs the browser reports.
 */
export class SeenModel {
  private entries = new Map<string, SeenEntry>();
  private statuses: HunkStatus[] = [];
  /** owner loc -> [hunk index, owner index] */
  private byLoc = new Map<string, [number, number][]>();

  constructor(
    snapshot?: SeenSnapshot | null,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (snapshot?.version === 1) for (const [id, e] of Object.entries(snapshot.entries)) this.entries.set(id, { ...e });
  }

  /** Rebuild the hunk list from a fresh diff. `elements`: per path; null = the file failed to parse. */
  update(files: readonly DiffFile[], elements: ReadonlyMap<string, HostElement[] | null>): void {
    const now = this.now();
    this.statuses = [];
    this.byLoc = new Map();

    for (const file of files) {
      const ids = hunkIds(file.path, file.hunks);
      const els = elements.get(file.path);
      const fileReason: UntrackableReason | undefined = file.binary
        ? 'binary'
        : file.status === 'deleted'
          ? 'deleted-file'
          : !JSX_FILE.test(file.path)
            ? 'not-jsx'
            : els === null || els === undefined
              ? 'parse-error'
              : undefined;

      file.hunks.forEach((hunk, i) => {
        const id = ids[i]!;
        const owners = fileReason ? [] : hunkOwners(hunk, els!).map(formatLoc);
        const reason = fileReason ?? (owners.length === 0 ? 'no-element' : undefined);
        if (reason) {
          this.statuses.push({ id, path: file.path, hunk, status: 'untrackable', reason, owners: [], seenOwners: [], pages: [] });
          return;
        }
        let entry = this.entries.get(id);
        if (!entry || entry.ownerCount !== owners.length) {
          entry = { ownerCount: owners.length, seenOwners: [], pages: [], lastInDiffAt: now };
          this.entries.set(id, entry);
        }
        entry.lastInDiffAt = now;
        const index = this.statuses.length;
        owners.forEach((loc, o) => {
          const list = this.byLoc.get(loc) ?? [];
          list.push([index, o]);
          this.byLoc.set(loc, list);
        });
        this.statuses.push(this.statusOf(id, file.path, hunk, owners, entry));
      });
    }
  }

  /** Apply a batch of seen locs from `page`. Returns how many matched a current owner. */
  markSeen(page: string, locs: readonly string[]): { matched: number; unmatched: number; changed: boolean } {
    let matched = 0;
    let unmatched = 0;
    let changed = false;
    for (const loc of locs) {
      const targets = this.byLoc.get(loc);
      if (!targets) {
        unmatched++;
        continue;
      }
      matched++;
      for (const [index, ownerIndex] of targets) {
        const status = this.statuses[index]!;
        const entry = this.entries.get(status.id)!;
        if (!entry.seenOwners.includes(ownerIndex)) {
          entry.seenOwners.push(ownerIndex);
          entry.seenOwners.sort((a, b) => a - b);
          changed = true;
        }
        if (!entry.pages.includes(page)) {
          entry.pages.push(page);
          changed = true;
        }
        if (entry.seenOwners.length === entry.ownerCount && entry.seenAt === undefined) entry.seenAt = this.now();
        this.statuses[index] = this.statusOf(status.id, status.path, status.hunk, status.owners, entry);
      }
    }
    return { matched, unmatched, changed };
  }

  hunks(): readonly HunkStatus[] {
    return this.statuses;
  }

  totals(): SeenTotals {
    let seen = 0;
    let total = 0;
    let untrackable = 0;
    for (const s of this.statuses) {
      if (s.status === 'untrackable') untrackable++;
      else {
        total++;
        if (s.status === 'seen') seen++;
      }
    }
    return { seen, total, untrackable };
  }

  /** JSON-safe state for persistence; prunes entries long gone from the diff. */
  snapshot(): SeenSnapshot {
    const cutoff = this.now() - PRUNE_AFTER_MS;
    const kept = [...this.entries].filter(([, e]) => e.lastInDiffAt >= cutoff);
    kept.sort((a, b) => b[1].lastInDiffAt - a[1].lastInDiffAt);
    this.entries = new Map(kept.slice(0, MAX_ENTRIES));
    const entries: Record<string, SeenEntry> = {};
    for (const [id, e] of this.entries) entries[id] = { ...e, seenOwners: [...e.seenOwners], pages: [...e.pages] };
    return { version: 1, entries };
  }

  /** Mark a trackable hunk seen (all owners) or unseen (clear progress) by hand. */
  setSeen(id: string, seen: boolean): boolean {
    const index = this.statuses.findIndex((s) => s.id === id);
    const status = this.statuses[index];
    const entry = this.entries.get(id);
    if (!status || status.status === 'untrackable' || !entry) return false;
    const before = JSON.stringify(entry);
    if (seen) {
      entry.seenOwners = status.owners.map((_, i) => i);
      entry.seenAt ??= this.now();
      if (status.status !== 'seen') entry.manual = true;
    } else {
      entry.seenOwners = [];
      entry.pages = [];
      delete entry.seenAt;
      delete entry.manual;
    }
    this.statuses[index] = this.statusOf(status.id, status.path, status.hunk, status.owners, entry);
    return JSON.stringify(entry) !== before;
  }

  /** Forget all seen progress (keeps the current hunk list). */
  reset(): void {
    this.entries.clear();
    const now = this.now();
    this.statuses = this.statuses.map((s) => {
      if (s.status === 'untrackable') return s;
      const entry: SeenEntry = { ownerCount: s.owners.length, seenOwners: [], pages: [], lastInDiffAt: now };
      this.entries.set(s.id, entry);
      return this.statusOf(s.id, s.path, s.hunk, s.owners, entry);
    });
  }

  private statusOf(id: string, path: string, hunk: Hunk, owners: string[], entry: SeenEntry): HunkStatus {
    const seen = entry.seenOwners.length === owners.length;
    return {
      id, path, hunk, status: seen ? 'seen' : 'unseen', owners, seenOwners: [...entry.seenOwners], pages: [...entry.pages],
      ...(entry.manual ? { manual: true } : {}),
    };
  }
}
