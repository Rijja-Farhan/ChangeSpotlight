<role>
You are a senior TypeScript engineer who knows the Vite plugin API (HMR custom events), WebSockets and Vitest with headless Chrome. You will build the overlay data flow of Change Spotlight (Phase 10) on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It diffs the current branch against a base branch, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"` (repo-relative), and records which changed elements were visible in the browser ("Seen X of Y").
It is a pnpm 12 workspace using TypeScript 7: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19, same repo). Data flows today: browser client -> Vite HMR -> plugin -> authenticated WebSocket (the plugin is the server, the extension the client) -> extension -> SeenModel -> tree, gutter, status bar. Phases 10 to 14 add an in-browser overlay. This phase only moves the data both ways.
</project>

<current_state>
Branch `walkthrough`. Phases 0 to 8 are committed (latest `eaf06a2`). Phase 9 (release) is skipped for now. Environment: Linux, Node 22.22, Vitest 5.0.5, headless Chrome at `/usr/bin/google-chrome` driven by `playwright-core` (vite-plugin devDependency).
- **`core/src/protocol.ts`**: `PROTOCOL_VERSION = 1`. Messages `hello`, `welcome`, `click {loc, page}`, `visibility {page, seen[]}`. `parseMessage(value)` returns `{ok, message}` or `{ok: false, reason}` and allows unknown extra fields.
- **`core/src/seenModel.ts`**: `HunkStatus {id, path, hunk, status: 'seen'|'unseen'|'untrackable', reason?, owners: string[] (locs), seenOwners: number[] (indexes into owners), pages: string[], manual?}`. `SeenTotals {seen, total, untrackable}` counts hunks. `setSeen(id, seen)`.
- **`extension/src/seenController.ts`** (no `vscode`): `SeenState {totals, hunks, root, branch}` goes to `onChange` after every change. `markHunk(id, seen)` persists and notifies.
- **`extension/src/tree.ts`**: a private `preview(h)` (first non-blank added line, whitespace collapsed, max 60 chars plus "…", or `deleted: <line>`) and `lineOf(h) = max(newStart, 1)`.
- **`extension/src/bridgeClient.ts`**: `startBridgeClient` -> `{onMessage, onConnectionChange, connected(): string[], dispose}`. It cannot send to servers.
- **`extension/src/bridge.ts`**: `BridgeConnection {onMessage, onDidChangeConnection, connected(): number}`. `bridgeMessages.ts` `describeMessage` switches over every message type.
- **`extension/src/extension.ts`**: `render(state)` updates tree, gutter, status bar. Bridge `visibility` goes to `seen.visibility`, `click` to `openClicked` when `openOnClick` is on.
- **`vite-plugin/src/bridge.ts`**: `startBridge({..., onMessage})` -> `{send (broadcast to authenticated clients), info, close}`. Incoming messages are parsed with `parseMessage`. `index.ts` passes an `onMessage` that only logs "ignored".
- **`vite-plugin/src/index.ts`**: registers `server.ws.on` for `cs:click` and `cs:visibility` via `messages.ts` `createMessageHandler` (validated, forwarded with `bridge.send`). The browser entry is `src/client/index.ts` `startClient({protocolVersion, hot})`. It imports nothing from core at runtime. `HotChannel.on` takes a callback with no data.
- **Tests**: `vite-plugin/test/e2e/sensor.test.ts` (Chrome against `test/e2e/fixture/`, with `test/helpers/bridgeClient.ts` `connectClient(port, token)` acting as the extension). `vite-plugin/test/integration.test.ts` checks the production build for markers. `extension/test/bridgeClient.test.ts` runs the real client against the real plugin `startBridge`. `extension/test/tempRepo.ts` makes throwaway repos.
- **Uncommitted user work** (walkthrough edits): `playground/src/components/{Counter,FeatureList,Header}.tsx`, `playground/src/util.ts`, `packages/extension/package.json` (`openOnClick` default) and `Notes/README.md`.
</current_state>

<goal>
Send an overlay model from VS Code to every page of the dev app, and send "Open in VS Code" and "Mark as seen" requests from the page back to VS Code, so Phases 11 to 14 can draw outlines and controls from VS Code's seen model alone.
</goal>

<requirements>
1. **Protocol** (`core/src/protocol.ts`, stays version 1, because these are new types and old receivers drop unknown types):
   - `OverlayMessage {type: 'overlay', branch: string|null, totals: SeenTotals, items: OverlayItem[], pages: string[], unplaced: string[]}`.
   - `OverlayItem {loc, path, line, endLine, status: 'unseen'|'partly'|'seen', seenHunks, hunkIds: string[], preview, pages: string[]}`.
   - `OpenMessage {type: 'open', path, line}` and `MarkMessage {type: 'mark', hunkIds: string[]}`.
   - `parseMessage` validates every field, including each item. `line` and `endLine` are positive integers.
2. **`buildOverlay(state: SeenState): OverlayMessage`** (create `extension/src/overlay.ts`, no `vscode`):
   - One item per distinct owner loc of trackable hunks. Untrackable hunks produce no items.
   - `hunkIds` are the hunks that list the loc, sorted by line. The loc counts as seen in a hunk when its owner index is in `seenOwners`. `seenHunks` is that count. `status` is `seen` when it equals `hunkIds.length`, `partly` when it is above 0, otherwise `unseen`.
   - `line` and `endLine` span the first to last changed line of those hunks (`lineOf` rules). `preview` is the tree preview of the first hunk. Move `preview` and `lineOf` to a shared module and keep the tree output identical.
   - `pages` is the union of the hunks' pages, sorted. Top-level `pages` is the sorted union over all items. `unplaced` lists the locs of items with no pages.
   - Items are sorted by path, then line. `totals` and `branch` are copied from the state.
3. **Extension publishing**:
   - Add `send(message): number` to the bridge client (broadcast to welcomed servers, returns the count) and expose it on `BridgeConnection`.
   - Send the current overlay as soon as a server is welcomed. Send it again after every `SeenState` change, debounced (recommended 150 ms). Put the debounce in a no-`vscode` module with injectable timers.
   - Handle incoming `open`: accept only a repo-relative path without `..` segments that exists under the root. Open it at `line` with `preview: true`, taking focus.
   - Handle incoming `mark`: mark each id seen through `SeenController`. Unknown ids are ignored.
   - `describeMessage` logs `open` and `mark` and returns null for `overlay`.
4. **Plugin relay** (`vite-plugin/src`):
   - The bridge `onMessage` stores the last `overlay` and sends it to every page with `server.ws.send('cs:overlay', message)`. It logs other types as ignored.
   - When the browser client starts, it sends `cs:overlay-request`. The plugin replies to that page only, with the stored overlay, if there is one.
   - Add `cs:open` and `cs:mark` to `messages.ts`. Validate them with `parseMessage` and forward them with `bridge.send`.
5. **Browser client** (create `src/client/overlayData.ts`, wired from `index.ts`): keep the latest overlay after a type and `protocolVersion` check. Export `onOverlay(listener)`, `latestOverlay()`, `requestOpen(path, line)` and `requestMark(hunkIds)`. Extend `HotChannel.on` to pass event data. No UI.
6. **Tests**:
   - Core: `protocol.test.ts` cases for the three new types.
   - Extension: create `overlay.test.ts` (status rules, a loc shared by two hunks, partly seen, manual marks, deletions, sorting, `pages`/`unplaced`, untrackable excluded, a 500-item overlay serialises under the 1 MiB `MAX_PAYLOAD`). Create `overlay.integration.test.ts`, with a temp repo, the real `startBridge` and the real client: the overlay arrives on connect and after a `visibility` report; a `bridge.send(open)` reaches the client's `onMessage`.
   - Plugin: create unit tests for the relay and for the new `messages.ts` events. Create `test/e2e/overlay.test.ts` (Chrome, `test/e2e/fixture/`, `connectClient` as the extension):
     - an overlay sent before page load arrives at startup
     - a second overlay arrives live
     - `requestOpen` and `requestMark` reach the client exactly
     - an invalid `cs:open` is dropped
   - Extend the production-build test markers with `cs:overlay`, `cs:open` and `cs:mark`.
</requirements>

<constraints>
- **No `vscode` in `overlay.ts`, the debounce module or `seenController.ts`**, because Vitest has no extension host.
- **The browser never decides "seen"**: overlay status comes only from `SeenState`, and `mark` goes through `SeenController`.
- **Validate at every hop**: the plugin validates with `parseMessage` before forwarding either way. The extension also checks `open` paths, because page content is untrusted.
- **Keep the client free of runtime imports from core** (type imports only), so the browser bundle stays small. Add no `window` globals. The e2e test may import the client module by its `/@fs/` URL to call `requestOpen`.
- **Dev-only**: everything stays behind `apply: 'serve'` and the injected virtual module.
- **Tests stay hermetic**: use temp repos and `test/e2e/fixture/`, never the playground's working-tree files.
- Keep `PROTOCOL_VERSION = 1`, the seen rule, hunk ids, the snapshot format and the tree/gutter behaviour unchanged.
- **Git**:
  - Commit locally on `walkthrough` after each verified step, with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never push, switch branches or rewrite history.
  - Never stage `.claude/`, `Notes/` or the uncommitted user files listed in current_state. If a step truly needs `packages/extension/package.json`, stop and report instead of committing it.
</constraints>

<out_of_scope>
- Phase 11: Shadow DOM layer, outlines, labels, the toggle and Alt+Shift+S.
- Phase 12: dwell-progress sharing, the "being counted" ring, the green flash.
- Phase 13: edge arrows, the pill, the panel.
- Phase 14: hover card UI, overlay settings, accessibility and performance work.
- Phase 9: packaging, publishing, CI, several dev servers, subfolder apps.
</out_of_scope>

<acceptance_criteria>
- [ ] `parseMessage` accepts valid `overlay`, `open` and `mark` messages and rejects malformed ones (tested).
- [ ] `buildOverlay` follows every rule in requirement 2 (tested), and the tree tests still pass unchanged.
- [ ] The extension sends the overlay on connect and after state changes (debounced), and handles `open` and `mark` (integration-tested).
- [ ] A page loaded after an overlay was sent receives it at startup, and live updates arrive (Chrome e2e).
- [ ] `open` and `mark` sent from the page reach the bridge client. Invalid ones are dropped.
- [ ] The production build contains none of the new markers.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with the e2e tests run, not skipped.
- [ ] No commit touches the uncommitted user files.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `pnpm --filter change-spotlight exec vitest run test/overlay.test.ts test/overlay.integration.test.ts test/tree.test.ts`: all pass.
- `pnpm --filter @change-spotlight/vite-plugin exec vitest run test/e2e/overlay.test.ts test/integration.test.ts`: all pass, none skipped.
- `grep -n "from 'vscode'" packages/extension/src/overlay.ts packages/extension/src/seenController.ts`: no output.
- `grep -n "from '@change-spotlight/core'" packages/vite-plugin/src/client/*.ts | grep -v "import type"`: no output.
- `git diff --name-only eaf06a2..HEAD | grep -E "playground/src|extension/package.json|Notes/|\.claude/"`: no output.
- `git status --short`: the user files from current_state are still modified and uncommitted.
</verification>

<workflow>
1. Read `protocol.ts`, `seenModel.ts`, `seenController.ts`, `tree.ts`, `bridge.ts`, `bridgeClient.ts`, `bridgeMessages.ts`, `extension.ts`, the plugin's `index.ts`, `bridge.ts`, `messages.ts` and `src/client/*`, plus the related tests.
2. Write a short step plan, then follow it without waiting:
   1. Protocol types and guards.
   2. `buildOverlay` and the shared preview helper.
   3. Client `send` and the extension publishing and handlers.
   4. The plugin relay.
   5. The browser `overlayData`.
   6. The e2e test and production markers.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
Do not run `/notes`; the Phase 10 note is written separately afterwards. Make sure all work is committed with conventional messages, then report:
- the files changed and the commits made
- the decisions taken: the item status rule, the debounce delay, the overlay-request handshake, `open` path checks
- the test count and run time
- follow-ups, for example: a stale overlay after VS Code disconnects, several VS Code windows sending overlays to one dev server, `server.fs.allow` when the client file lies outside the app root
</finish>
