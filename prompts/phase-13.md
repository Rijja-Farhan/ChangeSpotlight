<role>
You are a senior TypeScript engineer who knows the DOM (Shadow DOM, `getBoundingClientRect`, `scrollIntoView`, requestAnimationFrame, `prefers-reduced-motion`), Vite dev-server internals and Vitest with headless Chrome. You will build Phase 13 of Change Spotlight's browser overlay, "Finding what is left", on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It diffs the current branch against a base branch, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"` (repo-relative), and records which changed elements were visible in the browser ("Seen X of Y").
It is a pnpm workspace using TypeScript: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19, two pages: `index.html` and `about.html`). VS Code sends an overlay model to every page (Phase 10). The page draws outlines and labels from it (Phase 11), with a "being counted" ring and a green flash (Phase 12). This phase helps you find the changes you have not seen yet: edge arrows, a summary pill and a panel.
</project>

<current_state>
Branch `walkthrough`, latest commit `49b86d0` (Phase 12). Phase 9 is skipped. Linux, Node 22, Vitest 5.0.5, headless Chrome at `/usr/bin/google-chrome` via `playwright-core`. `vitest.config.ts` runs files one at a time. Paths below are in `packages/vite-plugin/` unless stated otherwise.
- **`packages/core/src/protocol.ts`**: `OverlayMessage { branch: string | null; totals: { seen, total, untrackable }; items: OverlayItem[]; pages: string[]; unplaced: string[] }`. `totals` counts hunks, the same numbers as the VS Code status bar. `OverlayItem { loc, path, line, endLine, status: 'unseen' | 'partly' | 'seen', seenHunks, hunkIds, preview, pages }`.
  - `pages` lists the pathnames (`location.pathname`, for example `/` or `/about.html`) where the item's hunks were *seen*. It is not where the element renders.
  - `unplaced` lists items with empty `pages`. That includes seen items that were marked by hand in VS Code.
- **`packages/extension/src/overlay.ts`**: the pure `buildOverlay(SeenState)` that produces the message above.
- **`src/client/overlayData.ts`**: `onOverlay(listener)`, `latestOverlay()`, `requestOpen`, `requestMark`.
- **`src/client/overlayLayer.ts`**: Shadow DOM host `<change-spotlight-overlay>` with one rAF `draw()` that reads, then writes. The read pass already calls `getBoundingClientRect` on every `[data-cs-loc]` instance that has an overlay item. It then skips drawing instances more than `OFFSCREEN_MARGIN = 200` px outside the viewport. Other parts of the layer:
  - Outlines and labels: `[data-cs-outline|data-cs-label][data-loc][data-status]`, plus `data-counting` and `data-flash`.
  - A standalone `button.eye` at the bottom right, with `aria-pressed` and `aria-label` set to "Hide outlines" or "Show outlines".
  - Alt+Shift+S toggles the outlines, except while typing in editable targets. The choice is stored in `sessionStorage` under `STORAGE_KEY = 'change-spotlight:outlines'` (`'on'`/`'off'`).
  - `reducedMotion` is a `matchMedia` query.
- **`src/client/outlines.ts`**: pure `fileLine`, `labelText`, `placeLabels`, `inViewport`, `Rect`, `Viewport`. **`src/client/live.ts`**: pure `isCounting`, `ringOffset`, `flashLocs`, `COUNTING_TEXT`. **`src/client/index.ts`**: `startClient` wires the overlay data, the layer and the sensor.
- **Tests**:
  - `test/outlines.test.ts` and `test/live.test.ts` (unit).
  - `test/e2e/{outlines,live,sensor,overlay}.test.ts` (fixtures `test/e2e/fixture-*/index.html`). The fake extension is `test/helpers/bridgeClient.ts` `connectClient(port, token)`. Overlays are sent with `client.ws.send(JSON.stringify(overlay))`. `outlines.test.ts` queries `button.eye[aria-pressed]` and `[aria-label="Hide outlines"]`.
  - `test/integration.test.ts` checks the production build for a list of markers.
- **Visual spec**: `.claude/overlay-design.md`. The values you need are in requirements.
- **Uncommitted user work** (walkthrough edits): `playground/src/components/{Counter,FeatureList,Header}.tsx`, `playground/src/util.ts`, `packages/extension/package.json`, `Notes/README.md`.
</current_state>

<goal>
Show where the unseen changes are: arrows at the screen edges for the ones scrolled out of view, a pill with "Seen X of Y · N to look at", and a panel that lists what is left on this page, on other pages, and not on any page yet. That way a reviewer can get every change to "seen" without hunting.
</goal>

<requirements>
1. **Pure logic** (create `src/client/finder.ts`, with no DOM access):
   - `samePage(a, b)`: treats `/x/index.html` and `/x/` as the same page.
   - `edgeCounts(rects by loc, statuses, viewport)` → `{ above, below, left, right }`. Count each unseen or partly loc once, and only when no instance of it intersects the viewport. Use its nearest instance: `above` if bottom < 0, `below` if top > viewport height, otherwise `left` or `right`.
   - `nearest(direction, …)`: the loc to scroll to (above: the largest bottom; below: the smallest top; left and right the same way).
   - `pillText(overlay)` → `Seen ${totals.seen} of ${totals.total} · ${n} to look at`, where `n` is the number of items whose status is not `seen`, across all pages. When `n` is 0, use `· all seen`. Use hunk totals for "Seen X of Y" so the pill matches VS Code's status bar.
   - `arrowText(n, dir)` → `1 unseen change below` / `2 unseen changes above` (`left`/`right` likewise).
   - `panelSections(overlay, locs in DOM, pathname)`:
     - **On this page**: items with at least one `[data-cs-loc]` instance in the current DOM. Unseen and partly first, then seen, in document order. The heading count `N left` counts the items that are not seen.
     - **On other pages**: items that are not seen, not in the DOM, and whose `pages` contain a page other than the current one (compared with `samePage`). Each row links to the first such page.
     - **Not on any page yet**: items that are not seen, not in the DOM, and have no other page. Seen items here, such as ones marked by hand, are left out.
2. **Edge arrows** (`[data-cs-arrow="above|below|left|right"]`, real `<button>`s):
   - Placement: centred on their edge (top, bottom, left, right). Amber pill: bg `#b45309`, white text, 40px tall, radius 20px, an arrow icon and `arrowText`.
   - Shown only when the count is above 0 and outlines are on.
   - Counts come from the existing rAF read pass, using the rects it already measures for all instances, before the `OFFSCREEN_MARGIN` skip.
   - Click: `scrollIntoView({ block: 'center', inline: 'center', behavior })` on the nearest element, where `behavior` is `'smooth'`, or `'auto'` under reduced motion.
3. **Pill** (`[data-cs-pill]`, bottom right, replacing the standalone eye position):
   - Style: bg `#1d1c1a`, text `#f6f5f2`, radius 24px.
   - Content: a progress ring (track `#5c5a55`, fill `#4ade80`, fraction `seen/total`, 0 when total is 0), then a `<button data-cs-open-panel aria-expanded>` showing `pillText`, then the existing 40px round `button.eye`.
   - Keep the eye's class, `aria-pressed`, `aria-label`, Alt+Shift+S and `STORAGE_KEY` unchanged.
   - Before the first overlay arrives, show only the eye.
4. **Panel** (`[data-cs-panel]` with `role="dialog"` and `aria-label="Change Spotlight"`, 380px wide, above the pill):
   - Style: bg `#1d1c1a`, radius 14px, borders `#34322e`, max height = viewport minus 120px, scrolling inside.
   - Opening and closing: the pill button toggles it. A close button and Escape close it and return focus to the pill button. It starts closed on every page load.
   - Header: `Change Spotlight`, then `Seen X of Y changes on branch <branch>` (leave out ` on branch …` when `branch` is null), then a 6px progress bar in `#4ade80`.
   - Sections `[data-cs-section="this|other|none"]` with headings in 12px uppercase `#a8a49b`: `On this page · N left`, `On other pages`, `Not on any page yet`. Hide empty sections. When all three are empty, show `Nothing left to look at`.
   - Rows `[data-cs-row][data-loc]`, at least 44px tall:
     - A status dot: unseen `#f59e0b`, partly half-filled `#f59e0b`, seen `#4ade80`.
     - The `fileLine` text in monospace, followed by muted (`#a8a49b`) text: `(below the fold)` or `(above)` when the element is off-screen, or `on /about.html`.
     - An action in `#fbbf72`: `Scroll to`, the same scroll as the arrows (the panel stays open), or `Open page`, which runs `location.assign(page)`. Rows in "Not on any page yet" show the muted hint `not shown on this page yet: open the part of the app that renders it` instead of an action.
   - Footer:
     - Checkbox `Show outlines on the page`: the same state as the eye, Alt+Shift+S and `STORAGE_KEY`.
     - Checkbox `Hide outlines of seen changes`: stored per tab in `sessionStorage` under `change-spotlight:hide-seen`, default off. When on, it hides the outlines and labels of seen items only.
     - The text `Toggle the overlay anytime with Alt + Shift + S`.
   - Live updates: the open panel follows new overlays, scrolling and DOM changes through the same `draw()`. Rebuild rows only when their content changes, so focus and clicks are not lost.
5. **Tests**:
   - Unit, create `test/finder.test.ts`. Cover `samePage`, the edge counting and `nearest` (seen items are excluded, a partly visible item is not counted, a shared loc is counted once), the singular and plural in `arrowText`, `pillText` including `all seen`, and all three sections. "Not on any page yet" leaves out seen unplaced items. An item in the DOM is always in "On this page", even when `pages` lists other pages.
   - E2E, create `test/e2e/finder.test.ts` with fixture `test/e2e/fixture-pages/index.html` and `about.html`. They are static HTML that mirrors the playground's two pages: a Header loc on both pages, FeatureList and Counter on index with Counter below tall spacers, a Team loc on about, a seen item, and one unplaced unseen item rendered nowhere. Cover:
     - arrow counts at the top, in the middle and at the bottom of index while scrolling (counts change, seen items are never counted, an arrow with count 0 is absent)
     - an arrow click scrolls its nearest element into the viewport
     - the pill text and `aria-expanded`
     - the panel's lists on `/` and on `/about.html`
     - `Scroll to`
     - `Open page` navigates to `/about.html`
     - both checkboxes, including persistence across a reload
     - Escape closes the panel
   - Add `data-cs-pill`, `data-cs-panel` and `data-cs-arrow` to the production markers in `test/integration.test.ts`.
</requirements>

<constraints>
- **VS Code is the only source of status and totals.** The pill, the panel and the arrows read only what `onOverlay` delivers. The browser never computes "seen".
- **`pages` means "seen on"**, so an unseen item that renders only on another page usually lands in "Not on any page yet". That is expected: the browser cannot know where unvisited code renders, so the hint stays generic.
- **Layout reads stay inside the single rAF `draw()` pass.** Add no second rAF loop and no scroll-time `getBoundingClientRect` outside it, to avoid layout thrash.
- **Pure logic in `finder.ts`, DOM in `overlayLayer.ts`** (or a thin module it calls), because Vitest runs in Node without a DOM. Client code keeps type-only imports from core.
- **Controls** are real `<button>` and `<input type="checkbox">` elements with `pointer-events: auto`. The layer stays click-through everywhere else.
- **Hermetic tests**: use the new fixture, never the playground's working tree, which holds uncommitted user edits. Open one page at a time, as `sensor.test.ts` does, so focus-based dwell works.
- `test/e2e/outlines.test.ts`, `live.test.ts`, `sensor.test.ts`, `overlay.test.ts` and the existing unit tests keep passing unchanged.
- Keep the protocol, `PROTOCOL_VERSION = 1`, the seen rule and all extension code unchanged. Phase 14 will seed `change-spotlight:hide-seen` from a VS Code setting.
- **Git**:
  - Commit locally on `walkthrough` after each verified step, with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never push, switch branches or rewrite history.
  - Never stage `.claude/`, `Notes/` or the uncommitted user files listed in current_state.
</constraints>

<out_of_scope>
- Phase 14:
  - the hover card on labels
  - the Open in VS Code and Mark as seen buttons (do not call `requestOpen` or `requestMark`)
  - VS Code settings sent with the overlay (show by default, hide seen outlines)
  - the full accessibility pass (contrast audit, focus order review)
  - the 500-element performance work
- Phase 9: packaging, publishing, CI.
</out_of_scope>

<acceptance_criteria>
- [ ] Arrow counts match the unseen and partly items above and below while scrolling, and are absent at 0 (unit + e2e).
- [ ] Clicking an arrow or `Scroll to` brings the nearest or chosen element into the viewport (e2e).
- [ ] The pill shows `Seen X of Y · N to look at` from the overlay, keeps the eye button's behaviour and opens the panel (e2e).
- [ ] The panel lists the right items in its three sections on `/` and on `/about.html`, and `Open page` navigates (unit + e2e).
- [ ] Both checkboxes work and persist per tab. Alt+Shift+S still toggles the outlines (e2e).
- [ ] The production build contains none of the new markers.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with all e2e tests run, not skipped.
- [ ] No commit touches the uncommitted user files, `.claude/` or `Notes/`.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `pnpm --filter @change-spotlight/vite-plugin exec vitest run test/finder.test.ts test/outlines.test.ts test/live.test.ts test/e2e/finder.test.ts test/e2e/outlines.test.ts test/e2e/live.test.ts test/e2e/sensor.test.ts test/e2e/overlay.test.ts test/integration.test.ts`: all pass, none skipped.
- `grep -n "from '@change-spotlight/core'" packages/vite-plugin/src/client/*.ts | grep -v "import type"`: no output.
- `grep -n "requestAnimationFrame" packages/vite-plugin/src/client/*.ts`: only the existing `schedule()` in `overlayLayer.ts`.
- `git diff --name-only 49b86d0..HEAD | grep -E "playground/|extension/|core/src|Notes/|\.claude/"`: no output.
- `git status --short`: the user files from current_state are still modified and uncommitted.
</verification>

<workflow>
1. Read `src/client/overlayLayer.ts`, `outlines.ts`, `live.ts`, `overlayData.ts`, `index.ts`, `packages/core/src/protocol.ts`, `packages/extension/src/overlay.ts`, `test/e2e/outlines.test.ts`, `test/e2e/live.test.ts` and `.claude/overlay-design.md`.
2. Write a short step plan, then follow it without waiting:
   1. `finder.ts` and its unit tests.
   2. Arrows in the draw pass.
   3. The pill, with the eye moved into it.
   4. The panel and its checkboxes.
   5. The e2e fixture and tests, and the production markers.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
Do not run `/notes`. The Phase 13 note is written separately afterwards. Make sure all work is committed with conventional messages, then report:
- the files changed and the commits made
- the decisions you made:
  - the pill's units (hunks vs. elements)
  - the section rules
  - where the panel's rendering lives
  - how rows avoid rebuilds
- the test count and run time
- follow-ups, for example:
  - elements clipped inside inner scroll containers (counted by viewport rect only)
  - items whose `pages` is empty although they render on a page you have not visited
</finish>
