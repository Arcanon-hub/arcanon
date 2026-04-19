---
phase: 95-shell-cleanup-dispatcher
plan: "02"
subsystem: worker-lifecycle
tags: [shell, refactor, deduplication, tdd, bats]
dependency_graph:
  requires: []
  provides: [lib/worker-restart.sh, tests/worker-restart.bats]
  affects: [scripts/session-start.sh, scripts/worker-start.sh]
tech_stack:
  added: [lib/worker-restart.sh]
  patterns: [sourceable-lib, tdd-red-green, pid-file-mutex]
key_files:
  created:
    - plugins/arcanon/lib/worker-restart.sh
    - tests/worker-restart.bats
  modified:
    - plugins/arcanon/scripts/session-start.sh
    - plugins/arcanon/scripts/worker-start.sh
decisions:
  - "worker-start.sh calls should_restart_worker (not restart_worker_if_stale) to avoid recursive spawn via worker_start_background"
  - "WRKR-07 pre-existing failure (migration log line in JSON log test) — not introduced by this plan"
metrics:
  duration_seconds: 205
  completed_date: "2026-04-19"
  tasks_completed: 4
  files_changed: 4
requirements: [DSP-05, DSP-06, DSP-07]
---

# Phase 95 Plan 02: Worker-Restart Library Extraction Summary

**One-liner:** Extracted duplicate worker restart logic into `lib/worker-restart.sh` providing `should_restart_worker` and `restart_worker_if_stale` with bats TDD coverage across 6 scenarios.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing bats tests for worker-restart.sh | ddef6dc | tests/worker-restart.bats |
| 1 (GREEN) | Implement lib/worker-restart.sh | 9d9d5d9 | plugins/arcanon/lib/worker-restart.sh |
| 2 | Replace inline restart block in session-start.sh | 5d0b9fa | plugins/arcanon/scripts/session-start.sh |
| 3 | Replace inline restart block in worker-start.sh | dc6da6b | plugins/arcanon/scripts/worker-start.sh |
| 4 | bats coverage (6 scenarios) | ddef6dc | tests/worker-restart.bats |

## What Was Built

`plugins/arcanon/lib/worker-restart.sh` — a sourceable Bash library exposing two functions:

- `should_restart_worker`: reads PID_FILE + PORT_FILE, sets `_should_restart`, `_restart_reason` (no_pid_file | stale_pid | version_mismatch | ok), `_installed_version`, `_running_version`, `_worker_pid`. Returns 0 always.
- `restart_worker_if_stale`: calls `should_restart_worker`, performs graceful→forceful kill on version_mismatch, cleans stale PID, calls `worker_start_background`. Sets `_worker_restarted`. Returns 0 always. Idempotent.

Both callers replaced their ~30-line inline duplicates with a `source + call` pair. The PID-file mutex boundary in `worker-start.sh` is preserved (Pitfall 8): `should_restart_worker` is called inline rather than `restart_worker_if_stale` to avoid recursive `worker_start_background` spawning.

## Verification Results

| Check | Result |
|-------|--------|
| `bash -n lib/worker-restart.sh` | PASS |
| `bash -n scripts/session-start.sh` | PASS |
| `bash -n scripts/worker-start.sh` | PASS |
| `bats tests/worker-restart.bats` (6/6) | PASS |
| `bats tests/session-start.bats` (22/22) | PASS |
| `bats tests/worker-lifecycle.bats` (6/7) | PASS (WRKR-07 pre-existing) |
| `grep -c 'declare -A' worker-restart.sh` | 0 (no Bash 4+ dependency) |
| MUTEX BOUNDARY comment present | PASS |
| Old `kill -0 "$PID"` guard removed from worker-start.sh | PASS |

## Deviations from Plan

### Pre-existing issue logged

**WRKR-07 (worker-lifecycle.bats):** Fails before and after this plan — migration log line `▶ migration 010 — service_dependencies` appears before the JSON log line, causing the JSON-validity check to fail. Confirmed pre-existing by running `git stash` + bats on the prior commit. No action taken; logged to deferred items.

No other deviations — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — this plan contains no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

- `plugins/arcanon/lib/worker-restart.sh` — FOUND
- `tests/worker-restart.bats` — FOUND
- Commit `ddef6dc` (RED) — FOUND
- Commit `9d9d5d9` (GREEN) — FOUND
- Commit `5d0b9fa` (session-start) — FOUND
- Commit `dc6da6b` (worker-start) — FOUND

## TDD Gate Compliance

- RED gate: commit `ddef6dc` — `test(95-02): add failing tests for worker-restart.sh (RED phase)` — PRESENT
- GREEN gate: commit `9d9d5d9` — `feat(95-02): implement lib/worker-restart.sh (GREEN phase)` — PRESENT
