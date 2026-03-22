# Requirements: Ligamen

**Defined:** 2026-03-22
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.5.0 Requirements

Requirements for Security & Data Integrity Hardening. Each maps to roadmap phases.

### Security

- [x] **SEC-01**: MCP resolveDb() uses path.normalize() + base directory validation to prevent path traversal attacks
- [x] **SEC-02**: Auth-db enricher rejects high-entropy strings and logs near-threshold values for credential leak prevention
- [x] **SEC-03**: Scan manager acquires project lock before scanning, rejects concurrent scans with clear error message

### Data Integrity

- [ ] **DINT-01**: endScan() cleans schemas for both stale and null-versioned connections before deleting connections (FK safety)
- [ ] **DINT-02**: upsertRepo() returns correct row ID on both insert and update (no lastInsertRowid=0 on ON CONFLICT)
- [ ] **DINT-03**: node_metadata enrichment tests use canonical view names matching production queries (ownership/security/infra)
- [ ] **DINT-04**: session-start.sh detects version mismatch and restarts worker when already running with stale code

### Reliability

- [ ] **REL-01**: Agent output parsing uses multiple strategies (JSON block, fenced code block, raw JSON) with logged fallback
- [ ] **REL-02**: Transitive impact queries enforce configurable depth limit (default 7) with 30s query timeout
- [ ] **REL-03**: Auth-db extractor enforces depth limit (8 levels), file size cap (1MB), and pre-traversal exclusion list
- [ ] **REL-04**: FTS5 search uses cached prepared statements with LRU eviction instead of per-call compilation

### Quality

- [ ] **QUAL-01**: Journal mode pragma ordering has explicit unit tests for readonly vs read-write connection modes
- [ ] **QUAL-02**: /ligamen:map asks user for project name before saving, stores in ligamen.config.json for reuse

## Future Requirements

### Scaling

- **SCALE-01**: Scan cancellation via cancellation token and /cancel HTTP endpoint
- **SCALE-02**: Scan resumption with per-repo checkpointing and --resume flag
- **SCALE-03**: Query result pagination with limit/offset on all query functions

### Performance

- **PERF-01**: ChromaDB sync backpressure with queue size limits and batch collection
- **PERF-02**: HTTP request rate limiting per project with query result caching

## Out of Scope

| Feature | Reason |
|---------|--------|
| PostgreSQL migration | SQLite handles current scale (<500 services); premature |
| better-sqlite3 fallback to sql.js | Exotic platform support not needed for current users |
| Worker thread pool | Single-threaded Node.js sufficient for current load |
| Docker-compose classification rework | Edge case with existing workaround (SBUG-02) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 80 | Complete |
| SEC-02 | Phase 80 | Complete |
| SEC-03 | Phase 80 | Complete |
| DINT-01 | Phase 81 | Pending |
| DINT-02 | Phase 81 | Pending |
| DINT-03 | Phase 81 | Pending |
| DINT-04 | Phase 81 | Pending |
| REL-01 | Phase 82 | Pending |
| REL-02 | Phase 82 | Pending |
| REL-03 | Phase 82 | Pending |
| REL-04 | Phase 83 | Pending |
| QUAL-01 | Phase 83 | Pending |
| QUAL-02 | Phase 83 | Pending |

**Coverage:**
- v5.5.0 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
