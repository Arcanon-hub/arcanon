# Roadmap: Ligamen

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- ✅ **v2.2 Scan Data Integrity** — Phases 27-29 (shipped 2026-03-16)
- ✅ **v2.3 Type-Specific Detail Panels** — Phases 30-32 (shipped 2026-03-18)
- ✅ **v3.0 Layered Graph & Intelligence** — Phases 33-38 (shipped 2026-03-18)
- ✅ **v4.0 Ligamen Rebrand** — Phases 39-45 (shipped 2026-03-20)
- 🚧 **v4.1 Command Cleanup** — Phases 46-48 (in progress)

## Phases

<details>
<summary>✅ v1.0 Plugin Foundation (Phases 1-13) — SHIPPED 2026-03-15</summary>

- [x] Phase 1-13: 5 commands, 4 hooks, shared libraries, 150+ tests

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v2.0 Service Dependency Intelligence (Phases 14-21) — SHIPPED 2026-03-15</summary>

- [x] Phase 14-21: 8 phases, 19 plans

Full details: `.planning/milestones/v2.0-ROADMAP.md`

</details>

<details>
<summary>✅ v2.1 UI Polish & Observability (Phases 22-26) — SHIPPED 2026-03-16</summary>

- [x] Phase 22-26: 5 phases, 11 plans

Full details: `.planning/milestones/v2.1-ROADMAP.md`

</details>

<details>
<summary>✅ v2.2 Scan Data Integrity (Phases 27-29) — SHIPPED 2026-03-16</summary>

- [x] Phase 27-29: 3 phases, 5 plans

Full details: `.planning/milestones/v2.2-ROADMAP.md`

</details>

<details>
<summary>✅ v2.3 Type-Specific Detail Panels (Phases 30-32) — SHIPPED 2026-03-18</summary>

- [x] Phase 30-32: 3 phases, 5 plans

Full details: `.planning/milestones/v2.3-ROADMAP.md`

</details>

<details>
<summary>✅ v3.0 Layered Graph & Intelligence (Phases 33-38) — SHIPPED 2026-03-18</summary>

- [x] Phase 33-38: 6 phases, 11 plans

Full details: `.planning/milestones/v3.0-ROADMAP.md`

</details>

<details>
<summary>✅ v4.0 Ligamen Rebrand (Phases 39-45) — SHIPPED 2026-03-20</summary>

- [x] Phase 39-45: 7 phases, 14 plans — full allclear → ligamen rename across 91 files

Full details: `.planning/milestones/v4.0-ROADMAP.md`

</details>

### 🚧 v4.1 Command Cleanup (In Progress)

**Milestone Goal:** Remove Kubernetes-specific commands (pulse, deploy-verify) that don't fit the plugin's core focus, and add MCP drift query tools for cross-repo version/type/API mismatch intelligence.

- [x] **Phase 46: Command Removal** - Delete pulse and deploy-verify commands, scripts, and primary documentation (completed 2026-03-20)
- [ ] **Phase 47: Test and Doc Cleanup** - Remove pulse/deploy-verify test fixtures and sweep remaining doc references
- [ ] **Phase 48: MCP Drift Tools** - Add drift_versions, drift_types, and drift_openapi MCP query tools

## Phase Details

### Phase 46: Command Removal
**Goal**: The pulse and deploy-verify commands no longer exist in the plugin
**Depends on**: Phase 45 (v4.0 complete)
**Requirements**: REM-01, REM-02, REM-03
**Success Criteria** (what must be TRUE):
  1. Running `/ligamen:pulse` in Claude Code produces a "command not found" error — the command file is gone
  2. Running `/ligamen:deploy-verify` in Claude Code produces a "command not found" error — the command file is gone
  3. `scripts/pulse-check.sh` no longer exists in the repository
  4. README and docs no longer mention pulse or deploy-verify in any capability list or usage section
  5. The validated requirements list in PROJECT.md no longer includes pulse or deploy-verify entries
**Plans:** 2/2 plans complete

Plans:
- [ ] 46-01-PLAN.md — Delete pulse.md, deploy-verify.md, and pulse-check.sh
- [ ] 46-02-PLAN.md — Remove pulse/deploy-verify references from README.md, docs/commands.md, and .planning/PROJECT.md

### Phase 47: Test and Doc Cleanup
**Goal**: No test fixtures or documentation references to the removed commands remain
**Depends on**: Phase 46
**Requirements**: CLN-01, CLN-02
**Success Criteria** (what must be TRUE):
  1. The bats test suite runs with zero failures and contains no test files or test cases referencing pulse or deploy-verify
  2. A full-text search across the repository for "pulse" and "deploy-verify" returns zero results outside of git history
**Plans**: 1 plan

Plans:
- [ ] 47-01-PLAN.md — Remove pulse/deploy-verify from structure.bats, docs/architecture.md, docs/commands.md, scripts/session-start.sh, README.md

### Phase 48: MCP Drift Tools
**Goal**: Agents can query cross-repo dependency version, shared type, and OpenAPI spec mismatches via MCP
**Depends on**: Phase 46
**Requirements**: MCP-01, MCP-02, MCP-03
**Success Criteria** (what must be TRUE):
  1. An agent calling `drift_versions` via MCP receives a structured list of dependency version mismatches across scanned repos
  2. An agent calling `drift_types` via MCP receives a structured list of shared type/struct/interface mismatches across repos
  3. An agent calling `drift_openapi` via MCP receives a structured list of OpenAPI spec breaking changes across repos
  4. All three tools are registered in the MCP server manifest and appear in `impact_tools` alongside existing tools
**Plans**: 3 plans

Plans:
- [ ] 48-01-PLAN.md — Test scaffold + queryDriftVersions + drift_versions tool registration
- [ ] 48-02-PLAN.md — queryDriftTypes + drift_types tool registration
- [ ] 48-03-PLAN.md — queryDriftOpenapi + drift_openapi tool registration

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22-26 | v2.1 | 11/11 | Complete | 2026-03-16 |
| 27-29 | v2.2 | 5/5 | Complete | 2026-03-16 |
| 30-32 | v2.3 | 5/5 | Complete | 2026-03-18 |
| 33-38 | v3.0 | 11/11 | Complete | 2026-03-18 |
| 39-45 | v4.0 | 14/14 | Complete | 2026-03-20 |
| 46. Command Removal | 2/2 | Complete   | 2026-03-20 | - |
| 47. Test and Doc Cleanup | v4.1 | 0/1 | Not started | - |
| 48. MCP Drift Tools | v4.1 | 0/3 | Not started | - |
