// Performance: 500 changed elements on one page stay within the frame budget while scrolling.
// The layer records each draw pass as a User Timing measure when sessionStorage asks for it.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, type OverlayItem, type OverlayMessage } from '@change-spotlight/core';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import changeSpotlight from '../../src/index.js';
import { connectClient, type TestClient } from '../helpers/bridgeClient.js';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';
const here = path.dirname(fileURLToPath(import.meta.url));

/** A draw pass must leave most of a 60 Hz frame (16.7 ms) to the app. */
const DRAW_P95_MS = 8;
const DRAW_MAX_MS = 16;
/** All 500 outlined and labelled at once: still within one frame. */
const DENSE_P95_MS = 16;

const items: OverlayItem[] = Array.from({ length: 500 }, (_, i) => ({
  loc: `src/cards/Card${i}.tsx:${i + 1}-${i + 1}`,
  path: `src/cards/Card${i}.tsx`,
  line: i + 1,
  endLine: i + 1,
  status: i % 3 === 0 ? 'seen' : i % 3 === 1 ? 'partly' : 'unseen',
  seenHunks: i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0,
  hunkIds: [`a${i}#1`, `b${i}#1`],
  preview: `<div className="card">{props.title}</div>`,
  pages: i % 3 === 2 ? [] : ['/'],
}));
const overlay: OverlayMessage = {
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature',
  totals: { seen: 167, total: 1000, untrackable: 0 },
  items,
  pages: ['/'],
  unplaced: items.filter((i) => i.pages.length === 0).map((i) => i.loc),
};

describe.skipIf(!existsSync(chrome))('overlay performance with 500 changed elements', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let client: TestClient;
  let url: string;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const cs = changeSpotlight();
    server = await createServer({ root: path.join(here, 'fixture-many'), configFile: false, plugins: [cs], logLevel: 'silent', server: { port: 0 } });
    await server.listen();
    url = server.resolvedUrls!.local[0]!;
    const info = await cs.api!.bridgeInfo();
    client = await connectClient(info!.port, info!.token);
    client.ws.send(JSON.stringify(overlay));
    await new Promise((r) => setTimeout(r, 200));
  });
  afterAll(async () => {
    client?.close();
    await browser?.close();
    await server?.close();
  });

  it('keeps each draw pass within the budget while scrolling, with the panel open', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(() => sessionStorage.setItem('change-spotlight:timing', 'on'));
    await page.goto(url);
    await page.waitForFunction(() => (document.querySelector('change-spotlight-overlay')?.shadowRoot?.querySelectorAll('[data-cs-outline]').length ?? 0) > 0);
    await page.evaluate(() => (document.querySelector('change-spotlight-overlay')!.shadowRoot!.querySelector('[data-cs-open-panel]') as HTMLButtonElement).click());
    await page.waitForTimeout(500);
    await page.evaluate(() => performance.clearMeasures('change-spotlight:draw'));

    const longTasks = await page.evaluate(async () => {
      const long: number[] = [];
      new PerformanceObserver((list) => list.getEntries().forEach((e) => long.push(e.duration))).observe({ type: 'longtask' });
      const max = document.documentElement.scrollHeight - innerHeight;
      for (let step = 0; step <= 60; step++) {
        window.scrollTo(0, (max * step) / 60);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      await new Promise((r) => setTimeout(r, 200));
      return long;
    });
    const draws = await page.evaluate(() => performance.getEntriesByName('change-spotlight:draw').map((e) => e.duration));
    draws.sort((a, b) => a - b);
    const p95 = draws[Math.floor(draws.length * 0.95)]!;
    console.log(`draw passes: ${draws.length}, median ${draws[Math.floor(draws.length / 2)]!.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${draws.at(-1)!.toFixed(2)} ms, long tasks ${longTasks.length}`);
    expect(draws.length).toBeGreaterThan(30);
    expect(p95).toBeLessThan(DRAW_P95_MS);
    expect(draws.at(-1)!).toBeLessThan(DRAW_MAX_MS);
    expect(longTasks.filter((d) => d > 50)).toEqual([]);
    await page.close();
  });

  it('draws all 500 on screen at once within a frame', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => sessionStorage.setItem('change-spotlight:timing', 'on'));
    await page.goto(`${url}?dense`);
    await page.waitForFunction(() => (document.querySelector('change-spotlight-overlay')?.shadowRoot?.querySelectorAll('[data-cs-outline]').length ?? 0) === 500);
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      performance.clearMeasures('change-spotlight:draw');
      for (let i = 0; i < 30; i++) {
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    const draws = await page.evaluate(() => performance.getEntriesByName('change-spotlight:draw').map((e) => e.duration).sort((a, b) => a - b));
    const p95 = draws[Math.floor(draws.length * 0.95)]!;
    console.log(`dense draw passes: ${draws.length}, median ${draws[Math.floor(draws.length / 2)]!.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
    expect(draws.length).toBeGreaterThanOrEqual(25);
    expect(p95).toBeLessThan(DENSE_P95_MS);
    await page.close();
  });
});
