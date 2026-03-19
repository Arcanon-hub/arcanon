# Requirements: Ligamen Rebrand

**Defined:** 2026-03-19
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v4.0 Requirements

Requirements for the allclear → ligamen rename. Each maps to roadmap phases.

### Identity

- [ ] **IDENT-01**: Package renamed from `@allclear/cli` to `@ligamen/cli` in package.json with updated description and binary name
- [ ] **IDENT-02**: Plugin name changed from `allclear` to `ligamen` in plugin.json and marketplace.json
- [ ] **IDENT-03**: Makefile `PLUGIN_NAME` updated to `ligamen`
- [ ] **IDENT-04**: Config filename renamed from `allclear.config.json` to `ligamen.config.json` across all references

### Commands & MCP

- [ ] **CMD-01**: All 6 slash commands renamed from `/allclear:*` to `/ligamen:*` (quality-gate, map, cross-impact, drift, pulse, deploy-verify)
- [ ] **CMD-02**: MCP server renamed from `allclear-impact` to `ligamen-impact` in `.mcp.json` and server code
- [ ] **CMD-03**: ChromaDB collection renamed from `allclear-impact` to `ligamen-impact`
- [ ] **CMD-04**: Skill descriptions updated to reference `ligamen` naming

### Environment & Paths

- [ ] **ENV-01**: All 20+ environment variables renamed from `ALLCLEAR_*` to `LIGAMEN_*`
- [ ] **ENV-02**: Data directory changed from `~/.allclear/` to `~/.ligamen/` across all scripts and worker code
- [ ] **ENV-03**: Temp file paths updated from `/tmp/allclear_*` to `/tmp/ligamen_*`

### Source Code

- [ ] **CODE-01**: All shell script comment headers and output messages updated from "AllClear" to "Ligamen"
- [ ] **CODE-02**: All JavaScript source file headers and internal references updated
- [ ] **CODE-03**: Session start hook context string changed from "AllClear active" to "Ligamen active"

### Documentation

- [ ] **DOCS-01**: README.md fully updated with new name, install instructions, and command references
- [ ] **DOCS-02**: All docs/ files (commands.md, configuration.md, hooks.md, architecture.md, service-map.md, development.md) updated
- [ ] **DOCS-03**: Planning docs updated where referencing the product name

### Tests

- [ ] **TEST-01**: All bats test files updated with new env vars, config filenames, temp paths, and assertion strings
- [ ] **TEST-02**: All JavaScript test files updated with new paths and references
- [ ] **TEST-03**: Test fixtures (mock configs, fixture config files) renamed and updated

### UI

- [ ] **UI-01**: Graph UI title/branding updated from "AllClear" to "Ligamen"
- [ ] **UI-02**: Worker UI HTML and any visible branding strings updated

## Future Requirements

None — this is a complete rename milestone.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backwards compatibility / migration from ~/.allclear | Clean break — user chose no migration path |
| Deprecated ALLCLEAR_* env var fallback | Clean break — no dual-name support |
| GitHub repo rename | Separate operation outside plugin codebase |
| npm publish under new name | Separate operation after code rename ships |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| IDENT-01 | Phase 39 | Pending |
| IDENT-02 | Phase 39 | Pending |
| IDENT-03 | Phase 39 | Pending |
| IDENT-04 | Phase 39 | Pending |
| ENV-01 | Phase 40 | Pending |
| ENV-02 | Phase 40 | Pending |
| ENV-03 | Phase 40 | Pending |
| CMD-01 | Phase 41 | Pending |
| CMD-02 | Phase 41 | Pending |
| CMD-03 | Phase 41 | Pending |
| CMD-04 | Phase 41 | Pending |
| CODE-01 | Phase 42 | Pending |
| CODE-02 | Phase 42 | Pending |
| CODE-03 | Phase 42 | Pending |
| TEST-01 | Phase 43 | Pending |
| TEST-02 | Phase 43 | Pending |
| TEST-03 | Phase 43 | Pending |
| DOCS-01 | Phase 44 | Pending |
| DOCS-02 | Phase 44 | Pending |
| DOCS-03 | Phase 44 | Pending |
| UI-01 | Phase 45 | Pending |
| UI-02 | Phase 45 | Pending |

**Coverage:**
- v4.0 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
