# Requirements: Ligamen

**Defined:** 2026-03-23
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.6.0 Requirements

Requirements for Logging & Observability milestone. Each maps to roadmap phases.

### Log Infrastructure

- [x] **LOG-01**: Logger implements size-based rotation — rotates at 10MB, keeps 3 old files (worker.log.1, .2, .3), rename-before-write check on each log call
- [x] **LOG-02**: Logger skips stderr writes when process has no TTY (daemon mode) — eliminates double-write when nohup captures stderr to the same log file
- [ ] **LOG-03**: All error log calls include err.stack alongside err.message — stack traces visible in structured log output for post-mortem debugging

### Scan Observability

- [ ] **SCAN-01**: Scan manager logs BEGIN event (repo count, scan mode) and END event (services found, connections found, duration) for every scanRepos invocation
- [ ] **SCAN-02**: Scan manager logs per-repo progress — discovery done (languages/frameworks), deep scan done (services/connections), enrichment done (enrichers applied)
- [ ] **SCAN-03**: setExtractorLogger is called from worker/index.js so auth-db enricher entropy warnings reach the structured logger

### Error Logging

- [ ] **ERR-01**: HTTP route error handlers log errors to the structured logger (not just response body) — all catch blocks in http.js that return 500 also call logger.error with stack trace
- [ ] **ERR-02**: MCP tool error handlers log errors to the structured logger — all catch blocks in server.js that return error status also call logger.error with stack trace

### Logger Adoption

- [ ] **ADOPT-01**: QueryEngine constructor accepts optional logger parameter — cross-repo name collision warning (line 1257) uses injected logger instead of console.warn

## Future Requirements

### Observability

- **OBS-01**: Dynamic log level change via HTTP endpoint (e.g., POST /api/log-level) without worker restart
- **OBS-02**: Log aggregation support — structured JSON format compatible with ELK/Loki/CloudWatch
- **OBS-03**: Request ID propagation for correlating HTTP requests across log entries

### Performance

- **PERF-01**: Async log writing (buffered writes instead of appendFileSync) for high-throughput scenarios

## Out of Scope

| Feature | Reason |
|---------|--------|
| External log shipping (ELK, Datadog) | Structured JSON is already compatible; shipping is infrastructure concern |
| Log viewer UI redesign | Current polling-based log terminal works; cosmetic changes not needed |
| Metrics/tracing (OpenTelemetry) | Premature for a CLI plugin; adds heavy dependencies |
| pino or winston migration | Current logger is simple and sufficient; no need for framework |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOG-01 | Phase 84 | Complete |
| LOG-02 | Phase 84 | Complete |
| LOG-03 | Phase 85 | Pending |
| SCAN-01 | Phase 86 | Pending |
| SCAN-02 | Phase 86 | Pending |
| SCAN-03 | Phase 86 | Pending |
| ERR-01 | Phase 85 | Pending |
| ERR-02 | Phase 85 | Pending |
| ADOPT-01 | Phase 87 | Pending |

**Coverage:**
- v5.6.0 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
