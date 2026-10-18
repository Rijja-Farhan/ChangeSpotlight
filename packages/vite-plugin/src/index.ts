import { execFileSync } from 'node:child_process';
import { PROTOCOL_VERSION } from '@change-spotlight/core';
import { createFilter, type FilterPattern, type Plugin } from 'vite';
import { startBridge, type Bridge } from './bridge.js';
import { resolveId as resolveTarget } from './ids.js';
import { tagHostElements } from './transform.js';

export interface ChangeSpotlightOptions {
  /** Set to false to turn the plugin off completely. Default true. */
  enabled?: boolean;
  /** Files to tag. Default: .jsx/.tsx files (/\.[jt]sx$/). */
  include?: FilterPattern;
  /** Files never to tag. Default: anything in node_modules. */
  exclude?: FilterPattern;
}

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

function findRepoRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export default function changeSpotlight(options: ChangeSpotlightOptions = {}): Plugin {
  if (options.enabled === false) return { name: 'change-spotlight', apply: () => false };

  const filter = createFilter(options.include ?? /\.[jt]sx$/, options.exclude ?? /\/node_modules\//);
  let repoRoot = process.cwd();
  let bridge: Bridge | undefined;
  const closeBridge = () => {
    bridge?.close();
    bridge = undefined;
  };

  return {
    name: 'change-spotlight',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      const root = findRepoRoot(config.root);
      if (!root) config.logger.info('[change-spotlight] not in a git repository; paths are relative to the Vite root');
      repoRoot = root ?? config.root;
    },

    configureServer(server) {
      const log = (msg: string) => server.config.logger.info(`[change-spotlight] ${msg}`);
      bridge = startBridge(repoRoot, log);
      server.httpServer?.once('close', closeBridge);

      server.ws.on('cs:click', (data: { protocolVersion?: unknown; loc?: unknown; page?: unknown }) => {
        if (typeof data?.loc !== 'string') return;
        bridge?.send({ protocolVersion: PROTOCOL_VERSION, type: 'click', loc: data.loc, page: data.page });
      });
    },

    // Vite calls this on server.close(), also for middleware-mode servers that have no httpServer.
    closeBundle: closeBridge,
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
      const target = resolveTarget(id, repoRoot);
      if (!target || !filter(target.file)) return;
      return tagHostElements(code, { filename: target.file, relPath: target.relPath, lang: target.lang });
    },
  };
}
