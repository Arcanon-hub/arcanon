---
gsd_state_version: 1.0
milestone: v0.1.3
milestone_name: Trust & Foundations
status: in_progress
stopped_at: Completed 108-01-PLAN.md
last_updated: "2026-04-25T14:18:00.000Z"
last_activity: "2026-04-25 — Plans 107-02 + 108-01 landed in parallel: install-deps.sh sentinel/validation; update.sh --check offline gate decoupled from refresh-process timeout (THE-1027)"
progress:
  total_phases: 32
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-25)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** v0.1.3 Trust & Foundations — install architecture cleanup, scan trust hardening, deprecated command removal, update-check timeout fix

## Current Position

Phase: 107 Install Architecture Cleanup (in progress, Wave 1)
Plan: 107-02 complete (1 commit); next up 107-03 bats test rewrite
Status: 2/14 plans complete; INST-01..06 marked done in REQUIREMENTS.md
Last activity: 2026-04-25 — Plan 107-02 landed: install-deps.sh rewritten with sha256 sentinel + binding-load validation + npm rebuild fallback (INST-02..05)

## v0.1.3 Phase Map

| Phase | Goal | Requirements |
|-------|------|--------------|
| 107 | Install Architecture Cleanup — drop runtime-deps.json, sentinel + binding-load validation, simplified mcp-wrapper.sh | INST-01..12 (12) |
| 108 | Update-check Timeout Fix + `/arcanon:upload` Removal | UPD-01..06, DEP-01..06 (12) |
| 109 | Path Canonicalization + Evidence at Ingest (migration 013) | TRUST-02, 03, 10, 11 (4) |
| 110 | services.base_path End-to-End (migration 012) | TRUST-04, 12 (2) |
| 111 | Quality Score + Reconciliation Audit Trail (migrations 014, 015) | TRUST-05, 06, 13, 14 (4) |
| 112 | `/arcanon:verify` Command | TRUST-01, 07, 08, 09 (4) |
| 113 | Verification Gate (release pin) | VER-01..07 (7) |

**Wave-able phases (can run in parallel within constraints):**

- Phase 108 is independent of Phase 107 once Phase 107 lands the install path
- Phases 110/111/112 each depend on Phase 109 landing first (migration 013 path_template)
- Phase 113 always last

## Performance Metrics

**Velocity:**

- Total plans completed: 195 (v1.0–v5.8.0 + v0.1.0 + v0.1.1 12 plans + v0.1.2 9 plans + v0.1.3 2 plans)
- Total milestones shipped: 21 (Ligamen v1.0–v5.8.0 + Arcanon v0.1.0 + v0.1.1 + v0.1.2)
- v0.1.3 in progress: 7 phases planned, 14 plans drafted, 2 plans complete (107-01, 107-02)

| Phase | Plan | Tasks | Files | Duration |
| ----- | ---- | ----- | ----- | -------- |
| 107   | 01   | 2     | 2     | ~5 min   |
| 107   | 02   | 1     | 1     | ~3 min   |
| Phase 108 P01 | 10 min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

- **v0.1.3 scope:** Two High-priority Linear tickets (THE-1022 scan trust, THE-1028 install architecture) plus THE-1027 (update-check 5s timeout) plus DEP cleanup (`/arcanon:upload` removal). Not bundling THE-1023..1026 — those go to v0.1.4 / v0.1.5.
- **`/arcanon:upload` removal brought forward from v0.2.0 → v0.1.3.** v0.1.2 already shipped a breaking change (LIGAMEN_* purge); one more removal in the same wave is consistent. Documented in CHANGELOG `### BREAKING`.
- **THE-1028 supersedes runtime-deps.json.** Single source of truth = `package.json`. Drop runtime-deps.json entirely. The `--omit=dev` flag already gives runtime-only behavior.
- **Validate, don't guess.** install-deps.sh and mcp-wrapper.sh's file-existence checks are replaced with `require("better-sqlite3")` validation. Fixes Node 25 binding bug class permanently.
- **Phase ordering trades migration grouping for REQ atomicity.** Migrations 012-015 each ship in the same phase as the runtime code that exercises them, so each REQ maps to exactly one phase. Phase 109 lands migration 013 + path canonicalization writes; Phase 110 lands migration 012 + base_path scan/resolution; Phase 111 lands migrations 014 + 015 + their wiring. Cleaner than splitting "all migrations first."
- **`/arcanon:verify` lives in Phase 112 (after data-shape phases).** The verify command reads scan data + connections.path_template + persisted evidence; depends on data shape stabilizing. Independent of Phase 110 (base_path) and Phase 111 (quality_score) but ordered after for stable test fixtures.
- Phase 107-01 complete: runtime-deps.json deleted, mcp-wrapper.sh trimmed to 12 lines (INST-01, INST-06)
- Phase 107-02 complete: install-deps.sh rewritten with sha256 sentinel + binding-load validation + npm rebuild fallback (INST-02..05)
- Plan 108-01 (THE-1027) complete: --check offline gate is now file-existence based (UPD-01..06)

### Pending Todos

- Run `/gsd-plan-phase 107` to draft plans for the install-architecture cleanup phase

### Blockers/Concerns

- 2 pre-existing node test failures unrelated to v0.1.2 (`server-search.test.js` queryScan drift, `manager.test.js` incremental prompt mock) — filed for a future milestone.
- PreToolUse hook p99 latency on macOS is 130ms vs the 50ms Linux target — documented caveat, not a regression.
- `/arcanon:update --check` 5s timeout addressed by THE-1027 in this milestone (Phase 108).

## Session Continuity

Last session: 2026-04-25T12:13:44.689Z
Stopped at: Completed 108-01-PLAN.md
Resume file: None
