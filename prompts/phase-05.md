<role>
You are a senior TypeScript engineer who knows browser APIs and Vite plugins. You will build the browser visibility sensor of the Change Spotlight Vite plugin (Phase 5) on your own: implement, test, and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`. At dev time it tags rendered host elements in a React + Vite app with `data-cs-loc="path:start-end"`. It then tracks which changed elements were actually visible in the browser and shows "Seen X of Y" with gutter markers.
It is a pnpm 12 workspaces monorepo using TypeScript 7: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19 test app inside the same git repo). Data flows browser -> Vite HMR WebSocket -> plugin -> local bridge -> extension.
</project>

<current_state>
Phases 0 to 4 are committed on branch `v1-phases`. Environment: Linux, Node 22, pnpm 12.11.2, Vitest 5.0.5, Google Chrome 136 at `/usr/bin/google-chrome`. No jsdom, happy-dom, Playwright or Puppeteer is installed.
- **`packages/core/src/protocol.ts`**: `PROTOCOL_VERSION = 1`; `HelloMessage`, `ClickMessage {type:'click', loc, page}`, `VisibilityMessage {protocolVersion, type:'visibility', page: string, seen: string[]}`; `parseMessage(value)` returns `{ok:true, message}` or `{ok:false, reason}`. Core is pure (no Node or DOM types).
- **`packages/vite-plugin/src/index.ts`**: `changeSpotlight(options?)` with `apply:'serve'`, `enforce:'pre'`. It holds the spike client as a template string `clientCode` (click listener in capture phase, `import.meta.hot.send('cs:click', {protocolVersion, loc, page})`), served as `virtual:change-spotlight/client` (resolved to `\0virtual:change-spotlight/client`). `transformIndexHtml` (`order:'pre'`) injects `<script type="module">import 'virtual:change-spotlight/client';</script>` into `<head>`. `configureServer` starts the bridge and forwards `cs:click` with an ad hoc `typeof loc` check. `closeBundle` closes the bridge.
- **`packages/vite-plugin/src/bridge.ts`** (spike transport): HTTP server on `127.0.0.1:0`, `GET /events` streams NDJSON, port written to `<repoRoot>/.change-spotlight/dev-server.json`. API: `startBridge(repoRoot, log): {send(message), close()}`.
- **`packages/vite-plugin/src/transform.ts`, `src/ids.ts`**: the tagging transform. Tests in `test/` (`transform`, `ids`, `sourcemap`, `integration`). `integration.test.ts` runs `createServer({root: playground, configFile:false, server:{middlewareMode:true, ws:false}, logLevel:'silent'})` and Vite `build()`; the build test asserts output contains no `data-cs-loc`, `virtual:change-spotlight` or `cs:click`.
- Build: `tsc -p .` compiles `src/` to `dist/`. `tsconfig.base.json` sets no `lib` (so DOM is included) and `types: ["node"]`.
- **`packages/extension/src/bridge.ts`**: `startBridgeClient(repoRoot, output)` reads the discovery file, connects to `/events`, and `handleLine` logs only `click` messages with its own ad hoc checks. It imports `vscode`, so it is not unit-testable. Extension tests (`test/*.test.ts`, Vitest) cover the git layer only.
- **`playground/`**: `vite.config.ts` uses `[changeSpotlight(), CS_REACT==='react' ? react() : reactSwc()]`. `src/App.tsx`: `<main>` (lines 7-15) containing Header, FeatureList, Counter, `<div style={{height:'150vh'}} />` (line 11) and `<footer id="pricing">` (lines 12-14). No router.
- `pnpm-workspace.yaml` has `allowBuilds` for `@swc/core` and `esbuild`. `playwright-core@1.64.1` (latest) has no dependencies and no install script.
</current_state>

<goal>
Report which tagged elements the user actually looked at: per page, batched `visibility` messages that reach the extension. Phase 7 builds "Seen X of Y" on these reports, so false positives (fast scrolling, hidden tab, invisible elements) must be filtered out here.
</goal>

<requirements>
1. **Client as a real TypeScript module.** Replace the `clientCode` string with `packages/vite-plugin/src/client/` (create):
   - `seen.ts`: a pure seen-rule tracker with no DOM globals. Inputs: per-element visibility updates (loc, visible fraction of element, fraction of viewport covered, non-zero size), page focus state, page changes, time (injected clock/timers). Output: batches of `{page, seen[]}`.
   - `sensor.ts`: the thin DOM adapter (observers, events).
   - `index.ts`: `startClient({protocolVersion, hot})` wiring sensor and click reporting. `hot` is typed as a minimal `{send(event: string, data: unknown): void}` interface.
   - The virtual module's `load()` returns a short entry: import `startClient` from the client file's absolute path and call it with `PROTOCOL_VERSION` and `import.meta.hot`. Resolve the path from `import.meta.url` so it works from `dist/` (`.js`) and from `src/` under Vitest (`.ts`).
2. **Seen rule.** An element's loc is seen when all hold continuously for at least 300 ms:
   - `intersectionRatio >= 0.5`, or (element taller or wider than the viewport) its visible part covers at least 50% of the viewport height.
   - `document.visibilityState === 'visible'` and `document.hasFocus()`.
   - Non-zero bounding box. At commit time, `el.checkVisibility({opacityProperty: true, visibilityProperty: true})` is true when the method exists.
   Losing any condition resets that element's dwell timer.
3. **Observation.** One `IntersectionObserver` for all elements. One `MutationObserver` on `document.documentElement` with `subtree`, `childList`, `attributes`, `attributeFilter: ['data-cs-loc']`:
   - Added nodes: observe the node and its `[data-cs-loc]` descendants.
   - Removed nodes: unobserve and cancel pending dwell.
   - Changed `data-cs-loc` (HMR line shift): treat as a new loc. Unobserve and re-observe the element so a fresh entry arrives.
4. **Dedupe.** Each `(page, loc)` pair is sent at most once per page load. A new loc string after HMR is a new pair.
5. **Pages.** `page` is `location.pathname`. Detect SPA navigation by wrapping `history.pushState`/`replaceState` and listening to `popstate`. On a page change: flush pending seen locs under the old page, then restart dwell for elements currently qualifying under the new page.
6. **Batching.** Flush queued locs every 500 ms when non-empty, and immediately on `pagehide` and on `visibilitychange` to hidden. One message per page: `{protocolVersion, type:'visibility', page, seen}` via `hot.send('cs:visibility', message)`.
7. **Clicks.** Keep click reporting in the new client. Send a full `ClickMessage` (`type:'click'`).
8. **Plugin side.** In `configureServer`, validate `cs:visibility` and `cs:click` payloads with core `parseMessage` and forward valid ones to `bridge.send`. Drop invalid ones; log the reason at most once per reason. Extract the handler into a small testable function.
9. **Extension side.** Create `packages/extension/src/bridgeMessages.ts` with `describeMessage(line: string): string | null`, using core `parseMessage`. Clicks keep today's log text. Visibility logs `Seen N element(s) on <page>` followed by the locs. `bridge.ts` uses it. Test it in `packages/extension/test/bridgeMessages.test.ts`.
10. **Tests.**
    - Unit (`packages/vite-plugin/test/seen.test.ts`, fake timers): 299 ms vs 300 ms; ratio 0.49 vs 0.5; tall element by viewport coverage; zero-size; focus lost and hidden tab reset the dwell; dedupe; new loc after HMR; page change attribution; batching at 500 ms and on hide.
    - Plugin handler test: valid messages forwarded, invalid dropped.
    - E2E (create `packages/vite-plugin/test/e2e/`): headless Chrome via `playwright-core` with `executablePath`. A fixture page with hand-written `data-cs-loc` attributes, served by a listening Vite dev server (`plugins: [changeSpotlight()]`, HMR on). Read messages from the bridge `/events` stream, so the path browser -> plugin validation -> bridge is covered. Cases: initial batch has only above-the-fold locs; scroll + wait adds the target; scrolling past in under 100 ms does not; an element mounted later; a removed element; `visibility:hidden` and `opacity:0` elements; an element 3x the viewport height; changed `data-cs-loc`; `pushState` route change. Plus one playground run (`reactSwc()`): `playground/src/App.tsx:12-14` arrives only after scrolling to the bottom.
    - The suite skips (not fails) when the Chrome path (`CS_CHROME` env, default `/usr/bin/google-chrome`) does not exist.
</requirements>

<constraints>
- **Transport stays the spike bridge.** Use `import.meta.hot.send` and the existing `/events` stream. Phase 6 replaces the bridge, so add nothing to it.
- **Client imports nothing from core at runtime** (`import type` is fine). The protocol version is passed in by the virtual entry. This keeps the browser module graph small and keeps core's diff code out of the page.
- **Performance.** No `getBoundingClientRect` or style reads in scroll or observer loops; use entry data. `checkVisibility` runs once per loc at commit time. IntersectionObserver thresholds: a fixed list (recommended 0 to 1 in 0.05 steps) so coverage of tall elements is updated while scrolling.
- **Injected dependencies.** `seen.ts` takes clock and timer functions as parameters so Vitest fake timers drive it without a DOM.
- **Production stays untouched.** The client is served only by the dev server. The existing build test must still pass.
- **pnpm.** Add `playwright-core` (`^1.64.1`) as a devDep of `packages/vite-plugin`. Run `pnpm view` to confirm the version first. If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds <pkg>` and record the reason. Do not download browsers.
- **Rebuild order.** `pnpm --filter @change-spotlight/core build` before plugin tests; `pnpm --filter @change-spotlight/vite-plugin build` before using the playground.
- **Git.**
  - Commit locally on `v1-phases` after each verified step, with a short conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never push, switch branches, or run other git write commands in the project repo.
  - `Notes/` is git-ignored. Never commit anything under it, including `Notes/README.md`.
- **Open choices (recommended defaults):**
  - Unfocused but visible window does not count (`hasFocus()` required). Consequence: focus in docked DevTools pauses seen tracking; document it.
  - No re-send after HMR or WebSocket reconnect; a server restart reloads the page and resets dedupe anyway.
  - `page` is `pathname` only, without query or hash.
  - Probe in a scratch script that headless Chrome 136 works with `playwright-core` 1.64 and that `document.hasFocus()` is true in a headless page. If either fails, use `puppeteer-core` instead, or emulate focus via CDP `Emulation.setFocusEmulationEnabled`. Record the choice.
</constraints>

<out_of_scope>
- Phase 6: WebSocket transport, tokens, discovery file location, reconnect/backoff, handshake.
- Phase 7: seen persistence, hunk matching, content hashes. The extension only logs.
- Phase 8: TreeView, gutter styles, status bar.
- Later: browser outlines, off-screen markers, "not shown yet" list.
- Changes to the transform or id handling.
</out_of_scope>

<acceptance_criteria>
- [ ] `src/index.ts` contains no client template string. The client lives in `src/client/*.ts`, and `seen.ts` uses no DOM globals.
- [ ] Every unit case in requirement 10 passes.
- [ ] E2E: correct batched messages arrive on `/events` for every listed case, and the playground footer is reported only after scrolling.
- [ ] Messages are batched: one `visibility` message per page per flush, never one per element.
- [ ] Invalid browser payloads never reach `/events`.
- [ ] The extension logs `Seen N element(s) on <page>` and still logs clicks.
- [ ] E2E skips cleanly with `CS_CHROME=/nonexistent`.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and the build test still finds no client markers.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm --filter @change-spotlight/core build && pnpm build && pnpm typecheck && pnpm test`: exit 0, with the e2e tests run and not skipped.
- `CS_CHROME=/nonexistent pnpm --filter @change-spotlight/vite-plugin test`: exit 0, e2e reported as skipped.
- `grep -nE "document|window|location" packages/vite-plugin/src/client/seen.ts`: no output.
- `git status --short` and `ls .change-spotlight 2>/dev/null` before and after `pnpm test`: same output.
- Start `pnpm --filter playground dev --port 5173` in the background. `curl -s http://localhost:5173/ | grep -c virtual:change-spotlight/client` prints 1, and `curl -s 'http://localhost:5173/@id/__x00__virtual:change-spotlight/client'` returns the entry importing `startClient`. Stop the server.
</verification>

<manual_checks_for_user>
Run these after the automated work is done. They must not block it.
1. Start the extension (F5) and `pnpm --filter playground dev`. Open the page in Chrome. Within about a second the Output panel shows `Seen N element(s) on /` without `App.tsx:12-14`.
2. Scroll slowly to the footer: a new batch with `playground/src/App.tsx:12-14`. Reload, scroll to the bottom and back in one fast flick: no footer entry.
3. Switch to another tab or app while the page is scrolled: nothing new is logged until you come back.
4. Edit `App.tsx` above the footer to shift lines: the shifted locs are reported again with new line numbers.
</manual_checks_for_user>

<workflow>
1. Read the files in current_state. Run the Chrome/`playwright-core` probe in a scratch script.
2. Write a short step plan, then follow it without waiting:
   1. `seen.ts` and unit tests.
   2. DOM adapter, client entry, virtual module loading.
   3. Plugin validation handler.
   4. Extension `describeMessage`.
   5. E2E fixture and tests.
   6. Playground e2e run.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
After verification passes, run `/notes 5`. The note must be `Notes/05-browser-sensor.md` and describe Change Spotlight only. Update the Phase 5 row in `Notes/README.md` (do not commit it). Then report:
- the files changed and the commits made
- the decisions taken: seen rule details, tall-element rule, focus handling, dedupe and re-send policy, client delivery, browser driver
- e2e run time and any flakiness seen
- the manual checks for the user
- follow-ups for Phases 6 and 7
</finish>
