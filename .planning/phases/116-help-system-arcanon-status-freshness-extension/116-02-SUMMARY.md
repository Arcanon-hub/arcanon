---
phase: 116
plan: "02"
title: "/arcanon:status freshness extension: GET /api/scan-freshness + cmdStatus rewire"
subsystem: scan-freshness
tags: [freshness, status, http-api, git, back-compat]
requires:
  - lib/help.sh extractor (from 116-01) — not direct, but ensures /arcanon:status --help still works
provides:
  - GET /api/scan-freshness endpoint (FRESH-03)
  - getCommitsSince(repoPath, sinceSha) helper for git-state
  - "Latest scan: YYYY-MM-DD (NN% high-confidence)" line in /arcanon:status (FRESH-01)
  - "N repo(s) have new commits since last scan: <name> (M new), ..." line (FRESH-02)
affects:
  - plugins/arcanon/worker/server/http.js (new route only — /api/scan-quality untouched)
  - plugins/arcanon/worker/cli/hub.js (cmdStatus rewired; _fetchLatestScanLine deleted)
  - plugins/arcanon/commands/status.md (descriptive bullets updated)
  - plugins/arcanon/CHANGELOG.md ([Unreleased] / ### Changed)
tech-stack:
  added: []
  patterns:
    - execFileSync git invocation pattern (mirrors worker/scan/manager.js:317 — no shell, 5s timeout)
    - null-vs-zero distinction in JSON for "couldn't determine" vs "up to date"
    - back-compat-by-coexistence: new endpoint added; old endpoint stays untouched
key-files:
  created:
    - plugins/arcanon/worker/scan/git-state.js
    - plugins/arcanon/worker/server/http.scan-freshness.test.js
    - plugins/arcanon/tests/fixtures/freshness/seed.js
    - plugins/arcanon/tests/fixtures/freshness/seed.sh
    - tests/freshness.bats
  modified:
    - plugins/arcanon/worker/server/http.js
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/commands/status.md
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Used a millisecond-tolerant ISO regex in the node test (`/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z?$/`) instead of the plan's strict no-millis form. The endpoint's normalizer appends 'Z' to SQLite's `YYYY-MM-DD HH:MM:SS` form (no millis), but if migration 015 ever switches to `Date.toISOString()` we'd break on a millisecond suffix. Cheap forward-compat."
  - "Hardened qualityPct null-check to also catch undefined (`quality_score === null || quality_score === undefined`). The plan only checked null; better-sqlite3 returns undefined for missing columns under some pre-migration paths. Defense-in-depth, no behavior change for the populated path."
  - "Hardened pctPart null-check in _fetchScanFreshness for the same reason (handle both null and undefined)."
  - "Used a JS-based fixture seeder (seed.js + seed.sh wrapper) instead of pure bash + sqlite3 CLI. Pattern proven by tests/fixtures/verify/seed.{sh,js}; better-sqlite3 resolves naturally via plugin node_modules; deterministic git identity via env vars."
  - "Set explicit branch name `-b main` on `git init` in the seeder. Without this, behavior depends on the dev's `init.defaultBranch` git config and could produce master/main inconsistencies."
metrics:
  duration_min: 8
  completed: 2026-04-27
---

# Phase 116 Plan 02: `/arcanon:status` Freshness Extension Summary

`/arcanon:status` now surfaces a `Latest scan: YYYY-MM-DD (NN% high-confidence)` line and a `N repo(s) have new commits since last scan: <name> (M new), ...` line via a new `GET /api/scan-freshness` endpoint that returns scan age, quality percentage, and per-repo `git rev-list --count` drift. The existing `GET /api/scan-quality` endpoint stays untouched for back-compat (consumed by `/arcanon:list`).

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create `worker/scan/git-state.js` (`getCommitsSince` helper) | `3291fb7` | `plugins/arcanon/worker/scan/git-state.js` |
| 2 | Add `GET /api/scan-freshness` route to `worker/server/http.js` | `2c12d51` | `plugins/arcanon/worker/server/http.js` |
| 3 | Author `worker/server/http.scan-freshness.test.js` (5 node tests) | `f15251b` | `plugins/arcanon/worker/server/http.scan-freshness.test.js` |
| 4 | Rewire `cmdStatus` in `worker/cli/hub.js` (delete `_fetchLatestScanLine`, add `_fetchScanFreshness`) | `77e6d09` | `plugins/arcanon/worker/cli/hub.js` |
| 5 | Update `commands/status.md` descriptive bullets | `9b77d1a` | `plugins/arcanon/commands/status.md` |
| 6 | Author `tests/fixtures/freshness/seed.{sh,js}` | `fad43b2` | `plugins/arcanon/tests/fixtures/freshness/seed.{sh,js}` |
| 7 | Author `tests/freshness.bats` (5 E2E tests) | `1a0ae54` | `tests/freshness.bats` |
| 8 | CHANGELOG bullet under `[Unreleased] / ### Changed` | `4d1eb28` | `plugins/arcanon/CHANGELOG.md` |

## Tests

- `node --test plugins/arcanon/worker/server/http.scan-freshness.test.js` — 5/5 pass
- `node --test plugins/arcanon/worker/server/http.scan-quality.test.js` — 5/5 pass (back-compat regression confirmed)
- `bats tests/freshness.bats` — 5/5 pass (FRESH-03 endpoint shape, FRESH-01 status line, FRESH-02 drift line, FRESH-02 suppression, FRESH-04 back-compat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Defense in depth] Tightened nullish checks for `quality_score`**

- **Found during:** Task 2 (route impl) and Task 4 (helper impl)
- **Issue:** Plan's null-check `breakdown.quality_score !== null` would let `undefined` slip through and produce `Math.round(undefined * 100) === NaN`. better-sqlite3 returns undefined for missing columns under some pre-migration paths.
- **Fix:** Tightened both call sites to `quality_score === null || quality_score === undefined`. Same correction applied in `_fetchScanFreshness` for `body.scan_quality_pct`.
- **Files modified:** `plugins/arcanon/worker/server/http.js`, `plugins/arcanon/worker/cli/hub.js`
- **Commits:** `2c12d51`, `77e6d09`

**2. [Rule 2 - Determinism] Forced `-b main` on fixture `git init`**

- **Found during:** Task 6 implementation
- **Issue:** Plain `git init` honors the dev's `init.defaultBranch` config. On dev machines where this is `master`, the seeder would create a `master` branch — harmless for the tests as written (they only walk HEAD), but a forward-compat liability for any future test that asserts on branch names.
- **Fix:** Pass `-b main` explicitly to `git init`. Deterministic across all dev environments.
- **Files modified:** `plugins/arcanon/tests/fixtures/freshness/seed.js`
- **Commit:** `fad43b2`

**3. [Plan-vs-reality drift] `/api/scan-quality` references in hub.js are NOT all gone**

- **Found during:** Task 4 verify
- **Issue:** Plan's verify step expected `grep -c "/api/scan-quality" plugins/arcanon/worker/cli/hub.js` to return 0. Reality returned 6: one comment inside the new `cmdStatus` (documenting the back-compat decision), plus 5 references inside `cmdList` (NAV-01, Phase 114). `cmdList` legitimately still consumes `/api/scan-quality` for its connection-breakdown line.
- **Fix:** No code change. The plan's check assumed `cmdStatus` was the sole consumer; it never was. The constraint that matters — "the `cmdStatus` function no longer calls `/api/scan-quality` at runtime" — IS satisfied (the 1 hit inside `cmdStatus` is a comment).
- **Documented:** Task 4 commit message (`77e6d09`) explicitly notes that `/arcanon:list` continues to use `/api/scan-quality` and that this is consistent with the back-compat constraint.
- **Files modified:** None (documentation only)

### Authentication Gates

None — no auth-required steps in this plan.

## Verification Trace

| Check | Result |
|-------|--------|
| `node --check` on all modified .js files | PASS (4/4) |
| `git-state.js` smoke test (HEAD~3 → 3, /tmp/not-a-repo → null) | PASS |
| Manual `git diff plugins/arcanon/worker/server/http.js` confirms `/api/scan-quality` route is byte-identical | PASS |
| `node --test http.scan-quality.test.js` continues to pass after http.js changes | PASS (5/5) |
| `node --test http.scan-freshness.test.js` | PASS (5/5) |
| `_fetchLatestScanLine` deleted (grep returns 0) | PASS |
| `_fetchScanFreshness` defined + called (grep returns 2) | PASS |
| `/api/scan-freshness` referenced in hub.js (grep returns 2) | PASS |
| `commands/status.md` references `FRESH-01` + `high-confidence`, no `TRUST-05` | PASS |
| Seeder smoke: 4 commits in repo-a, INIT_SHA captured, DB row populated | PASS |
| `bats tests/freshness.bats` | PASS (5/5) |
| CHANGELOG bullet under `[Unreleased] / ### Changed` | PASS (1 hit) |

## Self-Check: PASSED

- File `plugins/arcanon/worker/scan/git-state.js` — FOUND
- File `plugins/arcanon/worker/server/http.scan-freshness.test.js` — FOUND
- File `plugins/arcanon/tests/fixtures/freshness/seed.js` — FOUND
- File `plugins/arcanon/tests/fixtures/freshness/seed.sh` — FOUND
- File `tests/freshness.bats` — FOUND
- Commit `3291fb7` — FOUND
- Commit `2c12d51` — FOUND
- Commit `f15251b` — FOUND
- Commit `77e6d09` — FOUND
- Commit `9b77d1a` — FOUND
- Commit `fad43b2` — FOUND
- Commit `1a0ae54` — FOUND
- Commit `4d1eb28` — FOUND
