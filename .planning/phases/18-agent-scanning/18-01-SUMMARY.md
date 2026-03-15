---
phase: 18-agent-scanning
plan: 01
subsystem: scanning
tags: [agent-scanning, schema-validation, findings, json, node-test]

# Dependency graph
requires:
  - phase: 14-storage-foundation
    provides: SQLite schema with connections/schemas/fields tables that findings-schema.js mirrors
provides:
  - worker/agent-prompt.md — language-agnostic prompt template with confidence rules and output schema
  - worker/findings-schema.js — validateFindings() and parseAgentOutput() with zero external deps
  - worker/findings-schema.test.js — 29 unit tests via node:test
affects: [18-agent-scanning, 18-02-PLAN.md, scan-manager]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plain-object validation without external libraries (matches zero-dep constraint)"
    - "TDD with node:test built-in: RED commit (test file) then GREEN commit (implementation)"
    - "Fenced ```json block extraction via regex for agent output parsing"
    - "connections checked before service_name in validation order (per spec: validateFindings({}) yields 'missing required field: connections')"

key-files:
  created:
    - worker/agent-prompt.md
    - worker/findings-schema.js
    - worker/findings-schema.test.js
  modified: []

key-decisions:
  - "Validation order: connections array checked first so validateFindings({}) yields 'missing required field: connections' per spec (not service_name)"
  - "target_file is optional — if present must be string or null; absence is also valid"
  - "parseAgentOutput uses regex /```json\\s*\\n([\\s\\S]*?)\\n```/ to handle leading/trailing prose from verbose agents"
  - "agent-prompt.md prohibits inference: 'If you cannot find a literal string definition, do not report the endpoint'"

patterns-established:
  - "Prompt template pattern: {{TOKEN}} interpolation points replaced by scan-manager at runtime"
  - "Confidence contract: HIGH = literal string in source, LOW = inferred/dynamic"
  - "Evidence contract: every connection must include ≤3 line code snippet as direct citation"

requirements-completed: [SCAN-02, SCAN-03, SCAN-04, SCAN-08]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 18 Plan 01: Agent Scanning Contract Summary

**Agent prompt template + plain-object findings validator with zero dependencies, defining the scanning contract (confidence rules, evidence requirement, JSON schema) that all Phase 18 plans depend on.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-15T19:15:12Z
- **Completed:** 2026-03-15T19:18:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Language-agnostic agent prompt with `{{REPO_PATH}}` and `{{SERVICE_HINT}}` tokens, inline JSON schema, and explicit prohibition on inference without literal string definitions
- `validateFindings()` validates all required fields (service_name, confidence, services, connections, schemas), enum values (6 protocols, 2 confidence levels, 3 schema roles), and field-level types including `required` as boolean
- `parseAgentOutput()` extracts fenced ` ```json ``` ` blocks from agent prose output and pipes through validation
- 29 unit tests covering all documented behaviors, zero external dependencies

## Task Commits

Each task was committed atomically:

1. **Task 1: Agent prompt template** - `a071061` (feat) — agent-prompt.md with all required tokens and prohibitions
2. **Task 1 TDD RED** - `a071061` — (combined: prompt is not code, verification was inline)
3. **Task 2 TDD RED** - `2fece15` (test) — failing tests for findings-schema
4. **Task 2 TDD GREEN** - `c7b27a1` (feat) — findings-schema.js implementation

**Plan metadata:** *(this summary commit)*

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified

- `worker/agent-prompt.md` — Scanning instructions with confidence rules, evidence requirement, and full JSON schema outline
- `worker/findings-schema.js` — `validateFindings()` + `parseAgentOutput()` exports, JSDoc typedefs, zero dependencies
- `worker/findings-schema.test.js` — 29 tests via `node:test` + `node:assert/strict`

## Decisions Made

- Validation order puts `connections` check first so `validateFindings({})` returns `'missing required field: connections'` exactly as specified in the plan behavior contract
- `target_file` is optional (absent or null both accepted) — only source-side files are always known during scanning
- Regex `/```json\s*\n([\s\S]*?)\n```/` handles agents that produce leading prose before the JSON block (common hallucination pattern)
- Prompt explicitly states: "If you cannot find a literal string definition, do not report the endpoint" — hard prohibition, not a suggestion

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Node.js v25 processes `\!` in `-e` strings as a TypeScript escape; resolved by writing inline verification scripts to `.cjs` files and later using heredoc `--input-type=module` pattern instead of `node -e`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `worker/findings-schema.js` exports `validateFindings()` — ready to import in Plan 02 scan-manager as the first gate before persisting findings to SQLite
- `worker/agent-prompt.md` has `{{REPO_PATH}}` and `{{SERVICE_HINT}}` tokens — scan-manager replaces these at invocation time
- JSON shape in prompt matches `validateFindings()` expected shape exactly (verified by hand-tracing all required fields)

## Self-Check: PASSED

- worker/agent-prompt.md: FOUND
- worker/findings-schema.js: FOUND
- worker/findings-schema.test.js: FOUND
- 18-01-SUMMARY.md: FOUND
- Commit a071061: FOUND
- Commit 2fece15: FOUND
- Commit c7b27a1: FOUND

---
*Phase: 18-agent-scanning*
*Completed: 2026-03-15*
