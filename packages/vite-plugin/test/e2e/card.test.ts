// Hover card, keyboard access and VS Code overlay settings in headless Chrome, on the two-page
// fixture. A fake extension sends overlays and receives open / mark requests.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, type OverlayItem, type OverlayMessage, type OverlaySettings } from '@change-spotlight/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import changeSpotlight from '../../src/index.js';
import { connectClient, type TestClient } from '../helpers/bridgeClient.js';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';
const here = path.dirname(fileURLToPath(import.meta.url));

const HEADER = 'src/components/Header.tsx:6-6';
const FEATURES = 'src/components/FeatureList.tsx:4-4';
const COUNTER = 'src/components/Counter.tsx:8-10';

const item = (loc: string, status: OverlayItem['status'], extra: Partial<OverlayItem> = {}): OverlayItem => {
  const start = Number(loc.slice(loc.lastIndexOf(':') + 1).split('-')[0]);
  return { loc, path: loc.slice(0, loc.lastIndexOf(':')), line: start, endLine: start, status, seenHunks: status === 'seen' ? 1 : 0, hunkIds: [`${loc}#1`], preview: '', pages: [], ...extra };
};
const overlay = (features: OverlayItem['status'] = 'unseen', settings?: OverlaySettings): OverlayMessage => ({
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature',
  totals: { seen: features === 'seen' ? 2 : 1, total: 3, untrackable: 0 },
  items: [
    item(HEADER, 'seen', { pages: ['/'] }),
    item(FEATURES, features, { preview: '<h2 id="features">Features</h2>' }),
    item(COUNTER, 'unseen', { line: 8, endLine: 10, preview: 'onClick={() => setCount((c) => c + 1)}' }),
  ],
  pages: ['/'],
  unplaced: [FEATURES, COUNTER],
  ...(settings ? { settings } : {}),
});

const ov = 'change-spotlight-overlay';
const label = (loc: string) => `${ov} [data-cs-label][data-loc="${loc}"]`;
const card = `${ov} [data-cs-card]`;
const inRoot = <T>(page: Page, body: string) =>
  page.evaluate(`(() => { const root = document.querySelector('${ov}').shadowRoot; ${body} })()`) as Promise<T>;
const activeIn = (page: Page) => inRoot<string | null>(page, `const a = root.activeElement; return a ? (a.dataset.csAction ?? a.dataset.csLabel ?? a.className) : null;`);
const outlineLocs = (page: Page) => inRoot<string[]>(page, `return [...root.querySelectorAll('[data-cs-outline]')].map((o) => o.dataset.loc);`);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe.skipIf(!existsSync(chrome))('hover card, keyboard and settings in headless Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let client: TestClient;
  let url: string;

  const send = async (message: OverlayMessage) => {
    client.ws.send(JSON.stringify(message));
    await new Promise((r) => setTimeout(r, 100));
  };
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(url);
    await waitFor(async () => (await inRoot<boolean>(page, `return !root.querySelector('[data-cs-open-panel]').hidden;`)) === true);
    // Wait until the sensor's first count is over, so labels show their normal text.
    await page.waitForTimeout(400);
    await waitFor(async () => (await inRoot<number>(page, `return root.querySelectorAll('[data-counting]').length;`)) === 0);
    return page;
  };

  /** Scroll an element into view and wait until the sensor has finished counting it. */
  const reveal = async (page: Page, loc: string) => {
    await page.evaluate((l) => document.querySelector(`[data-cs-loc="${CSS.escape(l)}"]`)!.scrollIntoView({ block: 'center' }), loc);
    await page.waitForTimeout(400);
    await waitFor(async () => (await inRoot<number>(page, `return root.querySelectorAll('[data-counting]').length;`)) === 0);
  };

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const cs = changeSpotlight();
    server = await createServer({ root: path.join(here, 'fixture-pages'), configFile: false, plugins: [cs], logLevel: 'silent', server: { port: 0 } });
    await server.listen();
    url = server.resolvedUrls!.local[0]!;
    const info = await cs.api!.bridgeInfo();
    client = await connectClient(info!.port, info!.token);
  });
  beforeEach(async () => {
    await send(overlay());
    client.messages.length = 0;
  });
  afterAll(async () => {
    client?.close();
    await browser?.close();
    await server?.close();
  });

  it('opens the card on hover with the changed lines, and closes it when the pointer leaves', async () => {
    const page = await open();
    await reveal(page, COUNTER);
    await page.hover(label(COUNTER));
    await page.waitForSelector(`${card}:not([hidden])`);
    expect(await page.textContent(`${card} .lines`)).toBe('Counter.tsx · lines 8–10');
    expect(await page.textContent(`${card} pre`)).toBe('+ onClick={() => setCount((c) => c + 1)}');
    expect(await page.isVisible(`${card} [data-cs-action="mark"]`)).toBe(true);
    expect(await page.getAttribute(card, 'role')).toBe('dialog');

    await page.hover(`${card} .lines`); // moving onto the card keeps it open
    await page.waitForTimeout(400);
    expect(await page.isVisible(card)).toBe(true);
    await page.mouse.move(450, 690);
    await page.waitForSelector(`${card}[hidden]`, { state: 'attached' });
    await page.close();
  });

  it('sends Open in VS Code and Mark as seen, and follows VS Code confirming the mark', async () => {
    const page = await open();
    await page.hover(label(FEATURES));
    await page.click(`${card} [data-cs-action="open"]`);
    await waitFor(() => client.messages.some((m) => m.type === 'open'));
    expect(client.messages.find((m) => m.type === 'open')).toEqual({ protocolVersion: PROTOCOL_VERSION, type: 'open', path: 'src/components/FeatureList.tsx', line: 4 });

    await page.click(`${card} [data-cs-action="mark"]`);
    await waitFor(() => client.messages.some((m) => m.type === 'mark'));
    expect(client.messages.find((m) => m.type === 'mark')).toMatchObject({ hunkIds: [`${FEATURES}#1`] });
    // The browser does not turn it green by itself...
    await frames(page);
    expect(await page.getAttribute(label(FEATURES), 'data-status')).toBe('unseen');
    // ...only when VS Code says so.
    await send(overlay('seen'));
    await waitFor(async () => (await page.getAttribute(label(FEATURES), 'data-status')) === 'seen');
    expect(await page.textContent(`${card} .status`)).toBe('Seen · 1 change');
    expect(await page.isVisible(`${card} [data-cs-action="mark"]`)).toBe(false);
    await page.close();
  });

  it('works from the keyboard: focus opens the card, Tab reaches its buttons, Escape returns to the label', async () => {
    const page = await open();
    await reveal(page, COUNTER);
    await page.focus(label(COUNTER));
    await page.waitForSelector(`${card}:not([hidden])`);
    await page.keyboard.press('Tab');
    expect(await activeIn(page)).toBe('open');
    await page.keyboard.press('Tab');
    expect(await activeIn(page)).toBe('mark');
    await page.keyboard.press('Escape');
    await page.waitForSelector(`${card}[hidden]`, { state: 'attached' });
    expect(await page.evaluate(`document.querySelector('${ov}').shadowRoot.activeElement.dataset.loc`)).toBe(COUNTER);
    await page.close();
  });

  it('makes every control a native, focusable element with a visible focus ring', async () => {
    const page = await open();
    await page.click(`${ov} [data-cs-open-panel]`);
    await frames(page);
    const controls = await inRoot<{ tag: string; ring: string }[]>(
      page,
      `return [...root.querySelectorAll('button:not([hidden]), a[href], input')].filter((el) => el.getClientRects().length > 0).map((el) => ({ tag: el.tagName }));`,
    );
    expect(controls.length).toBeGreaterThan(8);
    for (const c of controls) expect(['BUTTON', 'A', 'INPUT']).toContain(c.tag);
    expect(await inRoot<number>(page, `return root.querySelectorAll('[tabindex], [onclick], [role="button"]').length;`)).toBe(0);

    // Tab through the panel and check the ring on each stop.
    await page.focus(`${ov} [data-cs-panel] .close`);
    const rings: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
      const ring = await inRoot<string | null>(page, `const a = root.activeElement; if (!a) return null; const s = getComputedStyle(a); return s.outlineStyle + ' ' + s.outlineColor;`);
      if (ring === null) break; // left the overlay
      rings.push(ring);
    }
    expect(rings.length).toBeGreaterThanOrEqual(6);
    for (const ring of rings) expect(ring).toBe('solid rgb(251, 191, 114)');
    await page.close();
  });

  it('follows the VS Code settings until the tab makes its own choice', async () => {
    await send(overlay('unseen', { showByDefault: false, hideSeen: false }));
    const page = await open();
    expect(await outlineLocs(page)).toEqual([]);
    expect(await page.getAttribute(`${ov} button.eye`, 'aria-pressed')).toBe('false');
    expect(await page.isVisible(`${ov} [data-cs-pill]`)).toBe(true);

    // A live settings change applies while the tab has no choice of its own.
    await send(overlay('unseen', { showByDefault: true, hideSeen: true }));
    await waitFor(async () => (await outlineLocs(page)).includes(FEATURES));
    expect(await outlineLocs(page)).not.toContain(HEADER); // hide seen

    // The tab's own choice wins over the settings, also after a reload.
    await page.click(`${ov} button.eye`);
    await waitFor(async () => (await outlineLocs(page)).length === 0);
    await page.reload();
    await waitFor(async () => (await inRoot<boolean>(page, `return !root.querySelector('[data-cs-open-panel]').hidden;`)) === true);
    await frames(page);
    expect(await outlineLocs(page)).toEqual([]);
    await page.close();
  });
});
