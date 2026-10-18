import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { PROTOCOL_VERSION } from '@change-spotlight/core';
import type { Plugin } from 'vite';
import { startBridge, type Bridge } from './bridge.js';
import { tagHostElements } from './transform.js';

const CLIENT_ID = 'virtual:change-spotlight/client';
const RESOLVED_CLIENT_ID = '\0' + CLIENT_ID;

// Runs in the browser. SPIKE: reports clicks; the visibility sensor comes in Phase 5.
const clientCode = `
const PROTOCOL_VERSION = ${JSON.stringify(PROTOCOL_VERSION)};
document.addEventListener('click', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-cs-loc]') : null;
  if (!el || !import.meta.hot) return;
  import.meta.hot.send('cs:click', {
    protocolVersion: PROTOCOL_VERSION,
    loc: el.getAttribute('data-cs-loc'),
    page: location.pathname,
  });
}, true);
`;

function findRepoRoot(dir: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return dir;
  }
}

export default function changeSpotlight(): Plugin {
  let repoRoot = process.cwd();
  let bridge: Bridge | undefined;

  return {
    name: 'change-spotlight',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      repoRoot = findRepoRoot(config.root);
    },

    configureServer(server) {
      const log = (msg: string) => server.config.logger.info(`[change-spotlight] ${msg}`);
      bridge = startBridge(repoRoot, log);
      server.httpServer?.once('close', () => bridge?.close());

      server.ws.on('cs:click', (data: { protocolVersion?: unknown; loc?: unknown; page?: unknown }) => {
        if (typeof data?.loc !== 'string') return;
        bridge?.send({ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: data.loc, page: data.page });
      });
    },

    resolveId(id) {
      return id === CLIENT_ID ? RESOLVED_CLIENT_ID : undefined;
    },

    load(id) {
      return id === RESOLVED_CLIENT_ID ? clientCode : undefined;
    },

    // order 'pre' so Vite still processes the injected inline module and rewrites the virtual import.
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [{ tag: 'script', attrs: { type: 'module' }, children: `import '${CLIENT_ID}';`, injectTo: 'head' }];
      },
    },

    transform(code, id) {
      const file = id.split('?')[0]!;
      if (file.startsWith('\0') || file.includes('/node_modules/') || !/\.[jt]sx$/.test(file)) return;

      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      if (rel.startsWith('..')) return; // outside the repo
      return tagHostElements(code, file, rel);
    },
  };
}
