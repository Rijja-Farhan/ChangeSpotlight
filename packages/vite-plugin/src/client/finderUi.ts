/// <reference lib="dom" />
// The overlay's "finding what is left" controls: edge arrows, the pill (Seen X of Y, eye button)
// and the panel. Only DOM writes and event wiring; overlayLayer.ts measures the page in its rAF
// pass and calls update() with what finder.ts worked out.
import type { OverlayMessage } from '@change-spotlight/core';
import { arrowText, DIRECTIONS, NOWHERE_HINT, pillText, rowNote, type Direction, type Row, type Sections } from './finder.js';
import { fileLine } from './outlines.js';

export const HIDE_SEEN_KEY = 'change-spotlight:hide-seen';

export const FINDER_STYLE = `
button, a { font: inherit; }
.arrow { position: fixed; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border: 0; border-radius: 20px; margin: 0;
  background: #b45309; color: #ffffff; font: 500 14px system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); pointer-events: auto; }
.arrow[hidden] { display: none; }
.arrow:hover { background: #8a4508; }
.arrow[data-cs-arrow="above"] { top: 20px; left: 50%; transform: translateX(-50%); }
.arrow[data-cs-arrow="below"] { bottom: 20px; left: 50%; transform: translateX(-50%); }
.arrow[data-cs-arrow="left"] { left: 20px; top: 50%; transform: translateY(-50%); }
.arrow[data-cs-arrow="right"] { right: 20px; top: 50%; transform: translateY(-50%); }
.pill { position: fixed; right: 20px; bottom: 20px; display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 24px;
  background: #1d1c1a; color: #f6f5f2; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25); pointer-events: auto;
  font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; }
.open { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 14px; border: 0; border-radius: 20px; margin: 0;
  background: transparent; color: #f6f5f2; font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; white-space: nowrap; }
.open[hidden] { display: none; }
.open:hover { background: #34322e; }
.open b { font-weight: 600; }
.pill .eye { position: static; box-shadow: none; background: #34322e; }
.pill .eye:hover { background: #4a4741; }
.panel { position: fixed; right: 20px; bottom: 76px; width: 380px; max-width: calc(100vw - 40px); max-height: calc(100vh - 120px); overflow: auto;
  box-sizing: border-box; border-radius: 14px; background: #1d1c1a; color: #f6f5f2; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
  pointer-events: auto; font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; }
.panel[hidden] { display: none; }
.head { padding: 18px 18px 14px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid #34322e; }
.title { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; }
.close { width: 32px; height: 32px; border: 0; border-radius: 16px; padding: 0; background: #34322e; color: #f6f5f2; display: flex;
  align-items: center; justify-content: center; cursor: pointer; }
.summary { font-size: 13px; color: #c9c5bc; }
.summary .branch { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #f6f5f2; }
.bar { height: 6px; border-radius: 3px; background: #34322e; overflow: hidden; }
.bar > div { height: 100%; background: #4ade80; }
.heading { padding: 14px 18px 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #a8a49b; margin: 0; }
.row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 18px; }
.row .where { flex: 1; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.row .note { color: #a8a49b; }
.row .action { flex: none; min-height: 32px; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: #fbbf72;
  font-size: 13px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.row .action:hover { background: #34322e; }
.row .hint { flex: none; max-width: 150px; font-size: 12px; color: #a8a49b; text-align: right; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.empty { padding: 14px 18px; color: #c9c5bc; font-size: 13px; }
.foot { margin-top: 8px; padding: 12px 18px 16px; border-top: 1px solid #34322e; display: flex; flex-direction: column; gap: 10px; }
.foot label { display: flex; align-items: center; gap: 10px; min-height: 32px; font-size: 13px; color: #d8d5ce; cursor: pointer; }
.foot input { width: 16px; height: 16px; margin: 0; accent-color: #f59e0b; }
.foot .keys { font-size: 12px; color: #a8a49b; }
.foot kbd { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #d8d5ce; }
.arrow:focus-visible, .open:focus-visible, .close:focus-visible, .action:focus-visible, .foot input:focus-visible { outline: 2px solid #fbbf72; outline-offset: 2px; }
`;

const ARROW_ICONS: Record<Direction, string> = {
  above: 'M7 12V3M3 6.5L7 2.5 11 6.5',
  below: 'M7 2v9M3 7.5L7 11.5 11 7.5',
  left: 'M12 7H3M6.5 3L2.5 7 6.5 11',
  right: 'M2 7h9M7.5 3L11.5 7 7.5 11',
};
const arrowIcon = (d: Direction) =>
  `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="${ARROW_ICONS[d]}" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="#f6f5f2" stroke-width="1.6" stroke-linecap="round"/></svg>';
const DOTS = {
  unseen: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#f59e0b"/></svg>',
  partly: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="#f59e0b" stroke-width="1.5"/><path d="M6 2a4 4 0 0 1 0 8z" fill="#f59e0b"/></svg>',
  seen: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#4ade80"/></svg>',
  nowhere: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="#a8a49b" stroke-width="1.5"/></svg>',
};
const STATUS_WORDS = { unseen: 'not seen yet', partly: 'partly seen', seen: 'seen' } as const;

/** Progress ring for the pill; `fraction` 0..1. */
function progressRing(fraction: number): string {
  const c = 2 * Math.PI * 7;
  return (
    `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="#5c5a55" stroke-width="2.5"/>` +
    `<circle cx="9" cy="9" r="7" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(c * fraction).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 9 9)"/></svg>`
  );
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface FinderState {
  overlay: OverlayMessage | undefined;
  counts: Record<Direction, number>;
  sections: Sections;
  /** Outlines shown (the eye / Alt+Shift+S). Arrows show only then. */
  visible: boolean;
  hideSeen: boolean;
}

export interface FinderCallbacks {
  scrollTo(loc: string): void;
  scrollToward(direction: Direction): void;
  setVisible(visible: boolean): void;
  setHideSeen(hide: boolean): void;
}

export interface FinderUi {
  update(state: FinderState): void;
  panelOpen(): boolean;
}

/** Builds the controls inside `root`; `eye` (the existing toggle) moves into the pill. */
export function createFinderUi(root: ShadowRoot, eye: HTMLButtonElement, callbacks: FinderCallbacks): FinderUi {
  const arrows = new Map<Direction, HTMLButtonElement>();
  for (const d of DIRECTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'arrow';
    button.setAttribute('data-cs-arrow', d);
    button.hidden = true;
    button.addEventListener('click', () => callbacks.scrollToward(d));
    arrows.set(d, button);
    root.append(button);
  }

  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.setAttribute('data-cs-pill', '');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'open';
  open.hidden = true;
  open.setAttribute('data-cs-open-panel', '');
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', 'cs-panel');
  pill.append(open, eye);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'cs-panel';
  panel.hidden = true;
  panel.setAttribute('data-cs-panel', '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Change Spotlight');
  panel.innerHTML = `
    <div class="head">
      <div class="title"><span>Change Spotlight</span><button type="button" class="close" aria-label="Close panel">${CLOSE_ICON}</button></div>
      <div class="summary"></div>
      <div class="bar" aria-hidden="true"><div></div></div>
    </div>
    <div class="sections"></div>
    <div class="foot">
      <label><input type="checkbox" data-cs-check="outlines"> Show outlines on the page</label>
      <label><input type="checkbox" data-cs-check="hide-seen"> Hide outlines of seen changes</label>
      <div class="keys">Toggle the overlay anytime with <kbd>Alt + Shift + S</kbd></div>
    </div>`;
  root.append(panel, pill);

  const summary = panel.querySelector('.summary') as HTMLDivElement;
  const bar = panel.querySelector('.bar > div') as HTMLDivElement;
  const sectionsEl = panel.querySelector('.sections') as HTMLDivElement;
  const outlinesBox = panel.querySelector('[data-cs-check="outlines"]') as HTMLInputElement;
  const hideSeenBox = panel.querySelector('[data-cs-check="hide-seen"]') as HTMLInputElement;
  let sectionsHtml = '';
  let openHtml = '';

  const setOpen = (next: boolean, focus: boolean) => {
    panel.hidden = !next;
    open.setAttribute('aria-expanded', String(next));
    if (next && focus) (panel.querySelector('.close') as HTMLButtonElement).focus();
    if (!next && focus) open.focus();
  };
  open.addEventListener('click', () => {
    const next = panel.hidden !== false;
    setOpen(next, next);
  });
  panel.querySelector('.close')!.addEventListener('click', () => setOpen(false, true));
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false, true);
  });
  outlinesBox.addEventListener('change', () => callbacks.setVisible(outlinesBox.checked));
  hideSeenBox.addEventListener('change', () => callbacks.setHideSeen(hideSeenBox.checked));
  sectionsEl.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button[data-scroll]');
    if (button) callbacks.scrollTo(button.getAttribute('data-scroll')!);
  });

  const row = (r: Row, kind: 'this' | 'other' | 'none') => {
    const where = escapeHtml(fileLine(r.item));
    const note = escapeHtml(rowNote(r));
    const loc = escapeHtml(r.item.loc);
    const status = STATUS_WORDS[r.item.status];
    const action =
      kind === 'this'
        ? `<button type="button" class="action" data-scroll="${loc}" aria-label="Scroll to ${where}">Scroll to</button>`
        : kind === 'other'
          ? `<a class="action" href="${escapeHtml(r.page!)}" aria-label="Open ${escapeHtml(r.page!)} to see ${where}">Open page</a>`
          : `<span class="hint">${escapeHtml(NOWHERE_HINT)}</span>`;
    const dot = kind === 'none' ? DOTS.nowhere : DOTS[r.item.status];
    return `<div class="row" data-cs-row data-loc="${loc}" data-status="${r.item.status}">${dot}<span class="where">${where}<span class="sr"> (${status})</span>${note ? ` <span class="note">${note}</span>` : ''}</span>${action}</div>`;
  };

  return {
    panelOpen: () => !panel.hidden,
    update({ overlay, counts, sections, visible, hideSeen }) {
      for (const [d, button] of arrows) {
        const n = visible && overlay ? counts[d] : 0;
        button.hidden = n === 0;
        if (n > 0) {
          const html = `${arrowIcon(d)}<span>${arrowText(n, d)}</span>`;
          if (button.innerHTML !== html) button.innerHTML = html;
        }
      }

      outlinesBox.checked = visible;
      hideSeenBox.checked = hideSeen;
      if (!overlay) {
        open.hidden = true;
        return;
      }
      open.hidden = false;
      const { totals } = overlay;
      const fraction = totals.total === 0 ? 0 : totals.seen / totals.total;
      const [seenPart, rest] = pillText(overlay).split(' · ') as [string, string];
      const nextOpen = `${progressRing(fraction)}<span><b>${seenPart}</b> · ${rest}</span>`;
      if (nextOpen !== openHtml) {
        openHtml = nextOpen;
        open.innerHTML = nextOpen;
      }

      const branch = overlay.branch ? ` on branch <span class="branch">${escapeHtml(overlay.branch)}</span>` : '';
      const nextSummary = `Seen ${totals.seen} of ${totals.total} changes${branch}`;
      if (summary.innerHTML !== nextSummary) summary.innerHTML = nextSummary;
      bar.style.width = `${Math.round(fraction * 100)}%`;

      let html = '';
      if (sections.thisPage.length > 0) {
        html += `<section data-cs-section="this"><h3 class="heading">On this page · ${sections.thisPageLeft} left</h3>${sections.thisPage.map((r) => row(r, 'this')).join('')}</section>`;
      }
      if (sections.otherPages.length > 0) {
        html += `<section data-cs-section="other"><h3 class="heading">On other pages</h3>${sections.otherPages.map((r) => row(r, 'other')).join('')}</section>`;
      }
      if (sections.nowhere.length > 0) {
        html += `<section data-cs-section="none"><h3 class="heading">Not on any page yet</h3>${sections.nowhere.map((r) => row(r, 'none')).join('')}</section>`;
      }
      if (html === '') html = '<div class="empty">Nothing left to look at</div>';
      // Rebuild only when the lists change, and give focus back to the same control afterwards.
      if (html !== sectionsHtml) {
        const focused = root.activeElement;
        const key = focused && sectionsEl.contains(focused) ? (focused.getAttribute('data-scroll') ?? focused.getAttribute('href')) : null;
        sectionsHtml = html;
        sectionsEl.innerHTML = html;
        if (key !== null) {
          const again = [...sectionsEl.querySelectorAll<HTMLElement>('.action')].find((el) => (el.getAttribute('data-scroll') ?? el.getAttribute('href')) === key);
          again?.focus();
        }
      }
    },
  };
}
