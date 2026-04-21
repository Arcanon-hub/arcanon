---
gsd_state_version: 1.0
milestone: v0.1.1
milestone_name: Command Cleanup + Update + Ambient Hooks
status: executing
stopped_at: Completed 100-impact-hook/100-03-PLAN.md
last_updated: "2026-04-21T19:40:59.987Z"
last_activity: 2026-04-21
progress:
  total_phases: 36
  completed_phases: 3
  total_plans: 12
  completed_plans: 11
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Phase 100 — PreToolUse Impact Hook

## Current Position

Phase: 100 (PreToolUse Impact Hook) — EXECUTING
Plan: 4 of 4
Status: Ready to execute
Last activity: 2026-04-21

Progress: [█████████░] 92%

## Performance Metrics

**Velocity:**

- Total plans completed: 172 (across v1.0–v5.8.0 rolled into v0.1.0)
- Total milestones shipped: 19 (Ligamen v1.0–v5.7.0 + v5.8.0 + Arcanon v0.1.0)

## Accumulated Context

### Decisions

(Cleared — see PROJECT.md Key Decisions table for full history)

- [v0.1.1]: Merge `/arcanon:upload` into `/arcanon:sync` — sync becomes the reconciliation verb; upload goes away. Rationale: "sync" correctly models the bidirectional reconcile-with-hub semantics; "upload" is only a special case.
- [v0.1.1]: Kill `/arcanon:cross-impact` outright — docs already mark it legacy and prefer `/arcanon:impact`. No backward compat burden since v0.1.0 just shipped.
- [v0.1.1]: Defer skills and agents to v0.2.0 — ship hooks first to observe real firing behavior before designing skills that layer on top.
- [v0.1.1]: PreToolUse hook fires on service-load-bearing files (`*.proto`, `openapi.*`, known service entry-points from impact-map) — deterministic, testable, doesn't depend on Claude's probabilistic skill matching.
- [v0.1.1]: `/arcanon:update` is opt-in: checks remote, asks user, then applies cleanly (reinstall + kill stale worker + prune cache + verify). Addresses the v6.0.0 → v0.1.0 stale-worker incident directly.
- Merge-then-delete sequencing for cross-impact: absorb all capabilities into impact.md first (Wave 1), then delete cross-impact.md (Wave 2) gated on bats serialization guard
- upload.md stub shells into hub.sh upload (not hub.sh sync) to preserve exact v0.1.0 code path for one version until v0.2.0
- Deprecated stub pattern established: [DEPRECATED] frontmatter + printf >&2 + $ARGUMENTS passthrough + v0.2.0 removal anchor
- Use typeof newKey !== 'undefined' (not ??) to preserve false values in two-read config fallback
- Guard hub.js main() behind import.meta.url === process.argv[1] to enable ESM import in tests
- 97-01: Outright kill of /arcanon:cross-impact with no migration stub — /arcanon:impact is canonical, docs already mark cross-impact legacy
- semver present transitively in node_modules — no package.json edit needed for 98-01
- claude plugin update --yes flag absent — 98-02 must handle interactive reinstall prompt
- node exit-code capture via || NODE_EXIT=$? guards ERR trap on intentional non-zero exits
- Kill-only semantics: update.sh --kill never calls restart_worker_if_stale or worker_start_background (Anti-Pattern 2 guard)
- --yes absent: reinstall uses claude plugin update arcanon --scope user without --yes per 98-01 pre-flight confirmation
- lsof +D detects open directory handles (cwd of a process), not open file handles — tail -f does NOT trigger it; tests must use (cd dir && sleep) to hold a genuine directory FD
- --verify always exits 0 regardless of poll outcome (Pitfall 11 graceful failure); caller reads .status to format user message
- Subshell capture pattern for ARCANON_ENRICHMENT block: entire block runs in $(...) subshell preserving set -euo pipefail discipline; failures exit silently via exit 0
- Stale prefix appended to ENRICHMENT suffix (not full context string): banner reads 'Arcanon active. Commands: ... [stale map — last scanned 3d ago] 5 services mapped.'
- systemMessage is the PreToolUse output key for soft-warns (not additionalContext)
- printf '%s' (no newline) used for sha256 input to match JS hash byte-for-byte
- root_path in production DBs is always relative; Plan 03 joins repos.path for absolute match
- systemMessage + exit 0 is the PreToolUse soft-warn pattern (confirmed from file-guard.sh)
- _ms_now() validates date +%s%3N output before trusting it — macOS BSD date exits 0 with garbage
- Self-exclusion uses CLAUDE_PLUGIN_ROOT prefix match to prevent hook-storm during Arcanon dev
- TIER_2_ANCHOR comment placed after Tier 1 block for Plan 03 insertion without full-file scan
- root_path is always relative in production DBs (pre-flight Finding 3): JOIN repos.path to reconstruct absolute prefix
- Trailing-slash normalization prevents auth-legacy false-match: [[ FILE == ${prefix%/}/* ]] with single trailing slash
- Worker HTTP primary for consumer query; direct SQLite fallback when worker_running returns non-zero (HOK-04)
- jq @uri encoding for URL params (T-100-10) + sed s/'/''/g for SQLite interpolation (T-100-09)

### Pending Todos

None.

### Blockers/Concerns

- `/arcanon:update` depends on Claude Code CLI shape for plugin install/uninstall; if CLI changes, the command breaks. Mitigation: try CLI path first, fall back to "here are the manual commands" diagnostic if auto-flow fails.
- PreToolUse hook adds latency to Edit/Write on service files. Need to keep the impact-query path fast (<100ms target) via prepared SQLite statements.
- Phase 100 requires four empirical pre-flight validations before writing code: (1) `additionalContext` vs `systemMessage` output key for PreToolUse; (2) `db-path.sh` hash algorithm from `worker/lib/data-dir.js`; (3) `root_path` absolute vs relative convention in production DB; (4) `/impact` HTTP endpoint parameter signature from `worker/server/http.js`.

## Session Continuity

Last session: 2026-04-21T19:40:59.978Z
Stopped at: Completed 100-impact-hook/100-03-PLAN.md
Resume file: None
