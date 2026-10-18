<role>
You are a senior TypeScript engineer who knows the VS Code extension API (TreeView, decorations, contributions) and Vitest. You will build the v1 UI of Change Spotlight (Phase 8) on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"` (repo-relative path), and records which changed elements were actually visible in the browser, so it can show "Seen X of Y".
It is a pnpm 12 workspace using TypeScript 7: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19, same git repo). Data flows: browser sensor -> Vite HMR -> plugin -> authenticated WebSocket -> extension -> SeenModel.
</project>

<current_state>
Phases 0 to 7 are committed on branch `v1-phases` (latest: `9361c2b` seen model wiring). Environment: Linux, Node 22.22, Vitest 5.0.5, VS Code 1.100.2 (`engines.vscode ^1.100.0`). No display or xvfb is available.
- **`core/src/seenModel.ts`**: `SeenModel(snapshot?, now?)` with `update(files, elements)`, `markSeen(page, locs)`, `hunks(): HunkStatus[]`, `totals(): {seen, total, untrackable}`, `snapshot()`, `reset()`. `HunkStatus {id, path, hunk, status: 'seen'|'unseen'|'untrackable', reason?: 'not-jsx'|'deleted-file'|'binary'|'parse-error'|'no-element', owners: string[] (data-cs-loc), seenOwners: number[], pages: string[]}`. Snapshot `{version: 1, entries: {[id]: {ownerCount, seenOwners, pages, seenAt?, lastInDiffAt}}}`. A hunk is seen when all owners are seen. Untrackable hunks are not in `total`.
- **`core/src/diff.ts`**: `Hunk {oldStart, oldCount, newStart, newCount, kind: 'add'|'delete'|'modify', removed[], added[]}`. A pure deletion has `newCount 0` and `newStart` = the line before the gap (0 at file top).
- **`extension/src/seenController.ts`** (no `vscode`): `SeenController(store, log, onChange, now?)`, `applyResult(result)` (returns early when `!result.ok`), `visibility(page, seen, busy)`, `reset()`, getter `state: SeenState | undefined`. `SeenState {totals, hunks, root, branch}` is passed to `onChange` after every result and every persisted change.
- **`extension/src/extension.ts`**: Output channel "Change Spotlight". One gutter style `media/dot.svg` (amber dot) on `changedRanges(result.files)`, set on visible editors. Status bar item `$(eye) Seen X/Y` whose click runs `changeSpotlight.refresh`. Commands `changeSpotlight.refresh` and `changeSpotlight.resetSeen` (no confirmation). `start()` returns early with a log line when there is no folder, git is missing or the folder is not a repo. Bridge `click` messages are only logged by `bridge.ts`.
- **`extension/src/bridge.ts`**: `connectBridge(gitDir, output)` -> `{onMessage, dispose}`. The underlying `bridgeClient.ts` client already has `onConnectionChange(listener)` and `connected(): string[]`, but `bridge.ts` does not expose them.
- **`extension/src/git.ts`**: `ChangeResult` is `{ok: true, root, branch, base, files, untracked, skipped}` or `{ok: false, reason: 'git-missing'|'not-a-repo'|'diff-too-large'|'git-error', message}`. `describeBase(base)`.
- **`extension/package.json`**: contributes the two commands and `changeSpotlight.baseBranch`. No views, menus or colors. Build: `scripts/build.mjs` (esbuild CJS bundle plus the copied oxc native binding).
- **Tests**: `extension/test/{seen.integration,seenStore,git,bridgeClient,...}.test.ts`, `memento.ts`, `tempRepo.ts`. `core/test/seen.test.ts`. Extension Vitest runs without `vscode`, so tested modules must not import it.
- **Playground**: one page (`/`, `index.html` -> `src/main.tsx` -> `App.tsx` with `Header`, `FeatureList`, `Counter`). No router.
- `.gitignore` contains `Notes/`. `Notes/README.md` is tracked and modified. There is no `Notes/07-*.md` yet; leave that alone.
</current_state>

<goal>
Turn the seen state into the v1 UI: a tree of changes grouped by page, seen/unseen gutter marks, a "Seen X of Y" counter, click-to-open, and reset and manual-mark commands. Done means a full walkthrough of a real branch on the playground feels right.
</goal>

<requirements>
1. **Manual marks in core** (`seenModel.ts`): add `setSeen(id, seen: boolean): boolean` (returns whether anything changed).
   - `true` sets all owners as seen, sets `seenAt` and adds an optional `manual: true` to the entry. `false` clears `seenOwners`, `pages`, `seenAt` and `manual`.
   - Untrackable or unknown ids return `false`. Expose `manual` on `HunkStatus`.
   - The snapshot stays `version: 1`, because the field is optional and old snapshots still load.
   - `SeenController.markHunk(id, seen)` persists and notifies.
2. **Tree model** (create `extension/src/tree.ts`, no `vscode`): `buildTree(state) -> TreeNode[]`. A node is `{id, kind: 'group'|'file'|'hunk', label, description?, tooltip?, icon?, contextValue?, collapsed?, open?: {path, startLine, endLine}, children?}`. Top-level groups, empty ones omitted, in this order:
   - "Not seen yet (N)": expanded, file -> hunk. Partially seen hunks show `k/n elements` in the description.
   - "Seen on `<page>` (N)": one group per page, sorted by page, each hunk listed flat by path then line. A hunk seen on two pages appears in both.
   - "Marked as seen (N)": seen hunks that have no pages.
   - "Not trackable (N)": collapsed, file -> hunk. The file description is the reason when all its hunks share one.
   - Each hunk is labelled `<basename>:<line>`. The description is a preview of the first non-blank added line (whitespace collapsed, max 60 chars plus "…"), or `deleted: <first removed line>` for deletions.
   - The tooltip lists the repo path, the line range, the status, the owners with seen ones marked, the pages and the reason.
   - `icon` is `'pass'` for seen, `'circle-outline'` for unseen and `'circle-slash'` for untrackable. `contextValue` is `hunk.seen`, `hunk.unseen` or `hunk.untrackable`.
   - `open` is set on every hunk except `deleted-file` hunks.
   - Node ids are unique and stable across rebuilds (group key plus hunk id), so expansion state survives refreshes.
3. **Decoration ranges** (create `extension/src/decorations.ts`, no `vscode`): `decorationRanges(hunks) -> Map<path, {seen, unseen, untrackable}: LineRange[]>` (1-based, merged).
   - A hunk with lines covers `newStart..newStart+newCount-1`.
   - A deletion marks line `max(newStart, 1)`.
   - A line claimed by two hunks takes one style, by priority unseen > seen > untrackable.
   - `deleted-file` hunks produce nothing.
4. **Contributions** (`extension/package.json`, `media/`):
   - Add view container `changeSpotlight` in the activity bar with monochrome `media/spotlight.svg`, and a tree view `changeSpotlight.changes` named "Changes".
   - Add commands `openHunk`, `markSeen` ("Mark as Seen") and `markUnseen` ("Mark as Unseen"), all hidden from the Command Palette (`menus.commandPalette` with `when: false`), because each needs a tree item as its argument.
   - In the view title, add Refresh (`$(refresh)`) and Reset Seen (`$(clear-all)`).
   - In the item context menu, show `markSeen` on `hunk.unseen` and `markUnseen` on `hunk.seen`.
   - Add `viewsWelcome` entries keyed on the context key `changeSpotlight.status` (`noFolder`, `noRepo`, `gitMissing`, `loading`, `error`, `noChanges`), each with a one-line explanation. `error` and `noChanges` include a `[Refresh](command:changeSpotlight.refresh)` link.
   - Add the setting `changeSpotlight.openOnClick` (boolean, default `false`).
   - Add the colors `changeSpotlight.unseenRuler` and `changeSpotlight.seenRuler`, with dark, light and highContrast defaults.
   - Replace `media/dot.svg` with gutter SVGs in light and dark variants: `gutter-unseen-*` (filled amber dot), `gutter-seen-*` (green check) and `gutter-untrackable-*` (grey hollow ring). Use different shapes, not only colours, so the styles stay distinguishable for colour-blind users.
5. **VS Code glue** (thin, in `extension.ts` plus new `treeView.ts` and `gutter.ts` as needed):
   - Register the tree view in `activate` before any early return, so welcome content always shows.
   - The view `description` is `Seen X of Y`. The badge is the unseen count, or none when it is 0.
   - When changes exist and no dev server is connected, `TreeView.message` explains how to start one. For this, extend `BridgeConnection` with `connected(): number` and `onDidChangeConnection`.
   - Set `changeSpotlight.status` on every state change.
   - Three decoration types: per-theme `gutterIconPath`, plus `overviewRulerColor` (ThemeColor) for the unseen and seen styles. Driven by `SeenState`, not `changedRanges`, and reapplied to visible editors on every state change and editor change.
   - Status bar: keep `$(eye) Seen X/Y`. Clicking it runs `changeSpotlight.changes.focus`. The tooltip shows the totals with the untrackable count.
   - `openHunk` opens `root/path` with `preview: true` and selects the hunk range (an empty selection for deletions), revealed in the centre.
   - `resetSeen` asks for confirmation with a modal that names the branch.
   - `openOnClick`: a browser `click` message opens the loc's file at its start line with `preserveFocus: true`, if the file exists.
6. **Playground second page** (create `playground/about.html` and `playground/src/about.tsx`): it renders `Header` and one new small component, so the walkthrough can show page groups and a hunk seen on two pages. Vite serves it at `/about.html` without config.
7. **Tests** (create `extension/test/{tree,decorations,manifest}.test.ts`; extend `core/test/seen.test.ts`):
   - `setSeen` behaviour, including across a snapshot round-trip.
   - Every tree group rule, preview truncation, id uniqueness and stability, the multi-page hunk, and the deletion label.
   - Decoration ranges for line spans, deletions at the top and in the middle, priority and `deleted-file`.
   - Manifest: every command in menus and `viewsWelcome` links is contributed. Every contributed command is registered in `src/*.ts` (grep `registerCommand('<id>'`). Every icon path exists. The view's container exists.
</requirements>

<constraints>
- **No `vscode` in `tree.ts`, `decorations.ts`, `seenController.ts`**: Vitest has no extension host. The glue only maps nodes and ranges to API objects.
- **No extension-host test (`@vscode/test-electron`)**: it needs a display and a VS Code download. Cover the UI with the pure tests and the manifest test, plus the manual checklist.
- **Unseen hunks have no page**: a page is only known once something is seen. That is why "Not seen yet" is grouped by file.
- Gutter icons are SVG files and cannot use ThemeColor. Pick colours readable on both the default light and dark themes, and use ThemeColor only for the overview ruler and tree icons (`testing.iconPassed` for seen).
- Decorations reflect the last saved state, because git and Vite read the disk. VS Code shifts ranges while you type, which is enough for v1.
- Keep the existing Output log lines. Keep `PROTOCOL_VERSION = 1` and leave the plugin, sensor and bridge transport unchanged.
- **Git**:
  - Commit locally on `v1-phases` after each verified step, with a short conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never stage anything under `Notes/`.
  - Never push, switch branches or run other git write commands.
- **Open choices (recommended defaults)**:
  - Item = hunk, not element. Owners appear in the tooltip, because the counter counts hunks.
  - Overview ruler marks only unseen and seen, so the scrollbar shows what is left. Untrackable lines get no ruler mark.
  - `markUnseen` on an element still on screen only returns to seen after an HMR update or a reload, because the sensor reports each loc once per page load. Document this.
</constraints>

<out_of_scope>
- Phase 9: `.vsix` packaging, per-platform bindings, publishing, README, CI, choosing between several dev servers, subfolder apps, rename and large-diff hardening.
- Later: browser outlines and off-screen markers, reveal hints, usage graph webview, MCP report, extension -> plugin messages.
- Do not change the Phase 5 seen rule, the hunk identity scheme or the snapshot key.
</out_of_scope>

<acceptance_criteria>
- [ ] `setSeen` is unit-tested, and the controller persists manual marks.
- [ ] `tree.test.ts` covers every group rule from requirement 2. `decorations.test.ts` covers requirement 3.
- [ ] `manifest.test.ts` passes, and all referenced media files exist in light and dark variants.
- [ ] `extension.ts` no longer uses `changedRanges` or `dot.svg`. It registers the view, the three decoration types and all contributed commands.
- [ ] `BridgeConnection` exposes the connection count and its change event.
- [ ] `/about.html` renders in the playground dev server.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with the e2e tests run, not skipped.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `pnpm --filter change-spotlight exec vitest run test/tree.test.ts test/decorations.test.ts test/manifest.test.ts`: all pass.
- `grep -nE "from 'vscode'" packages/extension/src/{tree,decorations,seenController,git,seenStore,elements}.ts`: no output.
- `grep -rn "dot.svg\|changedRanges" packages/extension/src`: no output.
- `ls packages/extension/media`: lists `spotlight.svg` and six `gutter-*` SVGs.
- Start `pnpm --filter playground dev` in the background, run `curl -s localhost:<port>/about.html | grep -c about`, expect at least 1, then stop the server.
- `git status --short`: only intended changes. `Notes/` is never staged.
</verification>

<manual_checks_for_user>
These run after the automated work and do not block it.
1. Setup: `git switch -c walkthrough` from `v1-phases`, then set `changeSpotlight.baseBranch` to `v1-phases` in the playground's workspace settings. Edit a JSX line in `Counter.tsx` and `Header.tsx`, a hook line in `Counter.tsx`, and add `playground/src/util.ts`. Delete a JSX line in `FeatureList.tsx`. Save.
2. F5, then start `pnpm --filter playground dev`. Open the activity bar icon. "Not seen yet" lists the JSX hunks by file, "Not trackable" is collapsed and holds `util.ts` and the hook hunk, and the title shows `Seen 0 of N`. The badge and status bar match.
3. Before starting Vite, the view shows the "no dev server" message. It clears once Vite is connected.
4. Gutter: amber dots on unseen lines, a mark on the line above the deletion, grey rings on untrackable lines. Check that all of these read well in Light+ and Dark+.
5. Open `/` and scroll. Hunks move to "Seen on /" with check icons, and the gutter and ruler update within about 1 s. Open `/about.html`: the `Header` hunk also appears under "Seen on /about.html".
6. Click a tree item: the file opens with the hunk selected. Use "Mark as Seen" and "Mark as Unseen" from the context menu, and check that the counts follow.
7. Enable `changeSpotlight.openOnClick` and click the counter button in the browser: the editor jumps to it.
8. Reset Seen from the view title: a confirmation names the branch, and the counts return to 0. Reload the window: state and expansion are kept.
9. Open a non-git folder: the welcome text shows. Note anything that feels wrong as Phase 9 input.
</manual_checks_for_user>

<workflow>
1. Read `seenModel.ts`, `seenController.ts`, `extension.ts`, `bridge.ts`, `bridgeClient.ts`, `package.json`, `scripts/build.mjs` and the existing tests.
2. Write a short step plan, then follow it without waiting:
   1. Core `setSeen` and the controller `markHunk`, with tests.
   2. `tree.ts` and `decorations.ts`, with tests.
   3. Contributions, media and the manifest test.
   4. VS Code glue: the view, welcome states, gutter, status bar, bridge connection, commands and `openOnClick`.
   5. The playground second page.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
After verification passes, run `/notes 8`. The note must be `Notes/08-v1-ui.md` and describe Change Spotlight only. Update the Phase 8 row in `Notes/README.md` (do not commit it). Then report:
- the files changed and the commits made
- the decisions taken: the tree shape, gutter styles and colours, deletion markers, manual marks, `openOnClick`, welcome states
- the test count and run time
- the manual checks for the user
- follow-ups for Phase 9
</finish>
