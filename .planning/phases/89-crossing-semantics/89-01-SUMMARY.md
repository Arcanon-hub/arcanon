---
phase: 89-crossing-semantics
plan: 01
subsystem: api
tags: [ligamen, scan, crossing, agent-prompt, semantics]

# Dependency graph
requires: []
provides:
  - "Three-value crossing semantics (internal/cross-service/external) defined in agent-prompt-common.md"
  - "All type-specific scan prompts (service, library, infra) use correct crossing values in examples"
affects: [89-02, 90-discovery-schema]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Crossing field in connection objects uses exactly one of: internal, cross-service, external"
    - "Default conservatively to external; reconciliation upgrades misclassified values post-scan"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/agent-prompt-common.md
    - plugins/ligamen/worker/scan/agent-prompt-service.md
    - plugins/ligamen/worker/scan/agent-prompt-library.md
    - plugins/ligamen/worker/scan/agent-prompt-infra.md

key-decisions:
  - "crossing enum: internal (same deployable unit), cross-service (linked repo service), external (third-party/outside project)"
  - "Conservative default: use external when uncertain; post-scan reconciliation corrects misclassifications"
  - "service prompt now demonstrates both cross-service (auth-service) and external (stripe-api) to give agents clear examples of both"

patterns-established:
  - "Crossing Semantics: every connection object requires a crossing field from the three-value enum"
  - "Agent prompts: common rules define semantics; type-specific prompts demonstrate with correct examples"

requirements-completed: [CROSS-01, CROSS-02]

# Metrics
duration: 5min
completed: 2026-03-23
---

# Phase 89 Plan 01: Crossing Semantics Definition Summary

**Three-value crossing enum (internal/cross-service/external) added to agent-prompt-common.md with corrected examples across all type-specific scan prompts**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-23T11:37:25Z
- **Completed:** 2026-03-23T11:42:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added "## Crossing Semantics" section to agent-prompt-common.md defining three values with decision table and conservative default rule
- Fixed service prompt: auth-service connection changed from external to cross-service, added stripe-api external example
- Fixed library prompt: event-journal connection changed from external to cross-service
- Fixed infra prompt: both payment-service connections changed from external to cross-service

## Task Commits

Each task was committed atomically:

1. **Task 1: Add crossing semantics definition to agent-prompt-common.md** - `6522ec8` (feat)
2. **Task 2: Fix crossing values in all three type-specific prompt examples** - `eb65cab` (feat)

## Files Created/Modified
- `plugins/ligamen/worker/scan/agent-prompt-common.md` - Added Crossing Semantics section between Evidence Requirement and Service Naming Convention
- `plugins/ligamen/worker/scan/agent-prompt-service.md` - auth-service to cross-service; added stripe-api external example
- `plugins/ligamen/worker/scan/agent-prompt-library.md` - event-journal to cross-service
- `plugins/ligamen/worker/scan/agent-prompt-infra.md` - both payment-service connections to cross-service

## Decisions Made
- Three-value enum chosen over boolean (external/internal): cross-service is semantically distinct from both truly-external third-party calls and truly-internal same-unit calls
- Conservative default (external) preferred: easier to upgrade a misclassification up to cross-service than to explain a false cross-service that was actually external

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 89-02 (post-scan reconciliation in map.md) can proceed immediately
- Crossing semantics definition is in place for agents to reference at scan time

---
*Phase: 89-crossing-semantics*
*Completed: 2026-03-23*
