<role>
You are a senior TypeScript and Vite plugin engineer. You will build the real `data-cs-loc` transform of the Change Spotlight Vite plugin (Phase 4) on your own: implement, test, and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`. At dev time it tags rendered host elements in a React + Vite app with `data-cs-loc="path:start-end"`. It then tracks which changed elements were actually visible in the browser and shows "Seen X of Y" with gutter markers.
It is a pnpm 12 workspaces monorepo using TypeScript 7: `packages/core` (pure logic), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19 test app inside the same git repo). Paths in `data-cs-loc` are relative to the git repo root, so the extension can match them against `git diff` paths.
</project>

<current_state>
Phases 0 to 3 are done and committed on branch `v1-phases`. Environment: Linux, Node 22, Vitest 5.0.5, Chrome at `/usr/bin/google-chrome`.
- **`packages/core`** (built to `dist/` with `tsc`; tests run with Vitest). It exports:
  - `formatLoc({path, start, end})` / `parseLoc`. `parseLoc` splits on the last `:`.
  - `normalizePath` / `toRepoRelative(abs, root)`. `toRepoRelative` returns `""` for the root itself and `null` for paths outside the root. Windows drive letters compare case-insensitively.
  - Core is pure: no Node or DOM types.
- **`packages/vite-plugin`** (ESM; `tsc -p .` builds `src` to `dist/`; scripts `build`, `dev`, `typecheck`; it has no tests and no Vitest yet). Deps: `magic-string ^1.4.3`, `oxc-parser ^0.154.0`, `@change-spotlight/core`. devDep `vite ^8.3.4`. This is still Phase 1 spike code:
  - `src/transform.ts`, `tagHostElements(code, filename, relPath)`:
    - Parses with `parseSync`: `lang` is `jsx` for `.jsx` files and `tsx` otherwise. It returns `null` on parse errors.
    - Walks every object key, skipping `parent`.
    - Tags `JSXElement`s whose name is a `JSXIdentifier` matching `/^[a-z]/`, unless they already have a `data-cs-loc`.
    - Lines come from `lineStarts`/`lineOf`, which count `\n`.
    - It inserts ` data-cs-loc="..."` with `appendLeft(opening.name.end)`.
    - It returns `{code, map}`, where the map comes from `generateMap({hires: true, includeContent: true})`.
  - `src/index.ts`, `changeSpotlight(): Plugin`:
    - `apply: 'serve'` and `enforce: 'pre'`.
    - `configResolved` finds the repo root with `git rev-parse --show-toplevel` and falls back to the Vite root.
    - `transform` strips `?query`, skips `\0` ids, `/node_modules/` and anything that is not `.jsx`/`.tsx`, then uses `path.relative` for the repo-relative path.
    - It also has the spike virtual client module (`virtual:change-spotlight/client`) and `transformIndexHtml`.
    - `configureServer` starts `src/bridge.ts`. The bridge writes `<repoRoot>/.change-spotlight/dev-server.json` (git-ignored) and closes only on `server.httpServer` `close`.
- **`playground/`**: `vite.config.ts` uses `[changeSpotlight(), react()]` with `@vitejs/plugin-react-swc ^4.3.3`. `@vitejs/plugin-react` is not installed. Sources:
  - `src/App.tsx`: components plus `<main>`, `<div style>`, `<footer>`.
  - `src/components/Counter.tsx`: `<section>` on lines 6 to 11, `<button onClick>` on lines 8 to 10.
  - `src/components/FeatureList.tsx`: a fragment, `.map` and `<li>`.
  - `src/components/Header.tsx`.
  - `src/main.tsx`.
  - Vite prints a hint that `@vitejs/plugin-react` v6 no longer uses Babel and is recommended.
- In the pnpm store (transitively): `@jridgewell/trace-mapping@0.3.31`, `source-map-js@1.2.2`.
- `oxc-parser` facts, checked with 0.154.0:
  - Offsets are UTF-16 and count a leading BOM (`<` at index 11 with a BOM, 10 without).
  - `svg:rect` gives a `JSXNamespacedName` with no parse error.
  - `my-widget` is a `JSXIdentifier`.
  - `this.x` is a `JSXMemberExpression`.
  - Attributes keep source order (`JSXSpreadAttribute`, `JSXAttribute`).
  - The package exports `Visitor`.
</current_state>

<goal>
Turn the spike into a tested transform. It must tag exactly the JSX elements that become DOM nodes, with repo-relative `path:start-end` values that match `git diff` line numbers. It must work with both React plugins and keep source maps exact. Phases 5 to 8 rely on these tags to decide which changed lines were seen.
</goal>

<requirements>
1. **Pure transform module.** Rewrite `packages/vite-plugin/src/transform.ts` as `tagHostElements(code, {filename, relPath, lang: 'jsx' | 'tsx'}): {code, map} | null`. It has no fs, git or Vite imports, and builds values with core `formatLoc`. Rules:
   - **Host test**: tag a `JSXIdentifier` name that matches `/^[a-z]/` or contains `-`, except `this`. Custom elements such as `my-widget` are tagged. Skip `JSXMemberExpression` (`motion.div`), `JSXNamespacedName` (`svg:rect`) and fragments.
   - **Line range**: `start` is the line of `<`. `end` is the line of the element's last character. Count only `\n`, the same way git does, so CRLF works and a lone `\r` is not a line break.
   - **Insertion point**: insert after the last attribute, or after the tag name when there are no attributes. Reason: React merges props left to right and the last one wins. If the tag sat first, a later `{...props}` that carries `data-cs-loc` would replace it.
   - **Existing `data-cs-loc`**: when the element already has an explicit `data-cs-loc` attribute, leave it unchanged. Running the transform twice gives the same output.
   - **Value form**: always write `data-cs-loc={<JSON.stringify(value)>}`. Reason: JSX string attributes have no backslash escapes, and parsers decode HTML entities in them. A path containing `"` or `&amp;` would break or be decoded wrongly.
   - **Syntax errors**: when there is a parse error, return `null` so Vite reports the original error.
   - **Fast exit**: return `null` when there is no change, and without parsing when `code` contains no `<`.
   - **Source map**: produce a hires map with `source` set to the filename and `includeContent: true`.
2. **Id handling (pure, tested; create a helper module).** This covers the logic from an id to a `relPath` and `lang`, or a skip:
   - Strip `?query`. Skip ids whose query contains `raw`, `url`, `inline`, `worker` or `sharedworker`.
   - Skip `\0` ids.
   - Choose `lang` from the extension: `.tsx` gives `tsx`; `.jsx`, `.js`, `.mjs` and `.cjs` give `jsx`. Always skip `.ts`, `.mts` and `.cts`, because they cannot contain JSX.
   - Get `relPath` from core `toRepoRelative`. Skip files outside the repo root.
3. **Plugin options.** The signature becomes `changeSpotlight(options?: {enabled?: boolean; include?: FilterPattern; exclude?: FilterPattern})`:
   - Use Vite's `createFilter`.
   - Default `include` is `/\.[jt]sx$/`. Default `exclude` is `/\/node_modules\//`.
   - `enabled: false` returns a plugin that does nothing (`apply: () => false`).
   - Export the options type.
4. **Plugin wiring.** In `src/index.ts`:
   - Keep `apply: 'serve'` and `enforce: 'pre'`.
   - Use the helpers from requirements 1 and 2.
   - When `git rev-parse` fails, log one info line before using the Vite root.
   - Close the bridge in the `closeBundle` hook as well, because Vite calls it on `server.close()`. This lets middleware-mode servers in tests shut down without leaving `dev-server.json` behind. Change nothing else in the bridge.
5. **Fixture tests.** Create `packages/vite-plugin/test/`:
   - Set up Vitest: add devDeps `vitest ^5.0.5` and `@jridgewell/trace-mapping`, scripts `test` and `test:watch`, and `tsconfig.test.json`. `typecheck` runs both configs.
   - Input files go in `test/fixtures/*.tsx|jsx`. Check output with `toMatchFileSnapshot` into `test/fixtures/__out__/`. Read every snapshot before committing it.
   - Cases:
     - Host vs component.
     - Member expression, namespaced tag, custom element.
     - Fragment.
     - Nested elements and JSX inside attributes (`icon={<svg/>}`).
     - Self-closing elements and multi-line attribute lists.
     - Spread before and after other attributes.
     - Existing `data-cs-loc`.
     - Idempotence.
     - Syntax error (`null`).
     - CRLF, BOM, non-ASCII text before an element.
     - TypeScript generics and `as` in a `.tsx` file.
     - JSX in a `.js` file (with `lang: 'jsx'`).
     - A path containing `"`, `&`, a space and a non-ASCII character; the value must round-trip through `parseLoc`.
     - A generated file of about 20,000 lines that transforms correctly in under 2 s.
   - Unit tests for the id helper:
     - Query handling and `.ts` skips.
     - Repo-root subfolder ids (`/repo/playground/src/A.tsx` gives `playground/src/A.tsx`).
     - An id outside the root.
     - Windows ids (`C:/Repo/app/src/A.tsx` with root `c:/repo`).
6. **Source-map test.** For representative tokens (`onClick`, `setCount`, attribute names after the insertion point, closing tags), find each token's position in the transformed output. `originalPositionFor` from `@jridgewell/trace-mapping` must return the token's exact original line and column. Include a CRLF fixture.
7. **Both React plugins.**
   - Add `@vitejs/plugin-react` (latest 6.x) and `@vitejs/plugin-react-swc ^4.3.3` as devDeps of `packages/vite-plugin`.
   - Create `test/integration.test.ts`. For each React plugin:
     - Run `createServer({root: <repo>/playground, configFile: false, plugins: [changeSpotlight(), react()], server: {middlewareMode: true}, logLevel: 'silent'})` and call `transformRequest` on `/src/components/Counter.tsx` and `/src/App.tsx`.
     - Assert that `"data-cs-loc"` appears with `playground/src/components/Counter.tsx:6-11` and `:8-10`, and that `$RefreshReg$` (React Refresh) is present.
     - Assert that `<Counter>` produces no tag.
     - Trace the final combined `result.map`: the original positions of `setCount`, `useState` and `onClick` must equal the positions from the same run without `changeSpotlight()`.
     - Close the server.
8. **Production stays untouched.** A test runs Vite `build()` on `playground/` with `outDir` in `os.tmpdir()`, using both plugins. It asserts that the output contains neither `data-cs-loc` nor `change-spotlight`.
9. **Playground.**
   - Add `@vitejs/plugin-react` to `playground/package.json`.
   - In `vite.config.ts`, select the React plugin with `CS_REACT=swc|react`, defaulting to `swc`, so both can be run by hand.
</requirements>

<constraints>
- **Parser: `oxc-parser`. Not Babel.** The plugin must not depend on which compiler the React plugin uses. Prefer the exported `Visitor` over walking every key.
- **Plugin order: `enforce: 'pre'`.** The transform must see raw JSX before `plugin-react` (which uses Oxc in Vite 8) or SWC compiles it.
- **Edits with `magic-string` only.** Never reprint the AST, because positions must stay exact for breakpoints.
- **Repo root.** Paths are relative to the git root, not the Vite root. This matches the extension's `git diff` paths when the app lives in a subfolder.
- **Index units.** oxc offsets are UTF-16 indexes and can be used directly with `magic-string`. Do not convert them to bytes.
- **Fixtures.** Add `test/fixtures/.gitattributes` with `* -text`, so git never rewrites CRLF or BOM fixtures.
- **Rebuild order.** Run `pnpm --filter @change-spotlight/core build` before plugin tests. Run `pnpm --filter @change-spotlight/vite-plugin build` before using the playground, because Vite loads the plugin from `dist/`.
- **pnpm.** If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds <pkg>` and record the reason.
- **Git.**
  - Commit locally on `v1-phases` after each verified step, with a short conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never push, switch branches, or run other git write commands in the project repo. Tests may write to git only inside their own temp repos.
  - Keep `.claude/` git-ignored.
  - `Notes/` is git-ignored except for tracked files such as `Notes/README.md`. Commit tracked files only.
- **Open choices (recommended defaults):**
  - Custom elements are tagged. The alternative is to skip them.
  - The tag goes at the end of the attributes, not after the tag name.
  - Values always use the expression form.
  - There is no file-size cap; only the `<` fast exit.
  - Filtering is done with `createFilter` inside the handler. Vite 8 `transform.filter` hook filters are an optional optimisation.
  - `.js` files are tagged only if the user widens `include`.
</constraints>

<out_of_scope>
- Phase 5: the visibility sensor (IntersectionObserver/MutationObserver, `transformIndexHtml` sensor). Leave the spike virtual client as it is.
- Phase 6: the WebSocket bridge, discovery file location, and tokens. Make only the `closeBundle` close from requirement 4.
- Phase 7/8: seen state and UI.
- Phase 9: npm publishing, README, CI.
- Tagging elements rendered through components (forwarding `data-cs-loc` to children).
</out_of_scope>

<acceptance_criteria>
- [ ] `transform.ts` and the id helper import neither `node:*`, `vite` nor `child_process`.
- [ ] Every fixture case in requirement 5 has a reviewed snapshot and passes.
- [ ] Tokens trace back to exact original line and column (requirement 6).
- [ ] Both React plugins produce the tags and React Refresh, and their source maps match the runs without Change Spotlight.
- [ ] `vite build` output contains no `data-cs-loc`.
- [ ] `enabled: false`, `include` and `exclude` are each covered by a test.
- [ ] No `.change-spotlight/dev-server.json` is left behind after the tests.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm --filter @change-spotlight/core build && pnpm build && pnpm typecheck && pnpm test`: exit 0. The vite-plugin tests run, and the core and extension tests still pass.
- `grep -nE "from '(node:|vite|child_process)" packages/vite-plugin/src/transform.ts <id helper>`: no output.
- `git status --short` and `ls .change-spotlight 2>/dev/null` before and after `pnpm test`: the same output.
- `pnpm --filter playground build && grep -rc data-cs-loc playground/dist`: every count is 0.
- Dev server check for each React plugin: start it with `CS_REACT=swc pnpm --filter playground dev --port 5173` (and again with `CS_REACT=react`) in the background, run `curl -s http://localhost:5173/src/components/Counter.tsx | grep -c 'Counter.tsx:6-11'`, which should print at least 1, then stop the server.
</verification>

<manual_checks_for_user>
Run these after the automated work is done. They must not block it.
1. Run `pnpm --filter playground dev` and open the page in Chrome. In DevTools Elements, `<section>` has `data-cs-loc="playground/src/components/Counter.tsx:6-11"`.
2. In DevTools Sources, set a breakpoint on `setCount` in `Counter.tsx` line 8 and click Increment. It pauses on line 8. Repeat with `CS_REACT=react`.
3. Edit `Counter.tsx`. HMR keeps the count state and the tags update.
</manual_checks_for_user>

<workflow>
1. Read the files listed in current_state. Probe oxc and both React plugins in a scratch script before designing.
2. Write a short step plan, then follow it without waiting:
   1. Vitest setup.
   2. Pure transform and fixtures.
   3. Id helper and options.
   4. Source-map test.
   5. Install `plugin-react` and run the integration tests.
   6. Build test.
   7. Playground switch.
3. For each step: implement it, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
After verification passes, run `/notes 4`. The note must be `Notes/04-plugin-transform.md` and must describe Change Spotlight only (`.claude/agents/notes-writer.md` was written for another project). Update the Phase 4 row in `Notes/README.md`. Then report:
- the files changed and the commits made
- the decisions taken: host rule, insertion point, value form, filters, root handling
- the measured large-file timing
- the manual checks for the user
- follow-ups for Phases 5, 6 and 9
</finish>
