---
phase: 11-pulse-skill
plan: "01"
subsystem: pulse-skill
tags: [kubectl, health-check, version-comparison, skill, bash]
dependency_graph:
  requires: []
  provides: [skills/pulse/SKILL.md, scripts/pulse-check.sh]
  affects: [skills/pulse/]
tech_stack:
  added: []
  patterns: [skill-as-orchestration-prompt, sourceable-bash-library, PLGN-07-jq-pattern]
key_files:
  created:
    - scripts/pulse-check.sh
  modified:
    - skills/pulse/SKILL.md
decisions:
  - "Used scripts/pulse-check.sh as a sourceable library (not SKILL.md inline bash) to enable bats-core testability per PULS-02 through PULS-05"
  - "Port-forward uses fixed local port 18080 to avoid collision with common dev servers on 8080"
  - "Health endpoint priority order: /health, /healthz, /actuator/health, /ready (application-first, then k8s-style)"
metrics:
  duration: "2 minutes"
  completed: "2026-03-15"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 11 Plan 01: Pulse Skill Summary

**One-liner:** kubectl-based service health checker with port-forward multi-endpoint probing, jq status normalization, and git tag version drift detection.

## What Was Built

Two artifacts that together implement the `/allclear pulse` skill:

1. `scripts/pulse-check.sh` — a POSIX-compatible bash library with seven functions providing the full kubectl/curl/jq logic for health checking and version comparison. Sourced by the SKILL.md at runtime via `${CLAUDE_PLUGIN_ROOT}/scripts/pulse-check.sh`.

2. `skills/pulse/SKILL.md` — the Claude Code orchestration prompt with correct frontmatter (`disable-model-invocation: true`, `allowed-tools: Bash`, `argument-hint: "[environment] [service-name]"`). Contains eight numbered sections guiding Claude through kubectl availability check, argument parsing, deployment discovery, health checking, version comparison, table rendering, summary line, and error handling.

## Requirements Covered

| ID | Description | Covered By |
|----|-------------|-----------|
| PULS-01 | `/allclear pulse` checks health via kubectl | SKILL.md sections 1–5 + pulse_check_health |
| PULS-02 | Parses /health responses (JSON and plain-text) | pulse_check_health: jq PLGN-07 with HTTP-200 fallback |
| PULS-03 | Compares running version to latest git tag | pulse_get_image_tag + pulse_get_latest_git_tag |
| PULS-04 | Graceful skip when kubectl absent | pulse_check_kubectl returning 1 with clear message |
| PULS-05 | Targets specific environments via namespace | pulse_resolve_namespace + ENV_ARG argument parsing |

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create scripts/pulse-check.sh helper library | a00c6fd |
| 2 | Create skills/pulse/SKILL.md orchestration prompt | cc8cc19 |

## Deviations from Plan

None — plan executed exactly as written.

The plan specified a `scripts/pulse-check.sh` helper (separate from an inline SKILL.md approach considered in RESEARCH.md). The plan's approach was followed directly. The existing placeholder `skills/pulse/SKILL.md` (4 lines, no real content) was replaced with the full implementation.

## Verification Results

All 8 plan verification checks passed:

1. `bash -n scripts/pulse-check.sh` — PASS
2. `test -f skills/pulse/SKILL.md` — PASS
3. `grep -q 'name: pulse' skills/pulse/SKILL.md` — PASS
4. `grep -q 'disable-model-invocation: true' skills/pulse/SKILL.md` — PASS
5. `grep -q 'command -v kubectl' scripts/pulse-check.sh` — PASS
6. `grep -q 'pulse_check_health' scripts/pulse-check.sh` — PASS
7. `grep -q 'pulse_get_latest_git_tag' scripts/pulse-check.sh` — PASS
8. `grep -q 'pulse_resolve_namespace' scripts/pulse-check.sh` — PASS

## Self-Check: PASSED

- scripts/pulse-check.sh: FOUND
- skills/pulse/SKILL.md: FOUND
- .planning/phases/11-pulse-skill/11-01-SUMMARY.md: FOUND
- Commit a00c6fd: FOUND
- Commit cc8cc19: FOUND
