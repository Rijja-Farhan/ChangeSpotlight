// End to end: a fake extension (bridge client) sends overlays -> plugin relay -> HMR -> page, and the
// page's "open" / "mark" requests travel back to the bridge client.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, type OverlayMessage } from '@change-spotlight/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import changeSpotlight from '../../src/index.js';
import { connectClient, type TestClient } from '../helpers/bridgeClient.js';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';
const here = path.dirname(fileURLToPath(import.meta.url));
const overlayDataUrl = '/@fs/' + path.resolve(here, '../../src/client/overlayData.ts').replace(/\\/g, '/').replace(/^\/+/, '');

const overlay = (seen: number): OverlayMessage => ({
  protocolVersion: PROTOCOL_VERSION,
  type: 'overlay',
  branch: 'feature',
  totals: { seen, total: 2, untrackable: 0 },
  items: [
    { loc: 'fx:top', path: 'src/App.tsx', line: 3, endLine: 4, status: seen > 0 ? 'seen' : 'unseen', seenHunks: seen, hunkIds: ['h1#1'], preview: '<div>top</div>', pages: seen > 0 ? ['/'] : [] },
  ],
  pages: seen > 0 ? ['/'] : [],
  unplaced: seen > 0 ? [] : ['fx:top'],
});

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Reads the page's overlay copy through the client module itself (same URL = same module instance). */
// Passed as strings: Vitest would rewrite import() inside a function body.
const withClient = (page: Page, body: string) => page.evaluate(`import(${JSON.stringify(overlayDataUrl)}).then((mod) => { ${body} })`);
const latestSeen = (page: Page) => withClient(page, 'return mod.latestOverlay()?.totals.seen ?? null;');

describe.skipIf(!existsSync(chrome))('overlay data flow in headless Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let client: TestClient;
  let url: string;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const cs = changeSpotlight();
    server = await createServer({ root: path.join(here, 'fixture'), configFile: false, plugins: [cs], logLevel: 'silent', server: { port: 0 } });
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

  it('gives a page loaded later the last overlay, then live updates', async () => {
    client.ws.send(JSON.stringify(overlay(0)));
    await new Promise((r) => setTimeout(r, 200)); // the overlay is stored before any page exists
    const page = await browser.newPage();
    await page.goto(url);
    await waitFor(async () => (await latestSeen(page)) === 0);

    client.ws.send(JSON.stringify(overlay(1)));
    await waitFor(async () => (await latestSeen(page)) === 1);
    await page.close();
  });

  it('sends Open in VS Code and Mark as seen back to the extension, and drops invalid requests', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    await waitFor(async () => (await latestSeen(page)) !== null);
    client.messages.length = 0;

    // The invalid one (empty path, line 0) must be dropped by the plugin.
    await withClient(page, `mod.requestOpen('', 0); mod.requestOpen('src/App.tsx', 3); mod.requestMark(['h1#1']);`);

    const requests = () => client.messages.filter((m) => m.type === 'open' || m.type === 'mark');
    await waitFor(() => requests().length >= 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(requests()).toEqual([
      { protocolVersion: PROTOCOL_VERSION, type: 'open', path: 'src/App.tsx', line: 3 },
      { protocolVersion: PROTOCOL_VERSION, type: 'mark', hunkIds: ['h1#1'] },
    ]);
    await page.close();
  });
});
