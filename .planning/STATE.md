---
gsd_state_version: 1.0
milestone: v5.8.0
milestone_name: Library Drift & Language Parity
status: executing
stopped_at: Completed 95-shell-cleanup-dispatcher-95-02-PLAN.md
last_updated: "2026-04-19T16:18:06.249Z"
last_activity: 2026-04-19
progress:
  total_phases: 32
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Phase 95 — Shell Cleanup + Unified Dispatcher

## Current Position

Phase: 95 (Shell Cleanup + Unified Dispatcher) — EXECUTING
Plan: 3 of 3
Status: Ready to execute
Last activity: 2026-04-19

Progress: [          ] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 156 (across v1.0–v5.7.0)
- Total milestones shipped: 18

## Accumulated Context

### Decisions

(Cleared — see PROJECT.md Key Decisions table for full history)

- [Phase 92-manifest-parsers]: MANAGED sentinel chosen over silent drop for unresolved Maven/NuGet versions — preserves row visibility in drift output
- [Phase 92-manifest-parsers]: Separate tmpfiles per Gradle DSL branch to avoid cross-contamination when build.gradle and build.gradle.kts co-exist
- [Phase 92-manifest-parsers]: detect_language uses csharp token; detect_project_type uses dotnet token — matches CLI naming convention
- [Phase 92-manifest-parsers]: compgen -G used for .csproj/.sln glob detection in detect_project_type (bash builtin, no subprocess)
- [Phase 92-manifest-parsers]: drift-types.sh: added --test-only guard (mirrors drift-versions.sh) to allow bats sourcing without triggering main loop under set -euo pipefail
- [Phase 92-manifest-parsers]: C# partial class limitation documented as code comment only — cross-file merging deferred per Pitfall 13, out of Phase 92 scope
- [Phase 92-manifest-parsers]: Fixtures contain only minimum files to trigger exactly one parser each — no cross-ecosystem contamination
- [Phase 92-manifest-parsers]: Rule 1 bug fix: Maven relativePath extraction RSTART+15 was off-by-one (tag is 14 chars) — fixed to RSTART+14 so ../pom.xml resolves correctly
- [Phase 93-dep-collector]: Migration 010: CREATE TABLE IF NOT EXISTS for idempotency, no hasCol() guards; 4-col UNIQUE includes manifest_file (NOT NULL) to handle mono-repo same-package-in-multiple-manifests; dep_kind column present in v5.8.0 schema despite only writing 'direct' (transient deferred to v5.9 per PITFALLS P6); ON DELETE CASCADE from services(id) means endScan() needs no new dep cleanup code
- [Phase 93-dep-collector]: ON CONFLICT DO UPDATE (not INSERT OR REPLACE) preserves row IDs across re-scans — chosen for DEP-08 row-id stability contract
- [Phase 93-dep-collector]: No deleteStaleDependencies() helper — ON DELETE CASCADE from services(id) handles dep cleanup automatically via endScan()
- [Phase 93-dep-collector]: runMigrations() in test seedDb() instead of partial migration chain — QueryEngine constructor requires all migrations for unconditional prepared statements
- [Phase 93-dep-collector]: Poetry regex: replaced \z (Perl/Ruby) with JS-compatible end-of-string match
- [Phase 93-dep-collector]: ecosystems_scanned pushed even for empty-dep manifests — found+parsed without error is a valid scanned state
- [Phase 95-shell-cleanup-dispatcher]: drift.sh uses bash subprocess (not source) to preserve DSP-03 direct-invocation regression contract
- [Phase 95-shell-cleanup-dispatcher]: Reserved slots licenses|security exit 2 (distinct from unknown=1) to differentiate reserved vs typo
- [Phase 95-shell-cleanup-dispatcher]: worker-start.sh calls should_restart_worker (not restart_worker_if_stale) to avoid recursive worker_start_background spawn

### Pending Todos

None.

### Blockers/Concerns

- Hub companion THE-1018 must land separately for end-to-end library drift. Plugin can ship payload v1.1 independently (hub accepts both v1.0 and v1.1 per ticket).

## Session Continuity

Last session: 2026-04-19T16:18:06.245Z
Stopped at: Completed 95-shell-cleanup-dispatcher-95-02-PLAN.md
Resume file: None
