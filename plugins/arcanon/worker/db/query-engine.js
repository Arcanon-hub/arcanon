/**
 * worker/query-engine.js — Read/write query layer over the Ligamen SQLite schema.
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
import { resolveConfigPath } from "../lib/config-path.js";

// ---------------------------------------------------------------------------
// LRU prepared statement cache (REL-04)
// ---------------------------------------------------------------------------

/**
 * Simple LRU cache for better-sqlite3 prepared statements.
 *
 * Uses a Map (which preserves insertion order) as the backing store.
 * On a cache hit, the entry is deleted and re-inserted to move it to the
 * "most recently used" end. On capacity overflow, the first (oldest) entry
 * is evicted.
 *
 * Cache key: the SQL template string (with ? placeholders).
 * Parameters are NOT part of the key — they are passed to .all()/.get()
 * on the returned statement just as with a directly-prepared statement.
 */
export class StmtCache {
  /**
   * @param {number} [capacity=50] - Maximum number of prepared statements to keep.
   */
  constructor(capacity = 50) {
    this._capacity = capacity;
    this._cache = new Map();
  }

  /**
   * Return a prepared statement for the given SQL, creating it if necessary.
   * Evicts the least-recently-used entry when capacity is exceeded.
   *
   * @param {string} sql - SQL template string (with ? placeholders).
   * @param {import('better-sqlite3').Database} db - Database instance to prepare on.
   * @returns {import('better-sqlite3').Statement}
   */
  get(sql, db) {
    if (this._cache.has(sql)) {
      // Move to end (most recently used)
      const stmt = this._cache.get(sql);
      this._cache.delete(sql);
      this._cache.set(sql, stmt);
      return stmt;
    }

    const stmt = db.prepare(sql);

    // Evict oldest (first) entry if at capacity
    if (this._cache.size >= this._capacity) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }

    this._cache.set(sql, stmt);
    return stmt;
  }

  /** Remove all cached statements. */
  clear() {
    this._cache.clear();
  }

  /** Number of cached statements. */
  get size() {
    return this._cache.size;
  }
}

/** Module-level LRU prepared statement cache instance (capacity 50). */
export const _stmtCache = new StmtCache(50);

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
      const ftsSql = `
        SELECT rowid AS id, name
        FROM services_fts
        WHERE services_fts MATCH ?
        LIMIT ?
      `;
      const ftsServices = _stmtCache.get(ftsSql, db).all(ftsQuery, perTable);

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
    const sqlLikeSql = `
      SELECT id, name, language AS type
      FROM services
      WHERE name LIKE ?
      LIMIT ?
    `;
    const sqlResults = _stmtCache.get(sqlLikeSql, db).all(
      "%" + query + "%",
      limit,
    );
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

// ---------------------------------------------------------------------------
// Binding sanitizer
// ---------------------------------------------------------------------------

/**
 * Converts any `undefined` values in a binding object to `null`.
 * better-sqlite3 throws TypeError for undefined bindings; null is always safe.
 * @param {object} obj
 * @returns {object}
 */
function sanitizeBindings(obj) {
  const out = {};
  for (const key of Object.keys(obj)) {
    out[key] = obj[key] === undefined ? null : obj[key];
  }
  return out;
}

export class QueryEngine {
  /**
   * @param {import('better-sqlite3').Database} db - An open better-sqlite3 instance.
   * @param {{ warn: (msg: string) => void } | null} [logger=null] - Optional structured logger.
   */
  constructor(db, logger = null) {
    this._db = db;
    this._logger = logger;

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
      INSERT INTO repos (path, name, type, last_commit, scanned_at)
      VALUES (@path, @name, @type, @last_commit, @scanned_at)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        last_commit = COALESCE(excluded.last_commit, last_commit),
        scanned_at = COALESCE(excluded.scanned_at, scanned_at)
    `);

    this._stmtUpsertService = db.prepare(`
      INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
      VALUES (@repo_id, @name, @root_path, @language, @type, @scan_version_id)
      ON CONFLICT(repo_id, name) DO UPDATE SET
        root_path = excluded.root_path,
        language = excluded.language,
        type = excluded.type,
        scan_version_id = excluded.scan_version_id
    `);

    // Try with confidence+evidence columns (migration 009). Fall back to
    // crossing-only (migration 008), then pre-migration-008 for compatibility.
    try {
      this._stmtUpsertConnection = db.prepare(`
        INSERT OR REPLACE INTO connections (source_service_id, target_service_id, protocol, method, path, source_file, target_file, scan_version_id, crossing, confidence, evidence)
        VALUES (@source_service_id, @target_service_id, @protocol, @method, @path, @source_file, @target_file, @scan_version_id, @crossing, @confidence, @evidence)
      `);
    } catch {
      // confidence/evidence columns not present — try with crossing only (migration 008)
      try {
        this._stmtUpsertConnection = db.prepare(`
          INSERT OR REPLACE INTO connections (source_service_id, target_service_id, protocol, method, path, source_file, target_file, scan_version_id, crossing)
          VALUES (@source_service_id, @target_service_id, @protocol, @method, @path, @source_file, @target_file, @scan_version_id, @crossing)
        `);
      } catch {
        // crossing column not present — pre-migration-008 database
        this._stmtUpsertConnection = db.prepare(`
          INSERT OR REPLACE INTO connections (source_service_id, target_service_id, protocol, method, path, source_file, target_file, scan_version_id)
          VALUES (@source_service_id, @target_service_id, @protocol, @method, @path, @source_file, @target_file, @scan_version_id)
        `);
      }
    }

    this._stmtBeginScan = db.prepare(
      "INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)"
    );
    this._stmtEndScan = db.prepare(
      "UPDATE scan_versions SET completed_at = ? WHERE id = ?"
    );
    this._stmtDeleteStaleConnections = db.prepare(`
      DELETE FROM connections
      WHERE source_service_id IN (
        SELECT id FROM services WHERE repo_id = ? AND scan_version_id != ? AND scan_version_id IS NOT NULL
      ) OR target_service_id IN (
        SELECT id FROM services WHERE repo_id = ? AND scan_version_id != ? AND scan_version_id IS NOT NULL
      )
    `);
    this._stmtDeleteStaleServices = db.prepare(
      "DELETE FROM services WHERE repo_id = ? AND scan_version_id != ? AND scan_version_id IS NOT NULL"
    );

    this._stmtDeleteNullConnections = db.prepare(`
      DELETE FROM connections
      WHERE source_service_id IN (SELECT id FROM services WHERE repo_id = ? AND scan_version_id IS NULL)
         OR target_service_id IN (SELECT id FROM services WHERE repo_id = ? AND scan_version_id IS NULL)
    `);
    this._stmtDeleteNullServices = db.prepare(
      "DELETE FROM services WHERE repo_id = ? AND scan_version_id IS NULL"
    );

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

    // --- Actor statements (migration 008) ---
    // Wrapped in try/catch for backward compatibility with pre-migration-008 databases.
    this._stmtUpsertActor = null;
    this._stmtUpsertActorConnection = null;
    this._stmtGetActorByName = null;
    this._stmtCheckKnownService = null;
    try {
      this._stmtUpsertActor = db.prepare(`
        INSERT INTO actors (name, kind, direction, source)
        VALUES (@name, @kind, @direction, @source)
        ON CONFLICT(name) DO UPDATE SET
          kind = excluded.kind,
          source = excluded.source
      `);

      this._stmtUpsertActorConnection = db.prepare(`
        INSERT OR REPLACE INTO actor_connections (actor_id, service_id, direction, protocol, path)
        VALUES (@actor_id, @service_id, @direction, @protocol, @path)
      `);

      this._stmtGetActorByName = db.prepare(`
        SELECT id FROM actors WHERE name = ?
      `);

      this._stmtCheckKnownService = db.prepare(`SELECT id FROM services WHERE name = ?`);
    } catch {
      // actors table doesn't exist yet — migration 008 not applied
      this._stmtUpsertActor = null;
      this._stmtUpsertActorConnection = null;
      this._stmtGetActorByName = null;
      this._stmtCheckKnownService = null;
    }

    // --- node_metadata statement (migration 008) ---
    this._stmtUpsertNodeMetadata = null;
    try {
      this._stmtUpsertNodeMetadata = db.prepare(`
        INSERT INTO node_metadata (service_id, view, key, value, updated_at)
        VALUES (@service_id, @view, @key, @value, datetime('now'))
        ON CONFLICT(service_id, view, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);
    } catch {
      // node_metadata table not present (pre-migration-008 db)
      this._stmtUpsertNodeMetadata = null;
    }
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
    { direction = "downstream", maxDepth = 7 } = {},
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
    this._stmtUpsertRepo.run({
      last_commit: null,
      scanned_at: null,
      ...repoData,
    });
    // lastInsertRowid is 0 when ON CONFLICT triggers an UPDATE (no insert).
    // Always query for the actual id by path to get the correct value.
    const row = this._db.prepare("SELECT id FROM repos WHERE path = ?").get(repoData.path);
    return { id: row.id };
  }

  /**
   * Inserts or replaces a service row.
   * @param {{ repo_id: number, name: string, root_path: string, language: string }} serviceData
   * @returns {number} Row id
   */
  upsertService(serviceData) {
    const result = this._stmtUpsertService.run(
      sanitizeBindings({ type: "service", scan_version_id: null, ...serviceData })
    );
    return result.lastInsertRowid;
  }

  /**
   * Inserts or replaces a connection row.
   * @param {{ source_service_id: number, target_service_id: number, protocol: string, method?: string, path?: string, source_file?: string, target_file?: string }} connData
   * @returns {number} Row id
   */
  upsertConnection(connData) {
    const result = this._stmtUpsertConnection.run(
      sanitizeBindings({
        method: null,
        path: null,
        source_file: null,
        target_file: null,
        scan_version_id: null,
        crossing: null,
        confidence: null,
        evidence: null,
        ...connData,
      })
    );
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
   * Inserts or updates a metadata key/value for a service in the given view.
   *
   * MUST NOT call beginScan/endScan - enrichment passes write metadata after
   * the scan bracket closes. This method creates no scan_versions rows.
   *
   * @param {number} serviceId - services.id
   * @param {string} view - Logical namespace (e.g., "ownership", "auth", "db")
   * @param {string} key - Key within the view (e.g., "owner", "auth_mechanism")
   * @param {string|null} value - Value to store (null clears the value)
   * @returns {number|null} lastInsertRowid, or null if node_metadata table absent
   */
  upsertNodeMetadata(serviceId, view, key, value) {
    if (!this._stmtUpsertNodeMetadata) return null;
    const result = this._stmtUpsertNodeMetadata.run({
      service_id: serviceId,
      view,
      key,
      value: value ?? null,
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
   * Opens a new scan bracket for the given repo.
   * Inserts a scan_versions row with the current ISO timestamp and returns
   * its integer ID. Pass this ID to persistFindings and endScan.
   *
   * @param {number} repoId
   * @returns {number} The new scan_versions row ID
   */
  beginScan(repoId) {
    const result = this._stmtBeginScan.run(repoId, new Date().toISOString());
    return result.lastInsertRowid;
  }

  /**
   * Closes a scan bracket. Does three things in order:
   *   1. UPDATE scan_versions SET completed_at = now WHERE id = scanVersionId
   *   2. DELETE stale connections (referencing stale service rows)
   *   3. DELETE stale services (scan_version_id != scanVersionId AND NOT NULL)
   *
   * Rows with scan_version_id IS NULL are NOT deleted — they are legacy
   * pre-bracket rows that survive until a subsequent scan replaces them.
   *
   * The connections DELETE runs first (no CASCADE on FK — connections reference
   * services by FK, so services cannot be deleted while connections exist).
   *
   * @param {number} repoId
   * @param {number} scanVersionId - The ID returned by beginScan
   */
  endScan(repoId, scanVersionId) {
    this._stmtEndScan.run(new Date().toISOString(), scanVersionId);

    // Clean up orphaned schema rows BEFORE deleting stale connections
    // (schemas FK references connections — must delete child rows first to avoid FK violation)
    //
    // Only keep schemas for connections belonging to the CURRENT scan version.
    // Both stale (scan_version_id != current) AND legacy NULL scan_version_id
    // connections will be deleted below, so their schemas must go first.
    try {
      this._db.prepare(`
        DELETE FROM fields WHERE schema_id IN (
          SELECT id FROM schemas WHERE connection_id NOT IN (
            SELECT id FROM connections WHERE scan_version_id = ?
          )
        )
      `).run(scanVersionId);
      this._db.prepare(`
        DELETE FROM schemas WHERE connection_id NOT IN (
          SELECT id FROM connections WHERE scan_version_id = ?
        )
      `).run(scanVersionId);
    } catch { /* schemas/fields tables may not exist */ }

    // Delete stale connections before stale services — no CASCADE on FK
    this._stmtDeleteStaleConnections.run(repoId, scanVersionId, repoId, scanVersionId);
    this._stmtDeleteStaleServices.run(repoId, scanVersionId);
    // Delete legacy NULL scan_version_id rows (pre-bracket rows) for this repo
    this._stmtDeleteNullConnections.run(repoId, repoId);
    this._stmtDeleteNullServices.run(repoId);
    // Clean up actor_connections for deleted services
    // (no CASCADE on the stale-service DELETE since it goes through scan_version_id filtering)
    try {
      this._db.prepare(`
        DELETE FROM actor_connections
        WHERE service_id NOT IN (SELECT id FROM services)
      `).run();
    } catch { /* actors table may not exist — migration 008 not applied */ }

    // Clean up any remaining orphaned schema rows (belt-and-suspenders cleanup)
    try {
      this._db.prepare(`
        DELETE FROM fields WHERE schema_id NOT IN (SELECT id FROM schemas)
      `).run();
      this._db.prepare(`
        DELETE FROM schemas WHERE connection_id NOT IN (SELECT id FROM connections)
      `).run();
    } catch { /* schemas/fields tables may not exist */ }
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
      SELECT s.id, s.name, s.root_path, s.language, s.type, s.repo_id, r.name as repo_name, r.path as repo_path, s.scan_version_id
      FROM services s
      JOIN repos r ON r.id = s.repo_id
    `,
      )
      .all();

    const latest_scan_version_id = services.reduce(
      (max, s) => (s.scan_version_id != null && (max === null || s.scan_version_id > max))
        ? s.scan_version_id
        : max,
      null
    );

    // Attach exposes per service node
    try {
      const allExposes = this._db
        .prepare('SELECT service_id, method, path, kind, handler FROM exposed_endpoints')
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

    let connections;
    try {
      connections = this._db
        .prepare(
          `
        SELECT c.id, c.protocol, c.method, c.path, c.source_file, c.target_file,
               s_src.name as source, s_tgt.name as target, c.scan_version_id,
               c.confidence, c.evidence
        FROM connections c
        JOIN services s_src ON c.source_service_id = s_src.id
        JOIN services s_tgt ON c.target_service_id = s_tgt.id
      `,
        )
        .all();
    } catch {
      // confidence/evidence columns not yet present (migration 009 not applied)
      connections = this._db
        .prepare(
          `
        SELECT c.id, c.protocol, c.method, c.path, c.source_file, c.target_file,
               s_src.name as source, s_tgt.name as target, c.scan_version_id,
               null as confidence, null as evidence
        FROM connections c
        JOIN services s_src ON c.source_service_id = s_src.id
        JOIN services s_tgt ON c.target_service_id = s_tgt.id
      `,
        )
        .all();
    }

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

    // Fetch actors and their connected services (graceful if migration 008 not applied)
    let actors = [];
    try {
      const actorRows = this._db
        .prepare("SELECT id, name, kind, direction, source FROM actors")
        .all();

      const actorConnStmt = this._db.prepare(`
        SELECT ac.protocol, ac.path, ac.direction, s.name as service_name, s.id as service_id
        FROM actor_connections ac
        JOIN services s ON s.id = ac.service_id
        WHERE ac.actor_id = ?
      `);

      actors = actorRows.map((a) => ({
        ...a,
        connected_services: actorConnStmt.all(a.id),
      }));
    } catch {
      // actors table doesn't exist yet (migration 008 not applied)
    }

    // Fetch schemas grouped by connection_id (graceful if schemas/fields absent)
    let schemas_by_connection = {};
    try {
      const schemaRows = this._db.prepare(`
        SELECT s.id as schema_id, s.connection_id, s.name, s.role, s.file,
               f.name as field_name, f.type as field_type, f.required as field_required
        FROM schemas s
        LEFT JOIN fields f ON f.schema_id = s.id
      `).all();

      const schemaMap = new Map(); // schema_id → { name, role, file, fields[] }
      for (const row of schemaRows) {
        const key = String(row.connection_id);
        if (!schemas_by_connection[key]) schemas_by_connection[key] = [];
        if (!schemaMap.has(row.schema_id)) {
          const schemaObj = { name: row.name, role: row.role, file: row.file, fields: [] };
          schemaMap.set(row.schema_id, schemaObj);
          schemas_by_connection[key].push(schemaObj);
        }
        if (row.field_name !== null) {
          schemaMap.get(row.schema_id).fields.push({
            name: row.field_name,
            type: row.field_type,
            required: row.field_required === 1,
          });
        }
      }
    } catch {
      // schemas/fields tables absent — return empty map
    }

    // Enrich services with owner/auth_mechanism/db_backend from node_metadata (graceful if absent)
    try {
      const metaRows = this._db.prepare(`
        SELECT service_id, key, value
        FROM node_metadata
        WHERE view IN ('enrichment', 'security', 'infra', 'ownership')
          AND key IN ('owner', 'owners', 'auth_mechanism', 'db_backend')
      `).all();
      const metaByService = {};
      for (const row of metaRows) {
        if (!metaByService[row.service_id]) metaByService[row.service_id] = {};
        metaByService[row.service_id][row.key] = row.value;
      }
      for (const svc of services) {
        const meta = metaByService[svc.id] || {};
        svc.owner = meta.owner ?? null;
        svc.auth_mechanism = meta.auth_mechanism ?? null;
        svc.db_backend = meta.db_backend ?? null;
      }
    } catch {
      // node_metadata table absent (pre-migration-008 DB)
      for (const svc of services) {
        svc.owner = null;
        svc.auth_mechanism = null;
        svc.db_backend = null;
      }
    }

    return { services, connections, repos, mismatches, actors, latest_scan_version_id, schemas_by_connection };
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
   * @param {number} [scanVersionId] - Optional scan version ID from beginScan(). When
   *   provided, every upserted service and connection row is stamped with this ID.
   */
  persistFindings(repoId, findings, commit, scanVersionId) {
    const serviceIdMap = new Map(); // name → id

    // 1. Upsert services
    for (const svc of findings.services || []) {
      const id = this.upsertService({
        repo_id: repoId,
        name: svc.name,
        root_path: svc.root_path || ".",
        language: svc.language || "unknown",
        type: svc.type || "service",
        scan_version_id: scanVersionId ?? null,
      });
      serviceIdMap.set(svc.name, id);
    }

    // 2. Upsert connections (resolve source/target names to IDs)
    for (const conn of findings.connections || []) {
      const sourceId =
        serviceIdMap.get(conn.source) || this._resolveServiceId(conn.source, repoId);
      const targetId =
        serviceIdMap.get(conn.target) || this._resolveServiceId(conn.target, repoId);
      if (!sourceId || !targetId) continue; // skip if service not found

      const connId = this.upsertConnection({
        source_service_id: sourceId,
        target_service_id: targetId,
        protocol: conn.protocol || "unknown",
        method: conn.method || null,
        path: conn.path || null,
        source_file: conn.source_file || null,
        target_file: conn.target_file || null,
        scan_version_id: scanVersionId ?? null,
        crossing: conn.crossing || null,
        confidence: conn.confidence || null,
        evidence: conn.evidence || null,
      });

      // Detect external actors: when crossing='external', the target is an
      // external system. Create/upsert an actor for it and link to the source
      // service via actor_connections.
      // SBUG-01: skip actor creation if target matches a known service in this DB.
      if (conn.crossing === "external" && this._stmtUpsertActor && this._stmtGetActorByName) {
        const actorName = conn.target; // target service name = actor name
        const knownService = this._stmtCheckKnownService
          ? this._stmtCheckKnownService.get(actorName)
          : null;
        if (!knownService) {
          this._stmtUpsertActor.run({
            name: actorName,
            kind: "system",
            direction: "outbound",
            source: "scan",
          });
          const actorRow = this._stmtGetActorByName.get(actorName);
          if (actorRow) {
            this._stmtUpsertActorConnection.run({
              actor_id: actorRow.id,
              service_id: sourceId,
              direction: "outbound",
              protocol: conn.protocol || null,
              path: conn.path || null,
            });
          }
        }
      }

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
        } else if (svc.type === 'infra') {
          kind = 'resource';
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

    // 6. Update repo_state
    if (commit) {
      this.setRepoState(repoId, commit);
    }
  }

  /**
   * Resolve a service name to its ID (for cross-repo connections).
   *
   * Resolution order:
   * 1. If repoId is provided and a service with that name exists in that repo,
   *    return it immediately (same-repo exact match — no ambiguity possible).
   * 2. If no same-repo match (or no repoId given), query all services with
   *    that name globally.
   * 3. Zero rows → return null.
   * 4. Exactly one row → return its id (unambiguous cross-repo reference, no warning).
   * 5. Multiple rows → emit logger.warn (or console.warn fallback) and return the first match's id.
   *
   * @param {string} name
   * @param {number|null} [repoId=null]
   * @returns {number|null}
   */
  _resolveServiceId(name, repoId = null) {
    // Step 1: same-repo exact match
    if (repoId != null) {
      const row = this._db
        .prepare("SELECT id FROM services WHERE name = ? AND repo_id = ?")
        .get(name, repoId);
      if (row) return row.id;
    }

    // Step 2: global lookup
    const rows = this._db
      .prepare("SELECT id, repo_id FROM services WHERE name = ?")
      .all(name);

    // Step 3: not found
    if (rows.length === 0) return null;

    // Step 4: unambiguous
    if (rows.length === 1) return rows[0].id;

    // Step 5: ambiguous — warn and return first match
    (this._logger?.warn ?? console.warn)(
      '[ligamen] Ambiguous service name "' + name + '" matches ' + rows.length +
      ' repos — using id ' + rows[0].id + '. Scope your connection to avoid collisions.'
    );
    return rows[0].id;
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

// ---------------------------------------------------------------------------
// Enrichment helpers (exported for use by MCP tool handlers)
// ---------------------------------------------------------------------------

/**
 * Build a type-aware summary sentence for an impact_query result.
 * Best-effort — returns { results, summary } where summary may be a plain
 * count phrase when type/boundary data is unavailable.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} serviceName
 * @param {Array} results
 * @returns {{ results: Array, summary: string }}
 */
export function enrichImpactResult(db, serviceName, results) {
  let summary = `${results.length} connection(s) found`;
  if (!db) return { results, summary };
  try {
    // 1. Resolve service type
    const svcRow = db
      .prepare("SELECT type FROM services WHERE name = ? LIMIT 1")
      .get(serviceName);
    const nodeType = svcRow?.type || "service";

    // 2. Load boundary membership from arcanon.config.json
    let boundaryLabel = "";
    try {
      const cfgPath = resolveConfigPath(process.cwd());
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const boundaries = cfg.boundaries || {};
      for (const [bName, members] of Object.entries(boundaries)) {
        if (members.includes(serviceName)) { boundaryLabel = bName; break; }
      }
    } catch { /* config absent — no boundary label */ }

    const count = results.length;
    const boundaryPart = boundaryLabel ? ` in the ${boundaryLabel} boundary` : "";

    if (nodeType === "library" || nodeType === "sdk") {
      summary = `${nodeType} ${serviceName} is used by ${count} service(s)${boundaryPart}`;
    } else if (nodeType === "infra") {
      summary = `infrastructure node ${serviceName} has ${count} dependent(s)${boundaryPart}`;
    } else {
      summary = `service ${serviceName} has ${count} connection(s)${boundaryPart}`;
    }
  } catch { /* best-effort */ }

  // Annotate each result item with owner/auth_mechanism/db_backend from node_metadata
  try {
    if (results.length > 0) {
      const serviceNames = results.map(r => r.service).filter(Boolean);
      if (serviceNames.length > 0) {
        const placeholders = serviceNames.map(() => '?').join(',');
        const metaRows = db.prepare(`
          SELECT nm.key, nm.value, s.name as service_name
          FROM node_metadata nm
          JOIN services s ON s.id = nm.service_id
          WHERE nm.view IN ('enrichment', 'security', 'infra', 'ownership')
            AND nm.key IN ('owner', 'owners', 'auth_mechanism', 'db_backend')
            AND s.name IN (${placeholders})
        `).all(...serviceNames);

        const metaByService = {};
        for (const row of metaRows) {
          if (!metaByService[row.service_name]) metaByService[row.service_name] = {};
          metaByService[row.service_name][row.key] = row.value;
        }

        results = results.map(r => {
          const meta = metaByService[r.service] || {};
          return {
            ...r,
            owner: meta.owner ?? null,
            auth_mechanism: meta.auth_mechanism ?? null,
            db_backend: meta.db_backend ?? null,
          };
        });
      }
    }
  } catch { /* node_metadata absent — skip enrichment */ }

  return { results, summary };
}

/**
 * Annotate each affected service in queryChanged results with owner/auth_mechanism/db_backend
 * from node_metadata. Best-effort — never throws.
 *
 * @param {import('better-sqlite3').Database|null} db
 * @param {Array<{service: string, connection_count: number}>} affected
 * @returns {Array<{service: string, connection_count: number, owner: string|null, auth_mechanism: string|null, db_backend: string|null}>}
 */
export function enrichAffectedResult(db, affected) {
  if (!db || affected.length === 0) {
    return affected.map(r => ({ ...r, owner: null, auth_mechanism: null, db_backend: null }));
  }
  try {
    const serviceNames = affected.map(r => r.service).filter(Boolean);
    if (serviceNames.length === 0) {
      return affected.map(r => ({ ...r, owner: null, auth_mechanism: null, db_backend: null }));
    }

    const placeholders = serviceNames.map(() => '?').join(',');
    const metaRows = db.prepare(`
      SELECT nm.key, nm.value, s.name as service_name
      FROM node_metadata nm
      JOIN services s ON s.id = nm.service_id
      WHERE nm.view IN ('enrichment', 'security', 'infra', 'ownership')
        AND nm.key IN ('owner', 'owners', 'auth_mechanism', 'db_backend')
        AND s.name IN (${placeholders})
    `).all(...serviceNames);

    const metaByService = {};
    for (const row of metaRows) {
      if (!metaByService[row.service_name]) metaByService[row.service_name] = {};
      metaByService[row.service_name][row.key] = row.value;
    }

    return affected.map(r => {
      const meta = metaByService[r.service] || {};
      return {
        ...r,
        owner: meta.owner ?? null,
        auth_mechanism: meta.auth_mechanism ?? null,
        db_backend: meta.db_backend ?? null,
      };
    });
  } catch {
    return affected.map(r => ({ ...r, owner: null, auth_mechanism: null, db_backend: null }));
  }
}

/**
 * Append actor_sentences to each search result row.
 * Each sentence follows the pattern:
 *   "source-service connects to external ActorName via PROTOCOL"
 * Best-effort — rows with no actors get actor_sentences: [].
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{ path: string, protocol: string, source_service: string, target_service: string }>} results
 * @returns {Array}
 */
export function enrichSearchResult(db, results) {
  if (!db) return results.map((row) => ({ ...row, actor_sentences: [] }));
  try {
    const stmt = db.prepare(`
      SELECT a.name AS actor_name, ac.protocol AS actor_protocol, s.name AS service_name
      FROM actor_connections ac
      JOIN actors a ON a.id = ac.actor_id
      JOIN services s ON s.id = ac.service_id
      WHERE s.name = ?
    `);

    return results.map((row) => {
      try {
        const actorRows = stmt.all(row.source_service);
        const actor_sentences = actorRows.map(
          (ar) =>
            `${ar.service_name} connects to external ${ar.actor_name} via ${ar.actor_protocol || "unknown"}`
        );
        return { ...row, actor_sentences };
      } catch {
        return { ...row, actor_sentences: [] };
      }
    });
  } catch {
    // actors table absent — return results with empty actor_sentences
    return results.map((row) => ({ ...row, actor_sentences: [] }));
  }
}
