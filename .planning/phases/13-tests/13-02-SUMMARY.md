---
phase: 13-tests
plan: 02
subsystem: testing
tags: [bats, bats-core, shell-testing, format-hook, lint-hook, path-stub-mocking, stdin-json]

# Dependency graph
requires:
  - phase: 13-01
    provides: bats infrastructure (submodules, test_helper) and structural validation tests
provides:
  - tests/format.bats — 16 bats tests covering TEST-01 (format per language) and TEST-07 (non-blocking guarantee)
  - tests/lint.bats — 13 bats tests covering TEST-02 (lint per language) and TEST-07 (non-blocking guarantee)
affects:
  - phase-3-format-hook
  - phase-4-lint-hook

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PATH-stub mocking: create executable in mktemp dir, prepend to PATH inline in bash -c"
    - "Stdin JSON injection: run bash -c \"printf '%s' '${json}' | bash '${SCRIPT}'\""
    - "Marker file invocation verification: stub touches a file, test asserts it exists"
    - "Non-blocking test pattern: assert_success regardless of formatter/linter exit code"

key-files:
  created:
    - tests/format.bats
    - tests/lint.bats
  modified: []

key-decisions:
  - "Tests are intentionally in RED state for tool-invocation cases — format.sh and lint.sh are placeholders that will be implemented in Phase 3/4"
  - "Non-blocking and skip tests pass because placeholder scripts already exit 0 unconditionally"
  - "PATH-stub marker pattern chosen over stderr capture to verify invocation — cleaner and hermetic"
  - "lint.bats systemMessage test asserts stdout contains 'systemMessage' key — will pass once lint.sh implements the warning JSON output"

patterns-established:
  - "Pattern: Stdin JSON injection via run bash -c with printf (avoids pipe/run precedence pitfall)"
  - "Pattern: Inline PATH stub mocking — PATH='${STUB_DIR}:${PATH}' inside bash -c string"
  - "Pattern: Marker file verification — stub touches file, test checks existence post-run"
  - "Pattern: Silent stdout assertion — assert_output empty for non-blocking hooks on success/skip"

requirements-completed:
  - TEST-01
  - TEST-02
  - TEST-07

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 13 Plan 02: Format and Lint Hook Tests Summary

**Bats test suite for PostToolUse hooks: 29 tests covering per-language invocation and unconditional exit-0 non-blocking guarantee for format.sh and lint.sh**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-15T10:08:35Z
- **Completed:** 2026-03-15T10:10:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created tests/format.bats with 16 @test blocks: 6 non-blocking (absent+crash), 6 per-language invocation with PATH stubs, 1 silent stdout, 3 skip generated dirs
- Created tests/lint.bats with 13 @test blocks: 6 non-blocking (absent+issues-found), 5 per-language invocation with PATH stubs, 1 systemMessage JSON output, 1 silent skip
- Both files exceed minimum line requirements (format.bats: 156 lines, lint.bats: 136 lines)
- Tests correctly in RED state for invocation/systemMessage cases pending Phase 3/4 implementation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create format.bats with per-language and non-blocking tests** - `6cf3f7a` (test)
2. **Task 2: Create lint.bats with per-language and non-blocking tests** - `7be74c1` (test)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `tests/format.bats` — 16 bats tests for format hook: non-blocking guarantee, per-language formatter invocation, silent stdout, skip generated dirs
- `tests/lint.bats` — 13 bats tests for lint hook: non-blocking guarantee, per-language linter invocation, systemMessage JSON output when issues found, silent skip

## Decisions Made

- Tests are intentionally in RED state for tool-invocation cases — scripts/format.sh and scripts/lint.sh are placeholder stubs that exit 0 without calling any real tools; these tests will turn green when Phase 3 (format) and Phase 4 (lint) implement the scripts
- PATH-stub marker pattern chosen to verify invocation — stubs touch a marker file, test asserts the file exists post-run; this is more reliable than asserting on stderr/stdout content
- systemMessage test for lint checks that `systemMessage` appears in stdout — this will pass when lint.sh implements the JSON warning output per ARCHITECTURE.md Pattern 1

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. bats-support and bats-assert submodules were already initialized (tests/test_helper/ populated from plan 13-01 infrastructure). Both test files ran cleanly against the placeholder scripts.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- tests/format.bats is ready to validate Phase 3 (format hook implementation) — 7 tests will turn green when format.sh runs ruff/rustfmt/prettier/gofmt per language
- tests/lint.bats is ready to validate Phase 4 (lint hook implementation) — 6 tests will turn green when lint.sh runs ruff/eslint/golangci-lint/cargo per language
- Run full suite: `tests/bats/bin/bats tests/format.bats tests/lint.bats`

---
*Phase: 13-tests*
*Completed: 2026-03-15*
