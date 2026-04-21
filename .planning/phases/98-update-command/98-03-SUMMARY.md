---
phase: 98-update-command
plan: "03"
subsystem: update-command
tags: [update, cache-pruning, lsof, health-poll, bats, shell]
dependency_graph:
  requires:
    - phase: 98-02
      provides: "--kill mode (worker stopped before prune/verify steps)"
  provides:
    - plugins/arcanon/scripts/update.sh (--prune-cache and --verify modes fully implemented)
    - plugins/arcanon/commands/update.md (Steps 6+7 wired; command is end-to-end complete)
    - tests/update.bats (21 tests total covering full update surface)
  affects:
    - /arcanon:update command (now fully functional end-to-end)
tech-stack:
  added: []
  patterns:
    - lsof +D detects open directory handles (cwd of a process), not just open files — tail -f does NOT trigger it
    - Empty bash array expansion via ${arr[@]+"${arr[@]}"} pattern for nullglob safety
    - Fake PLUGIN_ROOT with symlinked lib/ + no-op worker-start.sh for timeout test isolation
    - glob ~/ .claude/plugins/cache/*/arcanon/*/ (marketplace-agnostic) for cache discovery

key-files:
  created: []
  modified:
    - plugins/arcanon/scripts/update.sh (--prune-cache + --verify modes, ~112 new lines)
    - plugins/arcanon/commands/update.md (Steps 6+7 replaced, 55 new lines)
    - tests/update.bats (6 new tests, 145 new lines)

key-decisions:
  - "lsof +D detects open directory handles not open file handles — test uses (cd dir && sleep) not tail -f"
  - "--verify always exits 0 regardless of poll outcome (Pitfall 11: graceful failure)"
  - "Timeout test uses a fake PLUGIN_ROOT with no-op worker-start.sh rather than pointing at broken dir (lib/ symlinked so data-dir.sh still loads)"
  - "Empty bash arrays use \${arr[@]+\"\${arr[@]}\"} pattern to avoid unbound variable errors under set -u"

patterns-established:
  - "lsof +D guard pattern: detects when a process has cwd inside a dir — correct for worker-in-cache-dir scenario"
  - "10x1s poll loop (seq 1 10 + sleep 1) matches REQ UPD-10; first iteration sleeps before checking"
  - "All --verify branches emit some form of 'Restart Claude Code to activate v{X}' (REQ UPD-12)"

requirements-completed: [UPD-09, UPD-10, UPD-12]

duration: 7min
completed: "2026-04-21"
---

# Phase 98 Plan 03: Cache Prune + Health Verify + Final Message Summary

**lsof-guarded cache pruning and 10s /api/version health poll closing out the /arcanon:update end-to-end flow with a mandatory "Restart Claude Code to activate v{X}" message on every exit path**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-21T19:08:34Z
- **Completed:** 2026-04-21T19:15:51Z
- **Tasks:** 4 auto tasks + 1 checkpoint (pre-approved)
- **Files modified:** 3

## Accomplishments

- `scripts/update.sh --prune-cache` glob-discovers all old version dirs under `~/.claude/plugins/cache/*/arcanon/*/`, guards each with `lsof +D` before deletion, always preserves the current-version dir, and emits a JSON report with pruned/kept/locked arrays
- `scripts/update.sh --verify` starts the worker via `worker-start.sh`, polls `/api/version` up to 10 times at 1s intervals, emits `status=verified` on match or `status=verify_failed` with `reason=no_response|version_mismatch` on timeout — always exits 0 (Pitfall 11)
- `commands/update.md` Steps 6 and 7 wired: every branch emits some form of "Restart Claude Code to activate v{X}" (REQ UPD-12); the command is now end-to-end functional

## Task Commits

1. **Task 1: --prune-cache mode** — `4e8b8f4` (feat)
2. **Task 2: --verify mode** — `3c7ed31` (feat)
3. **Task 3: Wire Steps 6+7 in commands/update.md** — `76c9e68` (feat)
4. **Task 4: bats tests for prune + verify** — `15810d7` (test)

## Files Created/Modified

- `plugins/arcanon/scripts/update.sh` — --prune-cache (lsof-guarded glob-based dir pruning) and --verify (worker-start + 10s /api/version poll) modes implemented; stubs from 98-01/98-02 replaced
- `plugins/arcanon/commands/update.md` — Steps 6 (prune reporting) and 7 (verify + restart message) fully specified; command is now end-to-end complete
- `tests/update.bats` — 6 new tests added (21 total): UPD-09 current-kept, UPD-09 old-pruned, UPD-09 lsof-guard, UPD-10 success, UPD-10 timeout-exits-0, UPD-12 restart-message

## Decisions Made

- **lsof +D vs. tail -f for FD holds in tests:** `lsof +D <dir>` on macOS detects processes whose *cwd* is inside the directory — it does NOT detect files merely opened within it via `tail -f`. The real-world scenario is a worker process running from inside the cache dir (cwd handle). The test was updated to use `(cd <dir> && sleep 10) &` to hold a genuine directory handle.
- **--verify always exits 0:** Even when the poll times out or a version mismatch is detected, `--verify` exits 0. The caller (`commands/update.md`) reads `.status` to format the user-facing message. This implements Pitfall 11 (post-update worker failure must be silent-safe).
- **Timeout test isolation:** Using `CLAUDE_PLUGIN_ROOT` pointing at a broken empty dir caused `source "${PLUGIN_ROOT}/lib/data-dir.sh"` to fail. Fix: create a fake PLUGIN_ROOT with `lib/` symlinked to the real lib and a no-op `scripts/worker-start.sh` — the poll loop runs 10 iterations against an unreachable port and correctly times out.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] lsof test used tail -f instead of cd for directory handle**
- **Found during:** Task 4 (bats tests), test 18 failure
- **Issue:** The plan template used `tail -f <file>` to hold an FD. On macOS, `lsof +D <dir>` does not detect regular file-read handles — it only detects open directory handles (cwd of a process). The test was asserting the guard worked but the guard never fired.
- **Fix:** Changed to `(cd <dir> && sleep 10) &` which holds a cwd directory handle that `lsof +D` correctly detects.
- **Files modified:** `tests/update.bats`
- **Verification:** Test 18 passes; manual `lsof +D` confirmed detection.
- **Committed in:** `15810d7` (Task 4 commit)

**2. [Rule 1 - Bug] Timeout test pointed CLAUDE_PLUGIN_ROOT at empty dir causing source failure**
- **Found during:** Task 4 (bats tests), test 20 failure
- **Issue:** `--verify` sources `lib/data-dir.sh` from `${PLUGIN_ROOT}` (resolved from `CLAUDE_PLUGIN_ROOT`). Pointing `CLAUDE_PLUGIN_ROOT` at an empty temp dir made the script exit 1 on the `source` line, not 0 as expected.
- **Fix:** Build a fake PLUGIN_ROOT that symlinks `lib/` and `.claude-plugin/` from the real plugin root but provides a no-op `scripts/worker-start.sh`. The poll runs 10x1s against an unreachable port and exits 0 with `verify_failed`.
- **Files modified:** `tests/update.bats`
- **Verification:** Test 20 passes.
- **Committed in:** `15810d7` (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test correctness bugs from the plan template's assumptions about lsof behavior)
**Impact on plan:** No scope creep. Both fixes strengthen test fidelity. The lsof behavior is now correctly documented in `patterns-established`.

## Test Results

```
1..21
ok 1-15  (existing tests — no regressions)
ok 16 UPD-09: --prune-cache never prunes the current version dir
ok 17 UPD-09: --prune-cache deletes non-current version dirs
ok 18 UPD-09: --prune-cache skips dirs with active file handles (lsof guard)
ok 19 UPD-10: --verify starts worker and reports status=verified when versions match
ok 20 UPD-10: --verify exits 0 on timeout (does not fail the caller)
ok 21 UPD-12: commands/update.md contains 'Restart Claude Code to activate' in a success path

Full suite: 290/290 pass
```

## Cache Layout Observations

No surprises. The marketplace segment glob `*/arcanon/*/` correctly handles the `arcanon/arcanon/<version>` path structure. No host encountered a different marketplace name during testing.

## Worker-start Timing

In the UPD-10 success test, `--verify` typically completed at iteration 2-3 (2-3 seconds). The worker-start.sh spawns the Node process quickly and the port file is written before the first `sleep 1` elapses on most runs.

## Checkpoint Decision

The final `checkpoint:human-verify` task was pre-approved by the user for the entire phase ("approve without manual run"). Decision documented here for traceability — same disposition as 98-02. Risk: interactive `claude plugin update` flow behavior (prune output rendering, final restart message formatting in a live Claude Code session) is unverified against a real session and would surface on first real-user invocation.

## Phase 98 Close-out Note

All 13 UPD requirements delivered across plans 98-01, 98-02, and 98-03:

| Req | Plan | What |
|-----|------|------|
| UPD-01 | 98-01 | Read installed version from plugin.json/package.json |
| UPD-02 | 98-01 | Semver comparison via node+semver (not lexicographic) |
| UPD-03 | 98-01 | status=equal when up-to-date |
| UPD-04 | 98-01 | Changelog preview when newer |
| UPD-05 | 98-02 | Confirmation defaults No |
| UPD-06 | 98-02 | Reinstall via `claude plugin update arcanon --scope user` |
| UPD-07 | 98-02 | Scan-lock guard before kill |
| UPD-08 | 98-02 | Kill-only semantics (no restart) |
| UPD-09 | 98-03 | Cache prune with lsof guard |
| UPD-10 | 98-03 | Health poll 10s /api/version |
| UPD-11 | 98-01 | Offline-safe (5s cap, exit 0 with status=offline) |
| UPD-12 | 98-03 | Final "Restart Claude Code to activate v{X}" on every path |
| UPD-13 | 98-01 | Semver matrix tests (anti-lexicographic proof) |

Ready for Phase 99 (SessionStart Enrichment).

## Issues Encountered

None beyond the two auto-fixed test correctness bugs documented above.

## Next Phase Readiness

- `/arcanon:update` is end-to-end functional: check → confirm → kill → reinstall → prune → verify → restart message
- 290 bats tests green; update surface fully covered
- Phase 99 (SessionStart Enrichment) can proceed independently

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `plugins/arcanon/scripts/update.sh` contains --prune-cache | FOUND |
| `plugins/arcanon/scripts/update.sh` contains --verify | FOUND |
| `plugins/arcanon/commands/update.md` contains "Restart Claude Code to activate" | FOUND |
| `tests/update.bats` has 21 tests | FOUND |
| commit 4e8b8f4 (prune-cache) | FOUND |
| commit 3c7ed31 (verify) | FOUND |
| commit 76c9e68 (update.md steps 6+7) | FOUND |
| commit 15810d7 (bats tests) | FOUND |

---
*Phase: 98-update-command*
*Completed: 2026-04-21*
