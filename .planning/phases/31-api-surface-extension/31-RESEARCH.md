# Phase 31: API Surface Extension - Research

**Researched:** 2026-03-17
**Domain:** SQLite read extension + HTTP JSON shape + UI state mapping (better-sqlite3, Fastify, browser ES modules)
**Confidence:** HIGH — all findings sourced from direct source code inspection; zero external research required

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | `getGraph()` response includes `exposes` array on each service node containing its exposed endpoints/exports/resources | `getGraph()` at query-engine.js:607 returns `{ services, connections, repos, mismatches }` with no `exposes` field today; adding a post-services query that groups `exposed_endpoints` rows by `service_id` and attaches them satisfies this; the `kind` column (added by Phase 30 migration 007) is the discriminant field the UI needs |
| API-02 | `graph.js` `loadProject()` forwards exposes data into `state.graphData.nodes[i].exposes` | `loadProject()` at graph.js:57-66 builds nodes with an explicit property allowlist `{ id, name, language, type, repo_name }` — `exposes` is silently dropped; the fix is to add `exposes: s.exposes \|\| []` to the mapping object |
</phase_requirements>

---

## Summary

Phase 31 delivers two focused changes. `getGraph()` currently returns `{ services, connections, repos, mismatches }` with no surface data per node. The fix is a single additional query that fetches all `exposed_endpoints` rows, groups them into a map keyed by `service_id`, and attaches the array to each service before returning. No route change is needed — `GET /graph` in `http.js` passes `qe.getGraph()` through unchanged, and the additive shape is transparent to all existing consumers.

`loadProject()` in `graph.js` builds `state.graphData.nodes` by copying a fixed set of properties from the API response. Because `exposes` is not in that allowlist, it is silently dropped even after `getGraph()` returns it. The fix is to add `exposes: s.exposes || []` to the mapping object at line 64. No other UI code changes — once `exposes` is in `state.graphData.nodes`, the detail panel renderers added in Phase 32 will find it.

Phase 31 depends on Phase 30 having landed migration 007 (which adds the `kind` column to `exposed_endpoints`). The `getGraph()` exposes query must include `kind` in its SELECT so the UI receives the discriminant field needed for type-specific rendering.

**Primary recommendation:** Extend `getGraph()` with a grouped `exposed_endpoints` SELECT and patch the property allowlist in `loadProject()`. Both changes are in a single plan (31-01). No new files, no new npm packages.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.8.0 | Synchronous SQLite — the `_db.prepare().all()` pattern used throughout query-engine.js | Already the project's DB layer; no async plumbing needed for the extra SELECT |
| Node.js `node:test` + `node:assert` | built-in (Node 20+) | Test runner — same pattern used by tests/storage/query-engine.test.js | Zero install; consistent with all existing worker tests |

### No New Dependencies

Phase 31 requires zero new npm packages. Both changes are logic modifications inside existing files.

**Installation:**
```bash
# Nothing to install
```

---

## Architecture Patterns

### getGraph() Extension Pattern

The existing `getGraph()` method (query-engine.js:607-644) follows a sequential prepare-then-call pattern: three `.prepare().all()` calls followed by `detectMismatches()`. The extension follows the same shape — add a fourth query after the services query:

```javascript
// Source: worker/db/query-engine.js — getGraph() method
// Add after services.all():

const allExposes = this._db.prepare(
  'SELECT service_id, method, path, kind FROM exposed_endpoints'
).all();

const exposesByServiceId = {};
for (const row of allExposes) {
  if (!exposesByServiceId[row.service_id]) exposesByServiceId[row.service_id] = [];
  exposesByServiceId[row.service_id].push(row);
}
for (const svc of services) {
  svc.exposes = exposesByServiceId[svc.id] || [];
}
```

The query runs against all rows with no WHERE clause — filtering happens in JavaScript. This is correct: the number of rows in `exposed_endpoints` is bounded by services × endpoints-per-service (typically < 1000 rows for any real project). A full-table scan avoids N+1 queries.

**Graceful degradation:** The query must handle the case where migration 007 has not yet run (no `kind` column). The safe approach is to check whether the column exists or wrap in a try/catch. Checking column existence via `PRAGMA table_info(exposed_endpoints)` before issuing the SELECT is the simplest guard.

```javascript
// Graceful guard — skip exposes if kind column not yet present
const colInfo = this._db.prepare("PRAGMA table_info(exposed_endpoints)").all();
const hasKind = colInfo.some(c => c.name === 'kind');
const exposesSql = hasKind
  ? 'SELECT service_id, method, path, kind FROM exposed_endpoints'
  : 'SELECT service_id, method, path FROM exposed_endpoints';
```

However, since Phase 30 is a dependency of Phase 31, the column should always be present in practice. The guard is defensive coding for test environments that may not run the full migration chain.

### loadProject() Property Allowlist Pattern

`loadProject()` at graph.js:57-66 maps API services to UI node objects:

```javascript
// Source: worker/ui/graph.js:57-66 — current
state.graphData.nodes = (raw.services || []).map((s) => {
  serviceNameToId[s.name] = s.id;
  return {
    id: s.id,
    name: s.name,
    language: s.language,
    type: s.type || "service",
    repo_name: s.repo_name,
  };
});
```

The fix adds `exposes` to the allowlist with a safe default:

```javascript
// Source: worker/ui/graph.js:57-66 — after fix
state.graphData.nodes = (raw.services || []).map((s) => {
  serviceNameToId[s.name] = s.id;
  return {
    id: s.id,
    name: s.name,
    language: s.language,
    type: s.type || "service",
    repo_name: s.repo_name,
    exposes: s.exposes || [],
  };
});
```

The `|| []` guard ensures nodes with no stored exposes always have `exposes: []` rather than `undefined`, satisfying the Phase 31 Success Criterion #3.

### Recommended Project Structure

No new files. Phase 31 modifies two existing files:

```
worker/
├── db/
│   └── query-engine.js     # MODIFIED: getGraph() attaches exposes array
└── ui/
    └── graph.js             # MODIFIED: loadProject() forwards exposes to state nodes
tests/
└── storage/
    └── api-surface.test.js  # NEW: Wave 0 — verifies getGraph() exposes shape
```

### Anti-Patterns to Avoid

- **Per-click fetch for exposes:** Do not add a `GET /node-detail/:id` route. Embedding in `/graph` is the established pattern and avoids click latency.
- **Filtering in SQL:** Do not add `WHERE service_id IN (...)` to the exposes query. A single full-table scan is simpler and more performant than N per-service queries.
- **UI-side parsing of raw strings:** Do not store raw "METHOD PATH" strings and parse in the renderer. By Phase 31, `kind`/`method`/`path` are already split at persist time (Phase 30).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Group rows by service_id in SQL | GROUP BY + JSON_GROUP_ARRAY aggregate | Plain SELECT + JS grouping loop | better-sqlite3 `.all()` returns flat rows; JavaScript Map grouping is 5 lines and readable |
| Detect missing `kind` column | Schema version table lookup | `PRAGMA table_info(exposed_endpoints)` | Direct and reliable; no migration version bookkeeping needed |

---

## Common Pitfalls

### Pitfall 1: exposes silently dropped in loadProject()

**What goes wrong:** `getGraph()` correctly attaches `exposes` arrays to service rows, `/graph` response includes them, but `state.graphData.nodes[i].exposes` remains undefined in tests and at runtime.

**Why it happens:** `loadProject()` builds nodes with an explicit property object `{ id, name, language, type, repo_name }`. Any extra field on `s` (the raw API object) is silently ignored — JavaScript object literals don't auto-spread unknown properties.

**How to avoid:** Add `exposes: s.exposes || []` to the mapping object. Test by asserting `state.graphData.nodes[0].exposes` is an array after `loadProject()`.

**Warning signs:** Tests verify `/graph` response contains `exposes` but tests of `state.graphData.nodes` show `exposes: undefined`.

### Pitfall 2: kind column missing when getGraph() runs

**What goes wrong:** `SELECT service_id, method, path, kind FROM exposed_endpoints` throws "no such column: kind" if migration 007 has not run.

**Why it happens:** Phase 31 depends on Phase 30 (migration 007). In test environments, the `makeQE()` helper may not include migration 007 if not updated.

**How to avoid:** Update `makeQE()` in `tests/storage/query-engine.test.js` to import and run migration 007 alongside 001-006. For production, Phase 30 must complete before Phase 31.

**Warning signs:** `getGraph()` throws `SqliteError: table exposed_endpoints has no column named kind` in test output.

### Pitfall 3: exposes missing for nodes with no stored endpoints

**What goes wrong:** Nodes whose `service_id` has no rows in `exposed_endpoints` get `exposes: undefined` instead of `exposes: []`.

**Why it happens:** `exposesByServiceId[svc.id]` returns `undefined` if no rows exist for that service.

**How to avoid:** Use `svc.exposes = exposesByServiceId[svc.id] || []` (the `|| []` is mandatory). Also use `exposes: s.exposes || []` in `loadProject()`.

**Warning signs:** Detail panel renderer crashes with `cannot read properties of undefined (reading 'filter')` when clicking a service node with no endpoints.

### Pitfall 4: http.js route tested with stale mock

**What goes wrong:** `http.test.js` uses `mockQE.getGraph()` returning `{ nodes: [...], edges: [] }` — a shape that doesn't match the real `getGraph()` return value `{ services, connections, repos, mismatches }`. Extending the mock to add `exposes` on `nodes` would test the wrong shape.

**Why it happens:** The existing http.test.js mock was written for an earlier API shape and never corrected.

**How to avoid:** Phase 31 tests should test `getGraph()` directly via `tests/storage/api-surface.test.js`, not via the HTTP layer. The HTTP route is a passthrough — it requires no change and does not need new tests.

---

## Code Examples

Verified patterns from source code:

### Full getGraph() after extension

```javascript
// Source: worker/db/query-engine.js — getGraph() full method after Phase 31

getGraph() {
  const services = this._db
    .prepare(`
      SELECT s.id, s.name, s.root_path, s.language, s.type, s.repo_id, r.name as repo_name, r.path as repo_path
      FROM services s
      JOIN repos r ON r.id = s.repo_id
    `)
    .all();

  // Attach exposes — check kind column exists (migration 007 guard)
  try {
    const allExposes = this._db
      .prepare('SELECT service_id, method, path, kind FROM exposed_endpoints')
      .all();
    const exposesByServiceId = {};
    for (const row of allExposes) {
      if (!exposesByServiceId[row.service_id]) exposesByServiceId[row.service_id] = [];
      exposesByServiceId[row.service_id].push(row);
    }
    for (const svc of services) {
      svc.exposes = exposesByServiceId[svc.id] || [];
    }
  } catch {
    // migration 007 not yet applied — exposes not available
    for (const svc of services) {
      svc.exposes = [];
    }
  }

  const connections = this._db
    .prepare(`
      SELECT c.id, c.protocol, c.method, c.path, c.source_file, c.target_file,
             s_src.name as source, s_tgt.name as target
      FROM connections c
      JOIN services s_src ON c.source_service_id = s_src.id
      JOIN services s_tgt ON c.target_service_id = s_tgt.id
    `)
    .all();

  const repos = this._db
    .prepare(`
      SELECT r.id, r.name, r.path, r.type,
             rs.last_scanned_commit, rs.last_scanned_at
      FROM repos r
      LEFT JOIN repo_state rs ON rs.repo_id = r.id
    `)
    .all();

  const mismatches = this.detectMismatches();

  return { services, connections, repos, mismatches };
}
```

### loadProject() node mapping after extension

```javascript
// Source: worker/ui/graph.js — loadProject() node mapping after Phase 31

state.graphData.nodes = (raw.services || []).map((s) => {
  serviceNameToId[s.name] = s.id;
  return {
    id: s.id,
    name: s.name,
    language: s.language,
    type: s.type || "service",
    repo_name: s.repo_name,
    exposes: s.exposes || [],
  };
});
```

### Test pattern for getGraph() exposes

```javascript
// Source: tests/storage/api-surface.test.js (Wave 0 — does not exist yet)
// Pattern follows tests/storage/query-engine.test.js makeQE() helper

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as migration001 from "../../worker/db/migrations/001_initial_schema.js";
// ... through migration007

function makeQE() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const m of [migration001, ..., migration007]) {
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(m.version);
    })();
  }
  return { db, qe: new QueryEngine(db) };
}

it("getGraph() returns exposes array on service nodes", () => {
  const { db, qe } = makeQE();
  // insert repo, service, exposed_endpoints row
  // ...
  const result = qe.getGraph();
  const svc = result.services.find(s => s.name === 'test-service');
  assert.ok(Array.isArray(svc.exposes));
  assert.equal(svc.exposes[0].kind, 'endpoint');
});

it("getGraph() returns exposes: [] for nodes with no stored endpoints", () => {
  const { db, qe } = makeQE();
  // insert repo, service — NO exposed_endpoints rows
  const result = qe.getGraph();
  const svc = result.services[0];
  assert.deepStrictEqual(svc.exposes, []);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No exposes in /graph response | Embed exposes in /graph (Phase 31) | Phase 31 | Eliminates need for per-click API call in Phase 32 detail panels |
| loadProject() copies fixed field set | Add `exposes` to field set | Phase 31 | Downstream Phase 32 renderers find `node.exposes` without further changes |

**Nothing deprecated in this phase.** Phase 31 is purely additive.

---

## Open Questions

1. **try/catch vs PRAGMA guard in getGraph()**
   - What we know: Both approaches handle the missing-column case. try/catch is simpler. PRAGMA is more explicit.
   - What's unclear: The Phase 30 dependency makes the missing-column case impossible in production but common in tests.
   - Recommendation: Use try/catch (matches the existing `detectMismatches()` guard style in query-engine.js lines 666-681).

2. **Should exposes rows include `id` and `handler` fields?**
   - What we know: The SELECT in the architecture doc uses `service_id, method, path, kind`. The `handler` column (boundary_entry) is defined in migration 003 and is relevant for Phase 32 library panels (source file link).
   - What's unclear: Whether Phase 32 renderers need `handler` at the API-01/API-02 level or can add it later.
   - Recommendation: Include `handler` in the SELECT now (`SELECT service_id, method, path, kind, handler FROM exposed_endpoints`) to avoid a second Phase 32 schema change. Confirmed safe — additive field.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node 20+) |
| Config file | none — uses `node --test` directly |
| Quick run command | `node --test tests/storage/api-surface.test.js` |
| Full suite command | `node --test tests/storage/api-surface.test.js tests/storage/query-engine.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | `getGraph()` returns `exposes` array per service node with `kind/method/path` fields | unit | `node --test tests/storage/api-surface.test.js` | ❌ Wave 0 |
| API-01 | Nodes with no stored exposes have `exposes: []` (not undefined) | unit | `node --test tests/storage/api-surface.test.js` | ❌ Wave 0 |
| API-02 | `loadProject()` maps `s.exposes` into `state.graphData.nodes[i].exposes` | unit (JSDOM or mock fetch) | `node --test tests/ui/graph.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test tests/storage/api-surface.test.js`
- **Per wave merge:** `node --test tests/storage/api-surface.test.js tests/storage/query-engine.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/storage/api-surface.test.js` — covers API-01 (getGraph() exposes shape, empty-exposes default)
- [ ] `tests/ui/graph.test.js` — covers API-02 (loadProject() exposes forwarding); mock `fetch()` returning fixture JSON with `services[0].exposes`
- [ ] Update `makeQE()` in `tests/storage/query-engine.test.js` to import and run migration 007

---

## Sources

### Primary (HIGH confidence)

- `worker/db/query-engine.js` lines 607-644 — `getGraph()` confirmed: no exposes field, sequential prepare-then-call pattern (source code, direct read)
- `worker/db/query-engine.js` lines 796-815 — `persistFindings()` broken parser confirmed (source code, direct read)
- `worker/ui/graph.js` lines 28-120 — `loadProject()` explicit property allowlist at lines 57-66 (source code, direct read)
- `worker/server/http.js` lines 92-107 — `GET /graph` passthrough: `reply.send(qe.getGraph())` unchanged (source code, direct read)
- `worker/db/migrations/003_exposed_endpoints.js` — `exposed_endpoints` schema: `(id, service_id, method, path, handler, UNIQUE(service_id, method, path))` (source code, direct read)
- `tests/storage/query-engine.test.js` lines 39-64 — `makeQE()` helper pattern with migration chain (source code, direct read)
- `worker/db/query-engine.js` lines 653-681 — `detectMismatches()` try/catch guard for missing table (source code, direct read — pattern to follow for exposes guard)
- `.planning/config.json` — `workflow.nyquist_validation: true` (config, direct read)

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` — Phase 31 integration design: exposes query pattern, loadProject() fix, additive response shape analysis (planning artifact, HIGH)
- `.planning/phases/30-storage-correctness/30-RESEARCH.md` — migration 007 `kind` column definition; confirms `kind` is `TEXT NOT NULL DEFAULT 'endpoint'` (planning artifact, HIGH)

### Tertiary (LOW confidence)

- None. All findings are verified from source code.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing better-sqlite3 and node:test patterns confirmed in source
- Architecture: HIGH — `getGraph()`, `loadProject()`, and `/graph` route all read directly; change scope precisely bounded
- Pitfalls: HIGH — all four pitfalls derived from direct code inspection (explicit property allowlist, missing kind column, undefined vs empty array, stale HTTP mock)

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable domain — no external dependencies)
