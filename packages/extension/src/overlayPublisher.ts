// Keeps connected dev servers up to date with the overlay. No vscode import, timers injected, so
// the debounce is unit-tested.
import type { OverlayMessage } from '@change-spotlight/core';
import { buildOverlay } from './overlay';
import type { SeenState } from './seenController';

export const OVERLAY_DEBOUNCE_MS = 150;

export interface PublisherTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: PublisherTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class OverlayPublisher {
  private state: SeenState | undefined;
  private timer: unknown;

  constructor(
    private readonly send: (message: OverlayMessage) => void,
    private readonly timers: PublisherTimers = realTimers,
    private readonly delayMs = OVERLAY_DEBOUNCE_MS,
  ) {}

  /** A new seen state: publish it after a short quiet period (visibility batches come in bursts). */
  update(state: SeenState): void {
    this.state = state;
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => this.flush(), this.delayMs);
  }

  /** A dev server just connected: send what we have right away. */
  flush(): void {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.state) this.send(buildOverlay(this.state));
  }

  dispose(): void {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Checks an "open" request from the page, which is untrusted: a repo-relative path with no ".."
 * or absolute parts. Returns the cleaned relative path, or null. The caller checks it exists.
 */
export function openTarget(requested: string): string | null {
  const rel = requested.replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.includes('\0')) return null;
  const parts = rel.split('/');
  if (parts.some((p) => p === '..')) return null;
  const clean = parts.filter((p) => p !== '' && p !== '.').join('/');
  return clean === '' ? null : clean;
}
