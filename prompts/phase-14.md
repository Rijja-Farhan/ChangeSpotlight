<role>
You are a senior TypeScript engineer who knows the DOM (Shadow DOM, focus management, WCAG contrast, requestAnimationFrame, PerformanceObserver), the VS Code extension API (`workspace.getConfiguration`, `onDidChangeConfiguration`) and Vitest with headless Chrome. You will build Phase 14 of Change Spotlight's browser overlay, "Actions, settings and polish", on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It diffs the current branch against a base branch, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"` (repo-relative), and records which changed elements were visible in the browser ("Seen X of Y").
It is a pnpm workspace using TypeScript: `packages/core` (pure logic and protocol), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19, pages `index.html` and `about.html`). VS Code sends an overlay model to every page (Phase 10). The page draws outlines and labels (Phase 11), a "being counted" ring and a green flash (Phase 12), and edge arrows, a pill and a panel (Phase 13). This last overlay phase adds the label hover card with actions, two VS Code settings, an accessibility pass and a 500-element performance budget.
</project>

<current_state>
Branch `walkthrough`, latest commit `3fcfd5e` (Phase 13). Phase 9 is skipped. Linux, Node 22, Vitest 5.0.5, headless Chrome at `/usr/bin/google-chrome` via `playwright-core`. Vitest runs files one at a time.
- **`packages/core/src/protocol.ts`**: `PROTOCOL_VERSION = 1`. `OverlayMessage { type: 'overlay'; branch; totals: { seen, total, untrackable }; items: OverlayItem[]; pages; unplaced }`. `OverlayItem { loc, path, line, endLine, status: 'unseen' | 'partly' | 'seen', seenHunks, hunkIds, preview, pages }`. `OpenMessage { path, line }`, `MarkMessage { hunkIds }`. `parseMessage` validates overlays with `isOverlay`/`isOverlayItem` and allows unknown extra fields. Tests: `packages/core/test/protocol.test.ts`.
- **Extension** (`packages/extension/src/`):
  - `overlay.ts`: pure `buildOverlay(SeenState)`.
  - `overlayPublisher.ts`: `OverlayPublisher(send, timers, delayMs)` with debounced `update(state)` and immediate `flush()`. It also holds `openTarget(requested)`, the path check for `open`.
  - `extension.ts`: creates the publisher. `bridge.onMessage` handles `open` via `openRequested` (uses `openTarget`) and `mark` via `seen.markHunks(ids, true)`. Settings are read with `getConfiguration('changeSpotlight').get<boolean>('openOnClick', false)`.
  - `package.json` `contributes.configuration` has `changeSpotlight.baseBranch` and `changeSpotlight.openOnClick`.
  - `test/manifest.test.ts` checks settings used in source against the manifest. Its regex `get<\w+>\('(\w+)'` does not match dotted keys.
  - `test/overlay.integration.test.ts` wires real parts: temp repo, `computeChanges`, `SeenController`, `SeenStore` (with `test/memento.ts`), `OverlayPublisher`, `startBridgeClient`, and the plugin's `startBridge`.
- **Plugin client** (`packages/vite-plugin/src/client/`):
  - `overlayData.ts`: `onOverlay`, `latestOverlay`, `requestOpen(path, line)` and `requestMark(hunkIds)`. Both requests exist but nothing in the UI calls them yet.
  - `overlayLayer.ts`: Shadow DOM host `<change-spotlight-overlay>` and a single rAF `draw()` (read, then write).
    - Labels are `div.label[data-cs-label][data-loc][data-status]` with `pointer-events: none`, reused by key `loc\n<instance>`. Their `textContent` is the label text.
    - Visibility is stored in `sessionStorage` `STORAGE_KEY = 'change-spotlight:outlines'`, read once at start with a default of `true`.
    - The read pass builds `present` and `presentElements` with `[...spread]` per instance and `new Map(items…)` per frame. It calls `edgeCounts` and `panelSections` on every frame.
  - `finder.ts` (pure) and `finderUi.ts` (DOM): arrows, pill, panel and `HIDE_SEEN_KEY = 'change-spotlight:hide-seen'` (default off). The palette lives in `FINDER_STYLE` and `STYLE`.
  - `outlines.ts`: `fileLine`, `labelText`, `placeLabels`, `inViewport`.
- **Tests** (`packages/vite-plugin/test/`): unit `outlines`, `live`, `finder`. E2E `e2e/{outlines,live,sensor,overlay,finder}.test.ts` with fixtures `e2e/fixture-*`. `helpers/bridgeClient.ts` `connectClient(port, token)`. `integration.test.ts` checks production-build markers. The e2e tests read label `textContent` exactly (for example `seen · Row.tsx:1`).
- **Visual spec**: `.claude/overlay-design.md`. Needed values are inlined below.
- **Uncommitted user work, never commit it**: `playground/src/components/{Counter,FeatureList,Header}.tsx`, `playground/src/util.ts`, `Notes/README.md`, and one hunk in `packages/extension/package.json` that changes the `openOnClick` default from `false` to `true`.
</current_state>

<goal>
Finish the overlay so a reviewer can act on a change straight from the page (open it in VS Code, mark it as seen) and set its defaults in VS Code. Every control must work from the keyboard and meet contrast, and the overlay must stay smooth with 500 changed elements. Then v1's overlay is done and Phase 9 (release) can follow.
</goal>

<requirements>
1. **Protocol** (`packages/core/src/protocol.ts`):
   - Add `OverlaySettings { showByDefault: boolean; hideSeen: boolean }` and an optional `settings?: OverlaySettings` field on `OverlayMessage`.
   - `isOverlay` accepts a message without `settings`. When `settings` is present it must be an object with both booleans, otherwise the result is `invalid-fields`.
   - Add tests for all three cases.
2. **VS Code settings**:
   - Add `changeSpotlight.overlay.showByDefault` (boolean, default `true`) and `changeSpotlight.overlay.hideSeen` (boolean, default `false`) to `contributes.configuration`, with `markdownDescription`s.
   - `OverlayPublisher` includes the current `settings` in every overlay it sends, through an injected getter, so it stays vscode-free and unit-testable.
   - In `extension.ts`, `onDidChangeConfiguration` with `affectsConfiguration('changeSpotlight.overlay')` calls `flush()`.
   - Extend `manifest.test.ts` so dotted keys are checked too.
3. **Browser settings** (in `overlayLayer.ts`):
   - When the tab has no stored choice under `STORAGE_KEY` or `HIDE_SEEN_KEY`, outline visibility follows `settings.showByDefault` and hide-seen follows `settings.hideSeen`. This includes live changes to the settings.
   - A stored per-tab choice (eye, Alt+Shift+S, panel checkboxes) always wins. Without `settings`, keep today's defaults (on, off).
   - `showByDefault: false` hides outlines, labels and arrows like the eye does. The pill and eye stay visible.
4. **Hover card** (create `src/client/card.ts` for the DOM; pure text helpers go in a pure module):
   - Labels become `<button type="button">` elements with `pointer-events: auto`. They keep `data-cs-label`, `data-loc`, `data-status`, the class `label` and identical `textContent`. Outlines stay click-through.
   - One card node `[data-cs-card]` with `role="dialog"` and `aria-label` set to the card title.
     - Style: 240px wide, bg `#1d1c1a`, radius 8px.
     - Title `${basename} · lines ${line}–${endLine}`, or `· line ${line}` when they are equal, in `#fbbf72` monospace.
     - A preview box (bg `#2b2926`, text `#d8d5ce`, monospace) showing `+ ${preview}`, set as text, never as HTML.
     - Buttons `[data-cs-action="open"]` `Open in VS Code` (bg `#f6f5f2`, text `#1d1c1a`) and `[data-cs-action="mark"]` `Mark as seen` (outlined, border `#5c5a55`, text `#f6f5f2`). Hide the mark button when the status is `seen`.
   - Opening and closing:
     - The card opens on pointer hover over a label, and on label focus or click. It stays open while the pointer is over the label or the card, and closes about 200 ms after the pointer leaves both.
     - Escape closes it and returns focus to the label.
     - In the DOM it sits right after its label, so the next Tab reaches its buttons.
     - It is placed below the label, or above it when there is no room, clamped to the viewport.
     - It closes when its label is no longer drawn.
   - Actions:
     - Open calls `requestOpen(item.path, item.line)`.
     - Mark calls `requestMark(item.hunkIds)`.
     - While open, the card follows new overlays, so after VS Code confirms a mark the status and the mark button update.
5. **Accessibility**:
   - Every control is a native `<button>`, `<input type="checkbox">` or `<a href>` (Open page), reachable with Tab.
   - Every control has a `:focus-visible` ring that stays visible on any page background, for example a two-tone ring (`#fbbf72` plus a `#1d1c1a` outer ring).
   - Status is never shown by colour alone: label text, the panel rows' sr text, dashed vs. solid outlines.
   - Create `src/client/palette.ts`: a WCAG `contrastRatio(fg, bg)` and a `CONTRAST_PAIRS` list of every text/background pair used (labels unseen/seen/counting, arrows plus hover, pill, panel muted texts, `Scroll to`/`Open page`, card title/preview/buttons). Also list non-text pairs (focus ring, outlined button border).
   - Create `test/contrast.test.ts`. Text pairs must be at least 4.5:1 and non-text pairs at least 3:1. The test also checks that every listed colour occurs in the client style sources (read with `fs`), so the list cannot drift. Fix failing colours with the smallest change and report them.
6. **Performance**:
   - Create `test/e2e/fixture-perf/index.html` and `test/e2e/perf.test.ts`, with an overlay of 500 items in mixed statuses, and two layouts:
     - (a) a long list of 500 elements scrolled in 30 steps
     - (b) a dense grid with all 500 in the viewport
   - Measure the duration of each `draw()` through a test hook: when `window.__csDrawTimes` is an array, `draw()` pushes `performance.now()` deltas. Otherwise it does nothing.
   - Budgets: list p95 < 8 ms, grid p95 < 16 ms, and no PerformanceObserver `longtask` > 50 ms during the scroll.
   - Optimise until the budgets are met. Candidates:
     - build per-loc arrays without spreading
     - cache `byLoc` per overlay
     - skip `panelSections` while the panel is closed
     - skip label work for off-screen boxes
7. **Walkthrough**:
   - Create an automated walkthrough e2e, recommended at `packages/extension/test/walkthrough.e2e.test.ts`. It uses a temp git repo with changed `.tsx` files and two static HTML pages whose hand-written `data-cs-loc` values match the diff.
   - It runs a real Vite dev server with the plugin, and in-process `computeChanges` + `SeenController` + `OverlayPublisher` + `startBridgeClient`. Headless Chrome then covers:
     1. the overlay arrives
     2. scrolling counts an element as seen
     3. card Open delivers an `open` with the right path and line
     4. card Mark turns the item green
     5. a settings change re-sends the overlay and hide-seen applies
     6. a reload keeps the state
   - Add `playwright-core` to the extension's devDependencies if needed.
   - Add `data-cs-card` to the production markers in `test/integration.test.ts`.
</requirements>

<constraints>
- **VS Code stays the only source of status.** The card shows what the overlay says. Mark only sends a request, so the browser never turns an item green on its own.
- **Protocol stays at version 1.** `settings` is optional, so older and newer sides still interoperate.
- **Layout reads stay inside the single rAF `draw()`.** The card measures its label from the rects of that pass, which avoids layout thrash with 500 elements.
- **Pure logic stays in DOM-free modules**, since Vitest unit tests run in Node. Client code keeps type-only imports from core.
- **Existing tests keep passing unchanged**: label text, `button.eye[aria-pressed]`, `[aria-label="Hide outlines"]`, `STORAGE_KEY` and `HIDE_SEEN_KEY` semantics.
- **Hermetic tests**: fixtures and temp repos only, never the playground working tree, which has uncommitted user edits.
- **`packages/extension/package.json` has an uncommitted user hunk** (`openOnClick` default). Commit only your hunks:
  - write your diff to a patch with only your hunks
  - stage it with `git apply --cached`
  - confirm with `git diff --cached` that `openOnClick` is not in the staged diff, and `git diff` that it is still unstaged
- **Git**:
  - Commit locally on `walkthrough` after each verified step, with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never push, switch branches or rewrite history.
  - Never stage `.claude/`, `Notes/` or the user files listed in current_state.
</constraints>

<out_of_scope>
- Phase 9: subfolder apps, several dev servers, large-diff hardening, `.vsix` packaging, npm publishing, README, CI.
- The "Later" list: the usage-graph webview, global style warnings, affected pages, backend tracing, the MCP agent report, Next.js and Vue support.
- Changes to the seen rule, `buildOverlay` item contents, the panel's section rules or `openTarget`.
</out_of_scope>

<acceptance_criteria>
- [ ] `parseMessage` accepts overlays with and without valid `settings` and rejects malformed `settings` (unit).
- [ ] Both settings are in the manifest. Every overlay sent carries them, and a configuration change re-sends (unit + walkthrough).
- [ ] With no stored tab choice the page follows the settings. A stored choice overrides them (e2e).
- [ ] Hovering or focusing a label opens the card with the right title and preview. Open and Mark send the right `open`/`mark`, Escape closes and restores focus, and Tab reaches both card buttons (e2e).
- [ ] Every text pair is at least 4.5:1 and every non-text pair at least 3:1 (unit). Every control shows a focus ring (e2e checks the computed outline on focus).
- [ ] The perf test meets list p95 < 8 ms, grid p95 < 16 ms, and has no long task > 50 ms.
- [ ] The walkthrough e2e passes end to end.
- [ ] The production build contains none of the overlay markers, including `data-cs-card`.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with no e2e test skipped.
- [ ] No commit contains the `openOnClick` hunk, the user files, `.claude/` or `Notes/`.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `pnpm --filter @change-spotlight/vite-plugin exec vitest run test/contrast.test.ts test/e2e/perf.test.ts test/e2e/card.test.ts test/integration.test.ts`: all pass, none skipped. The perf test logs its p95 values.
- `pnpm --filter @change-spotlight/core exec vitest run test/protocol.test.ts`, then `pnpm --filter change-spotlight exec vitest run test/manifest.test.ts test/overlay.test.ts test/walkthrough.e2e.test.ts`: all pass.
- `grep -n "from '@change-spotlight/core'" packages/vite-plugin/src/client/*.ts | grep -v "import type"`: no output.
- `git log -p 3fcfd5e..HEAD -- packages/extension/package.json | grep -n openOnClick`: no `"default": true` line for `openOnClick`.
- `git diff --name-only 3fcfd5e..HEAD | grep -E "playground/|Notes/|\.claude/"`: no output.
- `git status --short`: the user files are still modified, and `git diff packages/extension/package.json` still shows the `openOnClick` hunk.
</verification>

<workflow>
1. Read the files named in current_state, plus `.claude/overlay-design.md`, `test/e2e/finder.test.ts` and `packages/extension/test/overlay.integration.test.ts`.
2. Write a short step plan, then follow it without waiting:
   1. Protocol plus settings in the extension.
   2. Browser settings.
   3. Labels as buttons plus the card (create `test/e2e/card.test.ts` covering hover, focus, Tab, Escape, Open and Mark, and settings precedence).
   4. Accessibility with palette and contrast.
   5. The perf test and optimisations.
   6. The walkthrough e2e.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
Do not run `/notes`. The Phase 14 note is written separately. Make sure all work is committed, then report:
- the files changed and the commits made
- the decisions you made:
  - the settings precedence
  - card open/close timing
  - colours changed for contrast
  - optimisations and the measured p95 before and after
- the test count and run time
- a manual walkthrough checklist for the user. Run the playground with F5 in VS Code and check: outlines, ring, green flash, arrows, pill, panel, card Open and Mark, both settings, Tab through every control, reduced motion.
- follow-ups, for example the label Tab order not following document order
</finish>
