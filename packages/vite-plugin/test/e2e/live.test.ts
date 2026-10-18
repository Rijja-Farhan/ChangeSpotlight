// Live states in headless Chrome: the "being counted" ring while the sensor dwells, and green with
// one flash only after VS Code (here a fake bridge client) confirms.
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

const TOP = 'src/Top.tsx:1-1';
const PASS = 'src/Pass.tsx:2-2';
const TARGET = 'src/Target.tsx:3-3';

const item = (loc: string, status: OverlayItem['status']): OverlayItem => ({
  loc,
  path: loc.slice(0, loc.lastIndexOf(':')),
  line: Number(loc.slice(loc.lastIndexOf(':') + 1).split('-')[0]),
  endLine: 3,
  status,
  seenHunks: status === 'seen' ? 1 : 0,
  hunkIds: ['h#1'],
  preview: '',
  pages: [],
});
const overlay = (target: OverlayItem['status']): OverlayMessage => ({
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature',
  totals: { seen: target === 'seen' ? 2 : 1, total: 3, untrackable: 0 },
  items: [item(TOP, 'seen'), item(PASS, 'unseen'), item(TARGET, target)],
  pages: [],
  unplaced: [],
});

/** Attributes of the outline and label drawn for `loc` (null when none). */
const state = (page: Page, loc: string) =>
  page.evaluate((l) => {
    const root = document.querySelector('change-spotlight-overlay')?.shadowRoot;
    const outline = root?.querySelector(`[data-cs-outline][data-loc="${CSS.escape(l)}"]`);
    const label = root?.querySelector(`[data-cs-label][data-loc="${CSS.escape(l)}"]`);
    return {
      status: outline?.getAttribute('data-status') ?? null,
      counting: outline?.hasAttribute('data-counting') ?? false,
      flash: outline?.hasAttribute('data-flash') ?? false,
      outlineColor: outline ? getComputedStyle(outline).outlineColor : null,
      label: label?.textContent ?? null,
      ring: !!label?.querySelector('.ring-fill'),
    };
  }, loc);

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!existsSync(chrome))('live overlay states in headless Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let client: TestClient;
  let url: string;

  const seenReported = (loc: string) => client.messages.some((m) => m.type === 'visibility' && m.seen.includes(loc));

  const open = async (options: { reducedMotion?: 'reduce' } = {}) => {
    client.ws.send(JSON.stringify(overlay('unseen')));
    client.messages.length = 0;
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}) });
    await page.goto(url);
    await waitFor(async () => (await state(page, TOP)).status === 'seen');
    return page;
  };

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const cs = changeSpotlight();
    server = await createServer({ root: path.join(here, 'fixture-live'), configFile: false, plugins: [cs], logLevel: 'silent', server: { port: 0 } });
    await server.listen();
    url = server.resolvedUrls!.local[0]!;
    const info = await cs.api!.bridgeInfo();
    client = await connectClient(info!.port, info!.token);
  });
  afterAll(async () => {
    client?.close();
    await browser?.close();
    await server?.close();
  });

  it('shows the ring while counting, stays amber until VS Code confirms, then turns green with one flash', async () => {
    const page = await open();
    expect((await state(page, TOP)).flash).toBe(false); // the first overlay never flashes
    // Record the short counting window from inside the page, so polling cannot miss it.
    await page.evaluate((loc) => {
      const root = document.querySelector('change-spotlight-overlay')!.shadowRoot!;
      const w = window as unknown as { csRecord: string[] };
      w.csRecord = [];
      new MutationObserver(() => {
        const label = root.querySelector(`[data-cs-label][data-loc="${CSS.escape(loc)}"]`);
        const outline = root.querySelector(`[data-cs-outline][data-loc="${CSS.escape(loc)}"]`);
        if (outline?.hasAttribute('data-counting') && label?.querySelector('[data-cs-ring]')) w.csRecord.push(`${label.textContent} ${getComputedStyle(outline).outlineColor}`);
      }).observe(root, { subtree: true, childList: true, attributes: true });
    }, TARGET);
    await page.evaluate(() => document.getElementById('target')!.scrollIntoView());
    await waitFor(async () => (await state(page, TARGET)).counting, 1000);
    expect(await state(page, TARGET)).toMatchObject({ status: 'unseen', label: 'looking…', ring: true, outlineColor: 'rgb(31, 79, 209)' });

    // The dwell ends and the batch goes out; without VS Code's answer it is amber again, not green.
    await waitFor(() => seenReported(TARGET));
    await waitFor(async () => !(await state(page, TARGET)).counting);
    expect(await page.evaluate(() => (window as unknown as { csRecord: string[] }).csRecord[0])).toBe('looking… rgb(31, 79, 209)');
    expect(await state(page, TARGET)).toMatchObject({ status: 'unseen', label: 'not seen yet · Target.tsx:3', outlineColor: 'rgb(180, 83, 9)' });

    client.ws.send(JSON.stringify(overlay('seen')));
    await waitFor(async () => (await state(page, TARGET)).status === 'seen');
    expect(await state(page, TARGET)).toMatchObject({ label: 'seen · Target.tsx:3', flash: true, outlineColor: 'rgb(21, 128, 61)' });
    await waitFor(async () => !(await state(page, TARGET)).flash, 2000); // one short flash, then quiet
    await page.close();
  });

  it('leaves an element scrolled past quickly amber and never reports it', async () => {
    const page = await open();
    await page.evaluate(async () => {
      document.getElementById('pass')!.scrollIntoView();
      await new Promise((r) => setTimeout(r, 50));
      window.scrollTo(0, 0);
    });
    await sleep(1200);
    expect(seenReported(PASS)).toBe(false);
    await page.evaluate(() => document.getElementById('pass')!.scrollIntoView());
    await sleep(100);
    expect(await state(page, PASS)).toMatchObject({ status: 'unseen', counting: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitFor(async () => !(await state(page, PASS)).counting);
    await page.close();
  });

  it('shows no ring on what VS Code already counts as seen', async () => {
    const page = await open();
    // TOP is on screen at load and is being dwelled on right now, but it is seen already.
    for (let i = 0; i < 8; i++) {
      expect((await state(page, TOP)).counting).toBe(false);
      await sleep(40);
    }
    await page.close();
  });

  it('does not flash with prefers-reduced-motion', async () => {
    const page = await open({ reducedMotion: 'reduce' });
    client.ws.send(JSON.stringify(overlay('seen')));
    await page.evaluate(() => document.getElementById('target')!.scrollIntoView());
    await waitFor(async () => (await state(page, TARGET)).status === 'seen');
    expect((await state(page, TARGET)).flash).toBe(false);
    const running = await page.evaluate(() =>
      document.querySelector('change-spotlight-overlay')!.shadowRoot!.getAnimations().filter((a) => a.playState === 'running').length,
    );
    expect(running).toBe(0);
    await page.close();
  });

  it('gives no flash when the first overlay already says seen', async () => {
    client.ws.send(JSON.stringify(overlay('seen')));
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(url);
    await page.evaluate(() => document.getElementById('target')!.scrollIntoView());
    await waitFor(async () => (await state(page, TARGET)).status === 'seen');
    expect((await state(page, TARGET)).flash).toBe(false);
    await page.close();
  });
});
