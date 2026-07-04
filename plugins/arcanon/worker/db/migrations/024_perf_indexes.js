/**
 * Migration 024 — Performance indexes for upstream-impact and scan-version
 * access patterns (PERF-03).
 *
 * Three indexes are missing from the current schema that are accessed
 * frequently by the upstream-impact CTE and scan-version-scoped queries in
 * endScan and the /api/verify route:
 *
 *   idx_connections_target_service_id
 *     ON connections(target_service_id)
 *     Serves: upstream-impact CTE (query-engine.js _stmtUpstream:
 *             WHERE target_service_id = ?) and detectMismatches.
 *
 *   idx_connections_scan_version_id
 *     ON connections(scan_version_id)
 *     Serves: endScan quality query, verify route
 *             (http.js:476-509, query-engine.js:1485).
 *
 *   idx_services_scan_version_id
 *     ON services(scan_version_id)
 *     Serves: endScan stale-row DELETE, quality breakdown
 *             (query-engine.js:1484-1520).
 *
 * Note on source_service_id: the UNIQUE index uq_connections_dedup already
 * has source_service_id as its leading column, so downstream CTE lookups
 * (WHERE source_service_id = ?) already use it efficiently. Only
 * target_service_id needs a standalone index.
 *
 * All three use CREATE INDEX IF NOT EXISTS (idempotent). The migration
 * version guard in runMigrations() prevents double-application; IF NOT EXISTS
 * is belt-and-suspenders for manual re-runs.
 *
 * Note: db.exec is the sqlite-adapter bulk-SQL execution method (wraps
 * node:sqlite DatabaseSync.exec). It runs DDL directly — no shell, no
 * process spawning, no user input.
 */

export const version = 24;

const DDL = `
  CREATE INDEX IF NOT EXISTS idx_connections_target_service_id
    ON connections(target_service_id);

  CREATE INDEX IF NOT EXISTS idx_connections_scan_version_id
    ON connections(scan_version_id);

  CREATE INDEX IF NOT EXISTS idx_services_scan_version_id
    ON services(scan_version_id);
`;

/**
 * @param {import('../sqlite-adapter.js').default} db
 */
export function up(db) {
  db.exec(DDL);
}
