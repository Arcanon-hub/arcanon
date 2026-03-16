---
phase: 27-schema-foundation-upsert-repair
plan: "02"
subsystem: scan
tags: [agent-prompt, naming-convention, service-identity, cross-repo]

# Dependency graph
requires: []
provides:
  - Naming convention rule in agent-prompt-deep.md that enforces manifest-derived, lowercase-hyphenated service names
  - Explicit disallow-list for generic names (server, worker, api, app, main, service, backend, frontend)
  - Disambiguation rule for repos whose manifest name is a blocked generic term
affects:
  - QueryEngine._resolveServiceId — consistent names prevent false identity merges in name-based lookup
  - Any future scan output — agent will now produce stable, collision-resistant service names

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Service names derived from package manifest (package.json name, pyproject.toml [project] name, go.mod module last segment, Cargo.toml [package] name)"
    - "Lowercase-hyphenated normalization: strip @scope/ prefix, lowercase, replace _ and spaces with -"
    - "Generic name block-list with path-based disambiguation suffix rule"

key-files:
  created: []
  modified:
    - worker/scan/agent-prompt-deep.md

key-decisions:
  - "Naming convention enforced at agent prompt level (cheapest fix — no schema or code change required)"
  - "Disallowed names: server, worker, api, app, main, service, backend, frontend — disambiguation via directory/module path suffix"
  - "Stability requirement: manifest name always used, never runtime hostname or container tag"

patterns-established:
  - "Service Naming Convention section placed between 'What NOT to Report' and 'Output Format' in agent prompt"

requirements-completed: [SCAN-04]

# Metrics
duration: 1min
completed: 2026-03-16
---

# Phase 27 Plan 02: Service Naming Convention Summary

**Agent scan prompt now enforces manifest-derived, lowercase-hyphenated service names with a generic-name block-list to prevent cross-repo false identity merges**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-16T14:53:31Z
- **Completed:** 2026-03-16T14:54:28Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added "## Service Naming Convention" section to `worker/scan/agent-prompt-deep.md` between "What NOT to Report" and "Output Format"
- Section documents manifest lookup rules for npm, Python, Go, and Rust ecosystems
- Section specifies lowercase-hyphenated format with transformation table and examples
- Section lists 8 disallowed generic names with path-based disambiguation rule
- Updated JSON schema `name` field description to reference the naming convention
- All other sections of the prompt left unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add service naming convention section to agent-prompt-deep.md** - `c3b1c4d` (feat)

**Plan metadata:** (final docs commit — see below)

## Files Created/Modified

- `worker/scan/agent-prompt-deep.md` - Added 57-line "Service Naming Convention" section and updated JSON schema name field description

## Decisions Made

- Naming convention enforced at agent prompt level only — no schema or code change required (cheapest fix, lowest risk)
- Block-list of 8 generic names (server, worker, api, app, main, service, backend, frontend) chosen based on common single-word service names that appear across multiple repos
- Disambiguation suffix derived from directory or module path rather than a registry lookup, keeping the rule self-contained for the scan agent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Agent prompt naming convention is in place; scan output will now produce stable, manifest-derived, collision-resistant service names
- `QueryEngine._resolveServiceId` name-based lookups will benefit from consistent naming once repos are re-scanned
- No blockers for remaining Phase 27 plans

---
*Phase: 27-schema-foundation-upsert-repair*
*Completed: 2026-03-16*
