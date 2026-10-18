/// <reference lib="dom" />
// The browser's copy of the overlay (from VS Code, relayed by the plugin) and the two requests the
// page can send back. Module state, so later overlay UI modules share one copy. No UI here.
import type { MarkMessage, OpenMessage, OverlayMessage } from '@change-spotlight/core';
import type { HotChannel } from './index.js';

type Listener = (overlay: OverlayMessage) => void;

let channel: { hot: HotChannel; protocolVersion: number } | undefined;
let latest: OverlayMessage | undefined;
const listeners = new Set<Listener>();

/** Light check: the plugin already validated it, but the HMR channel is shared with other code. */
function isOverlay(value: unknown, protocolVersion: number): value is OverlayMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<OverlayMessage>;
  return v.type === 'overlay' && v.protocolVersion === protocolVersion && Array.isArray(v.items);
}

/** Called once by startClient: listen for overlays and ask for the current one. */
export function connectOverlay(hot: HotChannel, protocolVersion: number): void {
  channel = { hot, protocolVersion };
  hot.on?.('cs:overlay', (data) => {
    if (!isOverlay(data, protocolVersion)) return;
    latest = data;
    for (const l of listeners) l(data);
  });
  hot.send('cs:overlay-request', {});
}

/** Called with every new overlay (and right away with the current one, if any). Returns unsubscribe. */
export function onOverlay(listener: Listener): () => void {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => listeners.delete(listener);
}

export function latestOverlay(): OverlayMessage | undefined {
  return latest;
}

/** "Open in VS Code": `path` is repo-relative, `line` 1-based. */
export function requestOpen(path: string, line: number): void {
  if (!channel) return;
  const message: OpenMessage = { protocolVersion: channel.protocolVersion, type: 'open', path, line };
  channel.hot.send('cs:open', message);
}

/** "Mark as seen" for these hunks. VS Code decides; the overlay updates when it says so. */
export function requestMark(hunkIds: string[]): void {
  if (!channel) return;
  const message: MarkMessage = { protocolVersion: channel.protocolVersion, type: 'mark', hunkIds };
  channel.hot.send('cs:mark', message);
}
