/**
 * Migration 009 — Add confidence/enrichment columns for the v5.3.0 enrichment pipeline.
 *
 * CONF-01: connections table gets confidence TEXT and evidence TEXT columns
 *   - confidence: agent-emitted confidence score (NULL = not yet detected)
 *   - evidence: agent-emitted snippet justifying the confidence (NULL = not yet detected)
 *
 * CONF-02: services table gets owner TEXT, auth_mechanism TEXT, db_backend TEXT columns
 *   - owner: CODEOWNERS team handle (NULL = not yet resolved)
 *   - auth_mechanism: auth protocol string (jwt, oauth2, api_key, etc.; NULL = not yet detected)
 *   - db_backend: database backend (postgresql, mysql, mongodb, etc.; NULL = not yet detected)
 *
 * schemas + fields tables each get scan_version_id INTEGER FK column
 *   - Enables stale-row cleanup in phase 71 (same pattern as services/connections)
 *
 * All column additions are idempotent via PRAGMA table_info checks.
 * CREATE INDEX IF NOT EXISTS is always idempotent — no guard needed.
 */

export const version = 9;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // Helper: returns true if the named column exists in the table
  const hasCol = (table, col) =>
    db.prepare("PRAGMA table_info(" + table + ")").all().some((c) => c.name === col);

  // connections: confidence TEXT (agent-emitted; NULL = not yet detected)
  if (!hasCol("connections", "confidence")) {
    db.exec("ALTER TABLE connections ADD COLUMN confidence TEXT;");
  }

  // connections: evidence TEXT (agent-emitted snippet; NULL = not yet detected)
  if (!hasCol("connections", "evidence")) {
    db.exec("ALTER TABLE connections ADD COLUMN evidence TEXT;");
  }

  // services: owner TEXT (CODEOWNERS team handle; NULL = not yet resolved)
  if (!hasCol("services", "owner")) {
    db.exec("ALTER TABLE services ADD COLUMN owner TEXT;");
  }

  // services: auth_mechanism TEXT (jwt, oauth2, api_key, etc.)
  if (!hasCol("services", "auth_mechanism")) {
    db.exec("ALTER TABLE services ADD COLUMN auth_mechanism TEXT;");
  }

  // services: db_backend TEXT (postgresql, mysql, mongodb, etc.)
  if (!hasCol("services", "db_backend")) {
    db.exec("ALTER TABLE services ADD COLUMN db_backend TEXT;");
  }

  // schemas: scan_version_id INTEGER FK (enables stale cleanup in phase 71)
  if (!hasCol("schemas", "scan_version_id")) {
    db.exec(
      "ALTER TABLE schemas ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id);"
    );
  }

  // fields: scan_version_id INTEGER FK (enables stale cleanup in phase 71)
  if (!hasCol("fields", "scan_version_id")) {
    db.exec(
      "ALTER TABLE fields ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id);"
    );
  }

  // Indexes: CREATE INDEX IF NOT EXISTS is always idempotent — no guard needed
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_connections_confidence ON connections(confidence);"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_schemas_scan_version ON schemas(scan_version_id);"
  );
}
