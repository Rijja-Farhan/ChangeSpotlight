// Finding what is left, in headless Chrome: edge arrows, the pill and the panel on a two-page app
// (static HTML mirroring the playground). A fake extension sends the overlay.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, type OverlayItem, type OverlayMessage } from '@change-spotlight/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import changeSpotlight from '../../src/index.js';
import { connectClient, type TestClient } from '../helpers/bridgeClient.js';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';
const here = path.dirname(fileURLToPath(import.meta.url));

const HEADER = 'src/components/Header.tsx:6-6';
const FEATURES = 'src/components/FeatureList.tsx:4-4';
const COUNTER = 'src/components/Counter.tsx:8-10';
const FOOTER = 'src/App.tsx:12-14';
const TEAM = 'src/components/Team.tsx:6-6';
const MODAL = 'src/components/Modal.tsx:14-14';
const MARKED = 'src/components/Marked.tsx:2-2';

const item = (loc: string, status: OverlayItem['status'], pages: string[]): OverlayItem => {
  const [start] = loc.slice(loc.lastIndexOf(':') + 1).split('-');
  return { loc, path: loc.slice(0, loc.lastIndexOf(':')), line: Number(start), endLine: Number(start), status, seenHunks: status === 'seen' ? 1 : 0, hunkIds: ['h#1'], preview: '', pages };
};
const OVERLAY: OverlayMessage = {
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature/pricing',
  totals: { seen: 2, total: 7, untrackable: 1 },
  items: [
    item(HEADER, 'seen', ['/', '/about.html']),
    item(FEATURES, 'unseen', []),
    item(COUNTER, 'partly', ['/']),
    item(FOOTER, 'unseen', []),
    item(TEAM, 'unseen', ['/about.html']),
    item(MODAL, 'unseen', []),
    item(MARKED, 'seen', []),
  ],
  pages: ['/', '/about.html'],
  unplaced: [FEATURES, FOOTER, MODAL, MARKED],
};

const inRoot = <T>(page: Page, fn: string) =>
  page.evaluate(`(() => { const root = document.querySelector('change-spotlight-overlay').shadowRoot; ${fn} })()`) as Promise<T>;

/** Visible arrows and their texts. */
const arrows = (page: Page) =>
  inRoot<Record<string, string>>(page, `return Object.fromEntries([...root.querySelectorAll('[data-cs-arrow]')].filter((a) => !a.hidden).map((a) => [a.dataset.csArrow, a.textContent]));`);

/** Each section's heading and rows (loc + text of the location part + action). */
const panel = (page: Page) =>
  inRoot<Record<string, { heading: string; rows: [string, string, string][] }>>(
    page,
    `return Object.fromEntries([...root.querySelectorAll('[data-cs-section]')].map((s) => [s.dataset.csSection, {
      heading: s.querySelector('h3').textContent,
      rows: [...s.querySelectorAll('[data-cs-row]')].map((r) => [r.dataset.loc, r.querySelector('.where').textContent.replace(/ \\((not seen yet|partly seen|seen)\\)/, ''), r.querySelector('.action, .hint').textContent]),
    }]));`,
  );

const inView = (page: Page, loc: string) =>
  page.evaluate((l) => {
    const r = document.querySelector(`[data-cs-loc="${CSS.escape(l)}"]`)!.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  }, loc);

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
}
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

describe.skipIf(!existsSync(chrome))('finding what is left in headless Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let client: TestClient;
  let base: string;

  const open = async (pathname = '/') => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(new URL(pathname, base).href);
    await waitFor(async () => (await inRoot<boolean>(page, `return !root.querySelector('[data-cs-open-panel]').hidden;`)) === true);
    return page;
  };
  const openPanel = async (page: Page) => {
    await inRoot(page, `root.querySelector('[data-cs-open-panel]').click();`);
    await frames(page);
  };

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const cs = changeSpotlight();
    server = await createServer({ root: path.join(here, 'fixture-pages'), configFile: false, plugins: [cs], logLevel: 'silent', server: { port: 0 } });
    await server.listen();
    base = server.resolvedUrls!.local[0]!;
    const info = await cs.api!.bridgeInfo();
    client = await connectClient(info!.port, info!.token);
    client.ws.send(JSON.stringify(OVERLAY));
    await new Promise((r) => setTimeout(r, 200));
  });
  afterAll(async () => {
    client?.close();
    await browser?.close();
    await server?.close();
  });

  it('counts unseen changes above and below while scrolling, never seen ones', async () => {
    const page = await open();
    await frames(page);
    expect(await arrows(page)).toEqual({ below: '2 unseen changes below' });

    await page.evaluate((l) => document.querySelector(`[data-cs-loc="${CSS.escape(l)}"]`)!.scrollIntoView({ block: 'center' }), COUNTER);
    await frames(page);
    expect(await arrows(page)).toEqual({ above: '1 unseen change above', below: '1 unseen change below' });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await frames(page);
    expect(await arrows(page)).toEqual({ above: '2 unseen changes above' }); // the seen Header is not counted
    await page.close();
  });

  it('scrolls to the nearest unseen change when an arrow is clicked', async () => {
    const page = await open();
    await frames(page);
    await inRoot(page, `root.querySelector('[data-cs-arrow="below"]').click();`);
    await waitFor(() => inView(page, COUNTER));
    expect(await inView(page, FOOTER)).toBe(false);
    await page.close();
  });

  it('shows the pill and opens and closes the panel', async () => {
    const page = await open();
    expect(await inRoot(page, `return root.querySelector('[data-cs-open-panel]').textContent;`)).toBe('Seen 2 of 7 · 5 to look at');
    expect(await inRoot(page, `return root.querySelector('[data-cs-pill] button.eye') !== null;`)).toBe(true);
    await openPanel(page);
    expect(await inRoot(page, `return [root.querySelector('[data-cs-open-panel]').getAttribute('aria-expanded'), root.querySelector('[data-cs-panel]').hidden];`)).toEqual(['true', false]);
    expect(await inRoot(page, `return root.querySelector('[data-cs-panel] .summary').textContent;`)).toBe('Seen 2 of 7 changes on branch feature/pricing');

    await page.keyboard.press('Escape');
    await frames(page);
    expect(await inRoot(page, `return [root.querySelector('[data-cs-panel]').hidden, root.activeElement?.hasAttribute('data-cs-open-panel')];`)).toEqual([true, true]);
    await page.close();
  });

  it('lists what is left on the home page, and scrolls to a row', async () => {
    const page = await open();
    await openPanel(page);
    expect(await panel(page)).toEqual({
      this: {
        heading: 'On this page · 3 left',
        rows: [
          [FEATURES, 'FeatureList.tsx:4', 'Scroll to'],
          [COUNTER, 'Counter.tsx:8 (below the fold)', 'Scroll to'],
          [FOOTER, 'App.tsx:12 (below the fold)', 'Scroll to'],
          [HEADER, 'Header.tsx:6', 'Scroll to'],
        ],
      },
      other: { heading: 'On other pages', rows: [[TEAM, 'Team.tsx:6 on /about.html', 'Open page']] },
      none: { heading: 'Not on any page yet', rows: [[MODAL, 'Modal.tsx:14', 'not shown on this page yet: open the part of the app that renders it']] },
    });

    await inRoot(page, `root.querySelector('[data-cs-row][data-loc="${FOOTER}"] .action').click();`);
    await waitFor(() => inView(page, FOOTER));
    expect(await inRoot(page, `return root.querySelector('[data-cs-panel]').hidden;`)).toBe(false); // stays open
    await page.close();
  });

  it('opens another page from the panel and lists that page there', async () => {
    const page = await open();
    await openPanel(page);
    await Promise.all([page.waitForURL(/about\.html$/), inRoot(page, `root.querySelector('[data-cs-row][data-loc="${TEAM}"] .action').click();`)]);
    await waitFor(async () => (await inRoot<boolean>(page, `return !root.querySelector('[data-cs-open-panel]').hidden;`)) === true);
    expect(await inRoot(page, `return root.querySelector('[data-cs-panel]').hidden;`)).toBe(true); // starts closed
    await openPanel(page);
    expect(await panel(page)).toEqual({
      this: { heading: 'On this page · 1 left', rows: [[TEAM, 'Team.tsx:6', 'Scroll to'], [HEADER, 'Header.tsx:6', 'Scroll to']] },
      other: { heading: 'On other pages', rows: [[COUNTER, 'Counter.tsx:8 on /', 'Open page']] },
      none: {
        heading: 'Not on any page yet',
        rows: [
          [FEATURES, 'FeatureList.tsx:4', 'not shown on this page yet: open the part of the app that renders it'],
          [FOOTER, 'App.tsx:12', 'not shown on this page yet: open the part of the app that renders it'],
          [MODAL, 'Modal.tsx:14', 'not shown on this page yet: open the part of the app that renders it'],
        ],
      },
    });
    await page.close();
  });

  it('hides seen outlines and all outlines from the checkboxes, per tab across reloads', async () => {
    const page = await open();
    await frames(page);
    const outlines = () => inRoot<string[]>(page, `return [...root.querySelectorAll('[data-cs-outline]')].map((o) => o.dataset.loc);`);
    expect(await outlines()).toContain(HEADER);

    await openPanel(page);
    await inRoot(page, `root.querySelector('[data-cs-check="hide-seen"]').click();`);
    await frames(page);
    expect(await outlines()).not.toContain(HEADER);
    expect(await outlines()).toContain(FEATURES);

    await page.reload();
    await waitFor(async () => (await outlines()).includes(FEATURES));
    expect(await outlines()).not.toContain(HEADER);
    await openPanel(page);
    expect(await inRoot(page, `return root.querySelector('[data-cs-check="hide-seen"]').checked;`)).toBe(true);

    await inRoot(page, `root.querySelector('[data-cs-check="outlines"]').click();`);
    await frames(page);
    expect(await outlines()).toEqual([]);
    expect(await arrows(page)).toEqual({}); // arrows follow the outlines
    expect(await inRoot(page, `return root.querySelector('button.eye').getAttribute('aria-pressed');`)).toBe('false');
    await page.keyboard.press('Alt+Shift+KeyS');
    await frames(page);
    expect(await inRoot(page, `return root.querySelector('[data-cs-check="outlines"]').checked;`)).toBe(true);
    await page.close();
  });
});
