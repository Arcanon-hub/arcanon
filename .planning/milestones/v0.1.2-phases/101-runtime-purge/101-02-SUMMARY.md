---
phase: 101-runtime-purge
plan: 02
subsystem: bash-runtime
tags: [runtime-purge, bash, env-vars, hooks, config-resolver]

# Dependency graph
requires:
  - phase: baseline
    provides: arcanon plugin bash libraries and hook scripts with mixed ARCANON_/LIGAMEN_ back-compat reads
provides:
  - lib/config.sh that reads only ARCANON_CONFIG_FILE (no LIGAMEN_* re-exports)
  - lib/data-dir.sh with two-step resolver (ARCANON_DATA_DIR → $HOME/.arcanon)
  - lib/config-path.sh that unconditionally returns $dir/arcanon.config.json
  - lib/linked-repos.sh reading only arcanon.config.json
  - Six hook scripts (lint, file-guard, format, worker-start, worker-stop, session-start) free of nested ${ARCANON_X:-${LIGAMEN_X:-default}} patterns
  - worker-start port resolution with no legacy tier (env → settings.json → arcanon.config.json → 37888)
  - session-start.sh that disables only on ARCANON_DISABLE_SESSION_START
affects: [101-03, 103-test-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-read env var policy: ${ARCANON_X:-default}, never ${ARCANON_X:-${LIGAMEN_X:-default}}"
    - "Single-probe config discovery: arcanon.config.json only; no ligamen.config.json fallback"
    - "Silent migration: no stderr deprecation warnings for removed legacy names"

key-files:
  created: []
  modified:
    - plugins/arcanon/lib/config.sh
    - plugins/arcanon/lib/config-path.sh
    - plugins/arcanon/lib/data-dir.sh
    - plugins/arcanon/lib/linked-repos.sh
    - plugins/arcanon/lib/db-path.sh
    - plugins/arcanon/scripts/lint.sh
    - plugins/arcanon/scripts/file-guard.sh
    - plugins/arcanon/scripts/format.sh
    - plugins/arcanon/scripts/worker-start.sh
    - plugins/arcanon/scripts/worker-stop.sh
    - plugins/arcanon/scripts/session-start.sh

key-decisions:
  - "Hard-remove, not two-read: LIGAMEN_* reads deleted entirely, no ARCANON_X ?? LIGAMEN_X fallbacks"
  - "No stderr deprecation notices for removed legacy names (users see unset behavior)"
  - "session-start.sh line 13 behavior change: LIGAMEN_DISABLE_SESSION_START stops disabling the hook — users must set ARCANON_DISABLE_SESSION_START"
  - "db-path.sh comment on line 55 rewritten to reflect data-dir.sh post-edit contract (runtime-describing doc, not cosmetic)"
  - "session-start.sh header comment rewritten from 'available ligamen commands' to 'available arcanon commands' — runtime-adjacent hook description, consistent with purged read"

patterns-established:
  - "Single-read env-var policy — any future script must read only ARCANON_*"
  - "Single-probe config discovery — only arcanon.config.json is probed anywhere in the bash runtime"
  - "Silent rename — no warn-at-runtime; dead env vars and dead filenames simply stop working"

requirements-completed: [ENV-04, ENV-05, ENV-06, ENV-07, PATH-01, PATH-03, PATH-05, PATH-06]

# Metrics
duration: 3min
completed: 2026-04-23
---

# Phase 101 Plan 02: Bash Runtime Purge Summary

**Bash libraries and hook scripts now read only ARCANON_* env vars and probe only arcanon.config.json — every LIGAMEN_* runtime read and ligamen.config.json fallback is deleted, with no stderr deprecation notices.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-23T17:44:21Z
- **Completed:** 2026-04-23T17:47:24Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Purged every `LIGAMEN_*` env var read and `ligamen.config.json` file probe from the 11 target files listed in REQUIREMENTS.md (ENV-04..07, PATH-01, PATH-03, PATH-05, PATH-06).
- Eliminated all nested-default `${ARCANON_X:-${LIGAMEN_X:-default}}` patterns across the arcanon plugin (verified via `grep -rEn` gate — zero matches plugin-wide).
- Collapsed `lib/config-path.sh` into a one-line unconditional `printf` (no more two-branch probe + stderr deprecation notice).
- Collapsed `lib/data-dir.sh` from a 5-step preference order to a 2-step resolver ($ARCANON_DATA_DIR → $HOME/.arcanon).
- Reduced `worker-start.sh` port-resolution chain from 4 tiers (env-arcanon / env-ligamen / settings.json-multi-key / multi-config-probe) to 3 tiers, single-source at each tier.
- Rewrote runtime-describing docstring on `lib/db-path.sh` line 55 that became factually false after `lib/data-dir.sh` was edited.

## Task Commits

Each task was committed atomically:

1. **Task 1: Purge lib/*.sh runtime reads and fallback branches** — `c217668` (feat)
2. **Task 2: Purge scripts/{lint,file-guard,format,worker-stop}.sh nested-default patterns** — `279f89a` (feat)
3. **Task 3: Purge scripts/{worker-start,session-start}.sh multi-source port/config resolution** — `3ac8e93` (feat)

**Plan metadata:** [to be committed with this SUMMARY]

## Files Created/Modified

### Library files (Task 1 — commit c217668)

- `plugins/arcanon/lib/config.sh` — Rewrote with Write (50 → 39 lines). Removed LIGAMEN_CONFIG_FILE elif branch (lines 28-30), the two LIGAMEN_CONFIG_* re-export lines (47-49), the back-compat aliases block from the header docstring, and the inline "legacy fallback" comment.
- `plugins/arcanon/lib/config-path.sh` — Rewrote with Write (26 → 13 lines). Deleted the arcanon.config.json existsSync branch and the ligamen.config.json + stderr deprecation branch. Resolver is now a one-line `printf '%s\n' "$dir/arcanon.config.json"`.
- `plugins/arcanon/lib/data-dir.sh` — Rewrote with Write (33 → 19 lines). Deleted LIGAMEN_DATA_DIR branch, `$HOME/.arcanon` existsSync branch (redundant with default), and `$HOME/.ligamen` existsSync branch. Preference order reduced from 5 to 2.
- `plugins/arcanon/lib/linked-repos.sh` — Single-line Edit. Deleted line 24 (`[[ -f "$config_file" ]] || config_file="${current_dir}/ligamen.config.json"`).
- `plugins/arcanon/lib/db-path.sh` — Single-line Edit. Comment on line 55 rewritten from `# Respects ARCANON_DATA_DIR / LIGAMEN_DATA_DIR overrides via data-dir.sh.` to `# Respects ARCANON_DATA_DIR override via data-dir.sh.`

### Hook scripts — quick edits (Task 2 — commit 279f89a)

- `plugins/arcanon/scripts/lint.sh` — 3 edits. Line 6 comment drops "legacy LIGAMEN_DISABLE_LINT"; line 7 nested-default → single; line 80 nested-default → single.
- `plugins/arcanon/scripts/file-guard.sh` — 5 edits. Lines 10+12 drop "Legacy alias: LIGAMEN_*" sentences; line 18 nested-default → single; line 69 drops "(legacy: LIGAMEN_EXTRA_BLOCKED)" parenthetical; line 73 nested-default → single.
- `plugins/arcanon/scripts/format.sh` — 2 edits. Line 6 comment drops "; legacy alias LIGAMEN_DISABLE_FORMAT"; line 7 nested-default → single.
- `plugins/arcanon/scripts/worker-stop.sh` — 1 edit. Line 11 comment drops ", legacy ~/.ligamen supported".

### Hook scripts — heavier surgery (Task 3 — commit 3ac8e93)

- `plugins/arcanon/scripts/worker-start.sh` — 5 edits in 3 regions. Line 18 header comment drops "legacy ~/.ligamen supported"; port resolution block collapsed from 4 tiers to 3 (deleted LIGAMEN_WORKER_PORT env elif + .LIGAMEN_WORKER_PORT jq key + ligamen.config.json CWD probe); line 77 comment drops "(or legacy ligamen.config.json)".
- `plugins/arcanon/scripts/session-start.sh` — 4 edits. Line 4 comment "available ligamen commands" → "available arcanon commands"; line 13 disable-hook concatenation reduced to only ARCANON_DISABLE_SESSION_START; line 73 CONFIG_FILE ligamen.config.json fallback deleted; line 114 DATA_DIR nested-default → single.

## Decisions Made

- **Header comment rewrites on db-path.sh and session-start.sh** were kept *in this plan* (not deferred to Phase 102) because they describe runtime behavior that's about to become false. A cosmetic-only comment stays for Phase 102; a runtime-describing comment that lies after the edit must move with the edit. This matches the plan's scope_guardrails explicitly.
- **lib/config.sh rewrite (not patch)**: chose full-file Write because six non-adjacent regions needed deletion (docstring, inline comment, elif branch, trailing comment, two re-exports). A Write is more readable than six overlapping Edits.
- **lib/data-dir.sh rewrite (not patch)**: same — four nested if-blocks collapsing into two made a Write clearer.
- **lib/config-path.sh rewrite (not patch)**: the resolver shrank from 13 lines to 3; a Write is cleaner than deleting two branches.

## Deviations from Plan

**None — plan executed exactly as written.**

All 11 files received the exact edits specified in the PLAN's `<scope_guardrails>` block. No bugs found, no auth gates hit, no architectural decisions needed. No pre-existing tests run (phase policy: test breakage is expected and belongs to Phase 103).

## Issues Encountered

- **Read tool truncation warnings** — the `Read` tool returned only line 1 for files with prior observations (lint.sh, worker-start.sh, session-start.sh) on the first call. Worked around by explicitly passing `offset: 1, limit: 200` to force a full read. Not a deviation — purely a tool interaction quirk. Did not affect the executed edits.
- **Read-before-edit reminders** were emitted on every Edit/Write even though the files had been Read in the same session. Edits all succeeded — reminders were advisory, not blocking.
- **Concurrent 101-01 execution observed** — another executor agent interleaved commits for plan 101-01 between my task commits (visible in `git log --oneline -5`). This is expected from the phase's wave=1 parallelization policy; my three commits (`c217668`, `279f89a`, `3ac8e93`) are atomically linked to 101-02 and do not overlap 101-01 files.

## User Setup Required

None — this phase is a pure internal refactor. No env vars to add, no credentials to rotate, no external services touched. Users upgrading from v5.x with `LIGAMEN_DATA_DIR`, `LIGAMEN_CONFIG_FILE`, `LIGAMEN_WORKER_PORT`, `LIGAMEN_DISABLE_*`, or `LIGAMEN_EXTRA_BLOCKED` set in their shell profile will find those vars silently ignored — they must rename to `ARCANON_*`.

## Verification Gates

All five gates from `<verification>` block PASS:

| Gate | Check | Result |
|------|-------|--------|
| 1 | `grep "LIGAMEN_\|ligamen.config.json\|.ligamen"` across 11 files | zero matches |
| 2 | `grep -rEn '\$\{ARCANON_[A-Z_]+:-\$\{LIGAMEN_' plugins/arcanon/` | zero matches |
| 3 | `bash -n` on all 11 files | all parse clean |
| 4a | `ARCANON_DATA_DIR=/tmp/arc-data → resolve_arcanon_data_dir` | prints `/tmp/arc-data` |
| 4b | unset both → `resolve_arcanon_data_dir` | prints `$HOME/.arcanon` |
| 4c | `resolve_arcanon_config /tmp` | prints `/tmp/arcanon.config.json` |
| 5 | stderr from `resolve_arcanon_config /tmp` | empty |

## Phase 102 Carry-over (intentionally untouched)

The following "ligamen" references in the 11 files were **left in place** per scope policy — they are cosmetic (log strings, file headers) and belong to Phase 102:

- `plugins/arcanon/lib/linked-repos.sh` line 27 — `echo "arcanon: using linked-repos config from $config_file" >&2` (the path string itself may still contain "ligamen" if a user passed that name, but the log-line code is neutral).
- File-level headers `# Arcanon — ...` are already arcanon-branded in these files; nothing deferred there.

All other "ligamen" appearances in the plugin (drift-*.sh, hub.sh, impact-hook.sh, impact.sh, mcp-wrapper.sh, update.sh, install-deps.sh) are **out of scope** for plan 101-02 — they belong to plans 101-03 and 102.

## Expected Test Breakage

Per phase policy (101-CONTEXT.md `<specifics>` section), tests in `tests/config.bats`, `tests/detect.bats`, `tests/format.bats`, `tests/file-guard.bats`, `tests/mcp-*.bats` fixtures set `LIGAMEN_*` env vars and will now fail. This is **intentional and validates the purge landed**. Phase 103 rewrites those tests.

## Behavior Change — session-start.sh line 13

**Before:** Either `ARCANON_DISABLE_SESSION_START` OR `LIGAMEN_DISABLE_SESSION_START` (non-empty) disabled the hook.
**After:** Only `ARCANON_DISABLE_SESSION_START` disables the hook.

Users who had `export LIGAMEN_DISABLE_SESSION_START=1` in their shell profile will find the hook running again after upgrade. This matches the v0.1.2 breaking-change acceptance (CONTEXT.md line 27-29: "Breaking change acceptable").

## Next Phase Readiness

- Plan 101-03 (install-deps.sh + runtime-deps.json PKG-01/03) unblocked — bash runtime is clean, only `install-deps.sh` line 2 header + package identity remain.
- Plan 101-04 (already committed at commit `75782d4`) depends on data-dir.sh resolver — verified working post-edit.
- Phase 103 test rewrites will fail-first on `LIGAMEN_CONFIG_FILE` fixtures, which is the validation signal the purge landed.

## Self-Check: PASSED

Verified:

- `plugins/arcanon/lib/config.sh` exists, 39 lines, zero legacy refs.
- `plugins/arcanon/lib/config-path.sh` exists, 13 lines, resolver is one-line.
- `plugins/arcanon/lib/data-dir.sh` exists, 19 lines, two-step preference.
- `plugins/arcanon/lib/linked-repos.sh` exists, ligamen.config.json fallback deleted.
- `plugins/arcanon/lib/db-path.sh` exists, runtime comment on line 55 corrected.
- `plugins/arcanon/scripts/lint.sh`, `file-guard.sh`, `format.sh`, `worker-start.sh`, `worker-stop.sh`, `session-start.sh` all exist, zero LIGAMEN_ matches.
- Commits `c217668`, `279f89a`, `3ac8e93` all present in `git log --all`.

---
*Phase: 101-runtime-purge*
*Completed: 2026-04-23*
