---
phase: 101-runtime-purge
plan: 01
subsystem: worker-runtime
tags:
  - runtime-purge
  - javascript
  - env-vars
requires:
  - ROADMAP.md v0.1.2 phase 101 definition
  - REQUIREMENTS.md ENV-01..03, ENV-08, ENV-09, PATH-02, PATH-04
provides:
  - worker-runtime reads ARCANON_* env vars only
  - resolveDataDir() and resolveConfigPath() are pure resolvers (no disk probes)
affects:
  - plugins/arcanon/worker/index.js
  - plugins/arcanon/worker/server/chroma.js
  - plugins/arcanon/worker/mcp/server.js
  - plugins/arcanon/worker/lib/data-dir.js
  - plugins/arcanon/worker/lib/config-path.js
tech_stack:
  added: []
  patterns:
    - "Pure resolver pattern: lib/data-dir.js + lib/config-path.js return paths without touching disk"
key_files:
  created: []
  modified:
    - plugins/arcanon/worker/index.js
    - plugins/arcanon/worker/server/chroma.js
    - plugins/arcanon/worker/mcp/server.js
    - plugins/arcanon/worker/lib/data-dir.js
    - plugins/arcanon/worker/lib/config-path.js
decisions:
  - "Hard-remove LIGAMEN_* reads — no two-read fallback, no deprecation warning, no migration tooling"
  - "Delete LEGACY_CONFIG_FILENAME export outright; no in-scope consumers, Phase 103 tests expected to break"
  - "Preserve COLLECTION_NAME string 'ligamen-impact' / 'arcanon-impact' — out of this plan's scope (101-04 handled it)"
metrics:
  duration_min: 12
  completed_date: "2026-04-23"
  tasks_total: 3
  tasks_completed: 3
  files_touched: 5
requirements:
  - ENV-01
  - ENV-02
  - ENV-03
  - ENV-08
  - ENV-09
  - PATH-02
  - PATH-04
---

# Phase 101 Plan 01: Worker JS Env Var + Fallback Purge Summary

Hard-removed every `LIGAMEN_*` env var read, `ligamen.config.json` fallback branch, and `$HOME/.ligamen` data-dir branch from the five worker/MCP JavaScript runtime files. Resolvers `resolveDataDir()` and `resolveConfigPath()` are now pure — no disk probes, no legacy branches.

## Tasks Completed

### Task 1 — worker/index.js + worker/server/chroma.js env var reads

**Commit:** `2c35612` (note: parallel worktree activity landed this content under a 101-03 commit label; content is correct, labeling is inaccurate — see Deviations)

**worker/index.js** — 3 rewrites:

| Line(s) | Before | After |
|---|---|---|
| 25 | `// 2. Read settings.json for LIGAMEN_LOG_LEVEL and port override` | `// 2. Read settings.json for ARCANON_LOG_LEVEL and port override` |
| 33 | `if (allSettings.LIGAMEN_LOG_LEVEL) logLevel = allSettings.LIGAMEN_LOG_LEVEL;` | `if (allSettings.ARCANON_LOG_LEVEL) logLevel = allSettings.ARCANON_LOG_LEVEL;` |
| 34-35 | `if (allSettings.LIGAMEN_WORKER_PORT) port = parseInt(allSettings.LIGAMEN_WORKER_PORT, 10);` | `if (allSettings.ARCANON_WORKER_PORT) port = parseInt(allSettings.ARCANON_WORKER_PORT, 10);` |
| 62 | `if (allSettings.LIGAMEN_CHROMA_MODE) {` | `if (allSettings.ARCANON_CHROMA_MODE) {` |

**worker/server/chroma.js** — 10 rewrites (1 JSDoc prose + 4 @param + 1 guard + 6 property reads):

| Line(s) | Description |
|---|---|
| 56 | JSDoc "If LIGAMEN_CHROMA_MODE is empty/falsy" → "If ARCANON_CHROMA_MODE is empty/falsy" |
| 60-63 | Four @param tags renamed `settings.LIGAMEN_CHROMA_MODE\|HOST\|PORT\|SSL` → `settings.ARCANON_CHROMA_MODE\|HOST\|PORT\|SSL` |
| 70 | Guard `if (!settings.LIGAMEN_CHROMA_MODE)` → `if (!settings.ARCANON_CHROMA_MODE)` |
| 80-85 | Six reads `settings.LIGAMEN_CHROMA_{HOST,PORT,SSL,API_KEY,TENANT,DATABASE}` → `settings.ARCANON_CHROMA_*` |

**Preserved (Phase 102 / data-migration carry-over):**
- Line 2 file header "for Ligamen v2.0" — cosmetic, Phase 102
- Line 24 `COLLECTION_NAME` string literal — handled by plan 101-04 (renamed to `"arcanon-impact"` there; was `"ligamen-impact"` at start of my plan)

### Task 2 — worker/mcp/server.js env var reads

**Commit:** `6b712b6`

| Line | Before | After |
|---|---|---|
| 27 | `if (_settings.LIGAMEN_LOG_LEVEL) _mcpLogLevel = _settings.LIGAMEN_LOG_LEVEL;` | `if (_settings.ARCANON_LOG_LEVEL) _mcpLogLevel = _settings.ARCANON_LOG_LEVEL;` |
| 46 | `process.env.LIGAMEN_DB_PATH \|\|` | `process.env.ARCANON_DB_PATH \|\|` |
| 47 | `resolveDbPath(process.env.LIGAMEN_PROJECT_ROOT \|\| process.cwd())` | `resolveDbPath(process.env.ARCANON_PROJECT_ROOT \|\| process.cwd())` |
| 79 | `const root = process.env.LIGAMEN_PROJECT_ROOT \|\| process.cwd();` | `const root = process.env.ARCANON_PROJECT_ROOT \|\| process.cwd();` |

**Deliberately preserved (Phase 102 carry-over):** 7 occurrences of the literal string `"LIGAMEN_PROJECT_ROOT"` inside `.describe()` schema strings at lines 1280, 1321, 1366, 1405, 1463, 1488, 1513 (surface to MCP clients). Plan explicitly carves these out as Phase 102 scope. Also preserved: JSDoc/comment at lines 33-34, 82 referencing `~/.ligamen`.

### Task 3 — worker/lib/data-dir.js + worker/lib/config-path.js (full rewrites)

**Commit:** `a880615`

**worker/lib/data-dir.js** — reduced from 37 lines / 5 preference steps to 22 lines / 2 preference steps.

Deleted:
- `import fs from "node:fs";` (no longer needed)
- `const LEGACY_DIR = ".ligamen";`
- `if (process.env.LIGAMEN_DATA_DIR) return process.env.LIGAMEN_DATA_DIR;`
- `fs.existsSync(current)` + `fs.existsSync(legacy)` disambiguation branches

After: `resolveDataDir()` returns `$ARCANON_DATA_DIR` if set, else `path.join(os.homedir(), ".arcanon")`. Pure resolver.

**worker/lib/config-path.js** — reduced from 25 lines to 15.

Deleted:
- `import fs from "node:fs";` (no longer needed)
- `const LEGACY = "ligamen.config.json";`
- `fs.existsSync(current)` / `fs.existsSync(legacy)` branches
- `export const LEGACY_CONFIG_FILENAME = LEGACY;` — full delete. No in-scope (worker/) consumers grep confirms. Phase 103 tests may import it — expected breakage.

After: `resolveConfigPath(dir)` always returns `path.join(dir, "arcanon.config.json")`. No disk probe.

## Verification Gates

All four gates from the plan passed post-execution:

| Gate | Command | Result |
|---|---|---|
| 1a | `grep -rn "LIGAMEN_" index.js chroma.js data-dir.js config-path.js` | zero matches — PASS |
| 1b | `grep -rn "process\.env\.LIGAMEN_\|_settings\.LIGAMEN_\|allSettings\.LIGAMEN_\|settings\.LIGAMEN_" mcp/server.js` | zero matches — PASS |
| 2 | `grep -n "ligamen\.config\.json\|/\.ligamen\|\"\.ligamen\"" [4 files]` | zero matches — PASS |
| 3 | `node --check` on all five files | all PASS |
| 4 | `ARCANON_DATA_DIR=/tmp/arc-test node -e "resolveDataDir()"` | prints `/tmp/arc-test` — PASS |

Additional spot-checks:
- `grep -c "ARCANON_LOG_LEVEL\|ARCANON_WORKER_PORT\|ARCANON_CHROMA_MODE" index.js` → 5 (check + assign per key × 3 keys — one is a one-liner check)
- `grep -c "ARCANON_CHROMA_" chroma.js` → 12 (prose + @param × 4 + guard + 6 reads)
- `grep -c "process\.env\.ARCANON_DB_PATH\|process\.env\.ARCANON_PROJECT_ROOT" server.js` → 3 (lines 46, 47, 79)
- `grep -c "_settings\.ARCANON_LOG_LEVEL" server.js` → 1 (line 27)
- `grep -c "LIGAMEN_PROJECT_ROOT" server.js` → 7 (Phase 102 `.describe()` carry-over, expected)
- Smoke test unsetting `ARCANON_DATA_DIR` → `resolveDataDir()` returns `$HOME/.arcanon` as intended

## Expected Phase 103 Test Breakage (not fixed — out of scope)

Four test files still contain `LIGAMEN_*` fixture references and will fail on next test run:
- `plugins/arcanon/worker/server/chroma.test.js`
- `plugins/arcanon/worker/mcp/server.test.js`
- `plugins/arcanon/worker/scan/manager.test.js`
- `plugins/arcanon/worker/db/pool-repo.test.js`

Per CONTEXT.md: "Tests in Phase 103's scope will break. Don't fix them in 101 — leave them red. Phase 103 rewrites them." Test breakage is the signal the purge landed.

## Phase 102 Carry-Over (left intentionally untouched)

For Phase 102 (source cosmetic rename) to pick up:

| File | Lines | What |
|---|---|---|
| `worker/server/chroma.js` | 2 | File-header comment: "ChromaDB async sync module for Ligamen v2.0" |
| `worker/mcp/server.js` | 33-34 | `resolveDbPath` JSDoc mentioning `~/.ligamen/projects/` |
| `worker/mcp/server.js` | 82 | Comment "~/.arcanon or legacy ~/.ligamen" |
| `worker/mcp/server.js` | 1280, 1321, 1366, 1405, 1463, 1488, 1513 | `.describe()` strings referencing `LIGAMEN_PROJECT_ROOT` in Zod schemas (MCP tool descriptions) |
| `worker/mcp/server.js` | 1192, 1200, 1431 | User-facing messages referencing `/ligamen:map` command name |

## Known Scope Gaps Confirmation

The plan flagged three runtime reads outside 101-01 scope that would otherwise block Phase 101 completion. All three were absorbed by **plan 101-04** (executed in parallel by another agent, already in main):

- `worker/db/pool.js:131` — `ligamen.config.json` iteration fallback → commit `74d0a65` (PATH-07)
- `worker/db/database.js:~215` — boundary-map comment reference → commit `d9a708d` (PATH-08)
- `worker/hub-sync/auth.js:47` — `~/.ligamen/config.json` credential fallback → commit `75782d4` (PATH-09)

ROADMAP success criterion #2 (zero `.ligamen`/`ligamen.config.json` grep matches across worker/) is now on track once all 4 plans in phase 101 land.

## Deviations from Plan

**1. [Rule 3 — Blocking] Task 1 landed under a mislabeled commit.**
- **Found during:** commit attempt after Task 1 edits
- **Issue:** A parallel worktree running phase 101 plans was active in the repo. When I ran `git commit` for Task 1, the file changes were already staged elsewhere and landed under commit `2c35612` with the label `feat(101-03): purge final Ligamen reference from install-deps.sh header`. The `2c35612` commit's actual contents include both my 101-01 index.js + chroma.js env-var rewrites AND the 101-03 install-deps.sh header edit (10 lines in index.js, 24 in chroma.js, 2 in install-deps.sh).
- **Fix:** No code action taken. The file contents are correct (verified via grep gates). The labeling mismatch is documented here for the Phase 105 verification agent; bisect-by-commit-message would miss it, bisect-by-file-content would find it. Not reverting — that would destroy valid work from other plans.
- **Files modified:** none (documentation only)
- **Commit:** n/a (the content is in `2c35612`)

**2. No code deviations — the plan executed exactly as written for Tasks 2 and 3.**

Tasks 2 and 3 committed cleanly under correctly-labeled `feat(101-01)` commits (`6b712b6`, `a880615`).

## Authentication Gates

None encountered.

## Commits

| Task | Plan label | Actual commit hash | Message |
|---|---|---|---|
| 1 (index.js + chroma.js) | 101-01 | `2c35612` (mis-labeled as 101-03 by parallel process) | content correct: 10+24 line rewrites |
| 2 (mcp/server.js) | 101-01 | `6b712b6` | `feat(101-01): purge LIGAMEN_* env var reads from worker/mcp/server.js` |
| 3 (data-dir.js + config-path.js) | 101-01 | `a880615` | `feat(101-01): purge legacy fallbacks from worker/lib data-dir.js and config-path.js` |

## Self-Check: PASSED

All five target files verified present in the working tree and modified vs HEAD^N:
- `plugins/arcanon/worker/index.js` — FOUND, 3 runtime rewrites applied (verified by grep)
- `plugins/arcanon/worker/server/chroma.js` — FOUND, 10 runtime rewrites applied
- `plugins/arcanon/worker/mcp/server.js` — FOUND, 4 runtime rewrites applied (7 .describe() carry-overs preserved as designed)
- `plugins/arcanon/worker/lib/data-dir.js` — FOUND, rewritten (37 → 22 lines)
- `plugins/arcanon/worker/lib/config-path.js` — FOUND, rewritten (25 → 15 lines)

All three commits verified in `git log`:
- `2c35612` — FOUND (carries Task 1 content under mislabeled 101-03 message)
- `6b712b6` — FOUND (Task 2, correctly labeled 101-01)
- `a880615` — FOUND (Task 3, correctly labeled 101-01)

All four verification gates passed (grep 1a, grep 1b, grep 2, node --check × 5, smoke test).
