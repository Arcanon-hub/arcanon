# Roadmap: AllClear → Ligamen

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- ✅ **v2.2 Scan Data Integrity** — Phases 27-29 (shipped 2026-03-16)
- ✅ **v2.3 Type-Specific Detail Panels** — Phases 30-32 (shipped 2026-03-18)
- ✅ **v3.0 Layered Graph & Intelligence** — Phases 33-38 (shipped 2026-03-18)
- 🚧 **v4.0 Ligamen Rebrand** — Phases 39-45 (in progress)

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

- [x] Phase 30: Storage Correctness (2/2 plans)
- [x] Phase 31: API Surface Extension (1/1 plan)
- [x] Phase 32: UI Detail Panels (2/2 plans)

Full details: `.planning/milestones/v2.3-ROADMAP.md`

</details>

<details>
<summary>✅ v3.0 Layered Graph & Intelligence (Phases 33-38) — SHIPPED 2026-03-18</summary>

- [x] Phase 33: Data Model (1/1 plans)
- [x] Phase 34: Layout Engine & Node Rendering (2/2 plans)
- [x] Phase 35: External Actors (2/2 plans)
- [x] Phase 36: Edge Rendering (1/1 plans)
- [x] Phase 37: Controls & Filters (3/3 plans)
- [x] Phase 38: Intelligence (2/2 plans)

Full details: `.planning/milestones/v3.0-ROADMAP.md`

</details>

### 🚧 v4.0 Ligamen Rebrand (In Progress)

**Milestone Goal:** Rename the plugin from "allclear" to "ligamen" across all code, configuration, environment variables, data paths, documentation, UI, slash commands, MCP server, and tests. Clean break — no backwards compatibility.

- [x] **Phase 39: Identity** - Rename package, plugin manifest, Makefile, and config filename
- [x] **Phase 40: Environment & Paths** - Rename all env vars, data directory, and temp file paths
- [x] **Phase 41: Commands & MCP** - Rename all slash commands, MCP server, ChromaDB collection, and skill descriptions
- [x] **Phase 42: Source Code** - Update shell script and JavaScript internal references and headers
- [x] **Phase 43: Tests** - Update bats tests, JS tests, and test fixtures
- [x] **Phase 44: Documentation** - Update README, docs/ files, and planning references
- [x] **Phase 45: UI** - Update graph UI title and worker HTML branding

## Phase Details

### Phase 39: Identity
**Goal**: The plugin's core identity artifacts carry the "ligamen" name so all tooling, installation, and marketplace discovery uses the new name
**Depends on**: Nothing (first phase of milestone)
**Requirements**: IDENT-01, IDENT-02, IDENT-03, IDENT-04
**Success Criteria** (what must be TRUE):
  1. Running `npm install` from the repo installs the package as `@ligamen/cli` with binary `ligamen`
  2. Claude Code marketplace lists the plugin as `ligamen` (plugin.json and marketplace.json show new name)
  3. Running `make install` uses `PLUGIN_NAME=ligamen` with no allclear references in Makefile targets
  4. Specifying configuration overrides requires a file named `ligamen.config.json` — `allclear.config.json` is not recognized
**Plans**: 2 plans
Plans:
- [ ] 39-01-PLAN.md — Rename npm package and plugin manifests (package.json, plugin.json, marketplace.json)
- [ ] 39-02-PLAN.md — Rename Makefile PLUGIN_NAME and config filename (Makefile, allclear.config.json.example, lib/config.sh)

### Phase 40: Environment & Paths
**Goal**: All runtime paths and environment variable names use the ligamen namespace so scripts and the worker resolve to the correct locations at startup
**Depends on**: Phase 39
**Requirements**: ENV-01, ENV-02, ENV-03
**Success Criteria** (what must be TRUE):
  1. Exporting `LIGAMEN_*` variables controls plugin behavior; `ALLCLEAR_*` variables have no effect
  2. The worker daemon stores its database at `~/.ligamen/` — no files are written to `~/.allclear/`
  3. Temporary files created during hooks and commands appear under `/tmp/ligamen_*` — no `/tmp/allclear_*` paths are created
**Plans**: TBD

### Phase 41: Commands & MCP
**Goal**: Every user-facing entry point — slash commands, MCP server name, ChromaDB collection, and skill descriptions — identifies itself as ligamen
**Depends on**: Phase 40
**Requirements**: CMD-01, CMD-02, CMD-03, CMD-04
**Success Criteria** (what must be TRUE):
  1. All 6 slash commands are invoked as `/ligamen:*` — `/allclear:*` commands no longer exist
  2. The MCP server registers as `ligamen-impact` in `.mcp.json` and in server startup output
  3. ChromaDB stores embeddings in a collection named `ligamen-impact`
  4. Skill files reference `ligamen` in their descriptions so agent auto-invocation prompts show the new name
**Plans**: 2 plans
Plans:
- [ ] 41-01-PLAN.md — Rename /allclear:* to /ligamen:* in all 6 command files and both skill descriptions
- [ ] 41-02-PLAN.md — Rename MCP server to ligamen-impact in .mcp.json and server.js, rename ChromaDB collection in chroma.js

### Phase 42: Source Code
**Goal**: All internal implementation files — shell scripts and JavaScript modules — carry ligamen branding in headers, comments, and user-visible output strings
**Depends on**: Phase 40
**Requirements**: CODE-01, CODE-02, CODE-03
**Success Criteria** (what must be TRUE):
  1. Shell script comment headers and any stdout messages printed to the terminal say "Ligamen" — no "AllClear" strings appear in script output
  2. JavaScript source file headers and internal log messages reference "Ligamen" — no "AllClear" strings appear in worker logs
  3. The session start hook reports "Ligamen active" when Claude Code starts a new session
**Plans**: 2 plans
Plans:
- [ ] 42-01-PLAN.md — Rename AllClear → Ligamen in shell script headers and output messages (scripts/, lib/worker-client.sh, session-start.sh CONTEXT)
- [ ] 42-02-PLAN.md — Rename AllClear → Ligamen in JS source file headers and agent prompt headings

### Phase 43: Tests
**Goal**: The full test suite passes against the renamed codebase with all assertions, fixtures, and env var references updated to ligamen
**Depends on**: Phase 42
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Running the bats test suite passes with zero failures — all env var references, config filename assertions, and temp path checks use `LIGAMEN_*` and `/tmp/ligamen_*`
  2. Running `node --test` on the JS test suite passes with zero failures — all path and reference assertions use ligamen names
  3. Test fixture config files are named `ligamen.config.json` and contain no allclear references
**Plans**: 3 plans
Plans:
- [ ] 43-01-PLAN.md — Rename ALLCLEAR_* env vars, /tmp/allclear_* paths, and assertion strings in all 10 bats test files
- [ ] 43-02-PLAN.md — Rename allclear- temp dir prefixes, allclear.config.json refs, and command strings in all 15 JS test files
- [ ] 43-03-PLAN.md — Rename test fixture allclear.config.json to ligamen.config.json

### Phase 44: Documentation
**Goal**: All user-facing documentation consistently describes the plugin as Ligamen with correct install instructions and command references
**Depends on**: Phase 41
**Requirements**: DOCS-01, DOCS-02, DOCS-03
**Success Criteria** (what must be TRUE):
  1. README.md install instructions reference the `ligamen` repository, `@ligamen/cli` package, and `/ligamen:*` commands throughout — no allclear references remain
  2. All docs/ files (commands.md, configuration.md, hooks.md, architecture.md, service-map.md, development.md) reference ligamen exclusively
  3. Planning docs (PROJECT.md, MILESTONES.md, and others) use "Ligamen" as the product name where the product name appears
**Plans**: 2 plans
Plans:
- [ ] 44-01-PLAN.md — Rename AllClear to Ligamen in README.md (install, commands, config, env vars)
- [ ] 44-02-PLAN.md — Rename AllClear to Ligamen in all docs/ files and planning docs

### Phase 45: UI
**Goal**: The graph UI and worker web interface display "Ligamen" as the product name with no visible allclear branding
**Depends on**: Phase 42
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. The graph UI page title and any visible header text reads "Ligamen" — no "AllClear" text appears in the browser tab or rendered UI
  2. The worker HTML response (index page, error pages, any static strings) shows "Ligamen" branding
**Plans**: 1 plan
Plans:
- [ ] 45-01-PLAN.md — Rename AllClear to Ligamen in index.html title, toolbar h1, and project-picker empty-state message

## Progress

**Execution Order:** 39 → 40 → 41 → 42 → 43 → 44 → 45

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22-26 | v2.1 | 11/11 | Complete | 2026-03-16 |
| 27-29 | v2.2 | 5/5 | Complete | 2026-03-16 |
| 30-32 | v2.3 | 5/5 | Complete | 2026-03-18 |
| 33-38 | v3.0 | 11/11 | Complete | 2026-03-18 |
| 39. Identity | v4.0 | 0/TBD | Not started | - |
| 40. Environment & Paths | v4.0 | 0/TBD | Not started | - |
| 41. Commands & MCP | v4.0 | 0/2 | Not started | - |
| 42. Source Code | v4.0 | 0/2 | Not started | - |
| 43. Tests | v4.0 | 0/3 | Not started | - |
| 44. Documentation | v4.0 | 0/TBD | Not started | - |
| 45. UI | v4.0 | 0/1 | Not started | - |
