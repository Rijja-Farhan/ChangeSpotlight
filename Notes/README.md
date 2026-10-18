# Change Spotlight: learning notes

Short explainers, one per topic, written after each phase is built.
They describe only code that exists in the repo. The plan lives in `.claude/PLAN.md`.

## Index

| Phase | Topic | Note | Status |
|---|---|---|---|
| 0 | Skeleton: pnpm workspace, shared tsconfig, three empty packages | [00-monorepo-skeleton.md](00-monorepo-skeleton.md) | done |
| 1 | Spikes: extension gutter dots, plugin tagging, HMR bridge | - | not started |
| 2 | `core`: diff parsing, range matching, protocol types | - | not started |
| 3 | Extension git layer | - | not started |
| 4 | Vite plugin transform (real version) | - | not started |
| 5 | Browser sensor | - | not started |
| 6 | Plugin to extension bridge | - | not started |
| 7 | The "seen" model | - | not started |
| 8 | v1 UI | - | not started |
| 9 | Hardening and release | - | not started |

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
