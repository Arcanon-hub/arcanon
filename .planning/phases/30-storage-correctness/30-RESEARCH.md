# Phase 30: Storage Correctness - Research

**Researched:** 2026-03-17
**Domain:** SQLite schema migration + type-conditional persistence (better-sqlite3, Node.js ESM)
**Confidence:** HIGH — all findings sourced from direct codebase inspection with zero external dependencies to evaluate

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STORE-01 | Migration 007 adds `kind` column to `exposed_endpoints` with type-conditional values (`endpoint`, `export`, `resource`) | `ALTER TABLE ... ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint'` is instant and non-destructive; existing rows silently receive `'endpoint'`; confirmed via migration 003 schema and SQLite ADD COLUMN semantics |
| STORE-02 | Migration 007 purges malformed `exposed_endpoints` rows for non-service nodes so re-scan inserts correctly | Confirmed: `INSERT OR IGNORE` with `UNIQUE(service_id, method, path)` silently skips correct rows when a malformed row occupies the same key; purge must happen in the same migration before the fixed parser lands |
| STORE-03 | `persistFindings()` uses type-conditional parsing — services parse "METHOD PATH", libraries store raw signature, infra stores raw resource reference | Broken parser confirmed at `query-engine.js` lines 797–815; `svc.type` field is already available in `findings.services[i]`; dispatch replaces split logic entirely |
</phase_requirements>

---

## Summary

Phase 30 is a data correctness phase with two deliverables: a database migration and a parser fix. Both are contained in two files — one new, one existing.

The `exposed_endpoints` table was designed for REST endpoints only. When library and infra scan types were added, their agent outputs were piped through the same `"METHOD PATH"` whitespace-split parser in `persistFindings()`. This silently produces malformed rows: a library export like `"createClient(config: ClientConfig): EdgeworksClient"` is stored with `method="createClient(config:"` and `path="ClientConfig):"`. An infra resource like `"k8s:ingress/payment → payment.example.com"` is stored with `method="k8s:ingress/payment"` and `path="→"`. None of these raise errors — the `INSERT OR IGNORE` swallows them and the malformed rows sit in the DB blocking future correct inserts.

Migration 007 must do two things in sequence: (1) add the `kind TEXT NOT NULL DEFAULT 'endpoint'` column so the fixed parser can tag rows, and (2) DELETE all existing malformed non-REST rows so re-scan can insert correct rows. Without the DELETE, `INSERT OR IGNORE` will silently skip every corrected row on re-scan because the malformed row already occupies the `UNIQUE(service_id, method, path)` key.

**Primary recommendation:** Write migration 007 with the ADD COLUMN followed immediately by the DELETE purge. Fix `persistFindings()` to dispatch on `svc.type`. Both changes land in the same phase before any API or UI work.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.8.0 | SQLite persistence — migration runner and query engine | Already the project's DB layer; synchronous API matches migration pattern in 001–006 |
| Node.js built-in `node:test` | >= 18 (project uses 20+) | Test runner for storage correctness verification | Already used in `tests/storage/query-engine.test.js`; no new install required |

### No New Dependencies

This phase requires zero new npm packages. The migration file follows the established pattern in `worker/db/migrations/001–006`. The `persistFindings()` fix is a logic change inside an existing method.

**Installation:**
```bash
# Nothing to install
```

---

## Architecture Patterns

### Migration File Pattern

All migrations in this project follow the same structure. File `003_exposed_endpoints.js` is the canonical reference:

```javascript
// Source: worker/db/migrations/003_exposed_endpoints.js
export const version = 3;

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ...
  `);
}
```

Migration 007 must export `version = 7` and a `up(db)` function. The migration runner reads `version` to record in `schema_versions`.

### Recommended Project Structure

```
worker/
└── db/
    ├── migrations/
    │   └── 007_expose_kind.js     # NEW — ADD COLUMN + DELETE purge
    └── query-engine.js            # MODIFIED — persistFindings() dispatch only
tests/
└── storage/
    └── query-engine.test.js       # MODIFIED — add migration007 import + test cases
```

### Pattern 1: ALTER TABLE ADD COLUMN with DEFAULT

Adding a column with a DEFAULT is instant and safe on existing rows in SQLite. No table rebuild occurs. All existing rows silently receive the default value.

```sql
-- Source: SQLite ALTER TABLE documentation + migration 003 pattern
ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint';
```

After this runs: every existing row has `kind = 'endpoint'`. No data is read or written to existing rows — the default is applied lazily by SQLite.

### Pattern 2: DELETE Purge Before Fixed Parser

The DELETE must run in the same `up(db)` function as the ADD COLUMN, after the column is added. This ensures the purge and the column addition are atomic (wrapped in the migration runner's transaction).

```javascript
// Source: worker/db/migrations/003 pattern + STATE.md decision
export function up(db) {
  db.exec(`
    ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint';
  `);

  // Purge malformed rows that will block correct inserts on re-scan.
  // REST endpoint rows always have method IS NOT NULL (e.g. "GET", "POST").
  // Library/infra rows from the broken parser have method IS NULL and
  // non-URL-path values (REST URL paths always start with '/').
  // Predicate: method IS NULL AND path NOT LIKE '/%'
  // Safe: REST rows with method=NULL have paths starting with '/';
  //       malformed library/infra rows have paths like "ClientConfig):", "→", "k8s:ingress/payment"
  db.exec(`
    DELETE FROM exposed_endpoints
    WHERE method IS NULL AND path NOT LIKE '/%';
  `);
}
```

The predicate `method IS NULL AND path NOT LIKE '/%'` targets only rows produced by the broken parser for library/infra types. REST endpoint rows always have a non-null method (HTTP verb). This predicate must be validated against a real DB with pre-existing library/infra scans before shipping — see Open Questions.

### Pattern 3: Type-Conditional Dispatch in `persistFindings()`

Replace lines 797–815 of `worker/db/query-engine.js`. The `svc.type` field is already present on every findings service object.

```javascript
// Source: worker/db/query-engine.js lines 797-815 (REPLACE)
// worker/scan/agent-prompt-library.md + agent-prompt-infra.md (format confirmation)
for (const svc of findings.services || []) {
  const svcId = serviceIdMap.get(svc.name);
  if (!svcId || !svc.exposes) continue;

  for (const item of svc.exposes) {
    let method = null;
    let path = item.trim();
    let kind = 'endpoint';

    if (svc.type === 'service') {
      const parts = item.trim().split(/\s+/);
      if (parts.length > 1) { method = parts[0]; path = parts[1]; }
      kind = 'endpoint';
    } else if (svc.type === 'library' || svc.type === 'sdk') {
      kind = 'export';
      // method stays null; path is the full function signature or type name
    } else if (svc.type === 'infra') {
      kind = 'resource';
      // method stays null; path is the full resource ref ("k8s:deployment/name")
    }

    try {
      this._db
        .prepare(
          'INSERT OR IGNORE INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)'
        )
        .run(svcId, method, path, svc.boundary_entry || null, kind);
    } catch { /* ignore duplicates */ }
  }
}
```

Key change: the INSERT now includes the `kind` column. For service rows, behavior is identical to the current code. For library/sdk and infra rows, the full string is stored as `path` with `method = null`.

### Anti-Patterns to Avoid

- **Using `INSERT OR REPLACE` instead of `INSERT OR IGNORE`:** Would cascade-delete child rows if any existed. The current schema has no child tables referencing `exposed_endpoints`, but `INSERT OR IGNORE` is safer and matches existing code style. Safe after the DELETE purge clears stale rows.
- **Running migration 007 without the DELETE:** Leaving malformed rows guarantees that re-scan after the fix produces no new data. The corrected rows conflict with the stale malformed rows under `INSERT OR IGNORE` and are silently skipped.
- **Putting the DELETE in a separate migration 008:** The corrected rows must land in an empty-of-malformed-data table. If 007 only adds the column and a new scan runs before 008, those scans still produce malformed rows (the parser hasn't been fixed yet) which then get tagged with a `kind` value. Combine ADD COLUMN and DELETE in a single `up()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Running migration 007 | Custom migration runner | Existing migration runner in `worker/db/database.js` | Already reads `version` export and wraps `up()` in a transaction against `schema_versions` |
| Verifying migration correctness | Manual DB inspection script | `node --test tests/storage/query-engine.test.js` with new test cases added to the existing file | Test infrastructure already imports migrations 001–005; adding migration006/007 follows the same pattern |
| Detecting malformed rows | Ad-hoc REGEXP | `method IS NULL AND path NOT LIKE '/%'` predicate | SQLite has no built-in REGEXP without an extension; `LIKE` is sufficient for this predicate |

**Key insight:** Both deliverables for Phase 30 are modifications to existing, well-understood patterns. The migration pattern is repeated six times already; the INSERT statement in `persistFindings()` only gains a `kind` column and a type-dispatch wrapper.

---

## Common Pitfalls

### Pitfall 1: Malformed Rows Block Correct Inserts on Re-scan

**What goes wrong:** Migration 007 adds the `kind` column but does not delete existing malformed rows. After deploying the fixed `persistFindings()`, a re-scan of a library repo tries to insert `(service_id, NULL, "createClient(config: ClientConfig): EdgeworksClient", kind='export')`. The UNIQUE constraint fires on the existing malformed row `(service_id, NULL, "ClientConfig):")` — same service_id and same method=NULL, but different path — so the new row does NOT conflict with the old row. However, the old malformed row `(service_id, "createClient(config:", "ClientConfig):")` also exists with a non-null method. These old rows will never be replaced by correct rows. The library panel will show both old malformed rows and new correct rows.

More critically: for infra rows where the broken parser produced `(service_id, NULL, "→")`, re-scan correctly inserts the full string. But the old `"→"` row remains and pollutes results.

**Prevention:** DELETE all rows where `method IS NULL AND path NOT LIKE '/%'` AND also delete rows where `method` looks like a function fragment (not an HTTP verb). The safest approach: DELETE all rows for any `service_id` whose service has `type IN ('library', 'sdk', 'infra')`. See Open Questions for predicate finalization.

**Warning signs:** After re-scan, `SELECT path, kind FROM exposed_endpoints WHERE service_id = <lib_id>` returns both full signatures (new correct rows) AND short fragments (old malformed rows).

### Pitfall 2: SQLite NULL UNIQUE Semantics

**What goes wrong:** Assuming two rows with `method = NULL` will conflict on the UNIQUE constraint.

**How to avoid:** SQLite treats each NULL as distinct in UNIQUE indexes. `(service_id=1, method=NULL, path="fn1")` and `(service_id=1, method=NULL, path="fn2")` are allowed. `(service_id=1, method=NULL, path="fn1")` inserted twice DOES conflict (same path). This means library/infra dedup works correctly by path alone — no special handling needed.

**Source:** `sqlite.org/nulls.html` (confirmed in SUMMARY.md research, MEDIUM confidence).

### Pitfall 3: Missing `kind` Column in INSERT Causes Runtime Error

**What goes wrong:** The fixed `persistFindings()` includes `kind` in the INSERT column list. If migration 007 has not run when the updated code is deployed, every persist call throws a "table exposed_endpoints has no column named kind" error.

**Prevention:** Migration 007 must run (via the migration runner at DB open time) before any scan results are persisted. The existing migration runner handles this automatically — it runs all pending migrations when `openDb()` is called. Phase 30 plan must deploy migration file before testing the parser fix.

### Pitfall 4: Test Helper `makeQE()` Runs Only Migrations 001–005

**What goes wrong:** The existing `makeQE()` helper in `tests/storage/query-engine.test.js` imports and runs migrations 001–005 only. New tests for Phase 30 that need the `kind` column will fail with "no column named kind" unless migration 006 (dedup_repos) and migration 007 (expose_kind) are also added to the `makeQE()` loop.

**Prevention:** Add `migration006` and `migration007` imports and add them to the migrations array in `makeQE()` before writing any new test assertions. The pattern is already established on lines 22–60 of the test file.

---

## Code Examples

### Migration 007 Complete File

```javascript
// Source: worker/db/migrations/003_exposed_endpoints.js pattern
// File: worker/db/migrations/007_expose_kind.js (NEW)

export const version = 7;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // Add kind discriminant: 'endpoint' | 'export' | 'resource'
  // DEFAULT 'endpoint' backfills all existing service rows instantly.
  db.exec(`
    ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint';
  `);

  // Purge malformed rows from the broken "METHOD PATH" parser.
  // These rows were inserted for library/sdk/infra services before
  // the type-conditional parser was added. They block correct rows
  // from being inserted on re-scan via INSERT OR IGNORE.
  //
  // Predicate: method IS NULL AND path NOT LIKE '/%'
  //   - REST rows with method=NULL (edge case) have paths starting with '/'
  //   - Malformed library rows: path = "ClientConfig):", "EdgeworksClient", etc.
  //   - Malformed infra rows: path = "→", "payment.example.com", etc.
  //   - Correct infra rows (k8s:deployment/...) do NOT start with '/'
  //     so they are purged here — they will be re-inserted correctly on next scan
  db.exec(`
    DELETE FROM exposed_endpoints
    WHERE method IS NULL AND path NOT LIKE '/%';
  `);
}
```

### Updated `makeQE()` Helper for Tests

```javascript
// Source: tests/storage/query-engine.test.js lines 22-60 (EXTEND)
import * as migration006 from "../../worker/db/migrations/006_dedup_repos.js";
import * as migration007 from "../../worker/db/migrations/007_expose_kind.js";

// In makeQE():
for (const m of [migration001, migration002, migration003, migration004, migration005, migration006, migration007]) {
  db.transaction(() => {
    m.up(db);
    db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(m.version);
  })();
}
```

### Verification SQL for Tests

```sql
-- STORE-01: kind column exists with default
SELECT kind FROM exposed_endpoints LIMIT 1;
-- Expected: returns 'endpoint' (or any value — column exists)

-- STORE-02: malformed rows purged
SELECT COUNT(*) FROM exposed_endpoints WHERE method IS NULL AND path NOT LIKE '/%';
-- Expected: 0

-- STORE-03 (library): full signatures stored
SELECT path, kind FROM exposed_endpoints WHERE service_id = <lib_id>;
-- Expected: path = "createClient(config: ClientConfig): EdgeworksClient", kind = 'export'

-- STORE-03 (infra): full resource refs stored
SELECT path, kind FROM exposed_endpoints WHERE service_id = <infra_id>;
-- Expected: path = "k8s:deployment/payment-service", kind = 'resource'

-- STORE-03 (service): unchanged
SELECT method, path, kind FROM exposed_endpoints WHERE service_id = <svc_id>;
-- Expected: method = "GET", path = "/users", kind = 'endpoint'
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "METHOD PATH" whitespace split for all types | Type-conditional dispatch: service splits, library/infra store raw string | Phase 30 (this phase) | Correct data for library exports and infra resources |
| No `kind` column — all rows treated as REST endpoints | `kind` discriminant: `'endpoint'` / `'export'` / `'resource'` | Phase 30 (this phase) | Enables type-aware filtering in API and UI layers |
| Malformed rows persisted silently | Malformed rows purged in migration 007 before new rows insert | Phase 30 (this phase) | Re-scan produces correct results instead of being blocked |

**No deprecated approaches to note** — this phase introduces the correct approach for the first time.

---

## Open Questions

1. **DELETE predicate validation against real DB with pre-existing library/infra scans**
   - What we know: `method IS NULL AND path NOT LIKE '/%'` targets malformed library/infra rows; correct REST rows always have `method IS NOT NULL`
   - What's unclear: whether any edge cases exist in real user data that match the predicate but should not be deleted (e.g., a REST service that exposed a root-level path with no method via an unusual scan)
   - Recommendation: The plan for task 30-01 must include a manual verification step: run the DELETE predicate as a SELECT first against the actual project DB and inspect the result set before writing the migration. This is documented in STATE.md as a blocker.

2. **`boundary_entry` column decision — add to `services` table in migration 007 or defer**
   - What we know: `persistFindings()` already receives `svc.boundary_entry` and passes it as `handler` to `exposed_endpoints`; the agent schema documents `boundary_entry` as a top-level service field; `services` table does not have a `boundary_entry` column
   - What's unclear: whether Phase 32 library panel needs `boundary_entry` as a source-file link (P2 feature); adding it to migration 007 avoids a separate migration 008 later
   - Recommendation: Defer to task 30-01 implementation — decide before writing the migration file. Deferring is safe because the Phase 32 source-file link is P2 (optional). If added, it is a second `ALTER TABLE services ADD COLUMN boundary_entry TEXT` in the same `up()` function.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no external install) |
| Config file | None — invoked directly via `node --test` |
| Quick run command | `node --test tests/storage/query-engine.test.js` |
| Full suite command | `node --test tests/storage/query-engine.test.js` (same — only storage tests exist for this domain) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STORE-01 | `kind` column present with default `'endpoint'` after migration 007 runs | unit | `node --test tests/storage/query-engine.test.js` | ❌ Wave 0 — new test cases needed |
| STORE-02 | Zero rows with `method IS NULL AND path NOT LIKE '/%'` after migration 007 | unit | `node --test tests/storage/query-engine.test.js` | ❌ Wave 0 — new test cases needed |
| STORE-03 (library) | After `persistFindings()` with a library scan, `SELECT path, kind` returns full signature with `kind='export'` | unit | `node --test tests/storage/query-engine.test.js` | ❌ Wave 0 — new test cases needed |
| STORE-03 (infra) | After `persistFindings()` with an infra scan, `SELECT path, kind` returns full resource ref with `kind='resource'` | unit | `node --test tests/storage/query-engine.test.js` | ❌ Wave 0 — new test cases needed |
| STORE-03 (service) | After `persistFindings()` with a service scan, `SELECT method, path, kind` still returns split REST format with `kind='endpoint'` | unit | `node --test tests/storage/query-engine.test.js` | ❌ Wave 0 — regression test needed |

### Sampling Rate

- **Per task commit:** `node --test tests/storage/query-engine.test.js`
- **Per wave merge:** `node --test tests/storage/query-engine.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] New `describe("migration 007")` block in `tests/storage/query-engine.test.js` — covers STORE-01, STORE-02
- [ ] New `describe("persistFindings kind dispatch")` block in `tests/storage/query-engine.test.js` — covers STORE-03 (library, infra, service)
- [ ] `makeQE()` helper update to import and run `migration006` + `migration007` — prerequisite for all new tests
- [ ] Migration 007 file `worker/db/migrations/007_expose_kind.js` — must exist before test file can import it

---

## Sources

### Primary (HIGH confidence)

- `worker/db/query-engine.js` lines 797–815 — confirmed broken "METHOD PATH" parser and `INSERT OR IGNORE` pattern
- `worker/db/migrations/003_exposed_endpoints.js` — current `exposed_endpoints` schema: `method TEXT`, `path TEXT NOT NULL`, `UNIQUE(service_id, method, path)`, no `kind` column
- `worker/db/migrations/` directory listing — confirmed 001–006 exist; next migration is 007
- `worker/scan/agent-prompt-library.md` — library exposes format: function signatures like `"createClient(config: ClientConfig): EdgeworksClient"` (multi-word, contains spaces — breaks the split parser)
- `worker/scan/agent-prompt-infra.md` — infra exposes format: `"k8s:deployment/name"` and `"k8s:ingress/payment → payment.example.com"` (space in ingress format confirms parser failure)
- `worker/scan/agent-schema.json` — `exposes` as `["string"]`; format is type-conditional
- `tests/storage/query-engine.test.js` — confirmed test framework (Node.js `node:test`), `makeQE()` helper pattern, migrations 001–005 imported; migration 006 NOT yet imported
- `package.json` — `"test:storage": "node --test tests/storage/query-engine.test.js"` confirmed; zero new dependencies needed
- `.planning/STATE.md` — confirmed decisions: `kind` discriminant column approach locked; migration 007 DELETE predicate requires real-DB validation (flagged as blocker)

### Secondary (MEDIUM confidence)

- `.planning/research/SUMMARY.md` — SQLite NULL UNIQUE behavior confirmed: each NULL is distinct; `(service_id, NULL, "path1")` twice conflicts; `(service_id, NULL, "path1")` and `(service_id, NULL, "path2")` do not
- `.planning/research/ARCHITECTURE.md` — full data-flow diagram and exact code patches confirmed by prior codebase inspection pass

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external deps; confirmed from direct package.json and migration file inspection
- Architecture patterns: HIGH — migration pattern confirmed from six existing examples; parser fix location confirmed at exact lines
- Pitfalls: HIGH — all failure modes traced to actual code paths; `INSERT OR IGNORE` blocking scenario analytically confirmed

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable domain — SQLite schema patterns change slowly; Node.js built-in test runner is stable)
