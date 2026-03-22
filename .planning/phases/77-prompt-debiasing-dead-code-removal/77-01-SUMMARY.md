---
phase: 77-prompt-debiasing-dead-code-removal
plan: "01"
subsystem: scan-agent-prompts
tags: [prompts, dead-code, multi-language, discovery-context, SARC-02, SARC-03]
dependency_graph:
  requires: [76-01]
  provides: [type-specific-prompts-with-discovery-context, debiased-language-examples]
  affects: [scan-pipeline, agent-prompt-interpolation]
tech_stack:
  added: []
  patterns: [type-specific-prompt-selection, discovery-context-injection]
key_files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/agent-prompt-common.md
    - plugins/ligamen/worker/scan/agent-prompt-service.md
    - plugins/ligamen/worker/scan/agent-prompt-library.md
    - plugins/ligamen/worker/scan/agent-prompt-infra.md
    - plugins/ligamen/worker/scan/manager.js
    - plugins/ligamen/worker/scan/manager.test.js
  deleted:
    - plugins/ligamen/worker/scan/agent-prompt-deep.md
decisions:
  - "Type-specific prompt selection in manager.js: repoType === 'library' ? promptLibrary : repoType === 'infra' ? promptInfra : promptService"
  - "agent-prompt-deep.md deleted — its Discovery Context section migrated to all three active prompts"
  - "SARC-02 test uses discovery/deep-scan prompt discrimination via 'Discovery Agent' phrase check"
metrics:
  duration: "3m 30s"
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 7
---

# Phase 77 Plan 01: Prompt Debiasing and Dead Code Removal Summary

**One-liner:** Debiased scan prompts with Java/C#/Ruby/Kotlin examples, added {{DISCOVERY_JSON}} Discovery Context to all three active prompts, deleted agent-prompt-deep.md, and wired type-specific prompt selection into manager.js (replacing promptDeep).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Expand confidence examples and add Discovery Context sections | 948e5c9 | agent-prompt-common.md, agent-prompt-service.md, agent-prompt-library.md, agent-prompt-infra.md |
| 2 | Remove dead code (promptDeep + agent-prompt-deep.md) and add SARC-02 tests | 1d9fa85 | manager.js, manager.test.js, (deleted) agent-prompt-deep.md |

## What Was Built

**Task 1 — Prompt debiasing:**
- `agent-prompt-common.md`: HIGH confidence examples expanded from 2 Python/JS-only lines to 7 language-specific examples covering Python Flask, Node.js Express, Java Spring Boot (`@RestController`), C# ASP.NET Core (`[HttpGet]`), Ruby on Rails (`get '/users'`), Kotlin Ktor/Spring Boot (`fun getUsers()`), and event producers.
- All three active prompts (service, library, infra) received an identical Discovery Context section immediately after `{{COMMON_RULES}}`, containing a `{{DISCOVERY_JSON}}` placeholder and a fallback instruction for pre-Phase-76 safety.

**Task 2 — Dead code removal and prompt wiring:**
- `agent-prompt-deep.md` (473 lines) deleted from the repository.
- `manager.js`: removed 2 dead-code lines (comment + `const promptDeep = readFileSync(...)`).
- `manager.js`: replaced `promptDeep` usage in scan loop with ternary type-specific selection (`promptLibrary` / `promptInfra` / `promptService` based on `detectRepoType()` result). The comment was updated to reference SARC-03.
- `manager.test.js`: added new `describe("scanRepos — SARC-02 prompt content")` block with a full integration test that runs `scanRepos()`, captures the interpolated prompt, and asserts: `@RestController`, `[HttpGet`, `get '/users'`, `fun getUsers()`, DISCOVERY_JSON presence, and fallback instruction.

## Verification Results

1. `grep "@RestController" agent-prompt-common.md` — PASS
2. `grep "DISCOVERY_JSON" agent-prompt-service/library/infra.md` — all three PASS
3. `grep "fall back to scanning all files" agent-prompt-service.md` — PASS
4. `test ! -f agent-prompt-deep.md` — PASS (file deleted)
5. `grep -c "promptDeep" manager.js` — 0 (PASS)
6. SARC-02 test: PASS (4.8ms)
7. Full test suite: same 3 pre-existing failures from 78-01 TDD RED phase (retry-once tests); no new failures introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Wired type-specific prompt selection in manager.js scan loop**

- **Found during:** Task 2
- **Issue:** Plan specified removing the `promptDeep` declaration (2 lines) but `promptDeep` was also used at line 529 in the scan loop. Simply deleting the declaration would cause a ReferenceError at runtime. The old comment at line 523 explicitly noted "SARC-03 will clean up type-specific prompts" — this IS that cleanup.
- **Fix:** Replaced `promptDeep` usage with a ternary expression selecting `promptLibrary`, `promptInfra`, or `promptService` based on `detectRepoType()` result. Also updated the comment from "for informational logging" to "and select type-specific prompt (SARC-03)".
- **Files modified:** `plugins/ligamen/worker/scan/manager.js`
- **Commit:** 1d9fa85

## Self-Check: PASSED

Files created/modified:
- FOUND: plugins/ligamen/worker/scan/agent-prompt-common.md
- FOUND: plugins/ligamen/worker/scan/agent-prompt-service.md
- FOUND: plugins/ligamen/worker/scan/agent-prompt-library.md
- FOUND: plugins/ligamen/worker/scan/agent-prompt-infra.md
- FOUND: plugins/ligamen/worker/scan/manager.js
- FOUND: plugins/ligamen/worker/scan/manager.test.js
- CONFIRMED DELETED: plugins/ligamen/worker/scan/agent-prompt-deep.md

Commits:
- FOUND: 948e5c9 (feat(77-01): expand prompt examples and add Discovery Context sections)
- FOUND: 1d9fa85 (feat(77-01): remove promptDeep dead code, add SARC-02 test, wire type-specific prompts)
