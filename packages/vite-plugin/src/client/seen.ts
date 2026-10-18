// The "seen" rule, without any DOM: the sensor feeds it observations, it decides when a
// data-cs-loc counts as seen and batches the results. Timers are injected so tests can drive it.

export const DWELL_MS = 300;
export const FLUSH_MS = 500;
export const MIN_RATIO = 0.5;

export interface Observation {
  /** The element's data-cs-loc value. */
  loc: string;
  /** Fraction of the element that is visible (IntersectionObserver intersectionRatio). */
  ratio: number;
  /** Fraction of the viewport height the visible part covers. */
  viewportCoverage: number;
  /** Element is taller or wider than the viewport, so it can never be 50% visible. */
  tall: boolean;
  /** Element has a non-zero bounding box. */
  hasSize: boolean;
}

export interface Batch {
  page: string;
  seen: string[];
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SeenTrackerOptions<K> {
  timers: Timers;
  page: string;
  /** Final check when the dwell completes (e.g. checkVisibility for opacity/visibility). */
  canCommit?: (key: K) => boolean;
  onBatch: (batch: Batch) => void;
  /** A dwell started (true) or ended (false: committed, cancelled or element gone). For the overlay's ring. */
  onDwell?: (key: K, loc: string, active: boolean) => void;
}

export function qualifies(o: Observation): boolean {
  return o.hasSize && (o.ratio >= MIN_RATIO || (o.tall && o.viewportCoverage >= MIN_RATIO));
}

/** K identifies one element (the DOM element itself in the browser, anything in tests). */
export class SeenTracker<K> {
  private readonly observations = new Map<K, Observation>();
  private readonly dwell = new Map<K, unknown>();
  /** "page\nloc" pairs already reported during this page load. */
  private readonly reported = new Set<string>();
  /** page -> locs waiting for the next flush. */
  private readonly queue = new Map<string, Set<string>>();
  private flushTimer: unknown;
  private active = true;
  private page: string;

  constructor(private readonly options: SeenTrackerOptions<K>) {
    this.page = options.page;
  }

  /** New intersection data for an element. */
  update(key: K, observation: Observation): void {
    const previous = this.observations.get(key);
    // Cancel before storing, so the dwell-end event carries the loc that was being counted.
    if (previous && previous.loc !== observation.loc) this.cancel(key);
    this.observations.set(key, observation);
    this.evaluate(key);
  }

  /** The element left the DOM or lost its data-cs-loc. */
  remove(key: K): void {
    this.cancel(key);
    this.observations.delete(key);
  }

  /** Tab visible and focused. Losing it resets every running dwell. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    for (const key of this.observations.keys()) this.evaluate(key);
  }

  /** SPA navigation: report what was seen under the old page, then start over for the new one. */
  setPage(page: string): void {
    if (page === this.page) return;
    this.flush();
    for (const key of [...this.dwell.keys()]) this.cancel(key);
    this.page = page;
    for (const key of this.observations.keys()) this.evaluate(key);
  }

  /**
   * Forget what was already reported, so elements still on screen are reported again after a
   * dwell. Called after HMR: an edit inside an element whose line range did not change gives a
   * new change that must be seen again, but the element's loc (and thus the dedupe key) is the same.
   */
  resetReported(): void {
    this.reported.clear();
    for (const key of this.observations.keys()) this.evaluate(key);
  }

  /** Send everything queued now (also called on pagehide / tab hidden). */
  flush(): void {
    this.options.timers.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const [page, locs] of this.queue) this.options.onBatch({ page, seen: [...locs] });
    this.queue.clear();
  }

  private evaluate(key: K): void {
    const o = this.observations.get(key);
    const pending = this.dwell.has(key);
    if (!o || !this.active || !qualifies(o) || this.reported.has(this.pairOf(o.loc))) {
      if (pending) this.cancel(key);
      return;
    }
    if (pending) return;
    const handle = this.options.timers.setTimeout(() => this.commit(key), DWELL_MS);
    this.dwell.set(key, handle);
    this.options.onDwell?.(key, o.loc, true);
  }

  private commit(key: K): void {
    this.dwell.delete(key);
    const o = this.observations.get(key);
    if (o) this.options.onDwell?.(key, o.loc, false);
    if (!o || !this.active || !qualifies(o)) return;
    if (this.options.canCommit && !this.options.canCommit(key)) return;
    const pair = this.pairOf(o.loc);
    if (this.reported.has(pair)) return;
    this.reported.add(pair);

    let locs = this.queue.get(this.page);
    if (!locs) this.queue.set(this.page, (locs = new Set()));
    locs.add(o.loc);
    this.flushTimer ??= this.options.timers.setTimeout(() => this.flush(), FLUSH_MS);
  }

  private cancel(key: K): void {
    if (!this.dwell.has(key)) return;
    this.options.timers.clearTimeout(this.dwell.get(key));
    this.dwell.delete(key);
    this.options.onDwell?.(key, this.observations.get(key)?.loc ?? '', false);
  }

  private pairOf(loc: string): string {
    return `${this.page}\n${loc}`;
  }
}
