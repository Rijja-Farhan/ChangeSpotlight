# Change Spotlight: learning notes

Short explainers, one per topic, written after each phase is built.
They describe only code that exists in the repo. The plan lives in `.claude/PLAN.md`.

## Index

| Phase | Topic | Note | Status |
|---|---|---|---|
| 0 | Skeleton: pnpm workspace, shared tsconfig, three empty packages | [00-monorepo-skeleton.md](00-monorepo-skeleton.md) | done |
| 1 | Spikes: extension gutter dots, plugin tagging, HMR bridge | [01-extension-spike.md](01-extension-spike.md), [01-plugin-spike.md](01-plugin-spike.md), [01-bridge-spike.md](01-bridge-spike.md) | done |
| 2 | `core`: diff parsing, range matching, protocol types | [02-core.md](02-core.md) | done |
| 3 | Extension git layer: base detection, untracked files, auto-refresh | [03-git-layer.md](03-git-layer.md) | done |
| 4 | Vite plugin transform (real version) | [04-plugin-transform.md](04-plugin-transform.md) | done |
| 5 | Browser sensor: visibility tracking, seen rule, batching | [05-visibility-sensor.md](05-visibility-sensor.md) | done |
| 6 | Plugin to extension bridge: authenticated WebSocket, discovery in .git, reconnect, heartbeat | [06-plugin-extension-bridge.md](06-plugin-extension-bridge.md) | done |
| 7 | The "seen" model: owners, hunk ids, per-branch storage, Seen X/Y stub | [07-seen-model.md](07-seen-model.md) | done |
| 8 | v1 UI: Changes tree, seen/unseen gutter marks, counter, manual marks, open-on-click | [08-v1-ui.md](08-v1-ui.md) | done |
| 9 | Hardening and release | - | not started |
| 10 | Overlay data flow (VS Code -> browser and back) | [10-overlay-data-flow.md](10-overlay-data-flow.md) | done |
| 11 | Overlay outlines and labels | [11-overlay-outlines.md](11-overlay-outlines.md) | done |
| 12 | Overlay live states | [12-overlay-live-states.md](12-overlay-live-states.md) | done |
| 13 | Overlay: finding what is left | [13-overlay-finding.md](13-overlay-finding.md) | done |
| 14 | Overlay actions, settings and polish | [14-overlay-actions-polish.md](14-overlay-actions-polish.md) | done |

Status values: `not started`, `in progress`, `done`.

## Naming convention

- `NN-topic-name.md`, where `NN` is the two-digit phase number (`00`, `01`, ...).
- One note per clearly separate topic. Two topics in one phase share the prefix, e.g. `01-extension-spike.md` and `01-plugin-spike.md`.
- Lowercase, hyphen-separated topic names.

## Template

```markdown
# Phase NN: Topic name

**Status:** done | in progress
**Files:** real paths touched by this topic

## What it is
2-4 bullets. Define each new term in one line.

## Why
The problem it solves and the decisions made.

## How it works
Bullets or a small table. Real file paths and function names.

## Real example
Concrete input -> what the system does -> output (real commands, values, log lines).

## Gotchas
Traps hit, limits, and parts not built yet.

## Try it
Commands that work in this repo today.
```
