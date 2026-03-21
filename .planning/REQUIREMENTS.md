# Requirements: Ligamen

**Defined:** 2026-03-20
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.0 Requirements

Requirements for v5.0 Marketplace Restructure. Each maps to roadmap phases.

### Structure

- [x] **STR-01**: Create `plugins/ligamen/` directory and move plugin files into it (commands/, hooks/, scripts/, worker/, lib/, skills/, .claude-plugin/, package.json, package-lock.json, ligamen.config.json.example)
- [x] **STR-02**: Root keeps: README.md, LICENSE, Makefile, docs/, tests/, .planning/, .mcp.json

### Paths

- [ ] **PTH-01**: Update all internal path references in shell scripts (lib/, scripts/) to work from `plugins/ligamen/`
- [ ] **PTH-02**: Update worker JS imports and paths to work from new location
- [ ] **PTH-03**: Update hooks.json paths to reference `plugins/ligamen/` scripts

### Install

- [ ] **INS-01**: Update README installation instructions for marketplace-based install
- [ ] **INS-02**: Update Makefile install/uninstall targets for new structure

### Verify

- [ ] **VER-01**: Bats test suite passes with new directory layout
- [ ] **VER-02**: `claude plugin marketplace add` + `claude plugin install` works from a fresh clone

## Future Requirements

None deferred.

## Out of Scope

| Feature | Reason |
|---------|--------|
| npm publish | Not needed — marketplace install from GitHub is the distribution model |
| Monorepo with multiple plugins | Single plugin for now; can add more later |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STR-01 | Phase 49 | Complete |
| STR-02 | Phase 49 | Complete |
| PTH-01 | Phase 50 | Pending |
| PTH-02 | Phase 50 | Pending |
| PTH-03 | Phase 50 | Pending |
| INS-01 | Phase 50 | Pending |
| INS-02 | Phase 50 | Pending |
| VER-01 | Phase 51 | Pending |
| VER-02 | Phase 51 | Pending |

**Coverage:**
- v5.0 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after roadmap creation*
