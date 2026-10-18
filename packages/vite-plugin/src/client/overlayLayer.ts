/// <reference lib="dom" />
// The in-page overlay: one fixed, click-through layer in a Shadow DOM root on <body>, so the app's
// CSS cannot style it and it cannot style the app. Outlines are boxes drawn over each changed
// element from its bounding box; app elements are never touched. Decisions (text, placement) live
// in outlines.ts; this file only measures and draws, at most once per animation frame.
import type { OverlayItem, OverlayMessage } from '@change-spotlight/core';
import { inViewport, LABEL_HEIGHT, labelText, placeLabels, type LabelRequest, type Rect } from './outlines.js';
import { onOverlay } from './overlayData.js';
import { COUNTING_TEXT, flashLocs, isCounting, ringOffset } from './live.js';
import { DWELL_MS } from './seen.js';

export const HOST_TAG = 'change-spotlight-overlay';
export const STORAGE_KEY = 'change-spotlight:outlines';
const ATTR = 'data-cs-loc';
const FONT = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
/** Outlines further than this outside the viewport are not drawn. */
const OFFSCREEN_MARGIN = 200;
/** How long a newly seen outline flashes green. */
export const FLASH_MS = 700;
const RING_LENGTH = 28.3; // circumference of the r=4.5 ring

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
.outline { position: absolute; box-sizing: border-box; border-radius: 2px; outline-offset: 3px; pointer-events: none; }
.outline[data-status="unseen"], .outline[data-status="partly"] { outline: 2px dashed #b45309; box-shadow: 0 0 0 9px rgba(180, 83, 9, 0.12); }
.outline[data-status="seen"] { outline: 2px solid #15803d; }
.label { position: absolute; box-sizing: border-box; height: ${LABEL_HEIGHT}px; padding: 0 8px; border-radius: 4px; display: flex; align-items: center; gap: 6px;
  color: #ffffff; font: ${FONT}; line-height: ${LABEL_HEIGHT}px; white-space: nowrap; overflow: hidden; pointer-events: none; }
.label[data-status="unseen"], .label[data-status="partly"] { background: #b45309; }
.label[data-status="seen"] { background: #15803d; }
.label svg { flex: none; }
.outline[data-counting] { outline: 2px solid #1f4fd1; box-shadow: none; }
.label[data-counting] { background: #1f4fd1; }
.ring-fill { stroke-dasharray: ${RING_LENGTH}; stroke-dashoffset: ${RING_LENGTH}; animation: cs-fill ${DWELL_MS}ms linear forwards; }
@keyframes cs-fill { to { stroke-dashoffset: 0; } }
.outline[data-flash] { animation: cs-flash ${FLASH_MS}ms ease-out; }
.label[data-flash] { animation: cs-flash-label ${FLASH_MS}ms ease-out; }
@keyframes cs-flash-label { 0% { box-shadow: 0 0 0 0 rgba(21, 128, 61, 0.55); } 100% { box-shadow: 0 0 0 8px rgba(21, 128, 61, 0); } }
@keyframes cs-flash { 0% { box-shadow: 0 0 0 0 rgba(21, 128, 61, 0.55); } 100% { box-shadow: 0 0 0 14px rgba(21, 128, 61, 0); } }
@media (prefers-reduced-motion: reduce) {
  .outline[data-flash], .label[data-flash] { animation: none; }
  .ring-fill { animation: none; stroke-dashoffset: ${RING_LENGTH / 2}; }
}
.eye { position: fixed; right: 20px; bottom: 20px; width: 40px; height: 40px; border: 0; border-radius: 20px; padding: 0; margin: 0;
  display: flex; align-items: center; justify-content: center; background: #1d1c1a; color: #f6f5f2; cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25); pointer-events: auto; }
.eye:hover { background: #34322e; }
.eye:focus-visible { outline: 2px solid #fbbf72; outline-offset: 2px; }
.eye[aria-pressed="false"] { opacity: 0.85; }
`;

const ICONS: Record<OverlayItem['status'], string> = {
  unseen: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="#ffffff"/></svg>',
  partly: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke="#ffffff" stroke-width="1.5"/><path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="#ffffff"/></svg>',
  seen: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3L9.5 3.8" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
/** The ring that fills while the sensor counts an element; `elapsed` ms of the dwell are already done. */
const ring = (elapsed: number) =>
  `<svg data-cs-ring width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#8aa6ec" stroke-width="2"/>` +
  `<circle class="ring-fill" cx="6" cy="6" r="4.5" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" transform="rotate(-90 6 6)" style="animation-delay:-${Math.round(elapsed)}ms"/></svg>`;

/** Icon width + gap + horizontal padding, added to the measured text width. */
const LABEL_CHROME = 12 + 6 + 16;

const EYE_OPEN =
  '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const EYE_CLOSED =
  '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 15L15 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

export interface OverlayLayer {
  /** Re-measure on the next frame (e.g. after HMR). */
  refresh(): void;
  /** The sensor started (true) or stopped (false) counting this element. */
  setDwell(el: Element, active: boolean): void;
  setVisible(visible: boolean): void;
  stop(): void;
}

function readVisible(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeVisible(visible: boolean): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, visible ? 'on' : 'off');
  } catch {
    // storage blocked: the toggle still works for this page load
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function startOverlayLayer(): OverlayLayer {
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'position: fixed; inset: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483647; display: block;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style><div class="layer"></div><button type="button" class="eye"></button>`;
  const layer = root.querySelector('.layer') as HTMLDivElement;
  const eye = root.querySelector('.eye') as HTMLButtonElement;

  let items: OverlayItem[] = [];
  /** Elements the sensor is counting right now -> when it started (performance.now()). */
  const dwelling = new Map<Element, number>();
  /** Last status VS Code sent per loc, to spot the switch to "seen". */
  let lastStatus: Map<string, OverlayItem['status']> | undefined;
  /** loc -> when its flash ends. */
  const flashing = new Map<string, number>();
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let visible = readVisible();
  let frame = 0;
  /** Drawn nodes by key ("loc\n<instance>"), reused across frames. */
  const outlines = new Map<string, HTMLDivElement>();
  const labels = new Map<string, HTMLDivElement>();
  const labelTexts = new Map<string, string>();
  const observed = new Set<Element>();
  const widths = new Map<string, number>();
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) ctx.font = FONT;

  const measureText = (text: string): number => {
    let w = widths.get(text);
    if (w === undefined) {
      w = Math.ceil((ctx ? ctx.measureText(text).width : text.length * 7.3) + LABEL_CHROME + 2);
      widths.set(text, w);
    }
    return w;
  };

  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };

  const resizeObserver = new ResizeObserver(schedule);

  const renderEye = () => {
    eye.setAttribute('aria-pressed', String(visible));
    eye.setAttribute('aria-label', visible ? 'Hide outlines' : 'Show outlines');
    eye.title = `${visible ? 'Hide' : 'Show'} Change Spotlight outlines (Alt+Shift+S)`;
    eye.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
  };

  const setVisible = (next: boolean) => {
    visible = next;
    writeVisible(next);
    renderEye();
    schedule();
  };

  const prune = <T extends Element>(nodes: Map<string, T>, keep: Set<string>) => {
    for (const [key, node] of nodes) {
      if (keep.has(key)) continue;
      node.remove();
      nodes.delete(key);
      labelTexts.delete(key);
    }
  };

  function draw(): void {
    frame = 0;
    if (!host.isConnected && document.body) document.body.append(host);

    // Read: find and measure every changed element on the page.
    const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight };
    const byLoc = new Map(items.map((item) => [item.loc, item]));
    const boxes: { key: string; item: OverlayItem; rect: Rect; labelled: boolean; counting: boolean }[] = [];
    /** Locs with at least one instance being counted (its label shows the ring). */
    const countingLocs = new Map<string, number>();
    const elements = new Set<Element>();
    if (visible && byLoc.size > 0) {
      const instances = new Map<string, number>();
      for (const el of document.querySelectorAll(`[${ATTR}]`)) {
        const item = byLoc.get(el.getAttribute(ATTR) ?? '');
        if (!item) continue;
        elements.add(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const n = instances.get(item.loc) ?? 0;
        instances.set(item.loc, n + 1);
        const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
        if (!inViewport(rect, viewport, OFFSCREEN_MARGIN)) continue;
        // The browser never claims "seen": the ring shows only on what VS Code has not confirmed.
        const dwell = dwelling.get(el);
        const started = isCounting(item.status, dwell) ? dwell : undefined;
        if (started !== undefined) countingLocs.set(item.loc, Math.min(started, countingLocs.get(item.loc) ?? Infinity));
        boxes.push({ key: `${item.loc}\n${n}`, item, rect, labelled: n === 0, counting: started !== undefined });
      }
    }

    for (const el of dwelling.keys()) if (!el.isConnected) dwelling.delete(el);

    // Keep ResizeObserver on exactly the changed elements.
    for (const el of observed) {
      if (elements.has(el)) continue;
      resizeObserver.unobserve(el);
      observed.delete(el);
    }
    for (const el of elements) {
      if (observed.has(el)) continue;
      resizeObserver.observe(el);
      observed.add(el);
    }

    const requests: LabelRequest[] = boxes
      .filter((b) => b.labelled && inViewport(b.rect, viewport))
      .map((b) => ({ key: b.key, box: b.rect, width: measureText(countingLocs.has(b.item.loc) ? COUNTING_TEXT : labelText(b.item)) }));
    const now = performance.now();
    const placed = placeLabels(requests, viewport);

    // Write: update the boxes and labels, reusing nodes.
    const keepOutlines = new Set<string>();
    const keepLabels = new Set<string>();
    for (const b of boxes) {
      keepOutlines.add(b.key);
      let box = outlines.get(b.key);
      if (!box) {
        box = document.createElement('div');
        box.className = 'outline';
        box.setAttribute('data-cs-outline', '');
        outlines.set(b.key, box);
        layer.append(box);
      }
      box.setAttribute('data-loc', b.item.loc);
      box.setAttribute('data-status', b.item.status);
      box.toggleAttribute('data-counting', b.counting);
      box.toggleAttribute('data-flash', flashing.has(b.item.loc));
      box.style.cssText = `left:${b.rect.left}px;top:${b.rect.top}px;width:${b.rect.width}px;height:${b.rect.height}px`;

      const spot = placed.get(b.key);
      if (!spot) continue;
      keepLabels.add(b.key);
      let label = labels.get(b.key);
      if (!label) {
        label = document.createElement('div');
        label.className = 'label';
        label.setAttribute('data-cs-label', '');
        labels.set(b.key, label);
        layer.append(label);
      }
      const started = countingLocs.get(b.item.loc);
      const text = started !== undefined ? COUNTING_TEXT : labelText(b.item);
      // Rebuild only when the content changes, so a running ring animation is not restarted.
      const content = `${started ?? b.item.status}\n${text}`;
      if (labelTexts.get(b.key) !== content) {
        labelTexts.set(b.key, content);
        label.innerHTML = started !== undefined ? ring(ringOffset(started, now)) : ICONS[b.item.status];
        label.append(text);
      }
      label.setAttribute('data-loc', b.item.loc);
      label.setAttribute('data-status', b.item.status);
      label.toggleAttribute('data-counting', started !== undefined);
      label.toggleAttribute('data-flash', flashing.has(b.item.loc));
      label.style.cssText = `left:${spot.left}px;top:${spot.top}px;width:${spot.width}px`;
    }
    prune(outlines, keepOutlines);
    prune(labels, keepLabels);
  }

  // Changes in the app's DOM may move or resize changed elements. Our own nodes live in the shadow
  // root (not observed); only re-adding the host shows up here, and that needs no redraw.
  const mutations = new MutationObserver((records) => {
    if (records.some((r) => r.target !== host && !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n === host)))) schedule();
    else if (!host.isConnected) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [ATTR, 'class', 'style'] });

  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyS') return;
    if (isEditable(event.target)) return;
    event.preventDefault();
    setVisible(!visible);
  };
  eye.addEventListener('click', () => setVisible(!visible));
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('keydown', onKey, true);
  const unsubscribe = onOverlay((overlay: OverlayMessage) => {
    items = overlay.items;
    // Flash what VS Code just confirmed as seen; never on the first overlay after page load.
    const previous = lastStatus;
    lastStatus = new Map(items.map((i) => [i.loc, i.status]));
    const turned = reducedMotion?.matches ? [] : flashLocs(previous, items);
    if (turned.length > 0) {
      const until = performance.now() + FLASH_MS;
      for (const loc of turned) flashing.set(loc, until);
      window.setTimeout(endFlashes, FLASH_MS + 20);
    }
    schedule();
  });
  function endFlashes(): void {
    const now = performance.now();
    for (const [loc, until] of flashing) if (until <= now) flashing.delete(loc);
    schedule();
  }

  renderEye();
  document.body.append(host);
  schedule();

  return {
    refresh: schedule,
    setDwell(el, active) {
      if (active) dwelling.set(el, performance.now());
      else dwelling.delete(el);
      schedule();
    },
    setVisible,
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      unsubscribe();
      mutations.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      window.removeEventListener('keydown', onKey, true);
      host.remove();
    },
  };
}
