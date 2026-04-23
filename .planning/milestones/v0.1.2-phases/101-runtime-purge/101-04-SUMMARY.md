---
phase: 101-runtime-purge
plan: 04
subsystem: worker-runtime-extended
tags:
  - runtime-purge
  - javascript
  - collection-identifier
  - config-fallback
  - breaking-change
dependency_graph:
  requires: []
  provides:
    - "ChromaDB collection name = arcanon-impact (ENV-10)"
    - "pool.js listProjects() reads only arcanon.config.json (PATH-07)"
    - "database.js boundary-map comment aligned with arcanon-only runtime (PATH-08)"
    - "auth.js readHomeConfig() reads only ~/.arcanon/config.json (PATH-09)"
  affects:
    - ChromaDB collection stored at the configured Chroma endpoint (legacy "ligamen-impact" collection orphaned)
    - "$HOME/.ligamen/config.json is no longer consulted for Hub credentials"
tech_stack:
  added: []
  patterns:
    - "Hard-remove legacy identifiers without two-read fallback (CONTEXT.md decision)"
key_files:
  modified:
    - plugins/arcanon/worker/server/chroma.js
    - plugins/arcanon/worker/db/pool.js
    - plugins/arcanon/worker/db/database.js
    - plugins/arcanon/worker/hub-sync/auth.js
  created: []
decisions:
  - "COLLECTION_NAME rename is a hard break; existing ligamen-impact collections orphaned on upgrade (rebuild via /arcanon:map)."
  - "readHomeConfig() legacy ~/.ligamen fallback removed without deprecation warning per zero-tolerance policy."
  - "Runtime-describing JSDoc lines that would lie about behavior after the code edit were updated alongside the code; pure-historical prose deferred to Phase 102."
metrics:
  duration: "~2 minutes"
  completed_date: "2026-04-23"
  tasks_completed: 4
  files_modified: 4
  commits: 4
requirements:
  - ENV-10
  - PATH-07
  - PATH-08
  - PATH-09
---

# Phase 101 Plan 04: Additional Runtime Reads Purge Summary

Closed the four runtime-purge gaps discovered during Phase 101 planning (ENV-10 ChromaDB collection identifier, plus PATH-07/08/09 config-file runtime reads in pool.js/database.js/auth.js) by hard-removing all remaining `ligamen` and `.ligamen` runtime references without back-compat shims, stderr deprecation warnings, or two-read fallbacks.

## Task Results

### Task 1: Rename ChromaDB COLLECTION_NAME (ENV-10)

**File:** `plugins/arcanon/worker/server/chroma.js`
**Commit:** `5fe900f`

Before:
```javascript
const COLLECTION_NAME = "ligamen-impact";
```

After:
```javascript
const COLLECTION_NAME = "arcanon-impact";
```

Single-line edit. `getOrCreateCollection({ name: COLLECTION_NAME })` at line 100 auto-picks up the new value via the constant; no other callsite touched. Module-private — confirmed by `grep -rn "ligamen-impact" plugins/arcanon/worker/` returning only line 24 before edit.

### Task 2: Drop ligamen.config.json from pool.js listProjects() (PATH-07)

**File:** `plugins/arcanon/worker/db/pool.js`
**Commit:** `74d0a65`

Region A — iteration array (line 131):
```diff
-        for (const cfgFile of ["arcanon.config.json", "ligamen.config.json"]) {
+        for (const cfgFile of ["arcanon.config.json"]) {
```

Region B — JSDoc above the loop (lines 113-116):
```diff
-      // basename. Falls back to legacy ligamen.config.json, then to null
-      // (callers display the path basename in that case).
+      // basename. Falls back to null (callers display the path basename in
+      // that case).
```

The loop structure stays — only the array shrinks and the runtime-describing JSDoc that would otherwise lie about the fallback behavior is corrected.

### Task 3: Correct database.js boundary-map comment (PATH-08)

**File:** `plugins/arcanon/worker/db/database.js`
**Commit:** `d9a708d`

Before (line 215):
```javascript
  // Build boundary map from arcanon.config.json (legacy ligamen.config.json supported).
```

After:
```javascript
  // Build boundary map from arcanon.config.json.
```

Comment-only fix. Runtime at line 219 already calls `resolveConfigPath(process.cwd())`; once Phase 101-01 purges the legacy branch in `worker/lib/config-path.js`, the runtime is arcanon-only. The misleading "(legacy ligamen.config.json supported)" clause was the last footprint of the pattern in this file's runtime-describing documentation.

### Task 4: Purge auth.js legacy credential fallback (PATH-09)

**File:** `plugins/arcanon/worker/hub-sync/auth.js`
**Commit:** `75782d4`

Region A — header JSDoc bullet removed:
```diff
 *   3. ~/.arcanon/config.json  { "api_key": "arc_..." }
- *   4. ~/.ligamen/config.json  (legacy)
```

Region B — readHomeConfig() body:
```diff
 function readHomeConfig() {
   const home = os.homedir();
   const current = path.join(home, ".arcanon", "config.json");
-  const legacy = path.join(home, ".ligamen", "config.json");
-  return readJsonSafe(current) || readJsonSafe(legacy) || {};
+  return readJsonSafe(current) || {};
 }
```

Function contract after edit: reads only `$HOME/.arcanon/config.json`; returns `{}` on missing/unreadable/malformed.

## Verification Gates

| Gate | Description | Result |
|------|-------------|--------|
| 1 | `ligamen.config.json` absent from pool.js + database.js | 0 matches — PASS |
| 2 | `"ligamen-impact"` gone from chroma.js; `"arcanon-impact"` appears exactly once (line 24) | PASS |
| 3 | Zero `ligamen` refs in auth.js (case-insensitive) | 0 matches — PASS |
| 4 | Audit of remaining ligamen refs in the four files (Phase 102 prose catalog) | 4 matches (all intentional, listed below) |
| 4b | Runtime-read-level scan across all four files | 0 matches — PASS (authoritative runtime-purge gate) |
| 5 | All four files parse via `node --check` | PASS (chroma.js, pool.js, database.js, auth.js) |
| 6 | auth.js still exports `DEFAULT_HUB_URL`, `API_KEY_PREFIX`, `AuthError`, `resolveCredentials`, `storeCredentials`, `hasCredentials` | PASS ("auth.js exports intact") |

## Breaking Changes

### ENV-10: ChromaDB collection rename

On first startup after this change, `client.getOrCreateCollection({ name: "arcanon-impact" })` creates a fresh, empty collection. The legacy `"ligamen-impact"` collection on the Chroma server becomes orphaned (no consumer; no auto-migration). Recovery path: `/arcanon:map` rebuilds content into the new collection. Operators can manually delete the old collection via Chroma's admin API if desired; cost of leaving it is disk only.

### PATH-09: Credential-file rename

Users whose Arcanon Hub credentials live only in `~/.ligamen/config.json` (never migrated to `~/.arcanon/config.json`) will see `AuthError: No Arcanon Hub API key found` on the next `/arcanon:status` call. The existing error message already directs them to `/arcanon:login arc_…` and the Hub API-keys page. This is the intended outcome per the zero-tolerance policy.

### Required Phase 104 CHANGELOG BREAKING entry (verbatim)

> ChromaDB collection name changed from `ligamen-impact` to `arcanon-impact`. Existing collections are orphaned on upgrade — run `/arcanon:map` to rebuild in the new collection. The old collection can be safely deleted via your Chroma admin interface.

Phase 104 MUST include this entry (or semantically equivalent wording) in the v0.1.2 BREAKING section of CHANGELOG. This obligation is recorded here so it is not lost between plans.

## Phase 102 Cosmetic Prose Carry-over

The following four `ligamen` references remain across the plan's four files. Each is pure historical/header prose, not a runtime read and not a runtime-describing comment about a deleted branch. They are intentionally deferred to Phase 102:

| File | Line | Content |
|------|------|---------|
| `plugins/arcanon/worker/server/chroma.js` | 2 | ` * worker/chroma-sync.js — ChromaDB async sync module for Ligamen v2.0` |
| `plugins/arcanon/worker/db/pool.js` | 74 | ` * Scans ~/.ligamen/projects/ for impact-map.db files.` (actual runtime uses `resolveDataDir()`) |
| `plugins/arcanon/worker/db/database.js` | 2 | ` * worker/db.js — Database lifecycle module for Ligamen v2.0` |
| `plugins/arcanon/worker/db/database.js` | 8 | ` * DB path: ~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db` (actual runtime uses `resolveDataDir()`) |

Phase 102 inherits a complete carry-over inventory from this list.

## Expected Phase 103 Test Breakage

These tests hard-code the legacy identifiers and will fail after this plan, which is the intended purge signal (Phase 103 rewrites fixtures):

- `plugins/arcanon/worker/scan/discovery.test.js` — several `ligamen.config.json` fixture paths
- `plugins/arcanon/worker/hub-sync/auth.test.js:70` — `test("resolveCredentials supports legacy ~/.ligamen/config.json")`
- `plugins/arcanon/worker/db/query-engine-enrich.test.js:170-171` — `ligamen.config.json` fixture

Per CONTEXT.md and the plan, we do NOT fix these in 101-04.

## Deviations from Plan

None — plan executed exactly as written. All four tasks landed with the exact before/after snippets specified in the plan actions; all six verification gates passed; no deviations, no auto-fixes, no scope expansion.

Note on execution ordering: commits `6b712b6` (101-01) and `279f89a` (101-02) are interleaved with this plan's commits because Phase 101's plans are running in parallel (CONTEXT.md notes 101-01/101-02 are independent of 101-04). Plan 101-04's Task 3 reasoning assumed `resolveConfigPath()` is arcanon-only "after 101-01"; the comment fix in database.js is correct regardless of 101-01's execution order because the comment is simply a description that must align with the final runtime behavior.

## Commits

| Task | Req | Commit | Files |
|------|-----|--------|-------|
| 1 | ENV-10 | `5fe900f` | `plugins/arcanon/worker/server/chroma.js` |
| 2 | PATH-07 | `74d0a65` | `plugins/arcanon/worker/db/pool.js` |
| 3 | PATH-08 | `d9a708d` | `plugins/arcanon/worker/db/database.js` |
| 4 | PATH-09 | `75782d4` | `plugins/arcanon/worker/hub-sync/auth.js` |

## Self-Check: PASSED

- `plugins/arcanon/worker/server/chroma.js` — FOUND
- `plugins/arcanon/worker/db/pool.js` — FOUND
- `plugins/arcanon/worker/db/database.js` — FOUND
- `plugins/arcanon/worker/hub-sync/auth.js` — FOUND
- Commit `5fe900f` — FOUND
- Commit `74d0a65` — FOUND
- Commit `d9a708d` — FOUND
- Commit `75782d4` — FOUND
