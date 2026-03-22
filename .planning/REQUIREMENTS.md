# Requirements: Ligamen

**Defined:** 2026-03-22
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.4.0 Requirements

Requirements for Scan Pipeline Hardening milestone. Each maps to roadmap phases.

### Scan Bugs

- [x] **SBUG-01**: persistFindings checks target against known services before creating actor — eliminates phantom actor hexagons in graph UI (THE-945)
- [x] **SBUG-02**: detectRepoType correctly classifies service repos that have docker-compose.yml for local dev, with expanded Go/Java/Poetry library detection (THE-955)
- [x] **SBUG-03**: CODEOWNERS enricher passes relative service root_path to findOwners instead of absolute repo path — ownership patterns now match correctly (THE-956)

### Scan Architecture

- [ ] **SARC-01**: Discovery agent (Phase 1) runs before deep scan per repo, returning languages, frameworks, service hints, and file targets as {{DISCOVERY_JSON}} to the deep scan prompt (THE-953)
- [ ] **SARC-02**: Active agent prompts use discovery context for language-specific pattern guidance instead of hardcoded Python/JS examples; entry points expanded for Java, C#, Ruby, Kotlin (THE-959)
- [ ] **SARC-03**: Dead code removed: agent-prompt-deep.md deleted, promptDeep variable removed from manager.js, unique documentation migrated to active prompts first (THE-954)

### Scan Validation

- [x] **SVAL-01**: findings.js validates services[].type as enum (service/library/sdk/infra), validates root_path and language presence as non-empty strings (THE-957)
- [x] **SVAL-02**: getChangedFiles and getCurrentHead use execFileSync with argument arrays instead of execSync with string interpolation — eliminates shell injection surface (THE-958)

### Scan Reliability

- [ ] **SREL-01**: Discovery agents run in parallel across repos; deep scan agents run in parallel where possible; failed agents retry once then skip with user warning (THE-952)
- [ ] **SREL-02**: Graph UI /graph endpoint filters out actors whose name matches a known service, redirecting connections to the service node — defense in depth for stale actor data (THE-948)

### Release

- [ ] **REL-01**: All manifest files (package.json, marketplace.json, plugin.json) version-bumped to 5.4.0

## Future Requirements

### Crossing Semantics (deferred — THE-949)

- **CROSS-01**: Redefine crossing field: external = truly unknown, cross-service = different service, internal = same deployable unit
- **CROSS-02**: Post-scan reconciliation step downgrades external → cross-service when both endpoints are known services

## Out of Scope

| Feature | Reason |
|---------|--------|
| Crossing semantics rewrite (THE-949) | Related but larger scope — deferred to separate milestone |
| ChromaDB integration changes | No scan schema changes affect vector sync in this milestone |
| New MCP tools | Milestone focuses on scan pipeline, not API surface |
| UI layout changes | Only actor dedup filter added; no layout engine changes |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SBUG-01 | Phase 74 | Complete |
| SBUG-02 | Phase 74 | Complete |
| SBUG-03 | Phase 74 | Complete |
| SVAL-01 | Phase 75 | Complete |
| SVAL-02 | Phase 75 | Complete |
| SARC-01 | Phase 76 | Pending |
| SARC-02 | Phase 77 | Pending |
| SARC-03 | Phase 77 | Pending |
| SREL-01 | Phase 78 | Pending |
| SREL-02 | Phase 78 | Pending |
| REL-01 | Phase 79 | Pending |

**Coverage:**
- v5.4.0 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
