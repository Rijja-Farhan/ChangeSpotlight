// Outlines and labels in headless Chrome: a fake extension sends an overlay, the page draws it.
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

const item = (loc: string, status: OverlayItem['status'], line = 1): OverlayItem => ({
  loc,
  path: loc.slice(0, loc.lastIndexOf(':')),
  line,
  endLine: line,
  status,
  seenHunks: status === 'seen' ? 2 : status === 'partly' ? 1 : 0,
  hunkIds: ['h#1', 'h#2'],
  preview: '',
  pages: [],
});

const ITEMS = [
  item('src/Row.tsx:1-1', 'unseen', 1),
  item('src/Row.tsx:2-2', 'seen', 2),
  item('src/Row.tsx:3-3', 'partly', 3),
  item('src/List.tsx:5-5', 'unseen', 5),
  item('src/Grow.tsx:2-4', 'unseen', 2),
  item('src/Scroll.tsx:7-7', 'unseen', 7),
  item('src/Bottom.tsx:3-3', 'unseen', 3),
  item('src/Late.tsx:1-1', 'unseen', 1),
];
const overlay = (items: OverlayItem[]): OverlayMessage => ({
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature',
  totals: { seen: 0, total: items.length, untrackable: 0 },
  items,
  pages: [],
  unplaced: [],
});

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Each element's box next to the boxes of the outlines drawn for its loc, in document order. */
function compare(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('change-spotlight-overlay')!.shadowRoot!;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const pairs: { loc: string; element: Box; outline: Box | null }[] = [];
    const used = new Set<Element>();
    for (const el of document.querySelectorAll('[data-cs-loc]')) {
      const r = rect(el);
      if (r.top + r.height < -200 || r.top > innerHeight + 200) continue;
      const loc = el.getAttribute('data-cs-loc')!;
      const outline = [...root.querySelectorAll(`[data-cs-outline][data-loc="${CSS.escape(loc)}"]`)].find((o) => !used.has(o)) ?? null;
      if (outline) used.add(outline);
      pairs.push({ loc, element: r, outline: outline && rect(outline) });
    }
    return pairs;
  });
}

async function expectAligned(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pairs = await compare(page);
  for (const { loc, element, outline } of pairs) {
    expect(outline, loc).not.toBeNull();
    for (const k of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(outline![k] - element[k]), `${loc} ${k}`).toBeLessThanOrEqual(1);
  }
  return pairs;
}

const count = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector('change-spotlight-overlay')?.shadowRoot?.querySelectorAll(s).length ?? 0, selector);

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!existsSync(chrome))('outlines in headless Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let client: TestClient;
  let url: string;

  const open = async (width = 800, height = 600) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url);
    await waitFor(async () => (await count(page, '[data-cs-outline]')) > 0);
    // Elements on screen are being counted at first (blue "looking…"); wait for their own labels.
    await page.waitForTimeout(400);
    await waitFor(async () => (await count(page, '[data-counting]')) === 0);
    return page;
  };

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const cs = changeSpotlight();
    server = await createServer({ root: path.join(here, 'fixture-outlines'), configFile: false, plugins: [cs], logLevel: 'silent', server: { port: 0 } });
    await server.listen();
    url = server.resolvedUrls!.local[0]!;
    const info = await cs.api!.bridgeInfo();
    client = await connectClient(info!.port, info!.token);
    client.ws.send(JSON.stringify(overlay(ITEMS)));
    await new Promise((r) => setTimeout(r, 200));
  });
  afterAll(async () => {
    client?.close();
    await browser?.close();
    await server?.close();
  });

  it('draws one host with an open shadow root, outlines over each changed element, and restores the host', async () => {
    const page = await open();
    expect(await page.evaluate(() => document.querySelectorAll('change-spotlight-overlay').length)).toBe(1);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('change-spotlight-overlay')!).pointerEvents)).toBe('none');
    await expectAligned(page);

    await page.evaluate(() => document.querySelector('change-spotlight-overlay')!.remove());
    await waitFor(() => page.evaluate(() => document.querySelectorAll('change-spotlight-overlay').length === 1));
    await page.close();
  });

  it('follows window scroll, inner scroll, viewport resize and element resize', async () => {
    const page = await open();
    await page.evaluate(() => window.scrollBy(0, 150));
    await expectAligned(page);
    await page.evaluate(() => (document.getElementById('scroller')!.scrollTop = 120));
    const pairs = await expectAligned(page);
    expect(pairs.some((p) => p.loc === 'src/Scroll.tsx:7-7')).toBe(true);
    await page.setViewportSize({ width: 500, height: 400 });
    await expectAligned(page);
    await page.evaluate(() => (document.getElementById('grow')!.style.width = '320px'));
    const grown = await expectAligned(page);
    expect(grown.find((p) => p.loc === 'src/Grow.tsx:2-4')?.outline?.width).toBeCloseTo(320, 0);
    await page.close();
  });

  it('outlines an element mounted later', async () => {
    const page = await open();
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('data-cs-loc', 'src/Late.tsx:1-1');
      el.style.cssText = 'height: 40px; margin: 20px';
      document.body.prepend(el);
    });
    await waitFor(async () => (await count(page, '[data-cs-outline][data-loc="src/Late.tsx:1-1"]')) === 1);
    await expectAligned(page);
    await page.close();
  });

  it('outlines every instance of a shared loc but labels only the first', async () => {
    const page = await open();
    expect(await count(page, '[data-cs-outline][data-loc="src/List.tsx:5-5"]')).toBe(3);
    expect(await count(page, '[data-cs-label][data-loc="src/List.tsx:5-5"]')).toBe(1);
    await page.close();
  });

  it('styles outlines and labels by status, and labels never overlap', async () => {
    const page = await open();
    const labels = await page.evaluate(() => {
      const root = document.querySelector('change-spotlight-overlay')!.shadowRoot!;
      return [...root.querySelectorAll('[data-cs-label]')].map((l) => {
        const r = l.getBoundingClientRect();
        const outline = root.querySelector(`[data-cs-outline][data-loc="${CSS.escape(l.getAttribute('data-loc')!)}"]`)!;
        const o = getComputedStyle(outline);
        return {
          loc: l.getAttribute('data-loc'),
          text: l.textContent,
          bg: getComputedStyle(l).backgroundColor,
          outline: `${o.outlineStyle} ${o.outlineColor}`,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        };
      });
    });
    const by = (loc: string) => labels.find((l) => l.loc === loc)!;
    expect(by('src/Row.tsx:1-1')).toMatchObject({ text: 'not seen yet · Row.tsx:1', bg: 'rgb(180, 83, 9)', outline: 'dashed rgb(180, 83, 9)' });
    expect(by('src/Row.tsx:2-2')).toMatchObject({ text: 'seen · Row.tsx:2', bg: 'rgb(21, 128, 61)', outline: 'solid rgb(21, 128, 61)' });
    expect(by('src/Row.tsx:3-3')).toMatchObject({ text: '1/2 · Row.tsx:3', bg: 'rgb(180, 83, 9)', outline: 'dashed rgb(180, 83, 9)' });
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!.rect;
        const b = labels[j]!.rect;
        const hit = a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
        expect(hit, `${labels[i]!.loc} vs ${labels[j]!.loc}`).toBe(false);
      }
    }
    await page.close();
  });

  it('toggles with Alt+Shift+S and the eye button, remembered per tab', async () => {
    const page = await open();
    await page.keyboard.press('Alt+Shift+KeyS');
    await waitFor(async () => (await count(page, '[data-cs-outline]')) === 0);
    expect(await count(page, 'button.eye[aria-pressed="false"]')).toBe(1);

    await page.reload();
    await page.waitForTimeout(500);
    expect(await count(page, '[data-cs-outline]')).toBe(0); // still off after a reload

    await page.evaluate(() => (document.querySelector('change-spotlight-overlay')!.shadowRoot!.querySelector('button.eye') as HTMLButtonElement).click());
    await waitFor(async () => (await count(page, '[data-cs-outline]')) > 0);
    expect(await count(page, 'button.eye[aria-label="Hide outlines"][aria-pressed="true"]')).toBe(1);

    // Typing in a field does not toggle.
    await page.evaluate(() => {
      const input = document.createElement('input');
      document.body.prepend(input);
      input.focus();
    });
    await page.keyboard.press('Alt+Shift+KeyS');
    await page.waitForTimeout(100);
    expect(await count(page, '[data-cs-outline]')).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Alt+Shift+KeyS');
    await waitFor(async () => (await count(page, '[data-cs-outline]')) === 0);
    const fresh = await open(); // a new tab starts visible
    expect(await count(fresh, '[data-cs-outline]')).toBeGreaterThan(0);
    await fresh.close();
    await page.close();
  });

  it('restyles live when VS Code sends a new overlay', async () => {
    const page = await open();
    expect(await count(page, '[data-cs-outline][data-loc="src/Row.tsx:1-1"][data-status="unseen"]')).toBe(1);
    client.ws.send(JSON.stringify(overlay(ITEMS.map((i) => (i.loc === 'src/Row.tsx:1-1' ? { ...i, status: 'seen' as const, seenHunks: 2 } : i)))));
    await waitFor(async () => (await count(page, '[data-cs-outline][data-loc="src/Row.tsx:1-1"][data-status="seen"]')) === 1);
    expect(await page.evaluate(() => document.querySelector('change-spotlight-overlay')!.shadowRoot!.querySelector('[data-cs-label][data-loc="src/Row.tsx:1-1"]')!.textContent)).toBe('seen · Row.tsx:1');
    client.ws.send(JSON.stringify(overlay(ITEMS)));
    await page.close();
  });
});
