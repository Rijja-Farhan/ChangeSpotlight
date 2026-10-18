<role>
You are a senior TypeScript tooling engineer auditing and finishing the monorepo skeleton (Phase 0) of Change Spotlight.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`, tags rendered host elements in a React + Vite app with `data-cs-loc="path:start-end"` at build time, tracks which changed elements were actually visible in the browser, and shows "Seen X of Y" in a sidebar with seen/unseen gutter markers.
It is a pnpm workspaces monorepo, TypeScript everywhere: `packages/core` (diff parsing, range matching, versioned protocol types), `packages/extension` (VS Code extension), `packages/vite-plugin`, and `playground/` (Vite + React app, created in Phase 1). All paths below are repo-root relative with forward slashes.
</project>

<current_state>
Phase 0 is already implemented but not committed (the repo has no commits; everything is untracked). Environment: Node 22.22.3 via nvm, pnpm 12.11.2 via corepack, git 2.34.1, VS Code 1.100.2.
Existing files:
- `package.json`: name `change-spotlight-monorepo` (must differ from the extension's `change-spotlight`, or `pnpm --filter change-spotlight` matches both), private, `packageManager` pins pnpm 12.11.2, scripts `build` = `pnpm -r build`, `typecheck` = `pnpm -r typecheck`; devDeps `typescript ^7.0.2`, `@types/node ^22.20.5`.
- `pnpm-workspace.yaml`: `packages/*` and `playground` (`playground/` does not exist yet; that is expected).
- `tsconfig.base.json`: ES2022, NodeNext module/resolution, strict, noUncheckedIndexedAccess, esModuleInterop, skipLibCheck, declaration, sourceMap, isolatedModules, forceConsistentCasingInFileNames.
- `.gitignore`: `node_modules/`, `dist/`, `out/`, `*.vsix`, `*.tsbuildinfo`, `.vscode-test/`.
- `packages/core`: `@change-spotlight/core`, `type: module`, main `./dist/index.js`, types `./dist/index.d.ts`, scripts `build` = `tsc -p .`, `typecheck` = `tsc -p . --noEmit`; `tsconfig.json` extends base with `rootDir: src`, `outDir: dist`; `src/index.ts` exports `PROTOCOL_VERSION = 1`.
- `packages/vite-plugin`: `@change-spotlight/vite-plugin`, same layout as core; `src/index.ts` is `export {};`.
- `packages/extension`: name `change-spotlight`, publisher `change-spotlight`, `engines.vscode ^1.100.0`, main `./dist/extension.js`, empty `activationEvents`/`contributes`, same scripts; `tsconfig.json` overrides module/moduleResolution to `Node16`; devDep `@types/vscode ~1.100.0`; `src/extension.ts` has empty `activate`/`deactivate`.
- `.claude/` holds `PLAN.md`, slash commands and agents. `Notes/` and `prompts/` content beyond this file may not exist.
- `pnpm install && pnpm typecheck` currently prints `Done` for all three packages.
</current_state>

<goal>
Confirm the skeleton matches the spec above, fill only real gaps, and record it as the first commit, so Phase 1 spikes start from a clean, reproducible, type-checking baseline.
</goal>

<requirements>
1. Audit every file listed in current_state against its description. Report each as "matches" or "gap: <what differs>". Recreate nothing that already matches.
2. Fix any gap found, one at a time, with the smallest change.
3. Make sure `pnpm build` emits `packages/core/dist/index.js`, `packages/vite-plugin/dist/index.js` and `packages/extension/dist/extension.js` (plus `.d.ts` files for core and vite-plugin), and that `dist/` stays git-ignored.
4. Confirm `@types/vscode` is only in `packages/extension` devDeps (only the extension uses the VS Code API) and that the root package name is `change-spotlight-monorepo`.
5. Create the first git commit containing the skeleton. Recommended default: include `.claude/` so the plan and commands are versioned.
</requirements>

<constraints>
- Use pnpm 12.11.2 only (pinned via `packageManager`); never npm or yarn, to keep one lockfile (`pnpm-lock.yaml`).
- Keep TypeScript 7.x and the base tsconfig options; later phases rely on strict + noUncheckedIndexedAccess.
- Keep `@types/vscode` at `~1.100.0`; it must not exceed `engines.vscode ^1.100.0`, or `vsce` packaging fails.
- Keep the extension package CommonJS (no `"type": "module"`, Node16 resolution), because VS Code 1.100 loads extensions via `require`.
- Keep `core` and `vite-plugin` as ESM (`type: module`, NodeNext).
- Package names stay `@change-spotlight/core`, `@change-spotlight/vite-plugin`, `change-spotlight`; later phases import by these names.
- Work in small steps. Before each step, say briefly what and why. Show the code, say how to run and verify it, then wait for user confirmation before the next step. After each working step, suggest a short git commit message.
- When there is a trade-off, give the options briefly and recommend one.
</constraints>

<out_of_scope>
Do not build any of the following now; they belong to later phases:
- Phase 1: `playground/` app, esbuild bundling, `.vscode/launch.json`, F5 debugging, git diff gutter dots, the `data-cs-loc` transform, the HMR bridge.
- Phase 2: diff parsing, range matching, protocol message types and guards, Vitest setup.
- Phase 3+: git layer, real plugin transform, browser sensor, WebSocket bridge, seen model, UI, CI, packaging.
Adding linters, formatters or new dependencies is also out of scope unless needed to close a gap.
</out_of_scope>

<acceptance_criteria>
- [ ] Audit report lists every current_state file with "matches" or a fixed gap.
- [ ] `pnpm install` completes with no errors and leaves `pnpm-lock.yaml` consistent (`--frozen-lockfile` succeeds).
- [ ] `pnpm typecheck` prints `Done` for core, extension and vite-plugin.
- [ ] `pnpm build` produces the three dist entry files from requirement 3.
- [ ] `@types/vscode` appears in exactly one package.json.
- [ ] `git status` shows a clean tree after the first commit, and no `node_modules/` or `dist/` paths are tracked.
</acceptance_criteria>

<verification>
- `pnpm install --frozen-lockfile` → exits 0.
- `pnpm typecheck` → three lines ending `typecheck: Done`.
- `pnpm build && ls packages/core/dist packages/vite-plugin/dist packages/extension/dist` → shows `index.js`, `index.d.ts` (core, vite-plugin) and `extension.js`.
- `grep -l '@types/vscode' package.json packages/*/package.json` → only `packages/extension/package.json`.
- `git log --oneline` → one commit; `git status --short` → empty; `git ls-files | grep -E 'node_modules|dist/'` → no output.
</verification>

<workflow>
1. Read every file listed in current_state and `.claude/PLAN.md` (Phase 0 section only).
2. Post the audit report and a short plan of the gaps to fix. Wait for confirmation.
3. Fix gaps one small step at a time, verifying each.
4. Run the full verification list.
5. Report results.
</workflow>

<finish>
After verification passes, run `/notes 0` to write the explainer. `.claude/agents/notes-writer.md` is still written for another project (Askwell, with `app/`, `eval/` paths); tell the user, and make sure the note describes Change Spotlight. Then summarize the files changed, decisions made (including the `.claude/` choice), and any follow-ups for Phase 1.
</finish>
