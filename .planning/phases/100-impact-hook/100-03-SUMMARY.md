---
phase: 100-impact-hook
plan: "03"
subsystem: impact-hook
tags: [bash, hook, pre-tool-use, sqlite3, tier2, consumer-query, staleness, worker-http]
dependency_graph:
  requires:
    - phase: 100-02
      provides: impact-hook.sh skeleton with TIER_2_ANCHOR, Tier 1 match, self-exclusion, debug trace
    - phase: 100-01
      provides: db-path.sh (resolve_project_db_path, resolve_project_db_hash), data-dir.sh
  provides:
    - plugins/arcanon/scripts/impact-hook.sh (Tier 2 SQLite match + consumer query + staleness prefix — fully wired)
  affects:
    - plans/100-04 (bats fixtures + p99 benchmark target this hook's behavior)
tech_stack:
  added: []
  patterns:
    - Walk-up project root discovery (_find_project_root): arcanon.config.json -> .arcanon/ -> .git/
    - JOIN services+repos to reconstruct absolute prefix from relative root_path (pre-flight Finding 3)
    - Trailing-slash normalization for false-positive guard (${root_path%/}/ prefix match)
    - Worker HTTP primary / SQLite fallback dual-path consumer query
    - jq @uri URL encoding for HTTP query params (T-100-10)
    - sed s/'/''/ SQL injection mitigation for SQLite fallback (T-100-09)
    - Portable mtime: GNU stat -c %Y / BSD stat -f %m
    - jq -Rn --arg message escaping for all JSON output (Tier 1 + Tier 2)
key_files:
  created: []
  modified:
    - plugins/arcanon/scripts/impact-hook.sh
key_decisions:
  - "root_path is relative in all production DBs (pre-flight Finding 3) — JOIN repos.path to reconstruct absolute prefix rather than branching on absolute vs relative"
  - "Trailing-slash norm prevents auth-legacy false-match on auth: [[ FILE == ${prefix%/}/* ]] with exactly one trailing slash in pattern"
  - "Bare '.' root_path (repo root = service root) handled by stripping /.$ from the joined path"
  - "Worker HTTP primary path; SQLite fallback only when worker_running returns non-zero — consistent with pre-flight Finding 4"
  - "jq @uri encoding for URL params (T-100-10); sed s/'/''/g for SQLite interpolation (T-100-09)"
  - "sqlite3 -readonly -cmd .timeout 500 caps both Tier 2 classification and fallback consumer queries at 500ms"
  - "Tier 1 output upgraded from printf interpolation to jq -Rn escaping for consistency (handles filenames with special chars)"
  - "Consumer preview limited to 3 names (head -3) with total count N to keep systemMessage scannable"

requirements-completed: [HOK-02, HOK-03, HOK-04, HOK-05, HOK-08]

duration: ~2min
completed: "2026-04-21"
---

# Phase 100 Plan 03: Tier 2 SQLite Classification + Consumer Query Summary

**SQLite-backed Tier 2 service classification with worker HTTP consumer lookup, SQLite fallback, staleness prefix, and false-positive trailing-slash guard — impact-hook.sh delivers actionable cross-repo consumer warnings.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-21T19:37:41Z
- **Completed:** 2026-04-21T19:39:45Z
- **Tasks:** 2 (implemented together in one commit — no intermediate state between Task 1 and Task 2)
- **Files modified:** 1

## Accomplishments

- Tier 2 classification: walks up from the edited file to find project root, resolves the per-project impact-map.db via db-path.sh, JOINs services+repos to get absolute prefixes, prefix-matches with trailing-slash normalization
- Consumer query: worker HTTP primary (`GET /impact?project=<uri>&change=<uri>`) with direct SQLite fallback when worker unreachable
- Staleness prefix (`[stale map — scanned Xd ago]`) prepended when DB mtime > 48h
- All error paths (missing DB, missing sqlite3/jq, query failure, no service match) silently exit 0 — hook never blocks

## Task Commits

Both tasks implemented atomically (Task 2 inserted directly after Task 1 without an intermediate state):

1. **Task 1 + Task 2: Tier 2 block + consumer query + staleness** - `182cd74` (feat)

**Plan metadata:** (created after this section)

## Files Created/Modified

- `plugins/arcanon/scripts/impact-hook.sh` — TIER_2_ANCHOR replaced with 168-line Tier 2 block; Tier 1 output upgraded to jq-escaped format

## Decisions Made

- **root_path is always relative** (pre-flight Finding 3 confirmed across 3 production DBs). Implemented as `JOIN repos r ON s.repo_id = r.id` with `r.path || '/' || s.root_path` to reconstruct absolute prefix. Dropped the two-branch absolute/relative logic from the plan's pseudo-code in favour of this cleaner single path.
- **Bare `.` root_path** (repo root is service root) handled by stripping trailing `/.` after path join before the prefix match.
- **Tasks committed together**: Tasks 1 and 2 have no useful intermediate state (Task 1 populates `$SERVICE` but emits nothing; Task 2 is the emit). A single atomic commit is more correct than a commit with a silent positive-match path.

## Smoke-Test Evidence

### Path 1: Tier 2 positive match (SQLite fallback, worker down)

```
Input:  file_path=/tmp/fake-project/services/auth/index.js
DB:     services: auth (services/auth), web (services/web)
        connections: web -> auth (http)
Output: {"systemMessage": "Arcanon: auth has 1 consumer(s): web. Run /arcanon:impact for details."}
Exit:   0  PASS
```

### Path 2: False-positive guard (auth-legacy must not match auth)

```
Input:  file_path=/tmp/fake-project/services/auth-legacy/index.js
DB:     same as above (only 'auth' service tracked, not 'auth-legacy')
Output: (empty)
Exit:   0  PASS
```

### Path 3: Staleness prefix (DB mtime 5 days old)

```
Input:  file_path=/tmp/fake-project/services/auth/index.js
DB:     touched to 5 days ago (mtime > 48h threshold)
Output: {"systemMessage": "[stale map — scanned 5d ago] Arcanon: auth has 1 consumer(s): web. Run /arcanon:impact for details."}
Exit:   0  PASS
```

### Path 4: Tier 1 still works (proto file)

```
Input:  file_path=/tmp/api.proto
Output: {"systemMessage": "Arcanon: schema file api.proto edited — cross-repo consumers may be impacted. Run /arcanon:impact for details."}
Exit:   0  PASS  (now jq-escaped format)
```

### Path 5: No DB (project not scanned)

```
Input:  file_path=/tmp/nonexistent-project/foo.js
Output: (empty)
Exit:   0  PASS
```

### Path 6: Bad JSON input

```
Input:  bad-json{
Output: (empty)
Exit:   0  PASS
```

## Interface for Plan 04 (6 bats fixtures + p99 benchmark)

Plan 04 should test these 6 fixtures with bats:

| Fixture | Expected |
|---------|----------|
| auth/index.js, DB with web->auth | systemMessage contains "auth has 1 consumer(s): web" |
| auth-legacy/foo.js, only auth tracked | empty stdout (false-positive guard) |
| auth/index.js, DB mtime 5d ago | systemMessage starts with "[stale map" |
| auth/index.js, no connections | systemMessage contains "editing service auth" |
| api.proto (Tier 1) | systemMessage contains "schema file api.proto" |
| No DB present | empty stdout |

**p99 benchmark target:** < 50ms for the SQLite fallback path (hook budget).
Instrument with `time` wrapper or bats's `run` + elapsed time assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Simplified two-branch absolute/relative match to single JOIN-based path**

- **Found during:** Task 1 (pre-flight Finding 3 re-read)
- **Issue:** Plan's pseudo-code included a two-branch match (`absolute-path interpretation` + `relative-path interpretation`). Pre-flight Finding 3 confirmed all production DBs store relative paths only. The absolute-path branch (`[[ "$FILE" == "${_svc_root_norm}/"* ]]`) would never fire in production and adds dead code.
- **Fix:** Used `SELECT s.name, r.path || '/' || s.root_path FROM services s JOIN repos r ON s.repo_id = r.id` to always reconstruct the absolute prefix from the join. Single prefix match branch. Added bare-`.` special-case (`${_svc_abs_norm%/.}` strip) per pre-flight Finding 3 edge cases.
- **Files modified:** `plugins/arcanon/scripts/impact-hook.sh`
- **Commit:** 182cd74

---

**Total deviations:** 1 auto-fixed (Rule 1 — simplification of dead code branch to match empirical production data)
**Impact on plan:** Strictly better — fewer branches, production-accurate, covers bare `.` edge case.

## Known Stubs

None. The consumer query is fully wired: worker HTTP primary + SQLite fallback. All 4 smoke-test paths produce correct output.

## Threat Surface

STRIDE mitigations T-100-09 through T-100-14 implemented as planned:

- T-100-09 (SQL injection): `sed "s/'/''/g"` escapes SERVICE name in SQLite fallback heredoc.
- T-100-10 (URL injection): `jq -rn --arg v "$VAR" '$v | @uri'` encodes PROJECT_ROOT and SERVICE.
- T-100-11 (DoS via sqlite3): `-cmd ".timeout 500"` on both classification and fallback queries.
- T-100-12 (DB tampering): accepted — user-private DB.
- T-100-13 (info disclosure): accepted — intended feature output.
- T-100-14 (infinite walk-up): `while [[ "$dir" != "/" && "$dir" != "" ]]` terminates at root.

## Self-Check: PASSED

File exists:
- `plugins/arcanon/scripts/impact-hook.sh` — FOUND (168 lines added)

Commit exists:
- `182cd74` — FOUND (feat(100-03): Tier 2 SQLite classification + consumer query + staleness prefix)

Key patterns verified:
- `grep -q 'Tier 2'` — PASS
- `grep -q 'SELECT.*root_path'` — PASS
- `grep -q '_find_project_root'` — PASS
- `! grep -q 'TIER_2_ANCHOR'` — PASS
- `grep -q 'worker_call'` — PASS
- `grep -q 'target_service_id'` — PASS
