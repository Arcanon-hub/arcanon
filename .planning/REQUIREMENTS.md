# Requirements: Ligamen

**Defined:** 2026-03-23
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.7.0 Requirements

Requirements for Scan Accuracy milestone. Derived from Linear issues THE-949 and THE-951.

### Crossing Semantics (THE-949)

- [x] **CROSS-01**: Agent scan prompts define three crossing values — `external` (target not in any linked repo), `cross-service` (target is a different service in a linked repo), `internal` (within the same deployable unit)
- [x] **CROSS-02**: Agent prompt examples include the `crossing` field on every connection (no omissions)
- [x] **CROSS-03**: Post-scan reconciliation step in map.md collects all discovered service names across repos and downgrades `external` → `cross-service` for connections where both source and target resolve to known services

### Discovery Improvements (THE-951)

- [x] **DISC-01**: Discovery prompt instructs agents to check for multiple manifest files in subdirectories (`*/package.json`, `*/pyproject.toml`, `*/Cargo.toml`, `*/go.mod`) and report mono-repos with per-subdirectory `service_hints` entries
- [x] **DISC-02**: Discovery output schema includes `client_files` array — files matching patterns like `*client*`, `*api*`, `*http*`, or files importing `fetch`/`requests`/`reqwest`/`httpx`

### Release

- [ ] **VER-01**: All 5 manifest files bumped to v5.7.0

## Future Requirements

- **CROSS-04**: Persist `cross-service` crossing in database schema (currently only `external`/`internal` stored)
- **DISC-03**: Discovery phase detects infrastructure-as-code files (Terraform, Pulumi, CDK) for infra-type repos

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatic crossing inference from network topology | Requires runtime data (service mesh, DNS) not available at scan time |
| Full mono-repo workspace resolution | Yarn/pnpm workspaces are complex; basic multi-manifest detection is sufficient for now |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CROSS-01 | Phase 89 | Complete |
| CROSS-02 | Phase 89 | Complete |
| CROSS-03 | Phase 89 | Complete |
| DISC-01 | Phase 90 | Complete |
| DISC-02 | Phase 90 | Complete |
| VER-01 | Phase 91 | Pending |

**Coverage:**
- v5.7.0 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
