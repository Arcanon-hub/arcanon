---
phase: 19-repo-discovery-user-confirmation
plan: "02"
subsystem: worker
tags: [confirmation-flow, user-trust-gate, tdd, esm]
dependency_graph:
  requires:
    - worker/scan-manager.js (Phase 18) — provides findings array as input
  provides:
    - worker/confirmation-flow.js — pure module: groupByConfidence, formatHighConfidenceSummary, formatLowConfidenceQuestions, applyEdits, buildConfirmationPrompt, MAX_LOW_CONFIDENCE
  affects:
    - Phase 20 command layer — must call db.writeScan() ONLY after this module returns confirmed findings
tech_stack:
  added: []
  patterns:
    - Pure functions (no I/O, no SQLite)
    - TDD with node:test + assert
    - ESM exports (matches project type:module)
    - Single-pass edit instruction parsing
key_files:
  created:
    - worker/confirmation-flow.js
    - worker/confirmation-flow.test.js
  modified: []
decisions:
  - ESM used instead of CommonJS specified in plan — project has "type":"module" in package.json; CommonJS would break import consistency
  - Tasks 1 and 2 committed as single implementation commit after both TDD cycles — single test file grew cumulatively per plan spec
  - applyEdits intentionally limited to remove/confirm — complex edits handled by Phase 20 interactive loop per design doc
metrics:
  duration: "110s"
  completed: "2026-03-15"
  tasks_completed: 2
  files_created: 2
  tests_added: 22
requirements_satisfied:
  - UCON-01
  - UCON-02
  - UCON-03
  - UCON-04
---

# Phase 19 Plan 02: Confirmation Flow Module Summary

Pure user-trust-gate module with confidence grouping, batch high-confidence review, low-confidence cap (10), free-form edit application, and full prompt assembly — no SQLite writes until Phase 20 calls db after confirmed findings are returned.

## Objective

Build `worker/confirmation-flow.js` — the trust boundary that prevents agent findings from entering the graph until a human has reviewed and approved them. All functions are pure (no I/O, no SQLite) so Phase 20's command layer retains full control of the persistence gate.

## What Was Built

### `worker/confirmation-flow.js`

Six exports implementing the full UCON-01 through UCON-04 requirements:

| Export | Purpose |
|--------|---------|
| `MAX_LOW_CONFIDENCE` | Integer constant (10) — cap for low-confidence review per session |
| `groupByConfidence(findings)` | Splits findings into `{high, low, lowOverflow}` — low capped at 10 |
| `formatHighConfidenceSummary(highFindings)` | Formats one-batch review grouped by repo path |
| `formatLowConfidenceQuestions(lowFindings)` | Returns per-finding question strings with evidence and intent question |
| `applyEdits(findings, editInstructions)` | Parses "confirm", "remove {service}", "remove connection X -> Y" |
| `buildConfirmationPrompt(grouped)` | Assembles full prompt with overflow notice when lowOverflow.length > 0 |

### `worker/confirmation-flow.test.js`

22 tests using `node:test` + `assert/strict`:
- 5 tests for `groupByConfidence` (empty, mixed, cap boundary, case-insensitive)
- 4 tests for `formatHighConfidenceSummary` (empty, confirm instruction, repo grouping, header counts)
- 3 tests for `formatLowConfidenceQuestions` (length, service names, empty)
- 6 tests for `applyEdits` (confirm no-op, case-insensitive confirm, empty no-op, remove service, case-insensitive remove, unrecognized)
- 4 tests for `buildConfirmationPrompt` (high present, only low, overflow notice, no overflow)

## Verification

```
node --test worker/confirmation-flow.test.js
22 pass, 0 fail
```

- All 6 required exports present and verified
- No `console.log` in executable code (only `process.stderr.write` for unrecognized edit warnings)
- Low-confidence cap: 15 findings → `low.length === 10`, `lowOverflow.length === 5`
- `applyEdits("confirm")` is a verified no-op

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Convention] ESM used instead of CommonJS**
- **Found during:** Task 1 implementation
- **Issue:** Plan spec said "CommonJS module" but `package.json` has `"type": "module"` — all other worker files use ESM `import`/`export` syntax
- **Fix:** Used ESM `export` declarations throughout `confirmation-flow.js`
- **Files modified:** worker/confirmation-flow.js (ESM from the start)
- **Impact:** None — correct behavior, consistent with codebase

## Commits

| Hash | Message |
|------|---------|
| `33d59ff` | `test(19-02): add failing tests for confirmation-flow grouping, formatting, edits, prompt` |
| `61a5d15` | `feat(19-02): implement confirmation-flow module — all 5 functions + MAX_LOW_CONFIDENCE` |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| worker/confirmation-flow.js | FOUND |
| worker/confirmation-flow.test.js | FOUND |
| commit 33d59ff | FOUND |
| commit 61a5d15 | FOUND |
