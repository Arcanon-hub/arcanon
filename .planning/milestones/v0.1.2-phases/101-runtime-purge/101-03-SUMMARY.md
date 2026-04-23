---
phase: 101-runtime-purge
plan: 03
subsystem: package-identity
tags: [runtime-purge, npm, package-name, renaming, ligamen-residue]

# Dependency graph
requires:
  - phase: none
    provides: N/A (standalone package-identity rename, no dependencies)
provides:
  - runtime-deps.json with name=@arcanon/runtime-deps (PKG-01)
  - install-deps.sh with zero Ligamen references in header/body (PKG-03)
  - Verified fresh npm install produces node_modules with zero @ligamen traces (PKG-02)
affects: [Phase 102 cosmetic rename, Phase 103 test rewrite, Phase 104 docs, Phase 105 verification gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "npm scoped-package rename: edit name field only, preserve version/deps (no version bump)"
    - "Sentinel diff-based idempotency invalidates naturally on rename (no migration code)"

key-files:
  created: []
  modified:
    - plugins/arcanon/runtime-deps.json
    - plugins/arcanon/scripts/install-deps.sh

key-decisions:
  - "Name-only rename — version held at 0.1.1 (bump is a release-management concern, not PKG-01 scope)"
  - "No sentinel migration — full-file diff naturally invalidates on rename; one-time re-install is acceptable per v0.1.1 precedent"
  - "Did not rewrite the mis-scoped Task 2 commit — sibling parallel executors (101-02/101-04) committed intervening work, making rebase unsafe under destructive_git_prohibition"

patterns-established:
  - "Package identity: npm scope @arcanon/* for internal packages (replaces @ligamen/*)"
  - "private: true npm manifests can rename freely — no registry implications"

requirements-completed: [PKG-01, PKG-02, PKG-03]

# Metrics
duration: 2m 13s
completed: 2026-04-23
---

# Phase 101 Plan 03: Package Identity Rename Summary

**Renamed @ligamen/runtime-deps to @arcanon/runtime-deps in runtime-deps.json and purged the final Ligamen reference from install-deps.sh header; verified fresh npm install produces clean node_modules with zero @ligamen traces.**

## Performance

- **Duration:** 2m 13s
- **Started:** 2026-04-23T17:44:11Z
- **Completed:** 2026-04-23T17:46:24Z
- **Tasks:** 3 (2 editing + 1 verification)
- **Files modified:** 2

## Accomplishments

- `runtime-deps.json` `name` field is `@arcanon/runtime-deps`; version/description/private/dependencies/optionalDependencies byte-identical to pre-plan state
- `install-deps.sh` line 2 header is `# Arcanon — install-deps.sh`; zero case-insensitive `ligamen`/`@ligamen` matches remain in the file
- Fresh `npm install --prefix plugins/arcanon --omit=dev --no-fund --no-audit --package-lock=false` completed in 6s with 185 packages; grep of resulting node_modules returns zero `@ligamen/runtime-deps` matches
- No `package-lock.json` leaked into the working tree (per `--package-lock=false`)
- User-request grep `grep -r "@ligamen" plugins/arcanon/` returns **0 lines** — clean

## Task Commits

1. **Task 1: Rename runtime-deps.json package name (PKG-01)** — `bd6f540` (feat)
2. **Task 2: Purge install-deps.sh header (PKG-03)** — `2c35612` (feat) *[see Deviations below — commit has scope leak]*
3. **Task 3: Verify fresh npm install produces clean tree (PKG-02)** — no commit (verification-only, no source changes)

## Files Created/Modified

### runtime-deps.json diff (line 2)
```diff
-  "name": "@ligamen/runtime-deps",
+  "name": "@arcanon/runtime-deps",
```
All other fields (version `0.1.1`, description, private, 7 dependencies, 1 optionalDependency) byte-identical.

### install-deps.sh diff (line 2)
```diff
-# Ligamen — install-deps.sh
+# Arcanon — install-deps.sh
```
No other edits. Sentinel path `${CLAUDE_PLUGIN_DATA}/.arcanon-deps-installed.json` (line 30) was already correctly named.

## Decisions Made

- **No version bump:** PKG-01 specifies name change only. The sentinel's full-file diff catches the rename without requiring a version bump. Version bump is deferred to a release-management concern in a later PR.
- **No sentinel migration logic:** The existing diff-based idempotency naturally invalidates the sentinel on the rename, triggering exactly one re-install on next session start — explicit, acceptable, and consistent with v0.1.1 precedent documented in CONTEXT.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Task 2 commit scope leak from parallel executors**
- **Found during:** Task 2 (install-deps.sh purge commit)
- **Issue:** At the moment I ran `git add plugins/arcanon/scripts/install-deps.sh`, sibling parallel executors (this phase has `parallelization: true`) had modified `plugins/arcanon/worker/index.js` and `plugins/arcanon/worker/server/chroma.js` in the working tree but not yet staged/committed. My `git commit` picked up those workspace modifications in addition to my own staged file. The resulting commit `2c35612` contains 3 files (1 from my task, 2 from other plans' in-progress work).
- **Fix:** Did NOT rewrite the commit. Rationale:
  (a) Between `2c35612` and the moment I discovered the leak, sibling executors committed `5fe900f` (101-04), `c217668` (101-02), and `74d0a65` (101-04) on top of my commit. An interactive rebase to isolate `install-deps.sh` would conflict with those intervening commits, and running it would risk dropping sibling work.
  (b) The destructive_git_prohibition forbids history rewrites in worktrees without explicit user request.
  (c) The leaked content (LIGAMEN_* env var purges in worker/*.js) is legitimate 101-phase work that belongs in the 101-01 scope; it ends up in the right milestone just mis-attributed at the commit level.
- **Impact:** Commit-level attribution is imperfect — file-level blame for worker/index.js and worker/server/chroma.js ENV_* purges points at `2c35612` (a 101-03 commit) rather than a 101-01 commit. Milestone content is unaffected. Flagged here for audit trail.
- **Files modified:** plugins/arcanon/scripts/install-deps.sh (correct scope), plugins/arcanon/worker/index.js (leaked from 101-01), plugins/arcanon/worker/server/chroma.js (leaked from 101-01)
- **Verification:** All three files contain correct content — no data loss; only commit attribution is affected.
- **Committed in:** 2c35612 (Task 2 commit)

---

**Total deviations:** 1 (Rule 1 — commit scope leak caused by concurrent parallel-executor activity)
**Impact on plan:** File-level outcomes correct; commit-level attribution for two lines of work is imperfect. No source changes lost or corrupted. No scope creep in content terms.

## Issues Encountered

- **Parallel-execution race on `git add`/`git commit`:** Because several executors in phase 101 run concurrently in the same working tree, `git commit` after `git add <file>` will sweep in any unrelated files that were modified-but-not-staged at that instant. For future phase-wide parallelization runs, either serialize commits via a file-lock or have each executor work in a sandboxed worktree. Not fixed in this plan (out of scope).

## Test Files Pinning Old Package Name (Phase 103 note)

Per the plan output requirement, searched for test files that hard-code `@ligamen/runtime-deps`:
```
grep -r "@ligamen/runtime-deps" .
```
Returns only planning docs (`.planning/*`) — **no test files or runtime code pins the old name.** Phase 103 test rewrite does not need to touch this package-name surface; it can focus purely on env-var fixtures.

## User Setup Required

None — no external service configuration required. Users upgrading to v0.1.2 will experience one automatic re-install of runtime deps under the new `@arcanon/runtime-deps` name on their first session start; this is intentional and silent.

## Next Phase Readiness

- **Phase 101-03 complete.** `grep -r "@ligamen" plugins/arcanon/` returns 0 lines (confirmed).
- **Phase 102 (cosmetic rename)** can now proceed without worrying about runtime package identity.
- **Phase 103 (test rewrite)** — no test files currently pin `@ligamen/runtime-deps`, so the rewrite scope is purely env-var/path fixtures.
- **Phase 105 (verification gate)** can assert `! grep -qi '@ligamen' plugins/arcanon/runtime-deps.json plugins/arcanon/scripts/install-deps.sh` passes.

## Self-Check: PASSED

- FOUND: plugins/arcanon/runtime-deps.json (contains `"name": "@arcanon/runtime-deps"`)
- FOUND: plugins/arcanon/scripts/install-deps.sh (contains `# Arcanon — install-deps.sh`)
- FOUND: commit bd6f540 (Task 1)
- FOUND: commit 2c35612 (Task 2 — with documented scope leak)
- All verification gates (1-5) PASS
- User-request grep `grep -r "@ligamen" plugins/arcanon/` returns 0 lines

---
*Phase: 101-runtime-purge*
*Plan: 03*
*Completed: 2026-04-23*
