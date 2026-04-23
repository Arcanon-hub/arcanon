---
phase: 101-runtime-purge
status: passed
verified_at: 2026-04-23
plans_executed: 4
requirements_covered: 22
carry_overs_to_phase_102: 12
---

# Phase 101 Runtime Purge — Verification

## Status: ✅ PASSED

All runtime-level ligamen reads, fallbacks, and package identity removed. Remaining matches are cosmetic (docstrings, comments, user-facing schema descriptions) and are explicitly Phase 102 scope.

## Plans Executed

| Plan | Commits | Requirements | Status |
|---|---|---|---|
| 101-01 | 2c35612, 6b712b6, a880615, d31d318 | ENV-01, ENV-02, ENV-03, ENV-08, ENV-09, PATH-02, PATH-04 | ✅ |
| 101-02 | c217668, 279f89a, 3ac8e93, f629d32 | ENV-04, ENV-05, ENV-06, ENV-07, PATH-01, PATH-03, PATH-05, PATH-06 | ✅ |
| 101-03 | bd6f540, 2c35612, bfd50bd | PKG-01, PKG-02, PKG-03 | ✅ |
| 101-04 | 5fe900f, 74d0a65, d9a708d, 75782d4, 50b4b0e | ENV-10, PATH-07, PATH-08, PATH-09 | ✅ |

## Verification Gates

### Gate 1 — LIGAMEN_* env var runtime reads
**Expected:** 0 lines
**Actual (runtime reads):** 0 lines
**Cosmetic matches (Phase 102 scope):** 7 lines — all `.describe()` Zod schema strings in `worker/mcp/server.js` lines 1280, 1321, 1366, 1405, 1463, 1488, 1513. The CODE reads `ARCANON_PROJECT_ROOT`; only the USER-FACING TEXT says "LIGAMEN_PROJECT_ROOT". Phase 102 owns this.

### Gate 2 — Ligamen path fallbacks in runtime
**Expected:** 0 runtime branches
**Actual:** 0 runtime code paths check `ligamen.config.json` or `$HOME/.ligamen`
**Cosmetic matches (Phase 102 scope):** 5 JSDoc/comment lines
- `worker/mcp/server.js:33` — JSDoc comment
- `worker/mcp/server.js:82` — inline comment
- `worker/scan/manager.js:77` — JSDoc comment
- `worker/db/database.js:8` — file-header JSDoc
- `worker/db/pool.js:74` — JSDoc comment

### Gate 3 — @ligamen package references
**Expected:** 0
**Actual:** 0 ✓

### Gate 4 — runtime-deps.json identity
**Expected:** `"name": "@arcanon/runtime-deps"`
**Actual:** ✓

### Gate 5 — ChromaDB COLLECTION_NAME
**Expected:** `"arcanon-impact"`
**Actual:** ✓ (breaking change — existing users rebuild collections via `/arcanon:map`)

## Known Test Breakage (Expected — Phase 103 scope)

Tests in `tests/*.bats` and `worker/**/*.test.js` that set `LIGAMEN_*` env var fixtures OR assert on `ligamen.config.json` paths will fail until Phase 103 rewrites them. This is the intended signal that the runtime purge landed. Phase 103 owns the test updates.

Specific test files currently broken:
- `tests/config.bats` (LIGAMEN_CONFIG_FILE fixtures)
- `tests/detect.bats`, `tests/format.bats`, `tests/file-guard.bats`, `tests/structure.bats`
- `tests/mcp-chromadb-fallback.bats`, `tests/mcp-launch.bats`, `tests/mcp-server.bats`
- Worker node tests: `chroma.test.js`, `manager.test.js`, `discovery.test.js`, etc.

## Phase 102 Carry-Over Inventory

12 cosmetic ligamen mentions documented for Phase 102:
1. `worker/mcp/server.js` — 7 `.describe()` strings (LIGAMEN_PROJECT_ROOT in user-facing schema docs)
2. `worker/mcp/server.js:33` — JSDoc comment (`~/.ligamen/projects/...`)
3. `worker/mcp/server.js:82` — inline comment (`~/.arcanon or legacy ~/.ligamen`)
4. `worker/scan/manager.js:77` — JSDoc "legacy ligamen.config.json supported"
5. `worker/db/database.js:8` — file-header JSDoc (`~/.ligamen/projects/...`)
6. `worker/db/pool.js:74` — JSDoc (`~/.ligamen/projects/`)

Plus carry-overs documented in 101-04-SUMMARY:
- `pool.js:74`, `database.js:2+8`, `chroma.js:2` — pure historical prose

## Deviations from Plan

**1. 101-01 Task 1 content mislabeled in commit message.** Worker index.js and chroma.js edits landed under commit `2c35612` which carries the 101-03 install-deps.sh message (parallel-worktree bundling). File contents are correct; grep gates pass. Documented in 101-01-SUMMARY.md.

**2. 101-03 package-lock.json revert.** Agent initially deleted a tracked `package-lock.json` during npm verification cleanup; reverted before final commit. No residual impact.

## Phase 104 Handoff

Phase 104 must include the following BREAKING entry in CHANGELOG:

> **BREAKING — ChromaDB collection rename.** `COLLECTION_NAME` was renamed from `"ligamen-impact"` to `"arcanon-impact"`. Existing ChromaDB collections created under the Ligamen name are orphaned on upgrade; users must rebuild semantic search via `/arcanon:map` (or ignore if they were not using ChromaDB).

Recorded in `101-04-SUMMARY.md`.

## Overall

**Phase 101 verification: PASSED.** Ready to proceed to Phase 102 (Source Cosmetic Rename) and Phase 104 (Docs & README Purge) — both can run in parallel as planned.
