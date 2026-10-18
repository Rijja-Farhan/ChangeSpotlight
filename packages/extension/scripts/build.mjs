// Bundles the extension into dist/extension.js (CommonJS, as VS Code loads it) and copies the
// oxc-parser native binding for this platform next to it. Usage: node scripts/build.mjs [--watch]
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(root, 'src/extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  outfile: path.join(dist, 'extension.js'),
  // vscode is provided by VS Code. The parser's native binding is loaded at runtime with
  // require('./parser.<platform>.node'), i.e. from dist/, where we copy it below.
  external: ['vscode', '@oxc-parser/*', '*.node'],
  // oxc-parser is ESM and reads import.meta.url, which does not exist in a CommonJS bundle.
  define: { 'import.meta.url': '__cs_import_meta_url' },
  banner: { js: 'const __cs_import_meta_url = require("url").pathToFileURL(__filename).href;' },
  logLevel: 'info',
};

/** Copies the installed @oxc-parser/binding-<platform> .node file into dist/. */
function copyNativeBinding() {
  const pluginRequire = createRequire(path.join(root, '../vite-plugin/package.json'));
  const oxcPackage = pluginRequire.resolve('oxc-parser/package.json');
  const oxcRequire = createRequire(oxcPackage);
  const prefix = `@oxc-parser/binding-${process.platform}-${process.arch}`;
  const candidates = Object.keys(JSON.parse(readFileSync(oxcPackage, 'utf8')).optionalDependencies ?? {}).filter((n) => n.startsWith(prefix));
  for (const name of candidates) {
    let dir;
    try {
      dir = path.dirname(oxcRequire.resolve(`${name}/package.json`));
    } catch {
      continue; // not installed for this machine (e.g. musl vs gnu)
    }
    mkdirSync(dist, { recursive: true });
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.node'))) {
      copyFileSync(path.join(dir, file), path.join(dist, file));
      console.log(`copied ${file}`);
    }
    return;
  }
  throw new Error(`no oxc-parser binding installed for ${process.platform}-${process.arch}`);
}

copyNativeBinding();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
