# Phase 0: Monorepo skeleton

**Status:** done
**Files:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.gitignore`, `packages/core/*`, `packages/vite-plugin/*`, `packages/extension/*`

## What it is
- A **monorepo**: one git repo that holds several packages that build together.
- A **pnpm workspace**: pnpm treats each folder listed in `pnpm-workspace.yaml` as its own package, with one shared `node_modules` store and one lockfile.
- Three empty packages. Each type-checks and builds, but has no features yet.

| Package folder | Name | Module format | Job (later phases) |
|---|---|---|---|
| `packages/core` | `@change-spotlight/core` | ESM | Diff parsing, range matching, protocol types. Pure functions. |
| `packages/vite-plugin` | `@change-spotlight/vite-plugin` | ESM | Adds `data-cs-loc="path:start-end"` to elements at build time. Dev only. |
| `packages/extension` | `change-spotlight` | CommonJS | VS Code extension. Reads the git diff and shows "Seen X of Y" and gutter markers. |
| `playground/` | - | - | Vite + React test app. Listed in the workspace, created in Phase 1. |

## Why
- The extension and the plugin must agree on message shapes. Putting both in one repo lets them import the same types from `core`, so a protocol change breaks the build at once.
- `core` holds the logic with no VS Code or Vite imports, so Phase 2 can unit-test it without starting either tool.
- `pnpm -r build` (`-r` = recursive, run in every package) builds all of them with one command.

## How it works

**Tooling pinned**
- Node 22.22.3 installed with nvm (no sudo).
- pnpm 12.11.2 enabled with **corepack** (a Node tool that downloads the exact package manager a project asks for).
- Root `package.json` has `"packageManager": "pnpm@12.11.2+sha512..."`. Corepack checks the hash, so everyone runs the same pnpm binary.

**Root `package.json`**
- Named `change-spotlight-monorepo`, `private: true` (never published).
- Scripts: `build` = `pnpm -r build`, `typecheck` = `pnpm -r typecheck`.
- Dev deps shared by all packages: `typescript ^7.0.2` (the native Go-based compiler), `@types/node`.

**`tsconfig.base.json`** (each package's `tsconfig.json` extends it and adds `rootDir: src`, `outDir: dist`)

| Option | What it does |
|---|---|
| `target: ES2022` | Output modern JS. Node 22 and VS Code's Electron support it. |
| `module` / `moduleResolution: NodeNext` | Follow Node's real rules: `type: module` means ESM, otherwise CommonJS. |
| `strict` | All strict type checks on. |
| `noUncheckedIndexedAccess` | `arr[i]` has type `T \| undefined`. Matters for diff parsing, where line arrays are indexed a lot. |
| `isolatedModules` | Each file must compile alone. Needed later so esbuild and Vite can transpile file by file. |
| `declaration` | Emit `.d.ts` type files so packages can import each other's types. |
| `sourceMap` | Emit `.js.map` so the debugger shows the `.ts` source. |
| `skipLibCheck` | Do not type-check `.d.ts` files in `node_modules`. Faster, avoids errors in third-party types. |

**ESM vs CommonJS**
- **ESM** = `import`/`export` modules. **CommonJS** = `require`/`module.exports`.
- `core` and `vite-plugin` set `"type": "module"`. Vite loads plugins as ESM.
- The extension has no `type` field and overrides `module: Node16`. VS Code 1.100 loads extensions with `require`, so the output must be CommonJS.

**Extension manifest (`packages/extension/package.json`)**
- `engines.vscode: ^1.100.0`: the oldest VS Code the extension runs on.
- `@types/vscode: ~1.100.0`: the API types. They must not be newer than `engines.vscode`. Otherwise you could call an API the editor lacks, and `vsce` (the packaging tool) refuses to build the `.vsix`.
- `main: ./dist/extension.js`: the file VS Code `require`s.
- `activationEvents: []`, `contributes: {}`: no commands or views yet.
- `src/extension.ts` exports empty `activate()` (called when the extension starts) and `deactivate()` (called on shutdown).

**Build**
- Plain `tsc -p .` per package for now. esbuild bundling for the extension comes in Phase 1.
- `dist/` is in `.gitignore`, together with `node_modules/`, `out/`, `*.vsix`, `*.tsbuildinfo`, `.vscode-test/`.

## Real example
Input: `packages/extension/src/extension.ts`
```ts
import * as vscode from 'vscode';
export function activate(_context: vscode.ExtensionContext): void {}
export function deactivate(): void {}
```
Run `pnpm build`. Because the extension uses `module: Node16` and has no `type: module`, `tsc` writes CommonJS to `packages/extension/dist/extension.js`:
```js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
function activate(_context) { }
function deactivate() { }
```
`exports.activate` is what VS Code's `require` finds. Compare `packages/core/dist/index.js`, which stays ESM:
```js
export const PROTOCOL_VERSION = 1;
```

## Gotchas
- **Workspace package names must be unique.** The root was first also called `change-spotlight`, the same as the extension. Then `pnpm --filter change-spotlight add -D @types/vscode` matched both, and `@types/vscode` landed in the root too. Fix: rename the root to `change-spotlight-monorepo` and remove the duplicate dependency.
- `@types/vscode` belongs only in `packages/extension`. Only the extension uses the VS Code API.
- TypeScript 7 is new. If the extension or Vite tooling breaks on it, fall back to TypeScript 5.x.
- `playground` is listed in `pnpm-workspace.yaml` but does not exist yet. pnpm ignores it until Phase 1.
- `packages/vite-plugin/src/index.ts` is only `export {};`. `core` only exports `PROTOCOL_VERSION = 1`.
- No F5 debugging yet. `.vscode/launch.json` and esbuild come in Phase 1.

## Try it
```bash
cd /home/codingcops/dev/change-spotlight
corepack enable                       # once per Node install
pnpm install --frozen-lockfile        # fails if pnpm-lock.yaml is out of date
pnpm typecheck                        # three lines ending "typecheck: Done"
pnpm build
ls packages/core/dist packages/vite-plugin/dist packages/extension/dist
grep -l '@types/vscode' package.json packages/*/package.json   # only packages/extension/package.json
```
