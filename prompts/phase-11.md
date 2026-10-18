<role>
You are a senior TypeScript engineer who knows the DOM (Shadow DOM, ResizeObserver, MutationObserver, requestAnimationFrame), Vite dev-server internals and Vitest with headless Chrome. You will build the outlines and labels of Change Spotlight's browser overlay (Phase 11) on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It diffs the current branch against a base branch, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"` (repo-relative), and records which changed elements were visible in the browser ("Seen X of Y").
It is a pnpm workspace using TypeScript: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19). Since Phase 10, VS Code sends an overlay model to every page and the page can send "open" and "mark" requests back. Phases 11 to 14 draw the overlay UI from that model. This phase draws outlines and labels only.
</project>

<current_state>
Branch `walkthrough`. Phases 0 to 8 and 10 are committed (latest `ab71368`, Phase 10). Phase 9 is skipped. Environment: Linux, Node 22, Vitest 5.0.5, headless Chrome at `/usr/bin/google-chrome` driven by `playwright-core`.
- **`core/src/protocol.ts`**: `OverlayMessage {type: 'overlay', branch, totals {seen, total, untrackable}, items: OverlayItem[], pages, unplaced}`. `OverlayItem {loc, path, line, endLine, status: 'unseen'|'partly'|'seen', seenHunks, hunkIds: string[], preview, pages}`. `path` is repo-relative, `line` is 1-based.
- **`vite-plugin/src/client/index.ts`**: `startClient({protocolVersion, hot})`, injected only by the dev server through `virtual:change-spotlight/client`. It calls `connectOverlay(hot, protocolVersion)` and `startSensor`, and listens to `vite:afterUpdate`. `HotChannel.on(event, callback(data))`. Type-only imports from core.
- **`vite-plugin/src/client/overlayData.ts`**: module-level overlay copy. Exports `connectOverlay`, `onOverlay(listener)` (also calls the listener at once with the current overlay; returns unsubscribe), `latestOverlay()`, `requestOpen`, `requestMark`.
- **`vite-plugin/src/client/sensor.ts` / `seen.ts`**: the visibility sensor (DOM adapter plus a pure, unit-tested `SeenTracker`). This split is the pattern to follow.
- **Tests**: `test/e2e/overlay.test.ts` starts a dev server on `test/e2e/fixture/`, connects `test/helpers/bridgeClient.ts` `connectClient(port, token)` as the fake extension, sends overlays with `client.ws.send(JSON.stringify(overlay))`, and reads client modules in the page through their `/@fs/` URL, passed as a string to `page.evaluate` (Vitest rewrites `import()` inside functions). `test/e2e/sensor.test.ts` uses the same fixture. `test/integration.test.ts` builds the playground for production and asserts that markers (`data-cs-loc`, `cs:overlay`, ...) are absent.
- **Visual spec**: `.claude/overlay-design.md` (read it; the values this phase needs are copied into requirements).
- **Uncommitted user work** (walkthrough edits): `playground/src/components/{Counter,FeatureList,Header}.tsx`, `playground/src/util.ts`, `packages/extension/package.json`, `Notes/README.md`.
</current_state>

<goal>
Draw an outline and a label over every element of the current page that the overlay lists, kept exactly in place as the page scrolls, resizes and re-renders, with a remembered on/off toggle. This makes "what changed and what have I seen" visible in the app itself, from VS Code's seen model alone.
</goal>

<requirements>
1. **Layer** (create `src/client/overlayLayer.ts`, started from `startClient`):
   - One host element `<change-spotlight-overlay>` appended to `document.body`, with an open Shadow DOM root. All styles live inside the shadow root.
   - The host is `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647` and takes no layout space. Only the layer's own controls set `pointer-events: auto`.
   - If the app removes the host, append it again.
2. **Outlines**:
   - For each overlay item, find the elements with `[data-cs-loc="<item.loc>"]` (escape the value with `CSS.escape`). Draw one box per connected element with a non-zero bounding box, positioned from `getBoundingClientRect()`. Never modify app elements.
   - Shared loc (list items): outline every instance; label only the first instance in document order that has a box.
   - Test hooks inside the shadow root: each outline has `data-cs-outline`, `data-loc`, `data-status`. Each label has `data-cs-label`, `data-loc`.
3. **Keep in place**: re-measure on window scroll (capture phase, so inner scroll containers count), window resize, ResizeObserver on outlined elements, MutationObserver on `document.body` (childList, subtree, attributes `data-cs-loc`, `class`, `style`), `vite:afterUpdate`, and every new overlay from `onOverlay`. Coalesce all triggers into at most one measure-and-draw pass per animation frame. Read layout first, then write, in that pass.
4. **Styles** (from the spec):
   - Unseen: `2px dashed #b45309`, halo `box-shadow: 0 0 0 9px rgba(180,83,9,0.12)`. Label bg `#b45309`, white filled dot icon, text `not seen yet · Counter.tsx:8`.
   - Seen: `2px solid #15803d`. Label bg `#15803d`, check icon, text `seen · Header.tsx:4`.
   - Partly seen: amber `#b45309` dashed outline with the halo, label text `<seenHunks>/<hunkIds.length> · Counter.tsx:8`.
   - Labels: text `#ffffff`, monospace 12px, height 22px, padding `0 8px`, radius 4px, system fonts only. `Counter.tsx:8` is the basename of `item.path` plus `item.line`.
5. **Label placement**: put a label just above the element's top-left corner. If that is outside the viewport, put it inside the box at the top-left. If it overlaps a label already placed, move it aside (to the right, else down) until it does not, staying inside the viewport. Put the label text and placement logic in a pure module (create `src/client/outlines.ts`) with unit tests.
6. **Toggle**:
   - Visible by default whenever the plugin runs.
   - `Alt+Shift+S` (match `event.code === 'KeyS'`, because on macOS Alt changes `event.key`; recommended: ignore it while focus is in an editable field) and a minimal eye button toggle it. The eye button is a real `<button>`, fixed bottom-right, 40px round, with `aria-label` "Hide outlines" or "Show outlines" and `aria-pressed`.
   - Store the state in `sessionStorage` under `change-spotlight:outlines` (`on`/`off`), so it is per tab and survives reloads.
   - When off, draw no outlines or labels, but keep the eye button.
7. **Tests**:
   - Unit: `test/outlines.test.ts` for label texts (all three statuses, nested paths, basename) and placement (no overlap, viewport clamping, the fallback inside the box).
   - E2E: create `test/e2e/outlines.test.ts` with a new fixture `test/e2e/fixture-outlines/index.html` (several tagged elements, a three-item list sharing one loc, a scrollable inner container, enough height to scroll). Cover:
     - each outline matches its element's bounding box within 1px
     - after `window.scrollBy`, an inner-container scroll, `page.setViewportSize` and an element size change, the outlines match again
     - an element added later gets an outline
     - three outlines and one label for the shared loc
     - label texts and styles per status
     - no two labels intersect for adjacent elements
     - `Alt+Shift+S` and the eye button hide and show; the state survives a reload; a new page starts visible
     - an updated overlay restyles an outline from unseen to seen
   - Add `change-spotlight-overlay` and `data-cs-outline` to the production-build markers in `test/integration.test.ts`.
</requirements>

<constraints>
- **The overlay draws only what VS Code says**: status and labels come from `OverlayItem` via `onOverlay`, never computed in the browser, so Phase 12's state model stays single-sourced.
- **Reuse `overlayData.ts`**; do not add a second channel or listen to `cs:overlay` directly.
- **Keep the client free of runtime imports from core** (type imports only), and add no `window` globals. Tests read state through the shadow root or the module's `/@fs/` URL.
- **Pure logic in plain modules, DOM in a thin adapter** (as `seen.ts` / `sensor.ts`), because Vitest runs in Node without a DOM.
- **Layout reads only inside the rAF pass**, never in observer callbacks, to avoid layout thrashing and feedback loops with the MutationObserver (mutations inside the shadow root are not observed; ignore records for the host itself).
- **Do not break the sensor**: the host has no `data-cs-loc`, and `sensor.test.ts` and `overlay.test.ts` keep passing on `test/e2e/fixture/`.
- **Dev-only**: everything is reached only from the injected virtual module.
- **Tests stay hermetic**: use the new fixture, never the playground's working-tree files.
- Keep the protocol, `PROTOCOL_VERSION = 1` and all extension code unchanged.
- **Git**:
  - Commit locally on `walkthrough` after each verified step, with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never push, switch branches or rewrite history.
  - Never stage `.claude/`, `Notes/` or the uncommitted user files listed in current_state.
</constraints>

<out_of_scope>
- Phase 12: dwell progress, the blue "being counted" ring and `looking…` label, the green flash.
- Phase 13: edge arrows, the pill (`Seen X of Y`), the panel. The eye button stays standalone; Phase 13 absorbs it into the pill.
- Phase 14: hover card, Open in VS Code / Mark as seen buttons, settings such as "hide seen outlines", the full accessibility pass, the 500-element performance work.
- Phase 9: packaging, publishing, CI.
</out_of_scope>

<acceptance_criteria>
- [ ] One `<change-spotlight-overlay>` host with an open shadow root exists on a dev page. It is restored if the app removes it.
- [ ] Every overlay item present on the page has outlines within 1px of its elements, including after scroll, inner scroll, resize, element resize and late-mounted elements (e2e).
- [ ] A shared loc gets one outline per instance and one label (e2e).
- [ ] Outline styles and label texts match requirement 4 for all three statuses (unit + e2e). Labels never overlap (unit + e2e).
- [ ] Alt+Shift+S and the eye button toggle the outlines. The state persists per tab via sessionStorage (e2e).
- [ ] An overlay update restyles outlines live (e2e).
- [ ] The production build contains none of the markers.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with all e2e tests run, not skipped.
- [ ] No commit touches the uncommitted user files.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `pnpm --filter @change-spotlight/vite-plugin exec vitest run test/outlines.test.ts test/e2e/outlines.test.ts test/e2e/overlay.test.ts test/e2e/sensor.test.ts test/integration.test.ts`: all pass, none skipped.
- `grep -n "from '@change-spotlight/core'" packages/vite-plugin/src/client/*.ts | grep -v "import type"`: no output.
- `grep -rn "getBoundingClientRect" packages/vite-plugin/src/client/`: only inside the rAF measure pass.
- `git diff --name-only ab71368..HEAD | grep -E "playground/src|extension/|core/src|Notes/|\.claude/"`: no output.
- `git status --short`: the user files from current_state are still modified and uncommitted.
</verification>

<workflow>
1. Read `src/client/index.ts`, `overlayData.ts`, `sensor.ts`, `seen.ts`, `src/index.ts`, `test/e2e/overlay.test.ts`, `test/e2e/sensor.test.ts`, `test/integration.test.ts` and `.claude/overlay-design.md`.
2. Write a short step plan, then follow it without waiting:
   1. Pure `outlines.ts` and its unit tests.
   2. The Shadow DOM layer and outline drawing.
   3. The rAF-batched re-measuring triggers.
   4. Labels and their placement.
   5. The toggle and eye button.
   6. The e2e fixture and tests, plus the production markers.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
Do not run `/notes`; the Phase 11 note is written separately afterwards. Make sure all work is committed with conventional messages, then report:
- the files changed and the commits made
- the decisions taken: the placement algorithm, how the layer maps viewport coordinates, toggle key handling in editable fields
- the test count and run time
- follow-ups, for example: elements inside iframes or other shadow roots, outlines for elements clipped by `overflow: hidden` ancestors, cost with many elements (Phase 14)
</finish>
