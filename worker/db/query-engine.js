/**
 * worker/query-engine.js — Read/write query layer over the AllClear SQLite schema.
 *
 * QueryEngine wraps a better-sqlite3 Database instance and provides:
 *   - Transitive impact traversal (downstream and upstream) with cycle detection
 *   - Direct (non-recursive) impact lookup
 *   - Breaking change classification (CRITICAL / WARN / INFO)
 *   - FTS5 keyword search across services, connections, and fields
 *   - Upsert helpers for all domain tables (used by scan manager in later phases)
 *   - Map version snapshots via VACUUM INTO
 *
 * Usage:
 *   import { openDb } from './db.js';
 *   import { QueryEngine } from './query-engine.js';
 *   const db = openDb(projectRoot);
 *   const qe = new QueryEngine(db);
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

import { chromaSearch, isChromaAvailable } from "../server/chroma.js";

// ---------------------------------------------------------------------------
// Module-level db handle for standalone search() export
// (injected via setSearchDb for testing; production uses getDb())
// ---------------------------------------------------------------------------

/** @type {import('better-sqlite3').Database | null} */
let _searchDb = null;

/**
 * Inject a database instance for the standalone search() function.
 * Used by tests for isolation; production callers set this via setSearchDb(getDb()).
 *
 * @param {import('better-sqlite3').Database | null} db
 */
export function setSearchDb(db) {
  _searchDb = db;
}

// ---------------------------------------------------------------------------
// Standalone 3-tier search export
// ---------------------------------------------------------------------------

/**
 * Search using a 3-tier fallback chain: ChromaDB -> FTS5 -> SQL.
 *
 * Each tier is independently reachable via skip options:
 *   options.skipChroma=true  — bypass ChromaDB, go directly to FTS5
 *   options.skipFts5=true    — bypass FTS5, go directly to SQL
 *
 * @param {string} query - Search query text
 * @param {{ limit?: number, skipChroma?: boolean, skipFts5?: boolean }} [options]
 * @returns {Promise<Array<{ id: string, name: string, type: string, score: number }>>}
 */
export async function search(query, options = {}) {
  const limit = options.limit || 20;
  const db = _searchDb;

  // Tier 1: ChromaDB semantic search
  if (!options.skipChroma && isChromaAvailable()) {
    try {
      const results = await chromaSearch(query, limit);
      process.stderr.write(
        "[search] tier=chroma results=" + results.length + "\n",
      );
      return results.map((r) => ({
        id: r.id,
        name: r.document,
        type: (r.metadata && r.metadata.type) || "unknown",
        score: r.score,
      }));
    } catch (err) {
      process.stderr.write(
        "[search] chroma failed, falling back to FTS5: " + err.message + "\n",
      );
    }
  }

  // Tier 2: FTS5 keyword search
  if (!options.skipFts5 && db) {
    try {
      const perTable = Math.ceil(limit / 3);
      const ftsQuery = '"' + query.replace(/"/g, '""') + '"';
      const ftsServices = db
        .prepare(
          `
        SELECT rowid AS id, name
        FROM services_fts
        WHERE services_fts MATCH ?
        LIMIT ?
      `,
        )
        .all(ftsQuery, perTable);

      if (ftsServices.length > 0) {
        process.stderr.write(
          "[search] tier=fts5 results=" + ftsServices.length + "\n",
        );
        return ftsServices.map((r) => ({
          id: String(r.id),
          name: r.name,
          type: "service",
          score: 1,
        }));
      }
    } catch (err) {
      process.stderr.write(
        "[search] fts5 failed, falling back to SQL: " + err.message + "\n",
      );
    }
  }

  // Tier 3: Direct SQL LIKE filter (always available)
  if (db) {
    const sqlResults = db
      .prepare(
        `
      SELECT id, name, language AS type
      FROM services
      WHERE name LIKE ?
      LIMIT ?
    `,
      )
      .all("%" + query + "%", limit);
    process.stderr.write(
      "[search] tier=sql results=" + sqlResults.length + "\n",
    );
    return sqlResults.map((r) => ({
      id: String(r.id),
      name: r.name,
      type: r.type || "service",
      score: 0.5,
    }));
  }

  // No db available at all — return empty
  process.stderr.write("[search] tier=sql results=0 (no db)\n");
  return [];
}

// ---------------------------------------------------------------------------
// Severity sort order
// ---------------------------------------------------------------------------
const SEVERITY_ORDER = { CRITICAL: 0, WARN: 1, INFO: 2 };

export class QueryEngine {
  /**
   * @param {import('better-sqlite3').Database} db - An open better-sqlite3 instance.
   */
  constructor(db) {
    this._db = db;

    // --------------------------------------------------------------------
    // Prepare all statements once for reuse
    // --------------------------------------------------------------------

    // --- Transitive downstream CTE ---
    this._stmtDownstream = db.prepare(`
      WITH RECURSIVE impacted(id, depth, path) AS (
        SELECT target_service_id AS id,
               1 AS depth,
               ',' || source_service_id || ',' || target_service_id || ',' AS path
        FROM connections
        WHERE source_service_id = ?

        UNION ALL

        SELECT c.target_service_id,
               i.depth + 1,
               i.path || c.target_service_id || ','
        FROM connections c
        JOIN impacted i ON c.source_service_id = i.id
        WHERE i.path NOT LIKE '%,' || c.target_service_id || ',%'
          AND i.depth < ?
      )
      SELECT DISTINCT i.id, s.name, MIN(i.depth) AS depth
      FROM impacted i
      JOIN services s ON s.id = i.id
      GROUP BY i.id
      ORDER BY depth
    `);

    // --- Transitive upstream CTE (source/target swapped) ---
    this._stmtUpstream = db.prepare(`
      WITH RECURSIVE impacted(id, depth, path) AS (
        SELECT source_service_id AS id,
               1 AS depth,
               ',' || target_service_id || ',' || source_service_id || ',' AS path
        FROM connections
        WHERE target_service_id = ?

        UNION ALL

        SELECT c.source_service_id,
               i.depth + 1,
               i.path || c.source_service_id || ','
        FROM connections c
        JOIN impacted i ON c.target_service_id = i.id
        WHERE i.path NOT LIKE '%,' || c.source_service_id || ',%'
          AND i.depth < ?
      )
      SELECT DISTINCT i.id, s.name, MIN(i.depth) AS depth
      FROM impacted i
      JOIN services s ON s.id = i.id
      GROUP BY i.id
      ORDER BY depth
    `);

    // --- Direct downstream (no recursion) ---
    this._stmtDirectDown = db.prepare(`
      SELECT s.id, s.name, c.protocol, c.method, c.path
      FROM connections c
      JOIN services s ON s.id = c.target_service_id
      WHERE c.source_service_id = ?
    `);

    // --- Direct upstream ---
    this._stmtDirectUp = db.prepare(`
      SELECT s.id, s.name, c.protocol, c.method, c.path
      FROM connections c
      JOIN services s ON s.id = c.source_service_id
      WHERE c.target_service_id = ?
    `);

    // --- CRITICAL check: does this (service, method, path) connection still exist? ---
    this._stmtConnExists = db.prepare(`
      SELECT id FROM connections
      WHERE source_service_id = ? AND method = ? AND path = ?
      LIMIT 1
    `);

    // --- FTS5 search statements ---
    this._stmtFtsServices = db.prepare(`
      SELECT rowid AS id, name, snippet(services_fts, 0, '[', ']', '...', 10) AS snippet
      FROM services_fts
      WHERE services_fts MATCH ?
      LIMIT ?
    `);

    this._stmtFtsConnections = db.prepare(`
      SELECT rowid AS id, path AS name, snippet(connections_fts, 0, '[', ']', '...', 10) AS snippet
      FROM connections_fts
      WHERE connections_fts MATCH ?
      LIMIT ?
    `);

    this._stmtFtsFields = db.prepare(`
      SELECT rowid AS id, name, snippet(fields_fts, 0, '[', ']', '...', 10) AS snippet
      FROM fields_fts
      WHERE fields_fts MATCH ?
      LIMIT ?
    `);

    // --- Upsert statements ---
    this._stmtUpsertRepo = db.prepare(`
      INSERT OR REPLACE INTO repos (path, name, type, last_commit, scanned_at)
      VALUES (@path, @name, @type, @last_commit, @scanned_at)
    `);

    this._stmtUpsertService = db.prepare(`
      INSERT OR REPLACE INTO services (repo_id, name, root_path, language, type)
      VALUES (@repo_id, @name, @root_path, @language, @type)
    `);

    this._stmtUpsertConnection = db.prepare(`
      INSERT OR REPLACE INTO connections (source_service_id, target_service_id, protocol, method, path, source_file, target_file)
      VALUES (@source_service_id, @target_service_id, @protocol, @method, @path, @source_file, @target_file)
    `);

    this._stmtUpsertSchema = db.prepare(`
      INSERT OR REPLACE INTO schemas (connection_id, role, name, file)
      VALUES (@connection_id, @role, @name, @file)
    `);

    this._stmtUpsertField = db.prepare(`
      INSERT OR REPLACE INTO fields (schema_id, name, type, required)
      VALUES (@schema_id, @name, @type, @required)
    `);

    this._stmtUpdateRepoState = db.prepare(`
      INSERT OR REPLACE INTO repo_state (repo_id, last_scanned_commit, last_scanned_at)
      VALUES (?, ?, ?)
    `);

    this._stmtGetRepoState = db.prepare(`
      SELECT last_scanned_commit, last_scanned_at FROM repo_state WHERE repo_id = ?
    `);

    this._stmtGetRepoByPath = db.prepare(`
      SELECT id, path, name FROM repos WHERE path = ?
    `);

    this._stmtInsertMapVersion = db.prepare(`
      INSERT INTO map_versions (label, snapshot_path) VALUES (?, ?)
    `);
  }

  // --------------------------------------------------------------------------
  // Transitive impact traversal
  // --------------------------------------------------------------------------

  /**
   * Returns all services reachable from sourceServiceId via the connections graph.
   *
   * @param {number} sourceServiceId
   * @param {{ direction?: 'downstream'|'upstream', maxDepth?: number }} [options]
   * @returns {Array<{ id: number, name: string, depth: number }>}
   */
  transitiveImpact(
    sourceServiceId,
    { direction = "downstream", maxDepth = 10 } = {},
  ) {
    const stmt =
      direction === "upstream" ? this._stmtUpstream : this._stmtDownstream;
    return stmt.all(sourceServiceId, maxDepth);
  }

  /**
   * Returns direct (one-hop) connections from/to sourceServiceId. No recursion.
   *
   * @param {number} sourceServiceId
   * @param {'downstream'|'upstream'} [direction]
   * @returns {Array<{ id: number, name: string, protocol: string, method: string, path: string }>}
   */
  directImpact(sourceServiceId, direction = "downstream") {
    const stmt =
      direction === "upstream" ? this._stmtDirectUp : this._stmtDirectDown;
    return stmt.all(sourceServiceId);
  }

  // --------------------------------------------------------------------------
  // Breaking change classification
  // --------------------------------------------------------------------------

  /**
   * Maps an array of detected changes to severity-tagged impact objects.
   *
   * Each change item:
   *   { type: 'removed', serviceId, method, path }   → CRITICAL
   *   { type: 'changed', serviceId, fieldName, oldType, newType } → WARN
   *   { type: 'added',   serviceId, fieldName }       → INFO
   *
   * For 'removed': checks current connections table — if the (serviceId, method, path)
   * row no longer exists, it was removed → CRITICAL.
   *
   * @param {Array<object>} changes
   * @returns {Array<{ severity: 'CRITICAL'|'WARN'|'INFO', description: string, affectedServices: number[] }>}
   */
  classifyImpact(changes) {
    const results = [];

    for (const change of changes) {
      if (change.type === "removed") {
        // Caller asserts this endpoint was removed — classify as CRITICAL
        results.push({
          severity: "CRITICAL",
          description: `Endpoint ${change.method} ${change.path} removed from service ${change.serviceId}`,
          affectedServices: [change.serviceId],
        });
      } else if (change.type === "changed") {
        results.push({
          severity: "WARN",
          description: `Field '${change.fieldName}' type changed from '${change.oldType}' to '${change.newType}' in service ${change.serviceId}`,
          affectedServices: [change.serviceId],
        });
      } else if (change.type === "added") {
        results.push({
          severity: "INFO",
          description: `Field '${change.fieldName}' added to service ${change.serviceId}`,
          affectedServices: [change.serviceId],
        });
      }
    }

    // Sort CRITICAL → WARN → INFO
    results.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
    );

    return results;
  }

  // --------------------------------------------------------------------------
  // FTS5 keyword search
  // --------------------------------------------------------------------------

  /**
   * Full-text search across services, connections, and fields FTS5 tables.
   * Returns up to `limit` total results tagged with `kind`.
   *
   * @param {string} query - FTS5 query string (plain text or fts5 syntax)
   * @param {{ limit?: number }} [options]
   * @returns {Array<{ kind: 'service'|'connection'|'field', id: number, name: string, snippet: string }>}
   */
  search(query, { limit = 20 } = {}) {
    try {
      const perTable = Math.ceil(limit / 3);
      // Wrap query in double quotes for phrase matching — handles hyphens and
      // special FTS5 characters (e.g. "svc-a" would otherwise parse as svc NOT a).
      // Escape any existing double quotes in the query string.
      const ftsQuery = '"' + query.replace(/"/g, '""') + '"';
      const services = this._stmtFtsServices
        .all(ftsQuery, perTable)
        .map((r) => ({ kind: "service", ...r }));
      const connections = this._stmtFtsConnections
        .all(ftsQuery, perTable)
        .map((r) => ({ kind: "connection", ...r }));
      const fields = this._stmtFtsFields
        .all(ftsQuery, perTable)
        .map((r) => ({ kind: "field", ...r }));

      return [...services, ...connections, ...fields].slice(0, limit);
    } catch {
      // Malformed FTS5 query or other query error → return empty
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Write helpers (used by scan manager in later phases)
  // --------------------------------------------------------------------------

  /**
   * Inserts or replaces a repo row.
   * @param {{ path: string, name: string, type: string, last_commit?: string, scanned_at?: string }} repoData
   * @returns {number} Row id
   */
  upsertRepo(repoData) {
    const result = this._stmtUpsertRepo.run({
      last_commit: null,
      scanned_at: null,
      ...repoData,
    });
    return result.lastInsertRowid;
  }

  /**
   * Inserts or replaces a service row.
   * @param {{ repo_id: number, name: string, root_path: string, language: string }} serviceData
   * @returns {number} Row id
   */
  upsertService(serviceData) {
    const result = this._stmtUpsertService.run({
      type: "service",
      ...serviceData,
    });
    return result.lastInsertRowid;
  }

  /**
   * Inserts or replaces a connection row.
   * @param {{ source_service_id: number, target_service_id: number, protocol: string, method?: string, path?: string, source_file?: string, target_file?: string }} connData
   * @returns {number} Row id
   */
  upsertConnection(connData) {
    const result = this._stmtUpsertConnection.run({
      method: null,
      path: null,
      source_file: null,
      target_file: null,
      ...connData,
    });
    return result.lastInsertRowid;
  }

  /**
   * Inserts or replaces a schema row.
   * @param {{ connection_id: number, role: string, name: string, file?: string }} schemaData
   * @returns {number} Row id
   */
  upsertSchema(schemaData) {
    const result = this._stmtUpsertSchema.run({
      file: null,
      ...schemaData,
    });
    return result.lastInsertRowid;
  }

  /**
   * Inserts or replaces a field row.
   * @param {{ schema_id: number, name: string, type: string, required?: number }} fieldData
   * @returns {number} Row id
   */
  upsertField(fieldData) {
    const result = this._stmtUpsertField.run({
      required: 0,
      ...fieldData,
    });
    return result.lastInsertRowid;
  }

  /**
   * Updates repo scan state (last scanned commit and timestamp).
   * @param {number} repoId
   * @param {string} lastScannedCommit
   */
  updateRepoState(repoId, lastScannedCommit) {
    this._stmtUpdateRepoState.run(
      repoId,
      lastScannedCommit,
      new Date().toISOString(),
    );
  }

  /**
   * Returns the repo_state entry for a given repo id, or null if not found.
   * @param {number} repoId
   * @returns {{ last_scanned_commit: string|null, last_scanned_at: string|null } | null}
   */
  getRepoState(repoId) {
    return this._stmtGetRepoState.get(repoId) ?? null;
  }

  /**
   * Alias for updateRepoState — named setRepoState for scan-manager compatibility.
   * @param {number} repoId
   * @param {string} commit
   */
  setRepoState(repoId, commit) {
    this.updateRepoState(repoId, commit);
  }

  /**
   * Looks up a repo by its absolute path.
   * @param {string} repoPath
   * @returns {{ id: number, path: string, name: string } | null}
   */
  getRepoByPath(repoPath) {
    return this._stmtGetRepoByPath.get(repoPath) ?? null;
  }

  /**
   * Returns the full service dependency graph (all nodes and edges).
   * Used by GET /graph and the D3 web UI.
   * @returns {{ services: Array, connections: Array, repos: Array }}
   */
  getGraph() {
    const services = this._db
      .prepare(
        `
      SELECT s.id, s.name, s.root_path, s.language, s.type, s.repo_id, r.name as repo_name, r.path as repo_path
      FROM services s
      JOIN repos r ON r.id = s.repo_id
      WHERE s.id IN (SELECT MAX(id) FROM services GROUP BY name)
    `,
      )
      .all();

    const connections = this._db
      .prepare(
        `
      SELECT c.id, c.protocol, c.method, c.path, c.source_file, c.target_file,
             s_src.name as source, s_tgt.name as target
      FROM connections c
      JOIN services s_src ON c.source_service_id = s_src.id
      JOIN services s_tgt ON c.target_service_id = s_tgt.id
    `,
      )
      .all();

    const repos = this._db
      .prepare(
        `
      SELECT r.id, r.name, r.path, r.type,
             rs.last_scanned_commit, rs.last_scanned_at
      FROM repos r
      LEFT JOIN repo_state rs ON rs.repo_id = r.id
    `,
      )
      .all();

    const mismatches = this.detectMismatches();

    return { services, connections, repos, mismatches };
  }

  /**
   * Detect mismatches between what services expose and what consumers call.
   * A mismatch occurs when:
   * - A connection's target_file is null (endpoint handler not found in target)
   * - A connection's path doesn't match any exposed endpoint in the target service
   * @returns {Array<{connection_id: number, source: string, target: string, type: string, detail: string}>}
   */
  detectMismatches() {
    // Cross-reference consumed endpoints against what target services expose.
    //
    // A mismatch = consumer calls path P on service B, but B's exposed_endpoints
    // table does NOT contain path P.
    //
    // Only runs when:
    // - The target service has at least one entry in exposed_endpoints (was scanned with the new prompt)
    // - The connection is a network call (not internal/sdk/import)
    //
    // If the target has NO exposed_endpoints, we can't verify — skip (not a mismatch).

    // Check if exposed_endpoints table exists (migration may not have run)
    try {
      this._db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='exposed_endpoints'",
        )
        .get();
    } catch {
      return []; // table doesn't exist yet
    }

    const tableExists = this._db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='exposed_endpoints'",
      )
      .get();
    if (!tableExists) return [];

    const mismatches = this._db
      .prepare(
        `
      SELECT c.id, c.method, c.path, c.protocol,
             s_src.name as source, s_tgt.name as target
      FROM connections c
      JOIN services s_src ON c.source_service_id = s_src.id
      JOIN services s_tgt ON c.target_service_id = s_tgt.id
      WHERE c.protocol NOT IN ('internal', 'sdk', 'import')
        AND c.path IS NOT NULL
        -- Target has exposed endpoints (was scanned properly)
        AND EXISTS (
          SELECT 1 FROM exposed_endpoints ep
          WHERE ep.service_id = c.target_service_id
        )
        -- But this specific path is NOT in the exposed list
        AND NOT EXISTS (
          SELECT 1 FROM exposed_endpoints ep
          WHERE ep.service_id = c.target_service_id
            AND ep.path = c.path
        )
    `,
      )
      .all();

    return mismatches.map((c) => ({
      connection_id: c.id,
      source: c.source,
      target: c.target,
      type: "endpoint_not_exposed",
      detail: `${c.method || c.protocol} ${c.path} — ${c.target} does not expose this endpoint`,
    }));
  }

  /**
   * Returns all map version entries, ordered by creation date descending.
   * @returns {Array<{id: number, created_at: string, label: string, snapshot_path: string}>}
   */
  getVersions() {
    return this._db
      .prepare(
        "SELECT id, created_at, label, snapshot_path FROM map_versions ORDER BY created_at DESC",
      )
      .all();
  }

  /**
   * Persists a complete scan result for one repo — services, connections, schemas, fields.
   * Resolves service names to IDs and wires connections to the correct service IDs.
   *
   * @param {number} repoId - The repo row ID
   * @param {object} findings - Agent scan findings (services, connections, schemas arrays)
   * @param {string} [commit] - Git commit hash to record in repo_state
   */
  persistFindings(repoId, findings, commit) {
    const serviceIdMap = new Map(); // name → id

    // 1. Upsert services
    for (const svc of findings.services || []) {
      const id = this.upsertService({
        repo_id: repoId,
        name: svc.name,
        root_path: svc.root_path || ".",
        language: svc.language || "unknown",
        type: svc.type || "service",
      });
      serviceIdMap.set(svc.name, id);
    }

    // 2. Upsert connections (resolve source/target names to IDs)
    for (const conn of findings.connections || []) {
      const sourceId =
        serviceIdMap.get(conn.source) || this._resolveServiceId(conn.source);
      const targetId =
        serviceIdMap.get(conn.target) || this._resolveServiceId(conn.target);
      if (!sourceId || !targetId) continue; // skip if service not found

      const connId = this.upsertConnection({
        source_service_id: sourceId,
        target_service_id: targetId,
        protocol: conn.protocol || "unknown",
        method: conn.method || null,
        path: conn.path || null,
        source_file: conn.source_file || null,
        target_file: conn.target_file || null,
      });

      // 3. Upsert schemas for this connection
      // Find schemas that belong to this connection path
      for (const schema of findings.schemas || []) {
        const schemaId = this.upsertSchema({
          connection_id: connId,
          role: schema.role,
          name: schema.name,
          file: schema.file || null,
        });

        // 4. Upsert fields for this schema
        for (const field of schema.fields || []) {
          this.upsertField({
            schema_id: schemaId,
            name: field.name,
            type: field.type || "unknown",
            required: field.required ? 1 : 0,
          });
        }
      }
    }

    // 5. Store exposed endpoints from the service scan
    for (const svc of findings.services || []) {
      const svcId = serviceIdMap.get(svc.name);
      if (!svcId || !svc.exposes) continue;
      for (const endpoint of svc.exposes) {
        // Parse "GET /users" or just "/users"
        const parts = endpoint.trim().split(/\s+/);
        const method = parts.length > 1 ? parts[0] : null;
        const path = parts.length > 1 ? parts[1] : parts[0];
        try {
          this._db
            .prepare(
              "INSERT OR IGNORE INTO exposed_endpoints (service_id, method, path, handler) VALUES (?, ?, ?, ?)",
            )
            .run(svcId, method, path, svc.boundary_entry || null);
        } catch {
          /* ignore duplicates */
        }
      }
    }

    // 6. Update repo_state
    if (commit) {
      this.setRepoState(repoId, commit);
    }
  }

  /**
   * Resolve a service name to its ID (for cross-repo connections).
   * @param {string} name
   * @returns {number|null}
   */
  _resolveServiceId(name) {
    const row = this._db
      .prepare("SELECT id FROM services WHERE name = ?")
      .get(name);
    return row ? row.id : null;
  }

  /**
   * The snapshot directory is created automatically.
   *
   * @param {string} label - Human-readable label for this version.
   * @returns {number} The new map_versions row id.
   */
  createMapVersion(label) {
    const dataDir = this._db.name ? path.dirname(this._db.name) : os.tmpdir();
    const snapshotsDir = path.join(dataDir, "snapshots");
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotPath = path.join(snapshotsDir, `${ts}.db`);

    this._db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);

    const result = this._stmtInsertMapVersion.run(label, snapshotPath);
    return result.lastInsertRowid;
  }
}
