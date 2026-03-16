# Requirements: AllClear v2.2

**Defined:** 2026-03-16
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v2.2 Requirements

Requirements for scan data integrity and cross-repo MCP queries.

### Schema & Dedup

- [x] **SCAN-01**: Re-scanning a repo upserts services by (repo_id, name) using ON CONFLICT DO UPDATE — no duplicate rows created
- [x] **SCAN-02**: Migration 004 adds UNIQUE(repo_id, name) to services table, deduplicates existing data, and rebuilds FTS5 indexes

### Scan Versioning

- [ ] **SCAN-03**: Each scan creates a version bracket (beginScan/endScan); stale rows from prior scans are cleaned up after successful persist

### Agent Naming

- [x] **SCAN-04**: Agent prompt enforces consistent service naming (lowercase-hyphenated, derived from package manifest name field)

### Cross-Repo MCP Queries

- [ ] **SCAN-05**: MCP tools accept a `repository` parameter (name or path) and resolve to the correct project DB by searching all project DBs under ~/.allclear/projects/ for a matching repo entry

## Future Requirements

### Cross-Repo Identity

- **SCAN-06**: Cross-repo canonical service identity — service_aliases table for merging same logical service discovered from different repos
- **SCAN-07**: Generic service name block-list (worker, api, server, app) to prevent false identity merges

### Scan History UI

- **SCAN-08**: UI panel showing scan version history with diff between versions
- **SCAN-09**: Log rotation for worker.log on long-running instances

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatic fuzzy service name matching | Too high false-positive risk — use explicit aliases instead |
| Repo-centric storage (migrate away from project DBs) | Project grouping works fine for storage; query layer handles repo-centric access |
| Real-time scan progress in UI | Agent scanning is foreground-only; UI polling would add complexity for rare events |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCAN-01 | Phase 27 | Complete |
| SCAN-02 | Phase 27 | Complete |
| SCAN-03 | Phase 28 | Pending |
| SCAN-04 | Phase 27 | Complete |
| SCAN-05 | Phase 29 | Pending |

**Coverage:**
- v2.2 requirements: 5 total
- Mapped to phases: 5
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 — traceability populated after roadmap creation*
