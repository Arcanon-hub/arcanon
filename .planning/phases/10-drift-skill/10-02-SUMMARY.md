---
phase: 10-drift-skill
plan: 02
subsystem: skills
tags: [drift, openapi, oasdiff, yq, bash, type-checking, cross-repo]

# Dependency graph
requires:
  - phase: 10-drift-skill/10-01
    provides: drift-common.sh helpers and drift-versions.sh foundation
  - phase: 02-shared-libraries
    provides: lib/siblings.sh sibling repo discovery
provides:
  - drift-types.sh — heuristic same-language type consistency checker
  - drift-openapi.sh — OpenAPI spec comparison with oasdiff and yq fallback
  - Complete drift skill (SKILL.md + 3 scripts + common lib)
affects: [drift skill consumers, allclear drift command]

# Tech tracking
tech-stack:
  added: [oasdiff (optional), yq (optional, graceful fallback)]
  patterns:
    - Language-scoped type comparison (no cross-language noise)
    - Hub-and-spoke comparison for >5 repos to limit execution time
    - Tool availability detection with graceful degradation (oasdiff > yq > informational)

key-files:
  created:
    - skills/drift/scripts/drift-types.sh
    - skills/drift/scripts/drift-openapi.sh
  modified: []

key-decisions:
  - "Type checking scoped to same-language repos by default (TS/TS, Go/Go) — prevents cross-language false positives"
  - "OpenAPI comparison uses oasdiff for $ref resolution when available; falls back to yq structural diff clearly labeled as degraded"
  - "Hub-and-spoke comparison pattern for >5 repos to keep drift openapi execution under 30s"
  - "Cap type names at 50 per repo and maxdepth 4 to prevent slow scans on large repos"

patterns-established:
  - "Tool availability pattern: command -v oasdiff > command -v yq > informational message"
  - "Language detection from manifest files (package.json/go.mod/pyproject.toml/Cargo.toml)"
  - "Heuristic type body extraction via awk with language-specific brace/dedent tracking"

requirements-completed: [DRFT-02, DRFT-03]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 10 Plan 02: Drift Skill Type and OpenAPI Checkers Summary

**Heuristic same-language type definition checker and oasdiff-powered OpenAPI spec comparison with graceful yq fallback completing the full drift skill**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T10:08:16Z
- **Completed:** 2026-03-15T10:11:30Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- drift-types.sh extracts exported types from TypeScript, Go, Python, and Rust repos using language-specific grep patterns; compares fields of shared type names within same-language repo groups only
- drift-openapi.sh discovers OpenAPI specs across 12 candidate locations, uses oasdiff for breaking-change detection when available, falls back to yq structural diff labeled as degraded, emits INFO when neither tool present
- Hub-and-spoke comparison strategy for >5 repos prevents exponential comparison time
- Both scripts source drift-common.sh for shared emit_finding and severity filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create drift-types.sh** - `870ec13` (feat)
2. **Task 2: Create drift-openapi.sh** - `2157f6f` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified

- `skills/drift/scripts/drift-types.sh` — language detection, per-language type extractors (TS/Go/Python/Rust), same-language grouping, field diff comparison
- `skills/drift/scripts/drift-openapi.sh` — spec discovery (12 candidates + fallback find), oasdiff structured comparison, yq structural diff fallback, hub-and-spoke for large repo sets

## Decisions Made

- Scoped type checks to same-language repos by default (TS vs TS, Go vs Go) — per research Pitfall 4, cross-language comparison produces noise because type names like `User` and `Order` appear independently in every language ecosystem
- OpenAPI comparison never does raw YAML diff (research Pitfall 3: $ref not resolved) — always uses oasdiff or explicitly labels comparison as degraded
- Hub-and-spoke for >5 repos: comparing all pairs is O(n^2); with 10+ repos this becomes slow. Comparing each against the first repo limits to O(n) while still surfacing major divergence
- Cap at 50 type names per repo: prevents drift types from becoming a 60-second operation on large repos (research Pitfall 5)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Executed prerequisite plan 10-01 Task 2 (drift-versions.sh)**
- **Found during:** Pre-execution dependency check
- **Issue:** Plan 10-02 depends_on 10-01, but drift-versions.sh had not been committed (plan 01 was only half-executed: SKILL.md and drift-common.sh were committed but drift-versions.sh was missing)
- **Fix:** Created and committed drift-versions.sh as part of completing plan 10-01 before proceeding with plan 10-02
- **Files modified:** skills/drift/scripts/drift-versions.sh
- **Verification:** bash -n passes; git log confirms commit dfcde91
- **Committed in:** dfcde91

---

**Total deviations:** 1 auto-fixed (1 blocking — missing prerequisite)
**Impact on plan:** Required fix to unblock plan 10-02 execution. Completed plan 10-01 as specified before proceeding.

## Issues Encountered

- Plan 10-01 was only partially executed before this session (SKILL.md and drift-common.sh committed, drift-versions.sh missing). Resolved by completing plan 10-01 first under deviation Rule 3.
- lib/siblings.sh exports both `list_siblings` (primary) and `discover_siblings` (alias) — plan 02 context referenced `list_siblings` which is the correct primary function.

## Self-Check: PASSED

- skills/drift/scripts/drift-types.sh: FOUND
- skills/drift/scripts/drift-openapi.sh: FOUND
- commit 870ec13 (drift-types.sh): FOUND
- commit 2157f6f (drift-openapi.sh): FOUND

## Next Phase Readiness

- Complete drift skill is ready: SKILL.md + drift-common.sh + drift-versions.sh + drift-types.sh + drift-openapi.sh
- All 6 DRFT requirements (DRFT-01 through DRFT-06) are now covered across plans 01 and 02
- drift types is heuristic — field extraction depends on source code being in expected directories (src/ for TS, project root for Go)
- No external dependencies required for core operation; oasdiff and yq are optional enhancements

---
*Phase: 10-drift-skill*
*Completed: 2026-03-15*
