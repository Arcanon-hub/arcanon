---
phase: 09-impact-skill
plan: 01
subsystem: skills
tags: [bash, grep, git-diff, cross-repo, symbol-scanning, sibling-discovery]

# Dependency graph
requires:
  - phase: 02-lib-primitives
    provides: lib/siblings.sh discover_siblings function (now extended with list_siblings)
provides:
  - lib/siblings.sh: list_siblings() with allclear.config.json override and parent-dir auto-discovery
  - scripts/impact.sh: cross-repo grep scan engine with --changed, --exclude, and file-path classification
  - skills/cross-impact/SKILL.md: Claude Code skill definition for /allclear impact
affects:
  - 13-tests (will add bats tests for impact.sh and siblings.sh)
  - Any phase that needs cross-repo reference scanning

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "grep -rn with --include extension filters and --exclude-dir for generated dirs"
    - "awk-based classification inline with grep pipeline (avoids subshell per-line cost)"
    - "while-read loop from temp file for bash 3.2 compatibility (replaces mapfile)"
    - "printf | jq pattern per PLGN-07 for all allclear.config.json parsing"
    - "discover_siblings as backward-compat alias for list_siblings"

key-files:
  created:
    - lib/siblings.sh (extended from Phase 02 placeholder — list_siblings with config.json support)
    - scripts/impact.sh (new — cross-repo scan engine)
    - skills/cross-impact/SKILL.md (replaced placeholder with full Claude instructions)
  modified: []

key-decisions:
  - "awk classification inline with grep pipeline rather than calling classify_match bash function per-line — avoids subshell fork overhead on large repos"
  - "discover_siblings alias added for backward compatibility with any Phase 02 callers"
  - "SKILL.md uses live sibling injection via shell backtick block so Claude sees current sibling list at invocation time"
  - "File-count reporting guidance in SKILL.md (not line-count) matches research finding that unique files per repo is better UX"

patterns-established:
  - "Pattern: SKILL.md shell injection for live data — !backtick source lib && function backtick in SKILL.md body"
  - "Pattern: grep scan loop with awk classification — one pipeline per term per sibling, sort -u on filepath column"
  - "Pattern: bash 3.2 compat temp-file accumulation — write to /tmp/allclear_terms_$$ then while-read back into array"

requirements-completed: [IMPT-01, IMPT-02, IMPT-03, IMPT-04, IMPT-05, IMPT-06, IMPT-07]

# Metrics
duration: 4min
completed: 2026-03-15
---

# Phase 09 Plan 01: Impact Skill Summary

**Cross-repo grep scanner with bash symbol extraction from git diff, four-tier classification (code/config/docs/test), and SKILL.md Claude instructions — AllClear's primary differentiator over other plugins**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-15T10:07:50Z
- **Completed:** 2026-03-15T10:11:05Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `lib/siblings.sh` extended with `list_siblings()` supporting allclear.config.json siblings array override and parent-dir `.git` discovery; `discover_siblings` alias kept for Phase 02 compat
- `scripts/impact.sh` created: CLI arg parsing (symbols, `--changed`, `--exclude`), git diff symbol extraction via keyword-anchored grep, grep scan loop across siblings with awk inline classification, tab-separated structured output grouped by repo
- `skills/cross-impact/SKILL.md` replaced placeholder with full Claude Code skill: YAML frontmatter, live sibling injection, three usage forms, step-by-step instructions, output interpretation table with risk levels

## Task Commits

Each task was committed atomically:

1. **Task 1: Sibling discovery library and impact scan engine** - `bacffe4` (feat)
2. **Task 2: SKILL.md for /allclear impact** - `4f80921` (feat)

## Files Created/Modified

- `lib/siblings.sh` — `list_siblings()` with config.json override + parent-dir scan; `discover_siblings` backward-compat alias
- `scripts/impact.sh` — Core scan engine: arg parsing, `--changed` symbol extraction, grep loop, awk classification, tab-separated output
- `skills/cross-impact/SKILL.md` — Full Claude Code skill: frontmatter, shell injection, usage docs, risk table

## Decisions Made

- awk classification inline with grep pipeline instead of per-line bash function calls — avoids subshell fork cost on large repos
- `discover_siblings` alias added to maintain backward compatibility with any existing callers from Phase 02
- Live sibling injection in SKILL.md via shell block so Claude always sees the current sibling list at invocation time, not a stale hard-coded list
- File-path (not line-number) reporting guidance in SKILL.md — per research finding that unique files per repo is cleaner UX for Claude to reason over

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added discover_siblings backward-compat alias in lib/siblings.sh**
- **Found during:** Task 1 (sibling discovery library)
- **Issue:** Phase 02 previously committed `discover_siblings` function; other phases may call it. Replacing it entirely with `list_siblings` would silently break those callers.
- **Fix:** Added `discover_siblings() { list_siblings "$@"; }` alias so both names work.
- **Files modified:** lib/siblings.sh
- **Verification:** Both `discover_siblings` and `list_siblings` names are present in the file; bash -n passes.
- **Committed in:** bacffe4 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — backward compatibility)
**Impact on plan:** Conservative addition. No scope creep; prevents silent regression in Phase 02 callers.

## Issues Encountered

- A linter auto-rewrote `lib/siblings.sh` after my first Write attempt, replacing `list_siblings` with `discover_siblings` and removing config.json support. Corrected by editing the file back to the full required implementation while retaining the `discover_siblings` alias for compat.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 09-01 complete: all three artifact files exist and pass syntax verification
- Phase 13 (tests) can now implement `tests/impact.bats` against `scripts/impact.sh`
- Any phase calling `list_siblings` or `discover_siblings` will get the correct implementation
- Functional end-to-end validation requires a live Claude session with `--plugin-dir` pointing to this repo

---
*Phase: 09-impact-skill*
*Completed: 2026-03-15*
