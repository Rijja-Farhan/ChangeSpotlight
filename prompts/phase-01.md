<role>
You are a senior TypeScript tooling engineer guiding the user through three throwaway learning spikes (Phase 1) for Change Spotlight, one spike at a time.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`, tags rendered host elements in a React + Vite app with `data-cs-loc="path:start-end"` at dev time, tracks which changed elements were actually visible in the browser, and shows "Seen X of Y" with seen/unseen gutter markers.
It is a pnpm workspaces monorepo, TypeScript everywhere: `packages/core` (pure logic, versioned protocol), `packages/extension` (VS Code extension), `packages/vite-plugin`, and `playground/` (Vite + React test app). All paths are repo-root relative with forward slashes.
</project>

<current_state>
Phase 0 is done and verified. Environment: Linux, Node 22.22.3, pnpm 12.11.2 (corepack), git 2.34.1, VS Code 1.100.2.
- `package.json`: `change-spotlight-monorepo`, private, scripts `build` = `pnpm -r build`, `typecheck` = `pnpm -r typecheck`; devDeps `typescript ^7.0.2`, `@types/node ^22.20.5`.
- `pnpm-workspace.yaml`: `packages/*`, `playground` (`playground/` does not exist yet).
- `tsconfig.base.json`: ES2022, NodeNext, strict, noUncheckedIndexedAccess, isolatedModules, declaration, sourceMap, skipLibCheck.
- `.gitignore`: `node_modules/`, `dist/`, `out/`, `*.vsix`, `*.tsbuildinfo`, `.vscode-test/`.
- `packages/core`: `@change-spotlight/core`, ESM, `src/index.ts` exports `PROTOCOL_VERSION = 1`, builds with `tsc -p .`.
- `packages/vite-plugin`: `@change-spotlight/vite-plugin`, ESM, `src/index.ts` is `export {};`, builds with `tsc -p .`, no dependencies.
- `packages/extension`: name `change-spotlight`, CommonJS (no `type` field, tsconfig `module`/`moduleResolution` `Node16`), `engines.vscode ^1.100.0`, devDep `@types/vscode ~1.100.0`, main `./dist/extension.js`, empty `activationEvents`/`contributes`, `src/extension.ts` has empty `activate`/`deactivate`, builds with plain `tsc`.
- No `.vscode/` folder, no esbuild, no `playground/`.
- Git: branch `main` exists but has **no commits**; everything is untracked.
- `Notes/README.md` indexes learning notes (`NN-topic-name.md`); `Notes/00-monorepo-skeleton.md` exists.
</current_state>

<goal>
Build three minimal, hand-verified spikes (gutter dots from a git diff, `data-cs-loc` tagging in a playground, click-to-Output-panel bridge) so the moving parts are understood before the real implementations in Phases 2 to 6. Code quality can be crude; what matters is that each spike works by hand and the lessons are recorded.
</goal>

<requirements>
Do the spikes in order. Finish, verify and get user confirmation on each before starting the next.

**Spike 1: extension gutter dots** (inside `packages/extension`)
1. Create an esbuild bundle: add `esbuild` as a devDep; `build` bundles `src/extension.ts` to `dist/extension.js` (`--bundle --platform=node --format=cjs --external:vscode --sourcemap`); add a `watch` script; keep `typecheck` on `tsc --noEmit`.
2. Create `.vscode/launch.json` and `.vscode/tasks.json` at the repo root so F5 builds and opens an Extension Development Host with `extensionDevelopmentPath` = `${workspaceFolder}/packages/extension`.
3. Contribute a command `changeSpotlight.spike.showChanges` ("Change Spotlight: Show Changed Lines (spike)"). It runs git in the workspace folder's repo root and places a gutter dot (create `packages/extension/media/dot.svg`, used via `createTextEditorDecorationType({ gutterIconPath })`) on every added/modified line in visible editors.
4. Base selection with fallback, logged to an Output channel "Change Spotlight": if `git rev-parse --verify HEAD` fails (no commits), use `git diff -U0` (index vs working tree; untracked files show nothing, so log that); else if `main` exists and `git merge-base main HEAD` differs from HEAD, diff `-U0` against the merge-base; otherwise diff against `HEAD`. Parse hunk headers crudely (`@@ -a,b +c,d @@`; `d = 0` means pure deletion, skip or mark line `c`).
5. Tell the user how to create a test branch themselves (for example: `git add -A`, `git commit -m "Phase 0 skeleton"`, `git switch -c spike/test`, then edit a file). The user runs these, not you.

**Spike 2: plugin tagging**
6. Create `playground/` with `pnpm create vite playground --template react-swc-ts` (SWC proves the transform does not need Babel; if that template is unavailable, use `react-ts` and swap to `@vitejs/plugin-react-swc`). Add 2 to 3 small components with nested host elements and at least one fragment.
7. In `packages/vite-plugin/src/index.ts`, export a default factory returning a plugin with `apply: 'serve'`, `enforce: 'pre'`, handling only `.jsx`/`.tsx` ids (query stripped), skipping `node_modules`. It adds `data-cs-loc="<repo-relative/path.tsx>:<startLine>-<endLine>"` to lowercase host elements only (not components, not fragments). Repo root comes from `git rev-parse --show-toplevel`; paths use forward slashes. Use `magic-string` and return its source map. `vite` is a devDep (for types) and peerDep.
8. The playground depends on `"@change-spotlight/vite-plugin": "workspace:*"` and registers it in `vite.config.ts`. Explain that Vite resolves the symlinked package through its `main` (`./dist/index.js`), so the plugin must be built first; add a `dev` watch script (`tsc -p . --watch`) in the plugin.

**Spike 3: click bridge**
9. The plugin serves a virtual module `virtual:change-spotlight/client`, injected via `transformIndexHtml`. On click, it finds `closest('[data-cs-loc]')` and calls `import.meta.hot.send('cs:click', { protocolVersion, loc, page })` without blocking the click.
10. The plugin listens with `server.ws.on('cs:click', ...)`, starts a local server on `127.0.0.1` with port 0, and writes `{ port, pid, protocolVersion }` to the discovery file `.change-spotlight/dev-server.json` at the repo root (add `.change-spotlight/` to `.gitignore`). It deletes the file and closes the server when the Vite server closes or restarts.
11. Transport (decide with the user; recommended): an HTTP server in the plugin exposing a streaming `GET /events` (newline-delimited JSON), which the extension reads. It is built-in Node and can be checked with `curl -N`. The alternative is an HTTP server in the extension that the plugin POSTs to. That is simpler, but it reverses who writes the discovery file.
12. The extension activates on `onStartupFinished`, watches the discovery file, connects when it appears or changes, drops the connection when it disappears, and logs `file:line` lines to the "Change Spotlight" Output channel. Messages whose `protocolVersion` differs from `PROTOCOL_VERSION` are logged and ignored. All connect/disconnect errors go to the Output channel only, with no popups.
13. Both sides import `PROTOCOL_VERSION` from `@change-spotlight/core` (workspace dep).
</requirements>

<constraints>
- Never run `git commit`, `git add`, `git switch`, `git branch`, `git stash` or any other git write command. Read-only git (`status`, `diff`, `log`, `rev-parse`, `merge-base`) is fine. After each working step, suggest a short commit message for the user to run.
- pnpm 12.11.2 only; one lockfile.
- Keep package names and module formats: extension CommonJS output (VS Code 1.100 `require`s it), core and vite-plugin ESM (Vite loads plugins as ESM).
- `@types/vscode` stays `~1.100.0` and only in the extension, so it never exceeds `engines.vscode`.
- Open choice: if the extension's `tsc` typecheck rejects importing ESM `core` from CommonJS (TS1479), recommended fix is extension tsconfig `module: "Preserve"`, `moduleResolution: "Bundler"`, because esbuild now produces the output. The alternative is to keep a local constant for the spike.
- Open choice: the playground's TypeScript version. Recommended default is the template's pinned version, since TS 7 is new and the template's `tsc -b` may break on it. `pnpm typecheck` must still pass from the root.
- No Babel anywhere in the plugin.
- The crude transform (regex or hand scanning) is acceptable. The real parser (oxc-parser) is Phase 4.
- Working style: small steps. Before each step, say briefly what and why. Show the code, explain how to run and verify it, and wait for confirmation. For trade-offs, give brief options with a recommendation.
</constraints>

<out_of_scope>
- Phase 2: real diff parser in `core`, range matching, protocol message types and guards, Vitest.
- Phase 3: base-branch detection (`master`, `origin/main`, settings), untracked files, recompute on save or branch change.
- Phase 4: real parser, fixture tests, source-map breakpoint validation.
- Phase 5: IntersectionObserver/MutationObserver sensor, batching, the seen rule.
- Phase 6: WebSocket transport, auth token, discovery file in `.git/`, reconnect with backoff, handshake.
- Phases 7 to 9: seen model, TreeView, seen/unseen gutter styles, packaging, CI.
</out_of_scope>

<acceptance_criteria>
- [ ] `pnpm install`, `pnpm typecheck` and `pnpm build` succeed from the root, including `playground`.
- [ ] `packages/extension/dist/extension.js` is a single esbuild bundle. F5 opens an Extension Development Host.
- [ ] Running the spike command shows gutter dots on exactly the changed lines, and the Output channel names the base used (no-commits, merge-base, or HEAD).
- [ ] In the playground, DevTools shows `data-cs-loc` with correct repo-relative paths and line ranges on host elements, and none on components or fragments.
- [ ] Clicking a tagged element logs its `file:line` in the "Change Spotlight" Output channel.
- [ ] Stopping and restarting Vite, or reloading the Extension Development Host, in any order, produces no error popups. The bridge works again after restart.
- [ ] `.change-spotlight/dev-server.json` exists while Vite runs, is removed when it stops, and is git-ignored.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm typecheck && pnpm build` → exits 0.
- `head -c 300 packages/extension/dist/extension.js` → esbuild CJS output; `grep -c 'require("vscode")' packages/extension/dist/extension.js` → at least 1.
- F5, then in the Development Host run "Change Spotlight: Show Changed Lines (spike)" on an edited file → dots on the changed lines. Compare against `git diff -U0` in a terminal.
- `pnpm --filter @change-spotlight/vite-plugin build && pnpm --filter playground dev`, then `curl -s http://localhost:5173/src/App.tsx | grep -o 'data-cs-loc[^,]*' | head` → values like `playground/src/App.tsx:N-M` (after the SWC JSX transform the attribute appears as an object key, not `data-cs-loc=`).
- DevTools Elements panel → attributes on host elements only.
- `cat .change-spotlight/dev-server.json`, then `curl -N http://127.0.0.1:<port>/events` and click in the browser → one JSON line per click with `protocolVersion: 1`.
- Ctrl+C on Vite → `ls .change-spotlight/` shows no `dev-server.json`. Output channel shows a quiet disconnect line. `git status --short` does not list `.change-spotlight/`.
</verification>

<workflow>
1. Read the files in current_state.
2. Propose a short plan for spike 1. Wait for confirmation.
3. Implement in small steps, verifying each. Suggest a commit message after each working step.
4. After each spike, summarize what was learned and anything that could change Phases 2 to 6. Wait for confirmation before the next spike.
5. Run the full verification and report.
</workflow>

<finish>
After verification passes, run `/notes 1`. `.claude/agents/notes-writer.md` is still written for another project (Askwell). Tell the user, and make sure the notes describe Change Spotlight only. Follow `Notes/README.md` naming (for example `01-extension-spike.md`, `01-plugin-spike.md`, `01-bridge-spike.md`) and update its index. Then summarize the files changed, the decisions made (transport, tsconfig fix, playground TS version), the lessons that affect later phases, and suggested commit messages.
</finish>
