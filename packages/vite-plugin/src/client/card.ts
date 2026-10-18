/// <reference lib="dom" />
// The hover card on a label: the changed lines and two actions, Open in VS Code and Mark as seen.
// One card at a time. overlayLayer.ts decides which label it belongs to and where it goes.
import type { OverlayItem } from '@change-spotlight/core';
import { fileLine, type Rect, type Viewport } from './outlines.js';

export const CARD_WIDTH = 240;
const GAP = 6;

export const CARD_STYLE = `
.card { position: absolute; box-sizing: border-box; width: ${CARD_WIDTH}px; padding: 12px; border-radius: 8px; background: #1d1c1a; color: #f6f5f2;
  display: flex; flex-direction: column; gap: 8px; z-index: 1; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25); pointer-events: auto;
  font: 13px system-ui, -apple-system, "Segoe UI", sans-serif; }
.card[hidden] { display: none; }
.card .lines { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #fbbf72; overflow-wrap: anywhere; }
.card .status { font-size: 12px; color: #c9c5bc; }
.card pre { margin: 0; padding: 6px 8px; border-radius: 4px; background: #2b2926; color: #d8d5ce; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.card .actions { display: flex; gap: 8px; }
.card .actions button { flex: 1; min-height: 32px; border-radius: 6px; font: 13px system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; padding: 0 8px; }
.card [data-cs-action="open"] { border: 0; background: #f6f5f2; color: #1d1c1a; font-weight: 500; }
.card [data-cs-action="open"]:hover { background: #ffffff; }
.card [data-cs-action="mark"] { border: 1px solid #5c5a55; background: transparent; color: #f6f5f2; }
.card [data-cs-action="mark"]:hover { background: #34322e; }
.card [data-cs-action="mark"][hidden] { display: none; }
`;

/** "Counter.tsx · lines 8–10" (en dash) or "Counter.tsx · line 8". */
export function cardTitle(item: Pick<OverlayItem, 'path' | 'line' | 'endLine'>): string {
  const name = fileLine(item).replace(/:\d+$/, '');
  return item.endLine > item.line ? `${name} · lines ${item.line}–${item.endLine}` : `${name} · line ${item.line}`;
}

/** The preview as a diff line: "+ added" or "- removed". Empty when there is nothing to show. */
export function cardPreview(item: Pick<OverlayItem, 'preview'>): string {
  if (item.preview === '') return '';
  return item.preview.startsWith('deleted: ') ? `- ${item.preview.slice('deleted: '.length)}` : `+ ${item.preview}`;
}

const STATUS_TEXT = { unseen: 'Not seen yet', partly: 'Partly seen', seen: 'Seen' } as const;

export function cardStatus(item: Pick<OverlayItem, 'status' | 'seenHunks' | 'hunkIds'>): string {
  const n = item.hunkIds.length;
  const changes = `${n} change${n === 1 ? '' : 's'}`;
  return item.status === 'partly' ? `Partly seen: ${item.seenHunks} of ${changes}` : `${STATUS_TEXT[item.status]} · ${changes}`;
}

/** Below the label when it fits, else above it; kept inside the viewport horizontally. */
export function placeCard(label: Rect, height: number, viewport: Viewport): { left: number; top: number } {
  const left = Math.max(0, Math.min(label.left, viewport.width - CARD_WIDTH));
  const below = label.top + label.height + GAP;
  const top = below + height <= viewport.height || label.top - GAP - height < 0 ? below : label.top - GAP - height;
  return { left, top };
}

export interface Card {
  element: HTMLDivElement;
  /** Fill the card for this item (no-op when unchanged, so focus inside it is kept). */
  show(item: OverlayItem): void;
  hide(): void;
  loc(): string | null;
}

export function createCard(container: HTMLElement, actions: { open(item: OverlayItem): void; mark(item: OverlayItem): void }): Card {
  const element = document.createElement('div');
  element.className = 'card';
  element.hidden = true;
  element.setAttribute('data-cs-card', '');
  element.setAttribute('role', 'dialog');
  element.innerHTML = `<div class="lines"></div><div class="status"></div><pre hidden></pre>
    <div class="actions"><button type="button" data-cs-action="open">Open in VS Code</button><button type="button" data-cs-action="mark">Mark as seen</button></div>`;
  container.append(element);
  const lines = element.querySelector('.lines') as HTMLDivElement;
  const status = element.querySelector('.status') as HTMLDivElement;
  const pre = element.querySelector('pre') as HTMLPreElement;
  const mark = element.querySelector('[data-cs-action="mark"]') as HTMLButtonElement;
  let current: OverlayItem | null = null;
  let content = '';

  element.querySelector('[data-cs-action="open"]')!.addEventListener('click', () => current && actions.open(current));
  mark.addEventListener('click', () => current && actions.mark(current));

  return {
    element,
    show(item) {
      current = item;
      element.hidden = false;
      const next = JSON.stringify([item.loc, item.status, item.line, item.endLine, item.preview, item.seenHunks, item.hunkIds.length]);
      if (next === content) return;
      content = next;
      element.setAttribute('data-loc', item.loc);
      element.setAttribute('aria-label', `Change in ${cardTitle(item)}`);
      lines.textContent = cardTitle(item);
      status.textContent = cardStatus(item);
      const preview = cardPreview(item);
      pre.hidden = preview === '';
      pre.textContent = preview;
      mark.hidden = item.status === 'seen';
    },
    hide() {
      current = null;
      content = '';
      element.hidden = true;
    },
    loc: () => current?.loc ?? null,
  };
}
