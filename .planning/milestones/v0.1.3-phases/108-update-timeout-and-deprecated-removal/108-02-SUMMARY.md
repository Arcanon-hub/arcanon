---
phase: 108-update-timeout-and-deprecated-removal
plan: 02
subsystem: cleanup
tags: [deprecation, breaking-change, command-surface, bats, changelog, readme]

# Dependency graph
requires:
  - phase: v0.1.1
    provides: "/arcanon:sync canonical upload-then-drain verb (the migration target for /arcanon:upload callers)"
provides:
  - "Removed /arcanon:upload deprecated stub command file"
  - "Removed 5 CLN-05 bats tests asserting the stub's presence"
  - "Added DEP-03 regression-guard bats test asserting commands/upload.md absence"
  - "Scrubbed /arcanon:upload references from README.md Quick start and Commands table"
  - "Verified plugins/arcanon/skills/impact/SKILL.md clean of /arcanon:upload references"
  - "CHANGELOG.md [Unreleased] section gained ### BREAKING + ### Removed entries with explicit /arcanon:sync migration guidance"
affects: [113-verification-gate, future-cli-cleanup-of-out-of-scope-upload-references]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Negative file-existence regression-guard bats test (mirrors CLN-01 cross-impact.md pattern from v0.1.1)"
    - "BREAKING-change CHANGELOG entry pinned to [Unreleased] until release-time rename in verification gate phase"

key-files:
  created:
    - ".planning/phases/108-update-timeout-and-deprecated-removal/deferred-items.md"
  modified:
    - "tests/commands-surface.bats — net -4 tests (was 9, now 6); 5 CLN-05 tests deleted, 1 DEP-03 added; header comment refreshed"
    - "README.md — Quick start block: 1 line removed; Commands table: 1 row removed"
    - "plugins/arcanon/CHANGELOG.md — [Unreleased] section gains ### BREAKING + ### Removed subsections"
  deleted:
    - "plugins/arcanon/commands/upload.md — deprecated stub (intentional, DEP-01)"

key-decisions:
  - "Followed CONTEXT D-03 verbatim — /arcanon:upload removed in v0.1.3, not deferred to v0.2.0"
  - "Followed CONTEXT D-04 — DEP-03 regression-guard added in same plan as the deletion (long-tail value of test deletion)"
  - "Followed CONTEXT D-05 — scope strictly limited to README.md + SKILL.md scrubbing; out-of-scope upload references in docs/, plugins/arcanon/README.md, login.md, session-start.sh deferred"
  - "Followed CONTEXT D-06 — CHANGELOG entry pinned to [Unreleased]; Phase 113 will rename to [0.1.3] at release"

patterns-established:
  - "Deprecation-removal commit anatomy: refactor(<phase-plan>): delete <file> + delete tests + add absence-guard test, all in one commit"
  - "Parallel-plan file-staging discipline: when commands-surface.bats and update.sh are both modified in the working tree but owned by different plans, each plan stages ONLY its own files individually (never `git add -A`/`git add .`); soft-reset is the recovery if a parallel agent's edit is accidentally caught in a stage"

requirements-completed: [DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06]

# Metrics
duration: 16min
completed: 2026-04-25
---

# Phase 108 Plan 02: `/arcanon:upload` Deprecated-stub Removal Summary

**Deleted the `/arcanon:upload` command file, swapped 5 CLN-05 stub-presence bats tests for 1 DEP-03 absence-guard test, scrubbed README's Quick start + Commands table, and added a BREAKING/Removed entry to CHANGELOG `[Unreleased]` redirecting users to `/arcanon:sync`.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-04-25T12:08:38Z
- **Completed:** 2026-04-25T12:24:21Z
- **Tasks:** 2 / 2
- **Files modified:** 3 (commands-surface.bats, README.md, CHANGELOG.md)
- **Files deleted:** 1 (plugins/arcanon/commands/upload.md)
- **Files verified clean (no edit needed):** 1 (plugins/arcanon/skills/impact/SKILL.md)
- **Files created:** 1 (deferred-items.md, capturing 3 unrelated bats failures owned by phases 107/109)

## Accomplishments

- DEP-01: `plugins/arcanon/commands/upload.md` removed from working tree and git index via `git rm`. The deprecated stub that has lived since v0.1.1 with a v0.2.0 removal anchor is now gone in v0.1.3, consistent with the v0.1.2 BREAKING wave (LIGAMEN_* purge).
- DEP-02: 5 CLN-05 bats tests asserting the stub's presence (lines 33–58 of the original file) deleted from `tests/commands-surface.bats`.
- DEP-03: Added `@test "DEP-03: /arcanon:upload command file has been removed (regression guard)"` — single negative file-existence assertion that fails if a future cherry-pick or stash apply silently restores the deleted command file. Mirrors the CLN-01 cross-impact.md pattern from v0.1.1.
- DEP-04: README.md scrubbed — `grep -c arcanon:upload README.md` now returns 0. Quick start block dropped the upload line; Commands table dropped the upload row. `/arcanon:sync` row remains as the canonical verb (description left as-is per plan note — refining "Drain the offline upload queue" → "Upload + drain" is a deferred follow-up, not in DEP-04 scope).
- DEP-05: `plugins/arcanon/skills/impact/SKILL.md` re-grepped, confirmed clean (zero matches), no edit applied — verify-only as anticipated by CONTEXT.
- DEP-06: `plugins/arcanon/CHANGELOG.md` `[Unreleased]` section gains a `### BREAKING` subsection with the verbatim entry from the plan spec ("Removed `/arcanon:upload` deprecated stub. Use `/arcanon:sync` (canonical since v0.1.1). CI scripts hardcoded to `/arcanon:upload` will fail with 'command not found'; migrate to `/arcanon:sync`.") plus a `### Removed` subsection enumerating the three concrete removals (file, tests, doc references). `[0.1.2]` and lower sections untouched.

## Task Commits

Each task was committed atomically with files staged individually (never `git add -A` — Wave-1 parallel plan 108-01's `update.sh` modification was unstaged at commit time and required careful staging discipline; see Deviations below):

1. **Task 1: Delete commands/upload.md and update bats test surface (DEP-01, DEP-02, DEP-03)** — `7cf3c4f` (refactor)
   - `plugins/arcanon/commands/upload.md` deleted via `git rm`
   - `tests/commands-surface.bats` 5 CLN-05 tests removed, 1 DEP-03 test added, header comment refreshed
   - Bats suite for the file: 6 tests pass (was 9; net −4 as planned)

2. **Task 2: Scrub /arcanon:upload from README + add CHANGELOG BREAKING entry (DEP-04, DEP-05, DEP-06)** — `86289f1` (refactor)
   - `README.md` Quick start: 1 line removed; Commands table: 1 row removed
   - `plugins/arcanon/CHANGELOG.md` `[Unreleased]` gains 2 subsections (BREAKING + Removed)
   - SKILL.md verified clean (no edit)

**Plan metadata commit:** Pending (final commit at end of plan execution will include this SUMMARY.md, deferred-items.md, STATE.md, ROADMAP.md updates).

## Files Created/Modified

- `plugins/arcanon/commands/upload.md` — **DELETED** (DEP-01). The 31-line deprecated stub forwarding to `/arcanon:sync` via `hub.sh upload $ARGUMENTS` is gone.
- `tests/commands-surface.bats` — modified (DEP-02 + DEP-03). Header comment now says: "the seven surviving commands of v0.1.1 are present with valid frontmatter, /arcanon:cross-impact has been fully removed (CLN-01), and /arcanon:upload has been fully removed (DEP-03 regression guard against accidental re-add)."
- `README.md` — modified (DEP-04). Two surgical removals (Quick start line + Commands table row).
- `plugins/arcanon/skills/impact/SKILL.md` — verified clean (DEP-05, no edit).
- `plugins/arcanon/CHANGELOG.md` — modified (DEP-06). `[Unreleased]` populated with BREAKING + Removed subsections.
- `.planning/phases/108-update-timeout-and-deprecated-removal/deferred-items.md` — created. Logs 3 unrelated bats failures owned by phases 107-02 / 109-02 (out of 108-02 scope per executor SCOPE BOUNDARY rule).

## Decisions Made

- **Followed CONTEXT D-03 verbatim** — bring `/arcanon:upload` removal forward from v0.2.0 to v0.1.3. v0.1.2 already shipped a BREAKING change (LIGAMEN_* env var purge); one more removal in the same wave is consistent.
- **Followed CONTEXT D-04** — added DEP-03 regression-guard test in the same plan as the deletion. Without it, the file could be silently re-added by cherry-pick or stash.
- **Followed CONTEXT D-05** — REQ scope is `README.md` + `SKILL.md` only. Out-of-scope `/arcanon:upload` references in `docs/commands.md`, `docs/getting-started.md`, `plugins/arcanon/README.md`, `commands/login.md`, `scripts/session-start.sh` were intentionally NOT touched. Phase 113 (VER-04) only verifies file absence, not the verb in arbitrary docs.
- **Followed CONTEXT D-06** — CHANGELOG entry pinned to `[Unreleased]`. Phase 113 will rename `[Unreleased]` → `[0.1.3] - 2026-04-XX` at release-tagging time.
- **Chose `git rm` over filesystem `rm`** for upload.md deletion — both stages and removes from working tree in one step, ensuring the file leaves git's index immediately.
- **Chose to refresh the bats file's header comment** as a Rule 1 inline truth-correction. The original comment said the deprecated stub was "in place with proper deprecation markers"; that became a false statement the moment the file was deleted. Updating it to "/arcanon:upload has been fully removed (DEP-03 regression guard against accidental re-add)" keeps the file self-documenting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Stale file-header comment in `tests/commands-surface.bats`**
- **Found during:** Task 1, after deleting the 5 CLN-05 tests.
- **Issue:** The file's top-of-file comment block (lines 1–7 in the original) described the file as testing the deprecated stub's "proper deprecation markers." After removing those 5 tests, that comment was a lie — the file no longer tested the stub at all (the new DEP-03 test asserts the file's absence).
- **Fix:** Updated the comment to: "/arcanon:cross-impact has been fully removed (CLN-01), and /arcanon:upload has been fully removed (DEP-03 regression guard against accidental re-add)."
- **Files modified:** `tests/commands-surface.bats` (header comment only)
- **Verification:** Comment now accurately describes the 6 tests in the file.
- **Committed in:** `7cf3c4f` (Task 1 commit)

**2. [Rule 3 — Blocking] First Task 1 commit accidentally captured Wave-1 parallel plan 108-01's `update.sh` change**
- **Found during:** Task 1 commit, post-commit deletion check.
- **Issue:** Plan 108-01 was running in parallel and had `plugins/arcanon/scripts/update.sh` modified (unstaged) when 108-02 started. `git rm plugins/arcanon/commands/upload.md` cleanly staged my deletion. After staging `tests/commands-surface.bats` individually, `git diff --cached --stat` showed 2 files. But by the time `git commit` ran, the 108-01 agent had advanced its own staging and the commit captured 3 files including `update.sh` (an out-of-scope file). The first 108-02 commit hash `b91fbef` had a 108-02 message but contained 108-01's diff alongside.
- **Fix:** `git reset --soft HEAD~1` (moves HEAD without touching working tree or index), then `git restore --staged plugins/arcanon/scripts/update.sh`, then re-staged only my 2 files and re-committed cleanly. The new (clean) Task 1 commit is `7cf3c4f`. The discarded `b91fbef` is no longer in history. Plan 108-01 was unaffected — it still owns and committed `update.sh` itself in commit `c343bc3` (visible in the post-Wave-1 history).
- **Files modified:** None additional — recovery was a history operation, not a content change.
- **Verification:** `git show --stat 7cf3c4f` confirms only 2 files (upload.md deletion + bats update). `git log` shows 108-01 has its own `update.sh` commit `c343bc3` directly after `e7cc02d` — clean separation.
- **Committed in:** Recovery itself was not committed; the clean replacement is `7cf3c4f`.

**Note on `git reset --soft`:** This is permitted by the executor's destructive-operations guidance (only `--hard` is forbidden in the worktree-prohibition rule). `--soft` only moves HEAD; it does not touch the working tree or stage area, so no work was destroyed. The original `b91fbef` was never pushed to a remote.

---

**Total deviations:** 2 auto-fixed (1 × Rule 1 truth-correction, 1 × Rule 3 commit-scope recovery).

**Impact on plan:** Both deviations were necessary for correctness. Rule 1 kept the bats file self-documenting after the test surface change. Rule 3 was a coordination-with-parallel-agent issue — without recovery, plan 108-01 would have been left in an ambiguous state and 108-02's commit would have spoken for changes it doesn't own. No scope creep introduced; the final two commits (`7cf3c4f` + `86289f1`) touch only 4 files, all within REQ scope.

## Issues Encountered

- **Parallel-plan staging contention** with plan 108-01 modifying `plugins/arcanon/scripts/update.sh` in the same working tree. Resolved via `git reset --soft` recovery and per-file staging discipline (described in Deviation #2 above). Future parallel-plan executors should rely on `git rm <file>` and `git add <specific-file>` exclusively — never `git add -A`, `git add .`, or `git commit -a`.
- **Three pre-existing bats failures** (HOK-06, INST-08, MCP-02) on the full suite at HEAD — owned by phases 107-02 (install-deps rewrite) and 109-02 (in flight). Out of 108-02 scope; logged to `deferred-items.md` for phase 113's verification gate to re-evaluate.

## Verification Results

| Check | Command | Result |
|---|---|---|
| File deletion (DEP-01) | `test ! -f plugins/arcanon/commands/upload.md` | PASS |
| Bats CLN-05 tests removed (DEP-02) | `grep -c CLN-05 tests/commands-surface.bats` | 0 (PASS) |
| Bats DEP-03 test added | `grep -c DEP-03 tests/commands-surface.bats` | 1 (PASS) |
| Bats commands-surface.bats green | `bats tests/commands-surface.bats` | 6 / 6 ok (PASS) |
| README scrubbed (DEP-04) | `! grep -q 'arcanon:upload' README.md` | PASS |
| SKILL.md clean (DEP-05) | `! grep -q 'arcanon:upload' plugins/arcanon/skills/impact/SKILL.md` | PASS |
| CHANGELOG entry present (DEP-06) | `grep -A 8 '## \[Unreleased\]' plugins/arcanon/CHANGELOG.md \| grep -q 'Removed `/arcanon:upload`'` | PASS |
| Combined Task 2 verify (per plan) | All three of the above piped with `&&` | PASS |
| Full bats suite | `bats tests/` | 308 / 311 ok — 3 unrelated failures owned by phases 107-02 / 109-02, logged to `deferred-items.md` (no regression caused by 108-02) |

## User Setup Required

None — this plan touches only command surface, tests, and docs. No external services, no env vars, no manual steps.

## Next Phase Readiness

- **Phase 108 status:** Both wave-1 plans complete (108-01 by another agent: commits `98c4995` test, `c343bc3` fix, `42cab7d` docs; 108-02 by this agent: commits `7cf3c4f`, `86289f1`).
- **For Phase 113 (verification gate):** VER-04 will check `commands/upload.md` file absence — DEP-01 satisfies that, and DEP-03's bats regression-guard ensures it stays absent. CHANGELOG `[Unreleased]` will be renamed to `[0.1.3] - 2026-04-XX` at release time.
- **Deferred follow-up (out of v0.1.3 scope, organic in v0.1.4/v0.1.5):** scrub `/arcanon:upload` from `docs/commands.md` (lines 33, 75, 118), `docs/getting-started.md` (line 30), `plugins/arcanon/README.md` (line 24), `plugins/arcanon/commands/login.md` (lines 38, 46), `plugins/arcanon/scripts/session-start.sh` (line 208). All five are in CONTEXT D-05's "Out-of-scope" table.

## Self-Check: PASSED

Verified the following claims:

- `7cf3c4f` exists in `git log` — FOUND
- `86289f1` exists in `git log` — FOUND
- `plugins/arcanon/commands/upload.md` does NOT exist on disk — CONFIRMED ABSENT
- `tests/commands-surface.bats` exists, has 0 CLN-05 occurrences and 1 DEP-03 occurrence — CONFIRMED
- `README.md` has 0 `/arcanon:upload` matches — CONFIRMED
- `plugins/arcanon/CHANGELOG.md` `[Unreleased]` section contains a `### BREAKING` subsection with the migration entry — CONFIRMED
- `.planning/phases/108-update-timeout-and-deprecated-removal/deferred-items.md` was created — CONFIRMED
- `plugins/arcanon/skills/impact/SKILL.md` was untouched (no commit modifies it from this plan) — CONFIRMED

---

*Phase: 108-update-timeout-and-deprecated-removal*
*Plan: 02 (`/arcanon:upload` deprecated-stub removal)*
*Completed: 2026-04-25*
