// End to end: headless Chrome -> sensor -> import.meta.hot -> plugin validation -> bridge /events.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import reactSwc from '@vitejs/plugin-react-swc';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type PluginOption } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import changeSpotlight from '../../src/index.js';
import { connectClient } from '../helpers/bridgeClient.js';

const chrome = process.env.CS_CHROME ?? '/usr/bin/google-chrome';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

interface Visibility {
  page: string;
  seen: string[];
}

/** A dev server plus a bridge client collecting its visibility messages. */
async function startStack(root: string, extraPlugins: PluginOption[] = []) {
  const cs = changeSpotlight();
  const server = await createServer({ root, configFile: false, plugins: [cs, ...extraPlugins], logLevel: 'silent', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  const info = await cs.api!.bridgeInfo();
  if (!info) throw new Error('bridge did not start');
  const client = await connectClient(info.port, info.token);
  const messages = client.messages as unknown as ({ type: string } & Visibility)[];
  const visibility = () => messages.filter((m) => m.type === 'visibility');
  return {
    url,
    messages,
    seen: (page = '/') => new Set(visibility().filter((m) => m.page === page).flatMap((m) => m.seen)),
    async close(this: void) {
      client.close();
      await server.close();
    },
  };
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Dwell (300 ms) + batch (500 ms) + margin. */
const SETTLE = 1300;

describe.skipIf(!existsSync(chrome))('sensor in headless Chrome', () => {
  let browser: Browser;
  let page: Page;
  let stack: Awaited<ReturnType<typeof startStack>>;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    stack = await startStack(path.join(here, 'fixture'));
  });
  afterAll(async () => {
    await browser?.close();
    await stack?.close();
  });
  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(stack.url);
    await sleep(SETTLE);
  });

  it('reports only what is on screen at first, never hidden, transparent or zero-size elements', async () => {
    const seen = stack.seen();
    expect(seen.has('fx:top')).toBe(true);
    for (const loc of ['fx:pass', 'fx:target', 'fx:vis-hidden', 'fx:opacity', 'fx:zero']) expect(seen.has(loc)).toBe(false);
    await page.close();
  });

  it('reports an element after scrolling to it and staying', async () => {
    await page.evaluate(() => document.getElementById('target')!.scrollIntoView());
    await waitFor(() => stack.seen().has('fx:target'));
    await page.close();
  });

  it('does not report an element scrolled past in under 100 ms', async () => {
    stack.messages.length = 0;
    await page.evaluate(async () => {
      document.getElementById('pass')!.scrollIntoView();
      await new Promise((r) => setTimeout(r, 50));
      window.scrollTo(0, 0);
    });
    await sleep(SETTLE);
    expect(stack.seen().has('fx:pass')).toBe(false);
    await page.close();
  });

  it('reports elements mounted later, but not ones removed before the dwell ends', async () => {
    stack.messages.length = 0;
    await page.evaluate(async () => {
      const add = (loc: string) => {
        const el = document.createElement('div');
        el.className = 'box';
        el.setAttribute('data-cs-loc', loc);
        document.body.prepend(el);
        return el;
      };
      add('fx:late');
      const gone = add('fx:gone');
      await new Promise((r) => setTimeout(r, 100));
      gone.remove();
    });
    await waitFor(() => stack.seen().has('fx:late'));
    await sleep(SETTLE);
    expect(stack.seen().has('fx:gone')).toBe(false);
    await page.close();
  });

  it('reports an element three times the viewport height', async () => {
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.height = '300vh';
      el.setAttribute('data-cs-loc', 'fx:tall');
      document.body.prepend(el);
    });
    await waitFor(() => stack.seen().has('fx:tall'));
    await page.close();
  });

  it('treats a changed data-cs-loc as a new element', async () => {
    await page.evaluate(() => document.querySelector('[data-cs-loc="fx:top"]')!.setAttribute('data-cs-loc', 'fx:top-moved'));
    await waitFor(() => stack.seen().has('fx:top-moved'));
    await page.close();
  });

  it('attributes elements to the new page after pushState', async () => {
    await page.evaluate(() => history.pushState({}, '', '/other'));
    await waitFor(() => stack.seen('/other').has('fx:top'));
    await page.close();
  });
});

describe.skipIf(!existsSync(chrome))('playground in headless Chrome', () => {
  it('reports the footer only after scrolling to the bottom', async () => {
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const stack = await startStack(path.join(repoRoot, 'playground'), [reactSwc()]);
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.goto(stack.url);
      await waitFor(() => stack.seen().size > 0, 15_000);
      await sleep(SETTLE);
      expect(stack.seen().has('playground/src/components/Counter.tsx:8-10')).toBe(true);
      expect(stack.seen().has('playground/src/App.tsx:12-14')).toBe(false);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await waitFor(() => stack.seen().has('playground/src/App.tsx:12-14'));
    } finally {
      await browser.close();
      await stack.close();
    }
  });
});
