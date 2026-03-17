# Milestones

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

