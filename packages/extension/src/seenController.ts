// Connects git results, browser visibility reports and storage to the SeenModel. No vscode import,
// so the whole flow is tested against real temp repos.
import { formatLoc, parseLoc, SeenModel, type HunkStatus, type SeenTotals } from '@change-spotlight/core';
import { analyzeElements } from './elements';
import type { ChangeResult } from './git';
import type { SeenStore } from './seenStore';

export interface SeenState {
  totals: SeenTotals;
  hunks: readonly HunkStatus[];
  root: string;
  branch: string | null;
}

export class SeenController {
  private model: SeenModel | undefined;
  private key: { root: string; branch: string | null } | undefined;
  private updating = false;
  private pending: { page: string; seen: string[] }[] = [];
  private lastTotals = '';
  /** Changed JSX files -> current element locs, to spot reports with outdated line numbers. */
  private currentLocs = new Map<string, Set<string>>();

  constructor(
    private readonly store: SeenStore,
    private readonly log: (msg: string) => void,
    private readonly onChange: (state: SeenState) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get state(): SeenState | undefined {
    if (!this.model || !this.key) return undefined;
    return { totals: this.model.totals(), hunks: this.model.hunks(), ...this.key };
  }

  /** A fresh git result: re-read elements, rebuild the hunk list, then apply held-back reports. */
  async applyResult(result: ChangeResult): Promise<void> {
    if (!result.ok) return;
    this.updating = true;
    try {
      if (!this.key || this.key.root !== result.root || this.key.branch !== result.branch) {
        this.key = { root: result.root, branch: result.branch };
        this.model = new SeenModel(this.store.load(result.root, result.branch), this.now);
        this.lastTotals = '';
      }
      const elements = await analyzeElements(result.root, result.files);
      this.currentLocs = new Map([...elements].map(([file, els]) => [file, new Set((els ?? []).map(formatLoc))]));
      this.model!.update(result.files, elements);
    } finally {
      this.updating = false;
    }
    const held = this.pending.splice(0);
    for (const report of held) this.apply(report.page, report.seen);
    await this.persist();
  }

  /**
   * Seen locs from the browser. While git results are about to change (busy) or being applied,
   * hold them back: they may already use the new line numbers.
   */
  async visibility(page: string, seen: string[], busy: boolean): Promise<void> {
    if (busy || this.updating || !this.model) {
      this.pending.push({ page, seen });
      return;
    }
    if (this.apply(page, seen)) await this.persist();
  }

  /** "Mark as Seen" / "Mark as Unseen" from the tree. */
  async markHunk(id: string, seen: boolean): Promise<void> {
    await this.markHunks([id], seen);
  }

  /** Several at once (the browser's "Mark as seen"), saved once. Unknown ids are ignored. */
  async markHunks(ids: readonly string[], seen: boolean): Promise<void> {
    let changed = false;
    for (const id of ids) if (this.model?.setSeen(id, seen)) changed = true;
    if (changed) await this.persist();
  }

  async reset(): Promise<void> {
    if (!this.model || !this.key) return;
    this.model.reset();
    await this.store.clear(this.key.root, this.key.branch);
    this.notify();
  }

  private apply(page: string, seen: string[]): boolean {
    const { changed } = this.model!.markSeen(page, seen);
    // Most seen elements simply show no change. Only reports for a changed file whose range no
    // longer exists are worth a note: the browser has not picked up the latest save yet.
    const stale = seen.filter((value) => {
      const loc = parseLoc(value);
      const locs = loc && this.currentLocs.get(loc.path);
      return locs !== undefined && locs !== null && !locs.has(value);
    }).length;
    if (stale > 0) this.log(`Ignored ${stale} seen element(s) on ${page} with outdated line numbers (page not reloaded yet?).`);
    return changed;
  }

  private async persist(): Promise<void> {
    if (!this.model || !this.key) return;
    await this.store.save(this.key.root, this.key.branch, this.model.snapshot());
    this.notify();
  }

  private notify(): void {
    const state = this.state!;
    const { seen, total, untrackable } = state.totals;
    const line = `Seen ${seen} of ${total} changes (${untrackable} not trackable)`;
    if (line !== this.lastTotals) {
      this.lastTotals = line;
      this.log(line);
    }
    this.onChange(state);
  }
}
