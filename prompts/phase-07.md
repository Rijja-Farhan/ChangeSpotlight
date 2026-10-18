<role>
You are a senior TypeScript engineer who knows git diffs, JSX ASTs and VS Code extensions. You will build the "seen" model of Change Spotlight (Phase 7) on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"`, and records which changed elements were actually visible in the browser, so it can show "Seen X of Y".
It is a pnpm 12 workspace using TypeScript 7: `packages/core` (pure logic, no Node or DOM types), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19, in the same git repo). Data flows: browser sensor -> Vite HMR -> plugin -> authenticated WebSocket -> extension.
</project>

<current_state>
Phases 0 to 6 are committed on branch `v1-phases` (latest: `356f6b8` WebSocket bridge). Environment: Linux, Node 22.22, Vitest 5.0.5, VS Code 1.100.2 (extension host Node 20.19, Electron 34).
- **`core/src/diff.ts`**: `parseDiff` -> `DiffFile {path, oldPath, status, binary, hunks}`. `Hunk {oldStart, oldCount, newStart, newCount, kind: 'add'|'delete'|'modify', removed[], added[]}`. Line text has no prefix and no `\r`. A pure deletion has `newCount 0` and `newStart` = the line before the gap. `changedRanges(files)`.
- **`core/src/match.ts`**: `matchHunks(element, hunks)` -> `{covered, intersecting}`. A deletion counts only when its gap is strictly inside the element (`start <= newStart < end`).
- **`core/src/loc.ts`**: `ElementLoc {path, start, end}`, `parseLoc`, `formatLoc`. **`added.ts`**: `addedFileDiff` turns an untracked file into one `add` hunk.
- **`core/src/protocol.ts`**: `VisibilityMessage {protocolVersion, type:'visibility', page, seen: string[]}` (data-cs-loc values), `ClickMessage`.
- **`extension/src/git.ts`** (no `vscode`): `computeChanges(root, configured)` -> `ChangeResult {ok, root, base: BaseInfo, files, untracked, skipped}`. Tracked changes come first, then untracked files as `added`. `resolveBase` already runs `git symbolic-ref -q HEAD`, but only to set `detached`. No branch name is returned.
- **`extension/src/changeTracker.ts`**: debounced (300 ms) recompute on save, file create/delete/rename, `HEAD`, `index`, `logs/HEAD` and the base setting. `onDidChange(ChangeResult)`, `refresh()`, `result`. Exposes no pending state.
- **`extension/src/bridge.ts`**: `connectBridge(gitDir, output)` -> `{onMessage: vscode.Event<BridgeEvent {serverId, message}>, dispose}`. `extension.ts` pushes it into subscriptions but does not subscribe to `onMessage`.
- **`extension/src/extension.ts`**: one gutter dot style (`media/dot.svg`) on `changedRanges`. One command, `changeSpotlight.refresh`. Output channel "Change Spotlight". No status bar item.
- **`vite-plugin/src/transform.ts`**: `tagHostElements(code, {filename, relPath, lang})` uses `oxc-parser` `parseSync` plus `Visitor`. It tags `JSXElement`s whose name is a `JSXIdentifier` passing `isHostTag`, skips elements that already have an explicit `data-cs-loc`, counts lines on `\n` only, and returns `null` on parse errors. The plugin filter defaults to `/\.[jt]sx$/` and excludes `/node_modules/`.
- **`vite-plugin/src/client/seen.ts`**: `SeenTracker` reports each `(page, loc)` once per page load (the `reported` set), with a 300 ms dwell and a 500 ms batch flush. `sensor.ts` uses a MutationObserver on `data-cs-loc`. `client/index.ts` `startClient({protocolVersion, hot})`.
- **Tests**: `extension/test/tempRepo.ts` (`makeRepo`, hermetic git env), `git.test.ts`, `bridgeClient.test.ts`, `vite-plugin/test/{transform,seen,...}.test.ts` with fixture snapshots in `test/fixtures/__out__/`.
- **Verified for this prompt**:
  - `@oxc-parser/wasm` is deprecated (stuck at 0.60.0).
  - `oxc-parser@0.154.0` loads a native binding per platform: `parser.linux-x64-gnu.node`, 2.1 MB. `@oxc-parser/binding-wasm32-wasip1@0.154.0` exists: 2.2 MB, needs `@napi-rs/wasm-runtime`.
  - An esbuild CJS bundle of `parseSync` works (about 43 KB of JS) with `--external:@oxc-parser/*`, `--define:import.meta.url=__cs_import_meta_url` and a banner that sets that variable from `__filename`. It also needs `parser.linux-x64-gnu.node` copied next to the bundle, because the NAPI loader tries `./parser.<triple>.node` first.
  - `Visitor` does not survive bundling. It lazily `require`s `../generated/visit/walk.js`.
- `.gitignore` contains `Notes/`, but `Notes/README.md` and `Notes/00-monorepo-skeleton.md` are still tracked, and `Notes/README.md` is modified.
</current_state>

<goal>
Turn diff hunks plus browser visibility reports into a persistent per-branch "Seen X of Y". A count must stay correct while lines shift, while code is edited, across HMR updates and across VS Code restarts. Phase 8 builds the tree, the two gutter styles and the counter UI on this model.
</goal>

<requirements>
1. **Element model** (create `core/src/elements.ts`):
   - `HostElement = ElementLoc & {depth}`. `depth` is the JSX nesting depth among host elements.
   - `hunkOwners(hunk, elements)`:
     - Each new-side line of a hunk is owned by the elements that contain it with the smallest line span, ties broken by the greatest depth. Several siblings on one line are all owners.
     - A pure deletion is owned by the innermost element(s) whose range strictly contains the gap, using the same rule as `matchHunks`.
     - The hunk's owners are the union over its lines, sorted by `(start, end)`.
     - Reason: an outer `<main>` that spans the file must not mark every hunk inside it as seen.
2. **Hunk identity** (create, core):
   - `hunkIds(path, hunks)` returns a stable, pure hash of `path`, `kind`, `removed` and `added`, the same on every platform and run.
   - Identical hunks in one file get an ordinal suffix (`#1`, `#2`) in file order.
   - Moving a hunk (line shift) keeps its id. Any content change gives a new id.
3. **SeenModel** (create, core, pure):
   - Input: the diff files plus `Map<path, HostElement[] | null>`, where `null` means the file failed to parse.
   - Per hunk it returns `{id, path, hunk, status: 'seen'|'unseen'|'untrackable', owners, seenOwners, pages}`. Untrackable hunks carry `reason: 'not-jsx'|'deleted-file'|'binary'|'parse-error'|'no-element'`.
   - A hunk is `seen` when **all** its owners have been reported seen. Reason: a false "seen" is worse than a missed one, and a conditional `a ? <X/> : <Y/>` needs both branches viewed.
   - `markSeen(page, locs)` matches each loc to an owner by exact `path:start-end`. Locs that match no current element are ignored and counted. It records which page each hunk was seen on.
   - Returns totals `{seen, total, untrackable}`. Untrackable hunks are not part of `total`.
   - `snapshot()` / `fromSnapshot()` use a JSON contract: `{version: 1, entries: {[hunkId]: {ownerCount, seenOwners: number[], pages: string[], seenAt?, lastInDiffAt}}}`.
     - Partial progress is kept per owner index.
     - If `ownerCount` changes, that entry's progress resets.
     - Entries absent from the diff for more than 14 days are pruned.
     - Keep at most 5000 entries.
4. **Shared element collector** (create `vite-plugin/src/elements.ts`, export subpath `./elements`):
   - `collectHostElements(code, {filename, relPath, lang}) -> HostElement[] | null`, built on `parseSync` plus a manual AST walk (no `Visitor`).
   - Refactor `tagHostElements` to use the same host and explicit-attribute rules. Every fixture snapshot stays byte-identical.
   - The subpath imports nothing from `vite`.
5. **Sensor after HMR**: add `SeenTracker.resetReported()` and call it from the client on `vite:afterUpdate`. Elements that stay visible after an edit are then reported again. Without this, an edited hunk inside an unchanged range would stay unseen until a full reload.
6. **Extension, no `vscode` imports**:
   - Add `branch: string | null` to `ChangeResult`: the symbolic ref, or `null` when detached.
   - Create `src/elements.ts`. It analyses changed `.jsx`/`.tsx` files (outside `node_modules`, not deleted, not binary) from disk after each `computeChanges`, reusing the plugin collector.
   - Create `src/seenStore.ts`. It persists through a `{get(key), update(key, value)}` interface under the key `changeSpotlight.seen.v1:<root>:<branch ?? 'detached'>`.
7. **Bundle**:
   - Change the extension build to bundle the parser JS with `@oxc-parser/*` external, plus the `import.meta.url` define and banner.
   - Copy the host platform's `parser.<triple>.node` into `dist/`, resolving it through `require.resolve` from the plugin package rather than a hard-coded `.pnpm` path.
   - The `build extension` preLaunchTask (`pnpm --filter change-spotlight... build`) already builds the plugin first, because the plugin is a workspace devDependency. Keep it that way.
8. **Wiring** (`extension.ts`, `changeTracker.ts`):
   - Each `ChangeResult` updates the model.
   - Bridge `visibility` messages call `markSeen`. While a recompute is scheduled or running (expose `busy` on `ChangeTracker`), buffer them and apply them after the next result. Reason: before the debounce fires, the browser may report post-save lines while the model still holds old lines.
   - Persist after every change.
   - Log one line `Seen X of Y changes (Z not trackable)` when the totals change, and log unmatched-loc counts.
   - Add a status bar item stub with the text `Seen X/Y`.
   - Add the command `changeSpotlight.resetSeen` ("Change Spotlight: Reset Seen") that clears the current branch key.
   - Keep the single gutter dot style.
9. **Tests**:
   - Core: owners with nested, same-line and sibling elements, `<main>` spanning the file, deletion gaps at edges and inside.
   - Core: identity for a move, an edit, a duplicate and CRLF content.
   - Core: all-owners rule, partial progress, snapshot round-trip, pruning, and a changed owner count.
   - Plugin: collector parity with `tagHostElements` on every fixture, so both produce the same ranges. `resetReported` is covered with fake timers.
   - Extension store: round-trip with a fake memento, and branch isolation.
   - Integration (create `extension/test/seen.integration.test.ts`, temp repo plus simulated visibility messages):
     - see, then insert lines above: still seen
     - edit the hunk: unseen
     - restart, i.e. a new model from the same memento: state kept
     - switch branch: separate state
     - stale loc: ignored
     - `.ts`/`.css` hunks: untrackable
</requirements>

<constraints>
- **Static analysis in the extension (option c)**, not "every hunk in a `.tsx` counts" (a), because (a) counts hooks and imports as UI. Not browser-reported rendered elements (b) either, because with (b) the total is unknown until pages are opened, and never-rendered changes would vanish from Y.
- **One collector for tagging and counting**: the extension must see exactly the ranges the browser reports.
- Only saved files count. Unsaved buffers are ignored, because both git and Vite read the disk.
- Mark `@change-spotlight/core` additions as exports in `core/src/index.ts`. Core stays free of Node and DOM types: implement the hash in pure TS.
- Native binding only for the current platform. Per-platform `.vsix` files or the wasip1 fallback are Phase 9 decisions.
- **Git**:
  - Commit locally on `v1-phases` after each verified step, with a short conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never stage anything under `Notes/`.
  - Never push, switch branches or run other git write commands.
- **Open choices (recommended defaults)**:
  - Keep `PROTOCOL_VERSION = 1`, since no message shape changes.
  - Rename identity: the path is part of the hash, so a renamed file's hunks become unseen. Accept this for v1.
  - Coarse units: a new untracked file is one hunk, so any edit resets the whole file. Accept this and log it as a Phase 8 walkthrough item, rather than splitting units now.
  - Large owners: a `tall` element (for example `<main>` owning direct text) can count as seen quickly under the Phase 5 rule. Accept this and document it.
  - Plugin `include`/`exclude` options are invisible to the extension, so the extension assumes the defaults. Phase 9 can publish them in the discovery file.
</constraints>

<out_of_scope>
- Phase 8: TreeView, seen/unseen gutter styles, view-title counter, click-to-open, any polished UI.
- Phase 9: subfolder apps, choosing between dev servers, `.vsix` packaging, cross-platform bindings, CI.
- Later: reveal hints, outlines in the browser, extension -> plugin messages.
- Do not change the bridge transport, the Phase 5 seen rule thresholds or the transform output.
</out_of_scope>

<acceptance_criteria>
- [ ] Every rule in requirements 1-3 has a passing unit test, including `<main>` not owning nested hunks.
- [ ] Transform fixture snapshots are unchanged, and the collector matches the transform on every fixture.
- [ ] A `seen.test.ts` case shows that a visible element is reported again after `resetReported()`.
- [ ] `package.json` contributes `changeSpotlight.resetSeen`. `extension.ts` subscribes to `onMessage`, buffers visibility messages while `tracker.busy` is set, and creates the status bar item.
- [ ] The integration test shows the move/edit/restart/branch/stale behaviour from requirement 9.
- [ ] `packages/extension/dist/` contains `extension.js` and `parser.linux-x64-gnu.node`, and the analysis smoke test passes.
- [ ] `grep -n "from 'vscode'"` finds nothing in `src/{elements,seenStore,git}.ts`.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with the e2e tests run, not skipped.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `git diff --exit-code packages/vite-plugin/test/fixtures/__out__`: no output.
- `ls packages/extension/dist`: lists `extension.js` and `parser.linux-x64-gnu.node`.
- Smoke-test the bundled parser outside VS Code. Create a small esbuild entry, `packages/extension/test/smoke/elements-entry.ts`, with the same flags as the extension build and the `.node` copied beside it. Run it with `node` on `playground/src/App.tsx`: it prints a non-empty element list.
- `grep -nE "from 'vscode'" packages/extension/src/{elements,seenStore,git}.ts`: no output.
- `grep -n resetSeen packages/extension/package.json packages/extension/src/extension.ts`: matches in both files.
- `git status --short`: only intended changes. `Notes/` is never staged.
</verification>

<manual_checks_for_user>
These run after the automated work and do not block it.
1. Edit `playground/src/components/Counter.tsx` (a JSX line and a hook line), save, then run `pnpm --filter playground dev` and F5. Output shows `Seen 0 of N changes (M not trackable)`, and the status bar shows `Seen 0/N`. The parser loads in the Node 20.19 extension host with no error.
2. Scroll to the counter: the count goes up within about 1 s.
3. Add lines above the change and save: the count stays the same. Edit the changed line itself: it drops by one, then rises again after you look at it (HMR, no reload).
4. Reload the window: the count is kept. Switch to another branch and back: each branch keeps its own count.
5. Run "Change Spotlight: Reset Seen": the count goes back to `0/N`.
</manual_checks_for_user>

<workflow>
1. Read the files named in current_state.
2. Write a short step plan, then follow it without waiting:
   1. Core elements, owners, identity and SeenModel, with tests.
   2. Plugin collector, transform refactor, parity tests and `resetReported`.
   3. Extension `branch` field, `elements.ts`, `seenStore.ts`, bundling and the smoke test.
   4. Wiring, the command and the status bar stub.
   5. The integration test.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
After verification passes, run `/notes 7`. The note must be `Notes/07-seen-model.md` and describe Change Spotlight only. Update the Phase 7 row in `Notes/README.md` (do not commit it). Then report:
- the files changed and the commits made
- the decisions taken: the trackability approach, the owner rule, the all-owners rule, the hash and ordinal scheme, the storage key and pruning, and buffering during recompute
- the test count and run time
- the manual checks for the user
- follow-ups for Phases 8 and 9
</finish>
