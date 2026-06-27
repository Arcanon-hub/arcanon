/**
 * Scan-version diff engine —, , Task 2 .
 *
 * Computes a set-diff of services and connections between two scan-version IDs
 * across two open Database handles (node:sqlite adapter). Returns an
 * added/removed/modified report keyed by stable cross-scan identities
 * (`(repo_id, name)` for services, `(source_name, target_name, protocol,
 * method, path)` for connections).
 *
 * Engine-shape contract (load-bearing — callers pass two raw Database handles):
 *
 *   - Takes two raw Database handles (node:sqlite adapter) — NOT projectRoot
 *     strings, NOT pool keys. Callers may pass the same handle for both
 *     (`dbA === dbB`) or two distinct handles. The engine signature is the
 *     same regardless.
 *
 *   - Pool-agnostic. Imports nothing from `worker/db/pool.js` or
 *     `worker/db/database.js`. The defensive grep regression in
 *     `scan-version-diff.test.js` (test 18) enforces this — it greps for
 *     the forbidden pool-helper names and fails the build if any appear.
 *     Adding any pool import would silently break the raw-handle contract;
 *     the grep test catches it loudly.
 *
 *   - Read-only. Only SELECT statements; no INSERT / UPDATE / DELETE
 *     anywhere in the module. Test 15 snapshots row counts pre/post diff
 *     and asserts they're equal — would fail if the engine ever writes.
 *
 *   - Caller owns DB lifecycle. Engine never calls `db.close()`. Test 14
 *     asserts `db.open === true` post-diff.
 *
 * Algorithm (per 115-RESEARCH.md §4.2):
 *
 *   1. Short-circuit: if `dbA === dbB && scanIdA === scanIdB`, return a
 *      same_scan=true result with all empty arrays. (Different DBs but the
 *      same numeric ID does NOT short-circuit — different DBs can have
 *      different content under the same ID.)
 *
 *   2. Load services + connections from both sides via
 *      `loadServices` / `loadConnections`. Each loader projects the stable
 *      cross-scan key (service name) into the row, so cross-scan service
 *      re-IDs (a re-scan inserts new rows with new AUTOINCREMENT IDs) do
 *      not break diff matching.
 *
 *   3. Build JS Maps keyed by `JSON.stringify([...])` for stable string
 *      keys (no collisions even if names contain `|` or other delimiters).
 *      In-memory set-diff is preferred over SQL `EXCEPT` because (a) data
 *      volumes are tiny, (b) it requires no `ATTACH DATABASE` cross-handle
 *      acrobatics for, and (c) the field-diff for `modified` is
 *      cleaner in JS than as nested SELECTs. See RESEARCH §4.1.
 *
 *   4. Walk keys: in B only → added; in A only → removed; in both → run
 *      field-by-field diff and add to `modified` if any field differs.
 *      NULL is a real value: NULL → value and value → NULL count as
 *      changes.
 *
 * Field projections (per RESEARCH §2):
 *
 *   services key:    (repo_id, name)
 *   services fields: root_path, language, type, owner, auth_mechanism,
 *                    db_backend, boundary_entry, base_path
 *
 *   connections key:    (source_name, target_name, protocol_raw ?? protocol,
 *                        method, path)
 *   connections fields: protocol, source_file, target_file, crossing,
 *                       confidence, evidence, path_template
 *
 *   The key's protocol component prefers `protocol_raw` (the agent's original
 *   token, stable across the #42 canonicalization migration) and falls back to
 *   `protocol` for pre-019 rows where protocol_raw is NULL. It is trim+lowercased
 *   for IDENTITY STABILITY ONLY — "NATS", "nats", and " nats " key identically so
 *   casing/whitespace variants of the same token don't churn the diff. The
 *   displayed/projected protocol_raw value retains its original casing. This keeps
 *   the diff churn-free across the migration: a pre-ship row stored as raw "kafka"
 *   and a post-ship row stored as canonical "events" / protocol_raw "kafka"
 *   produce the SAME key, so the edge is not falsely reported as removed+added.
 *   The displayed/diffed `protocol` field is unchanged, so a genuine bucket change
 *   still surfaces as a modification.
 *
 * The engine does NOT truncate `evidence` (or any other field). Truncation
 * for human display is the formatter's job . Test 17 verifies
 * 500-char evidence passes through verbatim.
 */

// ---------------------------------------------------------------------------
// Field lists (single source of truth — keep in sync with RESEARCH §2)
// ---------------------------------------------------------------------------

const SERVICE_FIELDS = [
  "root_path",
  "language",
  "type",
  "owner",
  "auth_mechanism",
  "db_backend",
  "boundary_entry",
  "base_path",
];

const CONNECTION_FIELDS = [
  // #42: protocol is now a DIFFED field (not part of the identity key, which
  // keys on protocol_raw). A genuine canonical-bucket reassignment therefore
  // surfaces as a modification rather than removed+added.
  "protocol",
  "source_file",
  "target_file",
  "crossing",
  "confidence",
  "evidence",
  "path_template",
];

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Load all services for a scan, projecting the diff fields.
 *
 * @param {import('../db/sqlite-adapter.js').default} db
 * @param {number} scanVersionId
 * @returns {Array<object>} rows with repo_id + name + diff fields
 */
export function loadServices(db, scanVersionId) {
  return db
    .prepare(
      `SELECT id, repo_id, name,
              root_path, language, type,
              owner, auth_mechanism, db_backend,
              boundary_entry, base_path
       FROM services
       WHERE scan_version_id = ?`
    )
    .all(scanVersionId);
}

/**
 * Load all connections for a scan, JOINing through services to project the
 * stable cross-scan key (source_name + target_name).
 *
 * @param {import('../db/sqlite-adapter.js').default} db
 * @param {number} scanVersionId
 * @returns {Array<object>} rows with source_name + target_name + protocol +
 *   method + path + diff fields
 */
export function loadConnections(db, scanVersionId) {
  // #42: include c.protocol_raw so connectionKey can key on the stable original
  // token across the canonicalization migration. Graceful for pre-019 DBs: if
  // the column is absent the prepare throws, and we fall back to a SELECT that
  // projects protocol_raw as NULL (connectionKey then keys on protocol).
  try {
    return db
      .prepare(
        `SELECT
           src.name AS source_name,
           tgt.name AS target_name,
           c.protocol,
           c.protocol_raw,
           c.method,
           c.path,
           c.source_file,
           c.target_file,
           c.crossing,
           c.confidence,
           c.evidence,
           c.path_template
         FROM connections c
         JOIN services src ON src.id = c.source_service_id
         JOIN services tgt ON tgt.id = c.target_service_id
         WHERE c.scan_version_id = ?`
      )
      .all(scanVersionId);
  } catch {
    return db
      .prepare(
        `SELECT
           src.name AS source_name,
           tgt.name AS target_name,
           c.protocol,
           NULL AS protocol_raw,
           c.method,
           c.path,
           c.source_file,
           c.target_file,
           c.crossing,
           c.confidence,
           c.evidence,
           c.path_template
         FROM connections c
         JOIN services src ON src.id = c.source_service_id
         JOIN services tgt ON tgt.id = c.target_service_id
         WHERE c.scan_version_id = ?`
      )
      .all(scanVersionId);
  }
}

// ---------------------------------------------------------------------------
// Internal diff helpers
// ---------------------------------------------------------------------------

function serviceKey(row) {
  return JSON.stringify([row.repo_id, row.name]);
}

function connectionKey(row) {
  // #42: prefer the stable raw token; fall back to protocol for pre-019 rows.
  // Normalize the raw component for IDENTITY ONLY (trim + lowercase) so casing
  // and surrounding whitespace variants of the SAME token (e.g. "NATS", "nats",
  // " nats ") produce ONE key and don't churn the diff as removed+added. The
  // displayed/projected protocol_raw value (loadConnections) stays verbatim — only
  // this key component is normalized.
  const rawComponent = String(row.protocol_raw ?? row.protocol ?? "").trim().toLowerCase();
  return JSON.stringify([
    row.source_name,
    row.target_name,
    rawComponent,
    row.method ?? "",
    row.path ?? "",
  ]);
}

function buildMap(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    m.set(keyFn(r), r);
  }
  return m;
}

function fieldDiff(before, after, fields) {
  const changed = [];
  for (const f of fields) {
    const b = before[f] === undefined ? null : before[f];
    const a = after[f] === undefined ? null : after[f];
    if (b !== a) {
      changed.push({ field: f, before: b, after: a });
    }
  }
  return changed;
}

function diffSet(mapA, mapB, fields, projectKey) {
  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, rowB] of mapB) {
    if (!mapA.has(key)) {
      added.push(rowB);
    } else {
      const rowA = mapA.get(key);
      const changedFields = fieldDiff(rowA, rowB, fields);
      if (changedFields.length > 0) {
        modified.push({
          ...projectKey(rowB),
          before: rowA,
          after: rowB,
          changed_fields: changedFields,
        });
      }
    }
  }
  for (const [key, rowA] of mapA) {
    if (!mapB.has(key)) {
      removed.push(rowA);
    }
  }

  return { added, removed, modified };
}

function emptyResult(sameScan) {
  return {
    same_scan: sameScan,
    services: { added: [], removed: [], modified: [] },
    connections: { added: [], removed: [], modified: [] },
    summary: {
      services: { added: 0, removed: 0, modified: 0 },
      connections: { added: 0, removed: 0, modified: 0 },
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Diff two scan versions. Returns an added/removed/modified report for
 * services and connections plus a summary count grid.
 *
 * Short-circuits when `dbA === dbB && scanIdA === scanIdB` (same handle,
 * same id) — returns `same_scan: true` with all-empty arrays. Different DBs
 * with the same numeric ID do NOT short-circuit (different DBs can have
 * different content under the same ID).
 *
 * @param {import('../db/sqlite-adapter.js').default} dbA
 * @param {import('../db/sqlite-adapter.js').default} dbB
 * @param {number} scanIdA
 * @param {number} scanIdB
 * @returns {{
 *   same_scan: boolean,
 *   services: {added: object[], removed: object[], modified: object[]},
 *   connections: {added: object[], removed: object[], modified: object[]},
 *   summary: {services: {added:number,removed:number,modified:number}, connections: {added:number,removed:number,modified:number}}
 * }}
 */
export function diffScanVersions(dbA, dbB, scanIdA, scanIdB) {
  if (dbA === dbB && scanIdA === scanIdB) {
    return emptyResult(true);
  }

  const servicesA = loadServices(dbA, scanIdA);
  const servicesB = loadServices(dbB, scanIdB);
  const connsA = loadConnections(dbA, scanIdA);
  const connsB = loadConnections(dbB, scanIdB);

  const servicesMapA = buildMap(servicesA, serviceKey);
  const servicesMapB = buildMap(servicesB, serviceKey);
  const connsMapA = buildMap(connsA, connectionKey);
  const connsMapB = buildMap(connsB, connectionKey);

  const servicesDiff = diffSet(
    servicesMapA,
    servicesMapB,
    SERVICE_FIELDS,
    (row) => ({ repo_id: row.repo_id, name: row.name })
  );
  const connsDiff = diffSet(
    connsMapA,
    connsMapB,
    CONNECTION_FIELDS,
    (row) => ({
      source_name: row.source_name,
      target_name: row.target_name,
      protocol: row.protocol,
      method: row.method,
      path: row.path,
    })
  );

  return {
    same_scan: false,
    services: servicesDiff,
    connections: connsDiff,
    summary: {
      services: {
        added: servicesDiff.added.length,
        removed: servicesDiff.removed.length,
        modified: servicesDiff.modified.length,
      },
      connections: {
        added: connsDiff.added.length,
        removed: connsDiff.removed.length,
        modified: connsDiff.modified.length,
      },
    },
  };
}
