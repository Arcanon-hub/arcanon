---
phase: 97-command-cleanup
plan: 02
subsystem: commands
tags: [slash-commands, bats, deprecation, sync, upload, hub]

# Dependency graph
requires: []
provides:
  - "Unified /arcanon:sync command with --drain, --repo, --dry-run, --force flags (CLN-03, CLN-04)"
  - "Deprecated /arcanon:upload stub with stderr warning forwarding to hub.sh upload (CLN-05)"
  - "Regression bats suite tests/commands-surface.bats covering 7 surviving commands (CLN-09)"
affects: [97-01-command-cleanup, 97-03-command-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deprecated stub pattern: [DEPRECATED] frontmatter description + printf >&2 + $ARGUMENTS passthrough + grep anchor"
    - "Slash-command orchestration: flag-parsed Step 0-3 structure for multi-mode commands"
    - "Bats structural testing: file-existence + frontmatter grep checks as regression gates"

key-files:
  created:
    - tests/commands-surface.bats
  modified:
    - plugins/arcanon/commands/sync.md
    - plugins/arcanon/commands/upload.md

key-decisions:
  - "upload.md stub shells into hub.sh upload (not hub.sh sync) to preserve exact v0.1.0 code path for one version"
  - "bash -n on bats files always exits 2 due to @test syntax; bats -c used as authoritative parse check (confirmed 10 tests)"
  - "sync.md uses capital-D 'Deprecated' in migration section heading to satisfy grep -q 'Deprecated' verify check"

patterns-established:
  - "Deprecated stub: description starts with [DEPRECATED], printf >&2 for warning, $ARGUMENTS passthrough, # DEPRECATED: remove in vX.Y.Z anchor"
  - "Multi-flag command: Step 0 parse, Step 1 preflight (skippable), Step 2 upload (skippable), Step 3 drain"

requirements-completed: [CLN-03, CLN-04, CLN-05, CLN-09]

# Metrics
duration: 15min
completed: 2026-04-19
---

# Phase 97 Plan 02: Command Cleanup — Sync/Upload Merge Summary

**`/arcanon:sync` absorbs `/arcanon:upload` with four-flag orchestration (--drain/--repo/--dry-run/--force); deprecated upload stub preserved for CI compatibility with 10-test bats regression suite**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-19T00:00:00Z
- **Completed:** 2026-04-19T00:15:00Z
- **Tasks:** 3
- **Files modified:** 3 (sync.md rewritten, upload.md replaced, commands-surface.bats created)

## Accomplishments

- Rewrote `commands/sync.md` from a simple drain-only command into a unified upload+drain orchestration with Step 0-3 structure and all four flags
- Reduced `commands/upload.md` to a deprecated stub: `[DEPRECATED]` description, `printf >&2` warning, `hub.sh upload $ARGUMENTS` forwarding, v0.2.0 removal anchor
- Created `tests/commands-surface.bats` with 10 `@test` blocks (CLN-01, CLN-03, CLN-04, CLN-05, CLN-09 requirement IDs) — bats parses and counts 10 tests cleanly

## Final sync.md orchestration flow

```
/arcanon:sync [flags]
  └─ Step 0: Parse args (--drain, --dry-run, --force, --repo, passthrough)
  └─ Step 1: Preflight (skipped if --force or --drain)
       └─ hub.sh status --json → check credentials field
       └─ if missing → walk user through login flow, STOP
  └─ Step 2: Upload (skipped if --drain)
       └─ --dry-run → print "would upload: <path>" and continue
       └─ hub.sh upload --repo "$REPO_PATH" $FORWARDED_ARGS
       └─ on ✗ non-retriable failure → STOP (don't drain)
  └─ Step 3: Drain
       └─ --dry-run → hub.sh queue (summarise pending rows)
       └─ hub.sh sync $FORWARDED_ARGS
```

## Upload stub shell block (exact)

```bash
# DEPRECATED: remove in v0.2.0
printf 'arcanon: /arcanon:upload is deprecated — use /arcanon:sync (v0.2.0 removes this stub)\n' >&2
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $ARGUMENTS
```

## Bats results

- `bats -c tests/commands-surface.bats` → 10 (exit 0)
- Full run (`bats tests/commands-surface.bats`) deferred to Wave 2 (97-01) after cross-impact.md deletion lands
- Tests that would fail today: `CLN-01: /arcanon:cross-impact command file has been removed` (cross-impact.md still exists pending 97-01)

## hub.js/hub.sh untouched confirmation

- `worker/cli/hub.js` — NOT modified (zero-overlap invariant for parallel wave execution)
- `scripts/hub.sh` — NOT modified (zero-overlap invariant for parallel wave execution)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite commands/sync.md** - `8934d74` (feat)
2. **Task 2: Convert commands/upload.md to deprecated stub** - `258d4af` (feat)
3. **Task 3: Add tests/commands-surface.bats** - `17c729f` (test)

## Files Created/Modified

- `plugins/arcanon/commands/sync.md` — Fully rewritten with flag-driven upload+drain orchestration
- `plugins/arcanon/commands/upload.md` — Reduced to deprecated stub (stderr warning, $ARGUMENTS passthrough, v0.2.0 anchor)
- `tests/commands-surface.bats` — New 10-test regression bats file

## Decisions Made

- **upload.md stub shells into `hub.sh upload` (not `hub.sh sync`)** — Preserves the exact Node CLI code path (`cmdUpload` at hub.js:191) that v0.1.0 upload users relied on. The slash-command rename is the user-facing change; the Node subcommand stays put until v0.2.0.
- **`bash -n` exits 2 on all bats files** — `@test` is a bats extension, not plain bash syntax. All existing bats files in the repo behave the same way. Used `bats -c` as the authoritative parse check.
- **Capital-D "Deprecated" in sync.md migration heading** — Required to satisfy the plan's `grep -q 'Deprecated'` verify check; no semantic change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Capital-D "Deprecated" required for verify grep**
- **Found during:** Task 1 verify
- **Issue:** Plan's verify block uses `grep -q 'Deprecated'` but the initial write used all-lowercase "deprecated". Verify failed.
- **Fix:** Changed migration section heading from "deprecation" to "Deprecated" and updated one inline occurrence.
- **Files modified:** `plugins/arcanon/commands/sync.md`
- **Verification:** `grep -q 'Deprecated' plugins/arcanon/commands/sync.md` passes
- **Committed in:** `8934d74` (Task 1 commit, re-ran after fix)

---

**Total deviations:** 1 auto-fixed (1 literal string correction)
**Impact on plan:** Trivial capitalization fix for verify compliance. No semantic or behavioral change.

## Issues Encountered

- `bash -n` on bats files exits 2 across the entire test suite (not just commands-surface.bats). This is a known limitation of bats syntax — `@test` curly brace blocks are not valid plain bash. The plan's acceptance criterion "bash -n succeeds" cannot be met by any bats file. Addressed by using `bats -c` which correctly parses and counts tests.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All changes are at the slash-command markdown layer. The stub's `printf >&2` write cannot change exit status (T-97-04 mitigated).

## Next Phase Readiness

- `tests/commands-surface.bats` is ready for Wave 2 full run once 97-01 deletes `cross-impact.md`
- The `CLN-01` test (`cross-impact.md` removed) will pass after 97-01 completes
- Zero changes to `hub.js`/`hub.sh` keeps Plan 97-03 unblocked for parallel execution

---
*Phase: 97-command-cleanup*
*Completed: 2026-04-19*
