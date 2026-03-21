# Roadmap: Ligamen

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- ✅ **v2.2 Scan Data Integrity** — Phases 27-29 (shipped 2026-03-16)
- ✅ **v2.3 Type-Specific Detail Panels** — Phases 30-32 (shipped 2026-03-18)
- ✅ **v3.0 Layered Graph & Intelligence** — Phases 33-38 (shipped 2026-03-18)
- ✅ **v4.0 Ligamen Rebrand** — Phases 39-45 (shipped 2026-03-20)
- ✅ **v4.1 Command Cleanup** — Phases 46-48 (shipped 2026-03-20)
- 🚧 **v5.0 Marketplace Restructure** — Phases 49-51 (in progress)

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

<details>
<summary>✅ v4.1 Command Cleanup (Phases 46-48) — SHIPPED 2026-03-20</summary>

- [x] Phase 46-48: 3 phases, 6 plans — K8s commands removed, MCP expanded to 8 drift tools

Full details: `.planning/milestones/v4.1-ROADMAP.md`

</details>

### 🚧 v5.0 Marketplace Restructure (In Progress)

**Milestone Goal:** Restructure the repo as a proper Claude Code marketplace plugin so end users can install via `claude plugin marketplace add` + `claude plugin install` without cloning.

- [x] **Phase 49: Directory Restructure** - Move all plugin files into `plugins/ligamen/`, leaving only repo-level files at root (completed 2026-03-21)
- [x] **Phase 50: Path and Install Updates** - Update all internal paths, imports, hooks references, README install instructions, and Makefile targets (completed 2026-03-21)
- [x] **Phase 51: Verification** - Confirm bats tests pass and marketplace install flow works end-to-end (completed 2026-03-21)

## Phase Details

### Phase 49: Directory Restructure
**Goal**: All plugin files live under `plugins/ligamen/` and only repo-level files remain at root
**Depends on**: Phase 48 (v4.1 complete)
**Requirements**: STR-01, STR-02
**Success Criteria** (what must be TRUE):
  1. `plugins/ligamen/` exists and contains commands/, hooks/, scripts/, worker/, lib/, skills/, .claude-plugin/, package.json, package-lock.json, and ligamen.config.json.example
  2. Root of the repo contains only README.md, LICENSE, Makefile, docs/, tests/, .planning/, and .mcp.json — no plugin source directories
  3. Git history is preserved for moved files (moved, not deleted and recreated)
**Plans**: 1 plan

Plans:
- [ ] 49-01-PLAN.md — Move all plugin source into plugins/ligamen/ via git mv, verify history preserved

### Phase 50: Path and Install Updates
**Goal**: All internal references, import paths, hooks.json entries, README install instructions, and Makefile targets are correct for the new `plugins/ligamen/` layout
**Depends on**: Phase 49
**Requirements**: PTH-01, PTH-02, PTH-03, INS-01, INS-02
**Success Criteria** (what must be TRUE):
  1. Shell scripts in `plugins/ligamen/scripts/` and `plugins/ligamen/lib/` resolve their internal `source` and relative path references without errors
  2. Worker JS files in `plugins/ligamen/worker/` resolve all `require`/`import` paths correctly from their new location
  3. `hooks.json` entries point to `plugins/ligamen/` script paths and Claude Code loads them without missing-file errors
  4. README installation section shows `claude plugin marketplace add` + `claude plugin install` as the primary install method
  5. `make install` and `make uninstall` run without errors using the new directory layout
**Plans**: 2 plans

Plans:
- [ ] 50-01-PLAN.md — Fix drift-common.sh fallback path; verify hooks.json and worker JS need no changes (PTH-01, PTH-02, PTH-03)
- [ ] 50-02-PLAN.md — Update README MCP server path example and Makefile targets for plugins/ligamen/ layout (INS-01, INS-02)

### Phase 51: Verification
**Goal**: The restructured plugin passes all automated tests and installs cleanly via the marketplace flow from a fresh clone
**Depends on**: Phase 50
**Requirements**: VER-01, VER-02
**Success Criteria** (what must be TRUE):
  1. `make test` (bats suite) runs to completion with zero failures using the new layout
  2. A fresh clone of the repo followed by `claude plugin marketplace add` + `claude plugin install` produces a working plugin installation with all commands and hooks active
**Plans**: 2 plans

Plans:
- [ ] 51-01-PLAN.md — Update all bats test path variables and Makefile lint/check targets for plugins/ligamen/ layout
- [ ] 51-02-PLAN.md — Run full test suite (make test) and execute marketplace install flow end-to-end

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
| 46-48 | v4.1 | 6/6 | Complete | 2026-03-20 |
| 49. Directory Restructure | 1/1 | Complete    | 2026-03-21 | - |
| 50. Path and Install Updates | 2/2 | Complete    | 2026-03-21 | - |
| 51. Verification | 1/2 | Complete    | 2026-03-21 | - |
