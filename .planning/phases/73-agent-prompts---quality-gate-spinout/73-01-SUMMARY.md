---
phase: 73-agent-prompts---quality-gate-spinout
plan: 01
subsystem: agent-prompts
tags: [agent-prompts, findings, validation, warnings, source_file]

# Dependency graph
requires:
  - phase: 72-detail-panel-ui
    provides: detail panel that surfaces source_file for file-level impact display
provides:
  - source_file REQUIRED guidance in agent-prompt-service.md and agent-prompt-library.md
  - validateFindings() returning { valid, findings, warnings } with null source_file diagnostics
affects: [manager.js, scanRepos, MCP impact responses]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Agent prompt structured requirement sections placed immediately before ## Example for discoverability"
    - "Soft validation pattern: warnings array alongside findings — scan completes, operator can diagnose"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/agent-prompt-service.md
    - plugins/ligamen/worker/scan/agent-prompt-library.md
    - plugins/ligamen/worker/scan/findings.js
    - plugins/ligamen/worker/scan/findings.test.js

key-decisions:
  - "source_file null produces a warning (not a hard validation error) — scan always completes per plan requirement"
  - "warnings array always present on valid:true result (empty array when no nulls) — callers never need to null-check"
  - "FindingsResult typedef updated to reflect new { valid: true, findings, warnings: string[] } shape"

patterns-established:
  - "Structured warnings in validator: soft signal separate from hard validity — enables operator diagnostics without blocking scans"

requirements-completed: [AGENT-01, AGENT-02]

# Metrics
duration: 12min
completed: 2026-03-22
---

# Phase 73 Plan 01: Agent Prompts & source_file Quality Gate Summary

**Added explicit source_file REQUIRED section to both agent scan prompts and soft-warning array to validateFindings() so null call sites are diagnosed without blocking scans**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-22T11:20:00Z
- **Completed:** 2026-03-22T11:32:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Both agent scan prompts (service and library) now have a "## source_file Requirement" section explaining the field is REQUIRED, the expected format, and the only valid reason to emit null
- validateFindings() now returns `{ valid: true, findings, warnings: string[] }` where each connection with `source_file === null` appends a diagnostic message
- FindingsResult JSDoc typedef updated to reflect the expanded shape
- 3 new test cases added and all 32 tests pass (29 pre-existing + 3 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add source_file requirement guidance to prompts** - `9fb1da4` (feat)
2. **Task 2 RED: Failing tests for source_file null warnings** - `81f4496` (test)
3. **Task 2 GREEN: Implement warnings in validateFindings** - `e70bc5d` (feat)

**Plan metadata:** (docs commit — see final commit below)

_Note: TDD tasks have multiple commits (test RED → feat GREEN)_

## Files Created/Modified

- `plugins/ligamen/worker/scan/agent-prompt-service.md` - Added "## source_file Requirement" section before "## Example"
- `plugins/ligamen/worker/scan/agent-prompt-library.md` - Added identical section before "## Example"
- `plugins/ligamen/worker/scan/findings.js` - Updated ok() helper with warnings param, added null source_file warning loop, updated typedef
- `plugins/ligamen/worker/scan/findings.test.js` - Added 3 new tests for null source_file warning behavior

## Decisions Made

- `source_file: null` produces a warning, not a hard error — scan always completes (plan requirement: "Hard validation is NOT triggered by null source_file")
- warnings array is always present on valid:true results (empty array, not undefined) — callers can safely do `result.warnings.length` without null checking
- Warning message format: `"connection[N].source_file is null — agent did not identify call site"` — includes index for easy triage

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — the grep acceptance criteria in the plan used `source_file is **REQUIRED**` but the actual inserted text is `source_file\` on every connection is **REQUIRED**`. The broader automated verify pattern (`source_file.*REQUIRED`) matched correctly and both files contain the required section.

## Next Phase Readiness

- Prompt guidance is live — agents scanning repos will now see source_file as REQUIRED with format examples
- validateFindings() callers (manager.js / scanRepos) can now inspect `result.warnings` to log or surface null source_file diagnostics to operators
- Ready for Phase 73 Plan 02

---
*Phase: 73-agent-prompts---quality-gate-spinout*
*Completed: 2026-03-22*

## Self-Check: PASSED

- FOUND: plugins/ligamen/worker/scan/agent-prompt-service.md
- FOUND: plugins/ligamen/worker/scan/agent-prompt-library.md
- FOUND: plugins/ligamen/worker/scan/findings.js
- FOUND: plugins/ligamen/worker/scan/findings.test.js
- FOUND: .planning/phases/73-agent-prompts---quality-gate-spinout/73-01-SUMMARY.md
- FOUND commit 9fb1da4: feat(73-01): add source_file requirement section to agent scan prompts
- FOUND commit 81f4496: test(73-01): add failing tests for source_file null warnings
- FOUND commit e70bc5d: feat(73-01): add source_file null warnings to validateFindings
