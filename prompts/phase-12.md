<role>
You are a senior TypeScript engineer who knows the DOM (Shadow DOM, CSS animations, IntersectionObserver, requestAnimationFrame, `prefers-reduced-motion`), Vite dev-server internals and Vitest with headless Chrome. You will build the live states of Change Spotlight's browser overlay (Phase 12) on your own: implement, test and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It diffs the current branch against a base branch, tags host elements in a React + Vite app with `data-cs-loc="path:start-end"` (repo-relative), and records which changed elements were visible in the browser ("Seen X of Y").
It is a pnpm workspace using TypeScript: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19). VS Code sends an overlay model to every page (Phase 10) and the page draws outlines and labels from it (Phase 11). This phase makes those outlines react live: a "being counted" ring while the sensor's dwell runs, and a green flash when VS Code confirms.
</project>

<current_state>
Branch `walkthrough`, latest commit `8929013` (Phase 11). Phase 9 is skipped. Linux, Node 22, Vitest 5.0.5, headless Chrome at `/usr/bin/google-chrome` via `playwright-core`. All paths below are in `packages/vite-plugin/`.
- **`src/client/seen.ts`**: pure `SeenTracker<K>` with `DWELL_MS = 300`, `FLUSH_MS = 500`. Seen rule: at least 50% visible for 300 ms while the tab is visible and `document.hasFocus()`. Each `page + loc` is reported once per load (`resetReported()` after HMR).
  - **Uncommitted, part of this phase**: `SeenTrackerOptions.onDwell?: (key, loc, active: boolean) => void`, called with `true` when a dwell starts and `false` when it commits, is cancelled or the element is removed. Keep it; it gets committed with this phase.
  - It has one bug: `update()` stores the new observation before calling `cancel()`, so a cancel caused by a loc change reports the new loc. Fix it so the `false` event carries the loc that was being counted.
- **`src/client/sensor.ts`**: `startSensor(onBatch)` is the DOM adapter (`K = Element`). It does not pass `onDwell` yet.
- **`src/client/index.ts`**: `startClient` calls `connectOverlay`, starts `startOverlayLayer()` once `document.body` exists, then `startSensor`. On `vite:afterUpdate` it calls `sensor.resetReported()` and `layer.refresh()`.
- **`src/client/overlayLayer.ts`**: Shadow DOM host `<change-spotlight-overlay>` and one rAF `draw()` (read, then write). Outlines `[data-cs-outline][data-loc][data-status]` and labels `[data-cs-label][data-loc][data-status]`, styled with `[data-status]` CSS. Shared locs: one outline per instance, one label on the first instance. Eye toggle stored in `sessionStorage` under `change-spotlight:outlines`. Items come only from `onOverlay` (`overlayData.ts`).
- **`src/client/outlines.ts`**: pure `labelText`, `fileLine`, `placeLabels`, `inViewport`, unit-tested in `test/outlines.test.ts`.
- **Tests**: `test/seen.test.ts` (fake timers), `test/e2e/outlines.test.ts` (fixture `test/e2e/fixture-outlines/`, fake extension `test/helpers/bridgeClient.ts` `connectClient(port, token)`, overlays sent with `client.ws.send(JSON.stringify(overlay))`, shadow-root queries). `test/e2e/sensor.test.ts` opens one page at a time with `browser.newPage()` and does nothing special for focus: headless Chrome reports the open page as focused. Visibility messages arrive in `client.messages` (`type: 'visibility'`). `test/integration.test.ts` checks a production build for markers.
- **Visual spec**: `.claude/overlay-design.md`.
- **Uncommitted user work** (walkthrough edits): `playground/src/components/{Counter,FeatureList,Header}.tsx`, `playground/src/util.ts`, `packages/extension/package.json`, `Notes/README.md`.
</current_state>

<goal>
Show, on each changed element, that the sensor is counting it (a filling ring) and, once VS Code's seen model confirms it, turn it green with one short flash. The page should show progress while you look, and never show a state VS Code has not confirmed.
</goal>

<requirements>
1. **Dwell events**: `startSensor` takes an `onDwell(element, active)` callback and passes it to `SeenTracker`. `index.ts` forwards it to a new layer method (for example `layer.setDwell(el, active)`). A dwell that starts before the layer exists still shows its ring once the layer starts.
2. **Counting state in the layer**: keep `Map<Element, startTime>` (from `performance.now()`). Entries are removed on `active: false` and when the element disconnects. Changes are drawn through the existing rAF `schedule()`.
3. **Ring rule**: an element is "counting" when it has a dwell entry and its item's status is not `'seen'`. While counting:
   - its outline is `2px solid #1f4fd1` with no halo
   - the loc's label (first instance) is blue `#1f4fd1`, shows a ring (track `#8aa6ec`, fill `#fff`) and the text `looking…` (U+2026), if any instance of that loc is counting
   - the ring fills through a CSS animation lasting `DWELL_MS` (import it from `seen.ts`), started at `-(now - startTime)` ms, so it stays in sync across redraws
   - test hooks: `data-counting` on the outline and on the label, `data-cs-ring` on the ring. `data-status` keeps VS Code's status.
4. **After the dwell**: the element goes back to its VS Code status (amber for unseen or partly) until a new overlay says `seen`. The browser never sets `seen` itself.
5. **Flash**: when an overlay changes a loc from `unseen` or `partly` to `seen`, compared with the previous overlay this page received, its outlines and label get one short flash (recommended: about 600 ms, one iteration, hook `data-flash`, removed afterwards). The first overlay after page load never flashes. Under `prefers-reduced-motion: reduce` the element turns green with no animation.
6. **Pure logic** (create `src/client/live.ts`): status-transition detection (`flashLocs(previous | undefined, next)`), the counting decision, and the ring's animation offset. Add the `looking…` text to `outlines.ts`, or to `live.ts`, keeping one source for label text.
7. **Tests**:
   - Unit, `test/seen.test.ts`: `onDwell` sends `true` on start and `false` on commit, on cancel (ratio drop), on `remove`, on `setActive(false)` and on `setPage`. A loc change sends `false` with the old loc, then `true` with the new one. No event fires for an already reported loc. Start and end events always come in pairs.
   - Unit, create `test/live.test.ts`: flash on unseen→seen and partly→seen; no flash on the first overlay, on seen→seen or on seen→unseen; counting is false for seen items; the offset is clamped to `[0, DWELL_MS]`.
   - E2E, create `test/e2e/live.test.ts` and `test/e2e/fixture-live/index.html` (a top element, a "pass" element and a "target" element separated by tall spacers). Cover:
     - after scrolling to the unseen target, `data-counting` and `data-cs-ring` appear (record them with an in-page MutationObserver on the shadow root, so the 300 ms window is not missed)
     - after the dwell, the outline is amber again with `data-status="unseen"` and the fake client has received a visibility message for the loc
     - after the client sends an overlay with that item `seen`, the outline is green and flashes
     - scrolling past in under 100 ms leaves the pass element amber, with no visibility message for it
     - a seen item never shows the ring
     - loading a page whose first overlay already says `seen` gives no flash
     - with `reducedMotion: 'reduce'` there is no flash and no running animation
   - Add `data-cs-ring` to the production markers in `test/integration.test.ts`.
</requirements>

<constraints>
- **VS Code is the single source of status**: `data-status`, green and the flash come only from overlays via `onOverlay`. The browser only adds the temporary counting state.
- **Dwell events flow sensor → index.ts → layer** as function calls. Add no `window` globals or custom DOM events, because the app could read or spoof them.
- **Reuse** `SeenTracker`, `DWELL_MS`, `overlayData.ts` and the existing `draw()` pass. Add no second rAF loop or timer-driven redraw: the CSS animation does the filling.
- **Pure logic in plain modules, DOM in thin adapters** (as `seen.ts` / `sensor.ts`), because Vitest runs in Node without a DOM.
- **Layout reads stay inside the rAF pass.** Client code keeps type-only imports from core.
- **Do not change the seen rule** (50%, 300 ms, focus) or batching. `sensor.test.ts`, `outlines.test.ts` and `overlay.test.ts` keep passing unchanged.
- **Focus in e2e**: open one page at a time, as `sensor.test.ts` does. If `document.hasFocus()` is false, call `page.bringToFront()` rather than faking focus in app code.
- **Tests stay hermetic**: use the new fixture, never the playground's working-tree files.
- Keep the protocol, `PROTOCOL_VERSION = 1` and all extension code unchanged.
- **Git**:
  - Commit locally on `walkthrough` after each verified step, with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never push, switch branches or rewrite history.
  - Never stage `.claude/`, `Notes/` or the uncommitted user files listed in current_state. `src/client/seen.ts` is yours to commit.
</constraints>

<out_of_scope>
- Phase 13: edge arrows ("N unseen changes below"), the pill (`Seen X of Y`), the panel. The eye button stays as it is.
- Phase 14: hover card, Open in VS Code / Mark as seen buttons, settings (hide seen outlines), the full accessibility pass, the 500-element performance work.
- Phase 9: packaging, publishing, CI.
</out_of_scope>

<acceptance_criteria>
- [ ] `onDwell` events are paired and carry the counted loc, including on a loc change (unit).
- [ ] An unseen element in view shows the blue outline and the filling ring with `looking…`. A seen element never does (e2e).
- [ ] After the dwell, the element is amber until VS Code's overlay says seen. Then it turns green and flashes once (e2e).
- [ ] Scrolling past quickly leaves the element amber and unreported (e2e).
- [ ] There is no flash on the first overlay after load or under reduced motion (unit + e2e).
- [ ] No `window` globals were added. The production build contains none of the markers.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, with all e2e tests run, not skipped.
- [ ] No commit touches the uncommitted user files.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0.
- `pnpm --filter @change-spotlight/vite-plugin exec vitest run test/seen.test.ts test/live.test.ts test/outlines.test.ts test/e2e/live.test.ts test/e2e/outlines.test.ts test/e2e/sensor.test.ts test/e2e/overlay.test.ts test/integration.test.ts`: all pass, none skipped.
- `grep -rnE "window\.(__|cs|changeSpotlight)|dispatchEvent\(new CustomEvent" packages/vite-plugin/src/client/`: no output.
- `grep -n "from '@change-spotlight/core'" packages/vite-plugin/src/client/*.ts | grep -v "import type"`: no output.
- `git diff --name-only 8929013..HEAD | grep -E "playground/src|extension/|core/src|Notes/|\.claude/"`: no output.
- `git status --short`: the user files from current_state are still modified and uncommitted. `seen.ts` is committed.
</verification>

<workflow>
1. Read `src/client/seen.ts` (with `git diff` for the uncommitted change), `sensor.ts`, `index.ts`, `overlayLayer.ts`, `outlines.ts`, `test/seen.test.ts`, `test/e2e/outlines.test.ts`, `test/e2e/sensor.test.ts` and `.claude/overlay-design.md`.
2. Write a short step plan, then follow it without waiting:
   1. Fix the `onDwell` loc bug and add its unit tests.
   2. Write the pure `live.ts` and its tests.
   3. Wire the sensor, index and layer, and draw the counting state and ring.
   4. Add the flash and reduced motion.
   5. Write the e2e fixture and tests, and add the production marker.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
Do not run `/notes`. The Phase 12 note is written separately afterwards. Make sure all work is committed with conventional messages, then report:
- the files changed and the commits made
- the decisions you made:
  - how early dwell events reach a layer that has not started yet
  - the ring technique (SVG stroke or conic gradient)
  - the flash duration
  - how shared locs show counting
- the test count and run time
- follow-ups, for example: the amber gap between the end of the dwell and VS Code's overlay (about `FLUSH_MS` plus a round trip), and the ring for elements that are taller than the viewport
</finish>
