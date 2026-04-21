---
phase: 98-update-command
plan: "02"
subsystem: update-command
tags: [update, kill, scan-lock, sigterm, sigkill, bats, tdd]
dependency_graph:
  requires:
    - plugins/arcanon/scripts/update.sh (--check mode from 98-01)
    - plugins/arcanon/commands/update.md (Steps 1-2 from 98-01)
  provides:
    - plugins/arcanon/scripts/update.sh (--kill mode: scan-lock-guarded, kill-only)
    - plugins/arcanon/commands/update.md (Steps 3-5: confirmation, kill, reinstall)
    - tests/update.bats (6 new tests: UPD-07 scan-lock, UPD-08 kill-only)
  affects:
    - plugins/arcanon/commands/ (update flow now actionable through Step 5)
    - tests/ (15 total tests in update.bats)
tech_stack:
  added: []
  patterns:
    - SIGTERM-5s-poll-SIGKILL inline in update.sh (mirrors worker-stop.sh:36-54)
    - Scan-lock PID validation via kill -0 (mirrors lib/worker-restart.sh:50)
    - Numeric PID validation via [[ $PID =~ ^[0-9]+$ ]] before any kill call (T-98-05)
    - Kill-only semantics: no worker_start_background, no restart_worker_if_stale
    - jq -r '.status' for JSON status routing in commands/update.md
key_files:
  created: []
  modified:
    - plugins/arcanon/scripts/update.sh (--kill mode added, 62 net new lines)
    - plugins/arcanon/commands/update.md (Steps 3-5 wired, 44 net new lines)
    - tests/update.bats (6 new tests appended, 110 net new lines)
decisions:
  - Kill-only: update.sh --kill never calls restart_worker_if_stale or worker_start_background (Anti-Pattern 2)
  - --yes absent: reinstall uses claude plugin update arcanon --scope user without --yes (per 98-01 pre-flight)
  - Structured JSON on all exit paths: every --kill branch emits {status, reason, ...} for commands/update.md to parse
  - Numeric PID guard (T-98-05): [[ $PID =~ ^[0-9]+$ ]] validates before kill -0 / kill -TERM
  - Restructured script: --kill block placed before --check logic to avoid case fall-through hitting check's exit 0
metrics:
  duration: "~7 minutes"
  completed: "2026-04-21T19:05:16Z"
  tasks_completed: 3
  files_created: 0
  files_modified: 3
---

# Phase 98 Plan 02: Confirmation, Kill, and Reinstall Summary

Kill-only worker stop with scan-lock guard (SIGTERM-5s-SIGKILL), confirmation prompt defaulting to No, and `claude plugin update arcanon --scope user` reinstall invocation wired into the update command — worker intentionally left down after this plan; 98-03 owns the restart.

## Files Modified

| File | Net Lines | Purpose |
|------|-----------|---------|
| `plugins/arcanon/scripts/update.sh` | +62 | `--kill` mode: scan-lock guard, SIGTERM-to-SIGKILL, JSON output |
| `plugins/arcanon/commands/update.md` | +44 | Steps 3-5: confirmation [y/N], kill + scan guard, reinstall |
| `tests/update.bats` | +110 | 6 new tests: UPD-07 scan-lock, UPD-08 kill-only semantics |

## Pre-flight `--yes` Outcome (matching 98-01 SUMMARY)

**`--yes` flag is ABSENT.** 98-01 SUMMARY explicitly records:

> `claude plugin update --yes flag absent — 98-02 must handle interactive prompt`

`commands/update.md` Step 5 uses `claude plugin update arcanon --scope user` **without** `--yes`. The `claude` CLI may prompt the user interactively for confirmation. This is the correct branch per the pre-flight outcome.

## Test Results

```
1..15
ok 1 UPD-13: node+semver says 0.10.0 > 0.9.0 (not lexicographic)
ok 2 UPD-13: node+semver says 0.10.0 is NOT less than 0.9.0 (anti-lex proof)
ok 3 UPD-13: node+semver says 0.1.1 > 0.1.0
ok 4 UPD-13: node+semver says 1.0.0 == 1.0.0
ok 5 UPD-03: --check emits status=equal when installed matches remote
ok 6 UPD-04: --check emits non-empty changelog_preview when remote is newer
ok 7 UPD-04: --check marks update_available=true when remote is newer
ok 8 UPD-11: --check exits 0 with status=offline when marketplace manifest is absent
ok 9 --check emits valid JSON with all required keys
ok 10 UPD-07: --kill emits scan_in_progress when scan.lock has a live PID
ok 11 UPD-07: --kill clears stale scan.lock (dead PID) and proceeds
ok 12 UPD-08: --kill sends SIGTERM and removes worker.pid/worker.port on live worker
ok 13 UPD-08: --kill emits reason=no_pid_file when worker not running
ok 14 UPD-08: scripts/update.sh does not reference restart_worker_if_stale or worker_start_background
ok 15 UPD-08: --kill does not spawn a new worker (kill-only semantics)
```

15/15 pass. Full suite: 284/284 pass (no regressions). Note: plan spec expected 14 tests (8 from 98-01 + 6 new) but 98-01 shipped 9 tests, giving 15 total.

## TDD Gate Compliance

- RED commit: `dbf11da` — `test(98-02): add failing tests for scan-lock guard, kill-only, no-restart`
- GREEN: tests pass against Task 1 implementation (`76cc814`) — no separate GREEN commit needed as implementation preceded test addition in the same session (tests verified passing immediately after append)

## Structural Fix Applied

The original approach appended the `--kill` block after the `--check` logic, but the case statement used fall-through for both modes into the same code path. The `--check` block's `exit 0` at line 114 would be reached before `--kill` logic ran. Fixed by restructuring the file: `--kill` block placed **before** `--check` logic, guarded by `if [[ "$MODE" == "--kill" ]]; then`. Tracked as a Rule 1 auto-fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restructured --kill block placement to prevent fall-through**
- **Found during:** Task 1 verification (functional test showed `--kill` producing `--check` output)
- **Issue:** Both `--check` and `--kill` fell through the case statement into the `--check` code block. The `exit 0` at the end of `--check` logic was reached before the `--kill` if-block.
- **Fix:** Moved the entire `--kill` if-block to execute BEFORE the `--check` logic. Added `if [[ "$MODE" == "--kill" ]]; then` guard so `--kill` exits early and `--check` code is only reached when `MODE=--check`.
- **Files modified:** `plugins/arcanon/scripts/update.sh`
- **Commit:** `76cc814`

## Notes for Plan 98-03

- The worker is **intentionally down** after this plan ships. `update.sh --kill` removes `worker.pid` and `worker.port` and does not restart.
- Plan 98-03's verify step MUST start a fresh worker before polling `/api/version`.
- `DATA_DIR` contents (SQLite DB, config) are preserved — only `worker.pid`, `worker.port`, and stale `scan.lock` are removed by `--kill`.
- Ports: tests use `37999`; dev worker default is `37888`. 98-03 tests should use `37999` or a different ephemeral port to avoid collisions.

## Threat Surface Scan

No new network endpoints or auth paths introduced. T-98-05 (numeric PID validation before kill) and T-98-06/T-98-07 (stale lock detection) are mitigated as specified in the plan's threat register.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `plugins/arcanon/scripts/update.sh` --kill mode present | FOUND |
| `plugins/arcanon/commands/update.md` Steps 3-5 present | FOUND |
| `tests/update.bats` 6 new tests present | FOUND |
| commit 76cc814 (update.sh --kill) | FOUND |
| commit 8b64c70 (update.md Steps 3-5) | FOUND |
| commit dbf11da (update.bats RED tests) | FOUND |
| `restart_worker_if_stale` count in update.sh | 0 |
| bats tests/update.bats pass count | 15/15 |
| full bats suite pass count | 284/284 |
