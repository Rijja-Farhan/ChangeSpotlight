<role>
You are a senior TypeScript engineer guiding the user, step by step, through building `packages/core` for Change Spotlight (Phase 2): pure, deterministic, unit-tested functions. The user is new to this tooling, so explain things plainly.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`, tags rendered host elements in a React + Vite app with `data-cs-loc="path:start-end"` at dev time, tracks which changed elements were actually visible in the browser, and shows "Seen X of Y" with seen/unseen gutter markers.
pnpm workspaces monorepo, TypeScript everywhere: `packages/core` (pure logic, versioned protocol), `packages/extension` (VS Code extension), `packages/vite-plugin`, `playground/` (Vite + React test app).
</project>

<current_state>
Phases 0 and 1 are done and verified by hand. Environment: Linux, Node 22.22.3, pnpm 12.11.2, git 2.34.1, TypeScript 7.0.2 (packages), Vite 8.3.4.
- `tsconfig.base.json`: ES2022, NodeNext, strict, `noUncheckedIndexedAccess`, `isolatedModules`, declaration, sourceMap, `"types": ["node"]` (TS 7 defaults `types` to `[]`).
- `pnpm-workspace.yaml`: `packages/*`, `playground`; `allowBuilds` for `esbuild`, `@swc/core`. pnpm 12 fails `pnpm install` with `ERR_PNPM_IGNORED_BUILDS` for any new dependency with an install script until `pnpm approve-builds <pkg>` is run.
- Root `package.json` scripts: `build` = `pnpm -r build`, `typecheck` = `pnpm -r typecheck`. No `test` script, no test runner anywhere.
- `packages/core`: ESM, `src/index.ts` only exports `PROTOCOL_VERSION = 1`; `tsc -p .` builds to `dist/`. `vite-plugin` (ESM, tsc NodeNext) imports core at runtime from `dist/`, so core output must be valid Node ESM: relative imports need `.js` extensions. The extension (tsconfig `Preserve`/`Bundler`/`noEmit`) is bundled by esbuild to CJS, core included.
- Spike code (leave untouched): `packages/extension/src/git.ts` runs `git diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ <merge-base>` and has a crude `parseDiff()` that skips pure deletions and deleted files. `packages/extension/src/bridge.ts` hand-checks `protocolVersion` and parses `loc` with `/^(.*):(\d+)-(\d+)$/`. `packages/vite-plugin/src/{index.ts,bridge.ts,transform.ts}` send `{protocolVersion, type: 'hello'}` and `{protocolVersion, type: 'click', loc, page}` as NDJSON and emit `data-cs-loc` values like `playground/src/components/Counter.tsx:8-10`.
- Real `git diff -U0` output observed on git 2.34: hunk headers may carry trailing context (`@@ -2 +2 @@ q`); a pure deletion looks like `@@ -2 +1,0 @@` (new start = the line before the gap, `0` at top of file); paths with spaces get a trailing TAB on `---`/`+++` lines; non-ASCII paths are quoted with octal escapes (`"b/\303\274n\303\257.txt"`); pure renames and binary files have no `---`/`+++` lines (`rename from/to`, `Binary files /dev/null and b/x differ`); mode-only changes have no hunks.
- Uncommitted user edits in `.gitignore` and `Notes/README.md` exist; leave them. `.claude/` is git-ignored on purpose; keep it that way.
</current_state>

<goal>
Turn `packages/core` into the tested heart of the project: diff parsing, element-to-hunk matching, `data-cs-loc` parsing, path normalization and versioned protocol messages with runtime guards. Later phases (git layer, transform, sensor, seen model) build on these functions, so their behaviour must be pinned down by fixtures now.
</goal>

<requirements>
Create these modules in `packages/core/src/`, re-exported from `index.ts` (with `.js` import extensions):
1. `paths.ts`: `normalizePath(p)` converts `\` to `/`, strips leading `./`, collapses `//`, resolves `.`/`..` segments. `toRepoRelative(absPath, repoRoot)` returns the normalized relative path, or `null` if outside the root; handles Windows drive letters case-insensitively.
2. `diff.ts`: `parseDiff(text): DiffFile[]`.
   - `DiffFile = { path; oldPath: string | null; status: 'added' | 'deleted' | 'modified' | 'renamed'; binary: boolean; hunks: Hunk[] }`. `path` is the new path (old path for deletions), normalized, without `a/`/`b/`.
   - `Hunk = { oldStart; oldCount; newStart; newCount; kind: 'add' | 'delete' | 'modify'; removed: string[]; added: string[] }`. Counts default to 1 when omitted. Line text has no `+`/`-` prefix and no trailing `\r`.
   - Pure deletion: `newCount = 0`, `newStart` = the line before the gap (0 = top of file), as git reports it.
   - Handle: added, modified, mixed and multiple hunks; new, deleted, pure-renamed, renamed+edited, binary (new and modified), mode-only files (empty `hunks`); quoted paths (decode C-style and octal escapes as UTF-8 bytes); trailing TAB after paths; `\ No newline at end of file`; CRLF content and CRLF-terminated diff text; empty input.
   - Consume exactly `oldCount` `-` lines and `newCount` `+` lines per hunk, so a removed line `-- x` (shown as `--- x`) or added `++ x` (shown as `+++ x`) is never read as a file header.
   - Malformed input (bad header, count mismatch) throws `DiffParseError` with the 1-based input line number.
3. `changedRanges(files): Map<string, LineRange[]>` with `LineRange = { start; end }` (1-based, inclusive): new-side ranges of hunks with `newCount > 0`, sorted; deleted files excluded. This replaces the spike's `Map<file, number[]>` for gutter dots.
4. `match.ts`: `matchHunks(element: ElementLoc, hunks): { covered: Hunk[]; intersecting: Hunk[] }`, element range `[s, e]` inclusive.
   - Hunk with `newCount > 0`, range `[c, c + d - 1]`: intersecting if `s <= c+d-1 && c <= e`; covered if `s <= c && c+d-1 <= e`.
   - Pure deletion at gap after line `L`: both intersecting and covered if `s <= L && L < e` (the gap lies strictly inside the element).
   - `covered` is always a subset of `intersecting`.
5. `loc.ts`: `parseLoc(value): ElementLoc | null` and `formatLoc(loc)`, `ElementLoc = { path; start; end }`. Split on the last `:` so paths may contain colons; require integers with `1 <= start <= end`; normalize the path. `formatLoc(parseLoc(x)!) === x` for valid normalized input.
6. `protocol.ts`: keep `PROTOCOL_VERSION = 1`. Types `HelloMessage {type: 'hello'}`, `ClickMessage {type: 'click'; loc; page}`, `VisibilityMessage {type: 'visibility'; page; seen: string[]}` (batched `data-cs-loc` values that met the seen rule; Phase 5 fills it), each with `protocolVersion`; union `ProtocolMessage`. `parseMessage(value: unknown)` returns `{ ok: true; message } | { ok: false; reason: 'not-object' | 'version-mismatch' | 'unknown-type' | 'invalid-fields' }`. Extra unknown fields are accepted (forward compatible).
7. Vitest: add `vitest` (5.0.5 is current; peer `vite ^6 || ^7 || ^8`) and `vite` `^8.3.4` (Vitest 5 needs it as a peer) as core devDeps. Core scripts `test` = `vitest run`, `test:watch` = `vitest`; root `test` = `pnpm -r test`.
8. Fixtures: create `packages/core/scripts/gen-fixtures.mjs` (plain Node, no TS runner) that builds a throwaway repo under `os.tmpdir()`, produces each case from requirement 2, runs `git diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ --find-renames` with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, and writes `packages/core/test/fixtures/<case>.diff`. Run with core script `fixtures`. Hand-write only cases git cannot produce here (CRLF-terminated diff text, malformed input). Add `packages/core/test/fixtures/.gitattributes` with `*.diff -text` so line endings are stored byte-for-byte.
9. Tests in `packages/core/test/*.test.ts`, one file per module, asserting exact parsed objects per fixture.
</requirements>

<constraints>
- Never run `git commit`, `git add`, `git switch` or any other git write command in the project repo. Read-only git is fine. The fixture script may run `git init`/`add`/`commit` only inside its own temp directory. After each working step, suggest a short commit message for the user to run.
- Core stays pure: no `fs`, `child_process`, `vscode`, `Buffer`, `process` or DOM APIs, so it can run in the extension, the plugin and the browser client. Enforce it: in `packages/core/tsconfig.json` set `"lib": ["ES2022"]`, `"types": []`. Decode UTF-8 by hand (`TextDecoder` is not in the ES2022 lib).
- Create `packages/core/tsconfig.test.json` (extends core's tsconfig, `noEmit`, `"rootDir": "."`, `"types": ["node"]`, includes `src` and `test`) and make core `typecheck` run both configs. Reason: tests and the fixture script need Node; the build must not.
- No validation library (zod etc.): four message shapes do not justify a dependency in a browser-bound package.
- The parser must not depend on user git config. It assumes the explicit `a/`/`b/` prefixes, `--find-renames` and no color, which Phase 3 will pass.
- If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds <pkg>` for the named package and explain why.
- After core changes, rebuild core (`pnpm --filter @change-spotlight/core build`) before root typecheck, because the other packages read `dist/index.d.ts`.
- Working style: small steps. Before each step say briefly what and why, show the code, explain how to run and verify it, and wait for confirmation. For trade-offs give brief options with a recommendation.
- Open choice, recommended default: keep `removed`/`added` line text in `Hunk` (cheap now; Phase 7 hashes it so a moved hunk keeps its seen status). Alternative: store only a hash, but the hash rule is not decided yet.
</constraints>

<out_of_scope>
- Replacing spike code in the extension or plugin with core functions (Phase 3 for the extension, Phase 4 for the plugin).
- Phase 3: base-branch detection, untracked files, running git, recompute on save.
- Phase 4: real transform, tag escaping, source maps.
- Phase 5: visibility sensor and seen rule. Phase 6: WebSocket, token, discovery file changes, handshake.
- Phase 7: hunk hashing and seen storage. Phase 8: UI.
</out_of_scope>

<acceptance_criteria>
- [ ] `pnpm install` succeeds; `pnpm test` runs Vitest in core and all tests pass.
- [ ] A fixture exists and is tested for every case listed in requirement 2, plus header-lookalike content lines and malformed input.
- [ ] `changedRanges` tests show sorted inclusive ranges, no entries for pure deletions or deleted files, and renamed files keyed by the new path.
- [ ] `matchHunks` tests cover inside, overlapping, touching edges, outside, and deletions at an element's first line, inside, and just after its end.
- [ ] `parseLoc` tests cover a colon in the path, backslashes, invalid ranges, and round-trip with `formatLoc`.
- [ ] `parseMessage` tests cover each message type, each failure reason, and extra fields.
- [ ] `normalizePath`/`toRepoRelative` tests cover POSIX, Windows and outside-root paths.
- [ ] `pnpm build` and `pnpm typecheck` pass; using `Buffer` or `node:fs` in `packages/core/src` fails typecheck.
- [ ] Running `pnpm --filter @change-spotlight/core fixtures` twice gives identical files.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm --filter @change-spotlight/core build && pnpm typecheck && pnpm build` → exit 0.
- `pnpm test` → all core tests pass, no other package fails.
- `pnpm --filter @change-spotlight/core fixtures && cp -r packages/core/test/fixtures /tmp/cs-fx1 && pnpm --filter @change-spotlight/core fixtures && diff -r /tmp/cs-fx1 packages/core/test/fixtures` → no output.
- `cd packages/vite-plugin && node -e "import('@change-spotlight/core').then(m => console.log(Object.keys(m)))"` → lists the new exports (proves `dist/` is valid Node ESM).
- Add `const b: Buffer = null!;` to a core source file temporarily, run `pnpm --filter @change-spotlight/core typecheck` → fails; remove it.
- `pnpm --filter playground dev` → plugin still starts (spike untouched).
</verification>

<workflow>
1. Read the files in current_state and run the sample `git diff` cases yourself to see real output.
2. Propose a short step plan (suggested order: Vitest setup, paths, loc, diff + fixtures, match, protocol). Wait for confirmation.
3. Implement one module at a time with its tests; verify; suggest a commit message.
4. Run the full verification and report.
</workflow>

<finish>
After verification passes, run `/notes 2`. `.claude/agents/notes-writer.md` is still written for another project (Askwell); tell the user and make sure the note describes Change Spotlight only, following `Notes/README.md` naming (for example `02-core.md`) and updating its index. Then summarize files changed, decisions made (hunk text kept, deletion representation, loc colon rule, message shapes), follow-ups for Phases 3 and 4, and suggested commit messages.
</finish>
