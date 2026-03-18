# Milestones

## v2.3 Type-Specific Detail Panels (Shipped: 2026-03-18)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**
- Migration 007 adds `kind` column to `exposed_endpoints` with COALESCE unique index for NULL-safe dedup
- `persistFindings()` type-conditional dispatch: services split METHOD/PATH, libraries store raw signatures, infra stores raw resource refs
- `getGraph()` attaches per-node `exposes` arrays with graceful pre-migration degradation
- Three-way detail panel routing: library panel (Exports + Used by), infra panel (Manages + Wires), service panel unchanged
- XSS-safe rendering with `escapeHtml()` on all scan-derived string insertions

---

## v2.2 Scan Data Integrity (Shipped: 2026-03-16)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**
- UNIQUE(repo_id, name) constraint with in-place dedup + ON CONFLICT DO UPDATE upsert preserving row IDs across re-scans
- Scan version bracket (beginScan/endScan) with atomic stale-row cleanup — failed scans leave prior data intact
- Agent prompt service naming convention enforcing manifest-derived, lowercase-hyphenated names
- Cross-project MCP queries via per-call resolveDb dispatching by path/hash/repo name

---

## v2.1 UI Polish & Observability (Shipped: 2026-03-16)

**Phases completed:** 5 phases, 11 plans, 0 tasks

**Key accomplishments:**
- HiDPI/Retina-crisp canvas rendering with devicePixelRatio scaling and smooth exponential zoom/pan
- Shared structured logger with component tags across all worker modules (zero console.log in production code)
- Collapsible log terminal with 2s polling, ring buffer, component filter, keyword search, and auto-scroll
- Persistent project switcher with full event listener teardown and force worker termination between projects

---

## v2.0 Service Dependency Intelligence (Shipped: 2026-03-15)

**Phases completed:** 8 phases, 19 plans, 0 tasks

**Key accomplishments:**
- (none recorded)

---

## v1.0 Plugin Foundation (Shipped: 2026-03-15)

**Phases completed:** 13 phases, 17 plans, 0 tasks

**Key accomplishments:**
- (none recorded)

---

