<role>
You are a senior TypeScript engineer who knows Node networking, WebSockets and VS Code extensions. You will build the real plugin-to-extension bridge of Change Spotlight (Phase 6) on your own: implement, test, and commit step by step, without waiting for confirmation between steps.
</role>

<project>
Change Spotlight is a VS Code extension plus a dev-only Vite plugin. It reads the current branch's git diff against `main`, tags rendered host elements in a React + Vite app with `data-cs-loc="path:start-end"`, tracks which changed elements were actually visible in the browser, and will show "Seen X of Y" with gutter markers.
It is a pnpm 12 workspaces monorepo using TypeScript 7: `packages/core` (pure logic, no Node or DOM types), `packages/extension`, `packages/vite-plugin`, and `playground/` (Vite 8.3 + React 19 app in the same git repo). Data flows browser -> Vite HMR WebSocket -> plugin -> local bridge -> extension. This phase replaces the local bridge.
</project>

<current_state>
Phases 0 to 5 are committed on branch `v1-phases` (latest: `f2e7139` visibility sensor). Environment: Linux, Node 22.22, pnpm 12.11.2, git 2.34, Vitest 5.0.5, Chrome at `/usr/bin/google-chrome`, VS Code 1.100.2. Its extension host runs Node 20.19.0 (Electron 34.5.1), where `typeof WebSocket` is `undefined`.
- **`packages/core/src/protocol.ts`**: `PROTOCOL_VERSION = 1`. `HelloMessage {type:'hello'}` (today sent plugin -> extension as the first line), `ClickMessage`, `VisibilityMessage {page, seen[]}`, and `parseMessage(value)` -> `{ok, message}` or `{ok:false, reason: 'not-object'|'version-mismatch'|'unknown-type'|'invalid-fields'}`.
- **`packages/vite-plugin/src/bridge.ts`** (spike): HTTP server on `127.0.0.1:0`. `GET /events` streams NDJSON with a `hello` line first. It writes `{port,pid,protocolVersion}` to `<repoRoot>/.change-spotlight/dev-server.json`, which is removed on close and `exit`. SIGINT/SIGHUP handlers remove the file and then re-raise the signal. The file is deleted only if it still holds this server's port. No auth. A second server overwrites the file. API: `startBridge(repoRoot, log): {send, close}`.
- **`packages/vite-plugin/src/index.ts`**: `findRepoRoot` (`git rev-parse --show-toplevel`, falls back to Vite root). `configureServer` starts the bridge and wires `cs:click`/`cs:visibility` through `createMessageHandler` (`src/messages.ts`, validates with `parseMessage`). `closeBundle` and `httpServer` close stop the bridge.
- **`packages/vite-plugin/test/`**: `e2e/sensor.test.ts` (headless Chrome via `playwright-core`). Its `startStack()` polls the discovery file for `pid === process.pid` and reads `/events` with `http.get`. `integration.test.ts` uses a middleware-mode server plus a build test asserting no `data-cs-loc`, `virtual:change-spotlight` or `cs:click` in the output. `vitest.config.ts` sets `fileParallelism: false` only because all test servers share the one discovery file.
- **`packages/extension/src/bridge.ts`** (spike, imports `vscode`): `startBridgeClient(repoRoot, output)` watches the discovery file with `createFileSystemWatcher`, connects with `http.get`, and logs via `describeMessage` from `src/bridgeMessages.ts` (pure, tested in `test/bridgeMessages.test.ts`).
- **`packages/extension/src/git.ts`**: `findRepo(cwd)` -> `{root, gitDir, commonDir}` via `git rev-parse --path-format=absolute`. `extension.ts` calls `startBridgeClient(found.repo.root, output)`. The bundle is esbuild, CJS, `--target=node20`. Dependencies are devDependencies because esbuild bundles them.
- `.gitignore` contains `.change-spotlight/` and `Notes/`. `Notes/README.md` is still tracked and currently modified.
- `pnpm view ws`: 8.22.0, no dependencies, no install scripts. `@types/ws`: 8.18.2.
</current_state>

<goal>
Make the plugin -> extension link reliable and private: an authenticated WebSocket with a version handshake that reconnects quietly when Vite or VS Code is started, restarted or reloaded in any order. Phase 7 builds the seen model on its message stream, so this stream must survive normal dev-loop churn without user action.
</goal>

<requirements>
1. **Core protocol** (`packages/core/src/protocol.ts`, plus a new `bridge.ts` if that is cleaner):
   - `HelloMessage` becomes client -> server `{protocolVersion, type:'hello', token}`. Add `WelcomeMessage {protocolVersion, type:'welcome'}` (server -> client).
   - `CLOSE_CODES`: `protocolError 4000` (first frame is not a hello), `badToken 4001`, `versionMismatch 4002`, `handshakeTimeout 4003`.
   - `parseServerInfo(value)` guard for the discovery JSON.
   - A version-agnostic hello reader, so the server can report the client's version on a mismatch.
2. **Discovery** (create): one file per server at `<gitDir>/change-spotlight/servers/<pid>-<port>.json` containing `{protocolVersion, pid, port, token, root, viteRoot}`.
   - The plugin gets `root` and `gitDir` from one `git rev-parse --path-format=absolute --show-toplevel --git-dir` call. This handles worktrees where `.git` is a file.
   - Directory mode `0o700`, file mode `0o600`. Write to a temp file in the same directory, then rename.
   - The token is `crypto.randomBytes(32).toString('hex')`, new for each server.
   - Outside a git repo the bridge does not start. Log it once.
3. **Plugin server** (rewrite `packages/vite-plugin/src/bridge.ts` on `ws`, `127.0.0.1`, port 0):
   - Reject upgrade requests that carry an `Origin` header with HTTP 403.
   - Accept only a `hello` within 2 s. Compare tokens with `timingSafeEqual`. Reply `welcome`, or close with the matching code; on a version mismatch the reason text holds the server version.
   - `send(message)` broadcasts to authenticated clients only. Incoming messages after the handshake go to an `onMessage` hook, which logs and ignores them for now (ready for later extension -> plugin features).
   - Ping every 10 s (injectable). Terminate clients that miss a pong.
   - On startup, delete files in the servers dir whose pid is dead (`process.kill(pid, 0)` throws `ESRCH`; `EPERM` means alive). Remove its own file on close, `exit`, SIGINT and SIGHUP, keeping the re-raise pattern.
   - Expose bridge details for tests through the plugin's `api` (e.g. `api.bridgeInfo(): Promise<{port, token, file} | null>`).
4. **Remove the spike**: the HTTP `/events` server, `.change-spotlight/`, and its `.gitignore` line.
5. **Extension client** (create `packages/extension/src/bridgeClient.ts`, no `vscode` import): `startBridgeClient({serversDir, log, ...timing overrides})`.
   - Watch the servers dir with `fs.watch` (create it if missing) and rescan on every event. Each rescan opens one connection per live entry (several dev servers at once) and skips dead-pid entries.
   - Reconnect with backoff 250 ms doubling to 5 s; reset after a `welcome`. Retry immediately when that entry's file changes. Stop retrying an entry whose file is gone.
   - On close code 4001 or 4002, log once and wait for that file to change.
   - Detect a dead server when no ping arrives within 25 s (injectable), then terminate and reconnect.
   - Expose `onMessage(listener)` with `{serverId, message: ProtocolMessage}` and `onConnectionChange`, both returning disposers, plus `dispose()`.
6. **Extension wiring**: `src/bridge.ts` becomes a thin `vscode` wrapper. It passes `<repo.gitDir>/change-spotlight/servers`, logs through `describeMessage`, re-exposes messages as a `vscode.Event` for Phase 7, and shows no popups. `describeMessage` returns `null` for `hello`/`welcome`.
7. **Quiet logs**: one line per connect (`Connected to Vite dev server pid N, port P.`) and one per disconnect. Failed retries during backoff log nothing.
8. **Tests**:
   - Core guards (hello, welcome, server info, version-agnostic hello).
   - Plugin: handshake success, bad token -> 4001, wrong version -> 4002, silence -> 4003, `Origin` -> 403, file mode `0600`, stale file deleted on startup, own file removed on close, two servers coexist.
   - Client: backoff sequence with fake timers, including reset after welcome. `bridgeMessages.test.ts`: `hello`/`welcome` return `null`.
   - Integration in `packages/extension/test/` (real plugin bridge <-> real client):
     - server first, then client
     - client first, server appears and connects within 1 s
     - server closed and restarted on a new port -> reconnect and the old entry is dropped
     - stale dead-pid file -> no connection attempt
     - heartbeat timeout -> reconnect
     - at most two log lines across a restart
   - Update `e2e/sensor.test.ts` and `integration.test.ts` to read messages through a small test client (`packages/vite-plugin/test/helpers/bridgeClient.ts`, create) that does the handshake.
</requirements>

<constraints>
- **`ws` on both sides** (`^8.22.0`; `@types/ws` as devDependency). The plugin lists it under `dependencies`; the extension lists it under devDependencies because esbuild bundles it. Reason: VS Code's Node 20 has no global WebSocket client. If esbuild cannot resolve `bufferutil`/`utf-8-validate`, mark them `--external`.
- **Own server rather than Vite's HTTP/WS server.** Middleware mode has no `httpServer`. `--host` exposes Vite to the LAN. Vite's socket belongs to the browser. A separate `127.0.0.1` listener stays local in every setup.
- **`gitDir`, not `commonDir`.** Each worktree runs its own dev server and VS Code window, so per-worktree discovery pairs them without filtering. `.git/` is never committed.
- **Token and `Origin` check together**: browsers can open WebSockets to localhost without CORS, and other local processes can find the port.
- `maxPayload` 1 MiB on both sides, to bound memory from a bad peer.
- **Cross-package tests.** For the extension integration tests to import the plugin bridge, add `@change-spotlight/vite-plugin: workspace:*` as an extension devDependency and a `./bridge` subpath in the plugin's `exports`. Keep `"."` resolving for the playground. Build the plugin before running extension tests.
- Keep `fileParallelism: false` only if e2e timing needs it, and update the comment to the real reason.
- **Git.**
  - Commit locally on `v1-phases` after each verified step, with a short conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Stage explicit paths only. Never `git add -A` or `git add .`, because `Notes/README.md` is tracked but must not be committed.
  - Never push, switch branches, or run other git write commands.
- **Open choices (recommended defaults):**
  - Keep `PROTOCOL_VERSION = 1`, since nothing is released and the old and new transports cannot meet. Bump it if you change `ClickMessage`/`VisibilityMessage`.
  - The extension connects to every live server now. Choosing which server's pages to show is Phase 9.
  - Windows: file modes are ignored there. Document that the user-profile ACLs on `.git` apply, and keep the token.
</constraints>

<out_of_scope>
- Phase 7: seen persistence, hunk matching, content hashes. The extension only logs and emits events.
- Phase 8: TreeView, gutter styles, status bar, any notification UI.
- Phase 9: app in a subfolder, choosing between servers, packaging, CI.
- Later: extension -> plugin "reveal" features. Only the receiving hook exists.
- Changes to the sensor, the transform, or `createMessageHandler` behaviour.
</out_of_scope>

<acceptance_criteria>
- [ ] No `/events`, `http.createServer`, `.change-spotlight` or `dev-server.json` left in `packages/` or `.gitignore`.
- [ ] Discovery files appear under `.git/change-spotlight/servers/` with mode `0600` and disappear on close, Ctrl+C and Vite config restart.
- [ ] Every handshake outcome in requirement 8 is covered by a passing test.
- [ ] All restart-order integration tests pass, with no test longer than 10 s.
- [ ] `bridgeClient.ts` imports nothing from `vscode`.
- [ ] Sensor e2e tests still pass on the new transport, and the build test still finds no client markers.
- [ ] `pnpm build` produces `packages/extension/dist/extension.js` with `ws` bundled.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass.
</acceptance_criteria>

<verification>
- `pnpm install && pnpm build && pnpm typecheck && pnpm test`: exit 0, e2e run and not skipped.
- `grep -rnE "/events|\.change-spotlight|dev-server\.json" packages/*/src packages/*/test .gitignore`: no output.
- `grep -n "from 'vscode'" packages/extension/src/bridgeClient.ts`: no output.
- `ls .git/change-spotlight/servers/` before and after `pnpm test`: empty both times.
- Start `pnpm --filter playground dev` in the background and wait for it to listen:
  - `stat -c %a .git/change-spotlight/servers/*.json` prints `600`.
  - A one-off `node -e` script using `ws` with the token from that file receives `welcome`, and with a wrong token gets close code 4001.
  - `curl -si -H 'Origin: http://evil.test' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:<port>/` returns `403`.
  - Send SIGINT: the file is gone.
- `git status --short`: only intended changes, and `Notes/` is never staged.
</verification>

<manual_checks_for_user>
Run these after the automated work is done. They must not block it.
1. Start `pnpm --filter playground dev`, then F5. Output "Change Spotlight" shows one `Connected ...` line, and scrolling logs `Seen ...` batches.
2. Ctrl+C Vite, wait 10 s, start it again. You see one disconnect line, one connect line, and no popups.
3. Stop Vite, F5 (Vite not running), then start Vite. It connects within about a second.
4. With both running, run "Developer: Reload Window". It reconnects without errors.
5. `kill -9` the Vite process, then start Vite again. The stale file is removed and the extension connects to the new server only.
6. Run a second server (`pnpm --filter playground dev --port 5174`). Both connect, and messages from each are logged.
7. Edit `playground/vite.config.ts` to trigger a Vite restart. It reconnects on its own.
</manual_checks_for_user>

<workflow>
1. Read the files named in current_state. Confirm the `ws` and `@types/ws` versions with `pnpm view`.
2. Write a short step plan, then follow it without waiting:
   1. Core protocol types, guards and tests.
   2. Plugin `ws` server, discovery and stale cleanup, with unit tests.
   3. Plugin test helper client. Migrate the e2e and integration tests. Remove the spike and `.change-spotlight/`.
   4. Extension `bridgeClient.ts` with backoff and heartbeat, plus unit tests.
   5. Extension integration and restart-order tests.
   6. `vscode` wrapper, `extension.ts` wiring, esbuild bundle check.
3. For each step: implement, run its tests plus `pnpm typecheck`, then commit.
4. Run the full verification and fix any failures before finishing.
</workflow>

<finish>
After verification passes, run `/notes 6`. The note must be `Notes/06-plugin-extension-bridge.md` and describe Change Spotlight only. Update the Phase 6 row in `Notes/README.md` (do not commit it). Then report:
- the files changed and the commits made
- the decisions taken: transport and library, discovery location and format, handshake and close codes, token and Origin handling, multi-server handling, backoff and heartbeat values, protocol version
- test run time and any flakiness seen
- the manual checks for the user
- follow-ups for Phases 7 and 9
</finish>
