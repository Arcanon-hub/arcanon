/**
 * worker/query-engine.js — Read/write query layer over the Arcanon SQLite schema.
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
// Path canonicalization (TRUST-03)
// ---------------------------------------------------------------------------

/**
 * Canonicalize a connection path by replacing every `{xxx}` template variable
 * with `{_}`. Used by persistFindings to collapse template-variant connections
 * (e.g. /runtime/streams/{stream_id} and /runtime/streams/{name} both become
 * /runtime/streams/{_}). Returns null/empty unchanged so we don't mint a `{_}`
 * for paths the agent didn't claim.
 *
 * Out of scope this phase: Express `:id` style, OpenAPI named groups, JAX-RS
 * constraint suffixes. See 109-CONTEXT.md D-06 in
 * .planning/phases/109-path-canonicalization-and-evidence/.
 *
 * @param {string|null|undefined} pathStr
 * @returns {string|null}
 */
export function canonicalizePath(pathStr) {
  if (pathStr == null) return null;
  if (pathStr === "") return "";
  return pathStr.replace(/\{[^/}]+\}/g, "{_}");
}

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

// ---------------------------------------------------------------------------
// base_path strip helper (TRUST-04 / Phase 110)
// ---------------------------------------------------------------------------

/**
 * Strips a target service's `base_path` from an outbound connection path,
 * if and only if the prefix is at a path-segment boundary.
 *
 * Algorithm (D-02 + D-03):
 *   1. If basePath is null/empty/undefined → return null (no strip applies).
 *   2. Normalize trailing slash on basePath.
 *   3. If connPath === basePath → return "/" (full match collapses to root).
 *   4. If connPath starts with basePath + "/" → return connPath.slice(bp.length).
 *   5. Otherwise (substring without segment boundary, or no prefix at all) → return null.
 *
 * Returns null in every "no strip" case — callers should fall back to literal
 * compare (which preserves correctness when basePath is absent).
 *
 * @param {string} connPath - Outbound connection path (the "candidate to strip from")
 * @param {string|null|undefined} basePath - Target service's base_path
 * @returns {string|null} Stripped path, or null when no strip applies.
 */
export function stripBasePath(connPath, basePath) {
  if (basePath == null || basePath === "") return null;
  // Normalize trailing slash
  const bp = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (bp === "") return null;
  if (connPath === bp) return "/";
  if (connPath.startsWith(bp + "/")) return connPath.slice(bp.length);
  // bp is a substring but not a path-segment boundary, OR no prefix at all.
  return null;
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

    // Try with base_path column (migration 014, TRUST-04). Fall back through
    // migration-011 (boundary_entry only), then pre-011 plain shape for older
    // databases. Mirrors the connections.path_template multi-tier fallback.
    this._hasBasePath = false;
    try {
      this._stmtUpsertService = db.prepare(`
        INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id, boundary_entry, base_path)
        VALUES (@repo_id, @name, @root_path, @language, @type, @scan_version_id, @boundary_entry, @base_path)
        ON CONFLICT(repo_id, name) DO UPDATE SET
          root_path = excluded.root_path,
          language = excluded.language,
          type = excluded.type,
          scan_version_id = excluded.scan_version_id,
          boundary_entry = excluded.boundary_entry,
          base_path = excluded.base_path
      `);
      this._hasBasePath = true;
    } catch {
      // base_path column not present — try migration-011 shape
      try {
        this._stmtUpsertService = db.prepare(`
          INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id, boundary_entry)
          VALUES (@repo_id, @name, @root_path, @language, @type, @scan_version_id, @boundary_entry)
          ON CONFLICT(repo_id, name) DO UPDATE SET
            root_path = excluded.root_path,
            language = excluded.language,
            type = excluded.type,
            scan_version_id = excluded.scan_version_id,
            boundary_entry = excluded.boundary_entry
        `);
      } catch {
        // boundary_entry column not present — pre-migration-011 database
        this._stmtUpsertService = db.prepare(`
          INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
          VALUES (@repo_id, @name, @root_path, @language, @type, @scan_version_id)
          ON CONFLICT(repo_id, name) DO UPDATE SET
            root_path = excluded.root_path,
            language = excluded.language,
            type = excluded.type,
            scan_version_id = excluded.scan_version_id
        `);
      }
    }

    // Try with path_template column (migration 013, TRUST-03). Falls back
    // through migration-009 (confidence+evidence), migration-008 (crossing),
    // then pre-008 plain columns for legacy DBs.
    this._hasPathTemplate = false;
    try {
      this._stmtUpsertConnection = db.prepare(`
        INSERT OR REPLACE INTO connections (source_service_id, target_service_id, protocol, method, path, path_template, source_file, target_file, scan_version_id, crossing, confidence, evidence)
        VALUES (@source_service_id, @target_service_id, @protocol, @method, @path, @path_template, @source_file, @target_file, @scan_version_id, @crossing, @confidence, @evidence)
      `);
      this._hasPathTemplate = true;
    } catch {
      // path_template column not present — pre-migration-013 db
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

    // --- service_dependencies statement (migration 010) ---
    this._stmtUpsertDependency = null;
    try {
      this._stmtUpsertDependency = db.prepare(`
        INSERT INTO service_dependencies (
          service_id, scan_version_id, ecosystem, package_name,
          version_spec, resolved_version, manifest_file, dep_kind
        )
        VALUES (
          @service_id, @scan_version_id, @ecosystem, @package_name,
          @version_spec, @resolved_version, @manifest_file, @dep_kind
        )
        ON CONFLICT(service_id, ecosystem, package_name, manifest_file) DO UPDATE SET
          version_spec     = excluded.version_spec,
          resolved_version = excluded.resolved_version,
          scan_version_id  = excluded.scan_version_id,
          dep_kind         = excluded.dep_kind
      `);
    } catch {
      // service_dependencies table not present (pre-migration-010 db)
      this._stmtUpsertDependency = null;
    }

    // --- quality_score statements (migration 015 / TRUST-05, TRUST-13) ---
    // The breakdown SQL counts confidence='high' and confidence='low' rows in
    // a single scan. Wrapped in try/catch so a pre-migration-015 db (no
    // quality_score column) cleanly disables persistence — endScan stays
    // best-effort.
    //
    // Lock-phrase (Phase 111 CONTEXT D-02, verbatim — kept on a single line so
    // the source-grep test in query-engine.quality-score.test.js can verify it):
    // NULL confidence is counted in `total` but contributes 0 to the numerator — agent omissions do not count as 'low'.
    this._stmtUpdateQualityScore = null;
    this._stmtSelectQualityScore = null;
    this._stmtSelectQualityBreakdown = null;
    try {
      this._stmtUpdateQualityScore = db.prepare(
        "UPDATE scan_versions SET quality_score = ? WHERE id = ?"
      );
      this._stmtSelectQualityScore = db.prepare(
        "SELECT quality_score FROM scan_versions WHERE id = ?"
      );
      this._stmtSelectQualityBreakdown = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN confidence = 'high' THEN 1 ELSE 0 END) AS high,
          SUM(CASE WHEN confidence = 'low'  THEN 1 ELSE 0 END) AS low,
          SUM(CASE WHEN confidence IS NULL  THEN 1 ELSE 0 END) AS null_count
        FROM connections
        WHERE scan_version_id = ?
      `);
      // Probe: a pre-015 db has scan_versions but no quality_score column. The
      // SELECT above does not reference quality_score, so the prepare succeeds
      // even on pre-015. We must explicitly verify the column exists before
      // arming the writer; otherwise endScan would throw at run() time.
      const cols = db.prepare("PRAGMA table_info(scan_versions)").all();
      if (!cols.some((c) => c.name === "quality_score")) {
        this._stmtUpdateQualityScore = null;
        this._stmtSelectQualityScore = null;
        this._stmtSelectQualityBreakdown = null;
      }
    } catch {
      // scan_versions table absent (pre-migration-005) — disable.
      this._stmtUpdateQualityScore = null;
      this._stmtSelectQualityScore = null;
      this._stmtSelectQualityBreakdown = null;
    }

    // --- enrichment_log statements (migration 016 / TRUST-06, TRUST-14) ---
    // Wrapped in try/catch so a pre-migration-016 db (no enrichment_log table)
    // cleanly disables the writers/readers — logEnrichment returns null and
    // getEnrichmentLog returns []. Mirrors the actor / node_metadata /
    // service_dependencies fallback pattern above.
    //
    // Decision (Phase 111 CONTEXT D-04): logEnrichment does NOT pre-validate
    // target_kind in JS. The migration-016 SQL CHECK constraint is the source
    // of truth — duplicating the check would silently mask SQL-level errors
    // and drift if the CHECK loosens in a later migration.
    this._stmtInsertEnrichmentLog = null;
    this._stmtSelectEnrichmentLog = null;
    this._stmtSelectEnrichmentLogByEnricher = null;
    try {
      this._stmtInsertEnrichmentLog = db.prepare(`
        INSERT INTO enrichment_log
          (scan_version_id, enricher, target_kind, target_id, field, from_value, to_value, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this._stmtSelectEnrichmentLog = db.prepare(`
        SELECT id, scan_version_id, enricher, target_kind, target_id, field,
               from_value, to_value, reason, created_at
        FROM enrichment_log
        WHERE scan_version_id = ?
        ORDER BY created_at ASC, id ASC
      `);
      this._stmtSelectEnrichmentLogByEnricher = db.prepare(`
        SELECT id, scan_version_id, enricher, target_kind, target_id, field,
               from_value, to_value, reason, created_at
        FROM enrichment_log
        WHERE scan_version_id = ? AND enricher = ?
        ORDER BY created_at ASC, id ASC
      `);
    } catch {
      // enrichment_log table absent — migration 016 not applied.
      this._stmtInsertEnrichmentLog = null;
      this._stmtSelectEnrichmentLog = null;
      this._stmtSelectEnrichmentLogByEnricher = null;
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
   * @returns {number} The repo row id. Pass it directly to beginScan / endScan.
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
    return row.id;
  }

  /**
   * Inserts or replaces a service row. Always returns the stable row id —
   * looks up by (repo_id, name) UNIQUE key when the prepared statement reports
   * lastInsertRowid=0 (UPDATE path) or returns a stale rowid from a prior
   * INSERT on a different table. (#TRUST-03 idempotency: caller wires
   * serviceIdMap from this return value, so a stale rowid from a sibling
   * INSERT in the same connection produced cross-wired connection FK
   * references on re-scan.)
   *
   * @param {{ repo_id: number, name: string, root_path: string, language: string }} serviceData
   * @returns {number} Row id
   */
  upsertService(serviceData) {
    const sanitized = sanitizeBindings({
      type: "service",
      scan_version_id: null,
      boundary_entry: null,
      base_path: null,
      ...serviceData,
    });
    // If the prepared statement does NOT include base_path (pre-migration-014),
    // strip the key so better-sqlite3 doesn't reject the extra named param.
    if (!this._hasBasePath) delete sanitized.base_path;
    this._stmtUpsertService.run(sanitized);
    // lastInsertRowid is unreliable on the ON CONFLICT DO UPDATE path
    // (returns 0 or a stale rowid from a prior INSERT on another table).
    // Always look up by the UNIQUE(repo_id, name) tuple to get the stable id.
    if (!this._stmtSelectServiceByRepoName) {
      this._stmtSelectServiceByRepoName = this._db.prepare(
        "SELECT id FROM services WHERE repo_id = ? AND name = ?"
      );
    }
    const row = this._stmtSelectServiceByRepoName.get(
      sanitized.repo_id,
      sanitized.name
    );
    return row ? row.id : null;
  }

  /**
   * Inserts or replaces a connection row.
   * @param {{ source_service_id: number, target_service_id: number, protocol: string, method?: string, path?: string, source_file?: string, target_file?: string }} connData
   * @returns {number} Row id
   */
  upsertConnection(connData) {
    const sanitized = sanitizeBindings({
      method: null,
      path: null,
      source_file: null,
      target_file: null,
      scan_version_id: null,
      crossing: null,
      confidence: null,
      evidence: null,
      path_template: null,
      ...connData,
    });
    // If the prepared statement does NOT include path_template (pre-migration-013),
    // strip the key so better-sqlite3 doesn't complain about an extra named param.
    if (!this._hasPathTemplate) delete sanitized.path_template;
    const result = this._stmtUpsertConnection.run(sanitized);
    return result.lastInsertRowid;
  }

  // --------------------------------------------------------------------------
  // Evidence-substring guard helpers (TRUST-02)
  // --------------------------------------------------------------------------

  /**
   * Look up the repo root path from `repos.path` for the given repoId.
   * Used by _validateEvidence to resolve relative source_file references the
   * agent typically emits. Returns null if the repo row is missing.
   *
   * @param {number} repoId
   * @returns {string|null}
   */
  _getRepoRootPath(repoId) {
    if (!this._stmtGetRepoRootPath) {
      this._stmtGetRepoRootPath = this._db.prepare(
        "SELECT path FROM repos WHERE id = ?"
      );
    }
    const row = this._stmtGetRepoRootPath.get(repoId);
    return row ? row.path : null;
  }

  /**
   * Validate that `evidence` appears as a literal substring in `source_file`.
   * Returns `{ ok: true }` on success or skip-with-warn cases (null/empty
   * evidence, null source_file, missing/unreadable source_file). Returns
   * `{ ok: false, reason }` only when evidence is non-empty AND source_file
   * resolves to a readable file AND the literal substring is not found.
   *
   * Per .planning/phases/109-path-canonicalization-and-evidence/109-CONTEXT.md:
   *   D-03: whole-file substring check (no line_start window — schema doesn't
   *         carry one).
   *   D-04: literal substring, no whitespace/regex normalization.
   *   D-05: lenient on null/missing/unreadable — return ok:true (warn when
   *         appropriate; persist anyway).
   *
   * @param {{ evidence?: string|null, source_file?: string|null }} conn
   * @param {string|null} repoRootPath - From repos.path; used to resolve
   *   relative source_file references the agent typically emits.
   * @returns {{ ok: boolean, warn?: string, reason?: string }}
   */
  _validateEvidence(conn, repoRootPath) {
    const evidence = (conn.evidence ?? "").trim();
    if (!evidence) return { ok: true }; // D-05 case 1: agent didn't claim evidence

    const srcRel = conn.source_file;
    if (srcRel == null || srcRel === "") return { ok: true }; // D-05 case 2

    // Resolve relative paths against repo root. Absolute paths used as-is.
    let abs = srcRel;
    if (!path.isAbsolute(srcRel) && repoRootPath) {
      abs = path.join(repoRootPath, srcRel);
    }

    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch (e) {
      // D-05 case 3: file missing or unreadable — warn but don't reject
      const detail = e.code || e.message || "unknown error";
      return {
        ok: true,
        warn:
          "[persistFindings] cannot validate evidence: source_file '" +
          srcRel +
          "' does not exist or is unreadable (" +
          detail +
          ")",
      };
    }

    if (content.indexOf(evidence) !== -1) {
      return { ok: true };
    }

    const preview =
      evidence.length > 80 ? evidence.slice(0, 80) + "..." : evidence;
    return {
      ok: false,
      reason: "evidence not found in '" + srcRel + "': " + preview,
    };
  }

  // --------------------------------------------------------------------------
  // path_template merge helpers (TRUST-03)
  // --------------------------------------------------------------------------

  /**
   * Merge a new template into an existing comma-separated list, dedup'd by
   * literal-equality. Returns the joined string. Used by persistFindings
   * before INSERT OR REPLACE clobbers the existing path_template value.
   *
   * @param {string|null} existingCsv - Current path_template value (may be null/empty)
   * @param {string|null} newTemplate - The agent's raw conn.path
   * @returns {string|null}
   */
  _mergePathTemplates(existingCsv, newTemplate) {
    if (!newTemplate) return existingCsv ?? null;
    if (!existingCsv) return newTemplate;
    const parts = existingCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.includes(newTemplate)) return existingCsv;
    parts.push(newTemplate);
    return parts.join(",");
  }

  /**
   * Read the current path_template value for the row that would be hit by an
   * upsertConnection call, identified by the 5-col UNIQUE tuple
   * (source, target, protocol, method, canonical path). Returns null when no
   * row exists yet, or when the schema is pre-migration-013.
   *
   * Note: `method IS ?` (not `=`) so NULL methods compare correctly.
   *
   * @param {number} sourceId
   * @param {number} targetId
   * @param {string} protocol
   * @param {string|null} method
   * @param {string|null} canonicalPath
   * @returns {string|null}
   */
  _getExistingPathTemplate(sourceId, targetId, protocol, method, canonicalPath) {
    if (!this._hasPathTemplate) return null;
    if (!this._stmtSelectExistingPathTemplate) {
      this._stmtSelectExistingPathTemplate = this._db.prepare(`
        SELECT path_template FROM connections
        WHERE source_service_id = ? AND target_service_id = ?
          AND protocol = ? AND method IS ? AND path IS ?
        LIMIT 1
      `);
    }
    const row = this._stmtSelectExistingPathTemplate.get(
      sourceId,
      targetId,
      protocol,
      method,
      canonicalPath
    );
    return row ? row.path_template : null;
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
   * Write a row to enrichment_log. (TRUST-06 / TRUST-14 — migration 016.)
   *
   * No-op (returns null) when migration 016 is not applied — the table is
   * absent and the prepared statement could not arm in the constructor.
   *
   * Throws (SqliteError) when the SQL CHECK on `target_kind` fails — JS does
   * NOT pre-validate per Phase 111 CONTEXT D-04 (the SQL CHECK is the source
   * of truth; duplicating the check would silently mask SQL-level errors).
   *
   * @param {number} scanVersionId
   * @param {string} enricher          — e.g., 'reconciliation', 'codeowners', 'auth-db'
   * @param {'service'|'connection'} targetKind
   * @param {number} targetId          — services.id or connections.id
   * @param {string} field             — e.g., 'crossing', 'owner'
   * @param {string|null} fromValue
   * @param {string|null} toValue
   * @param {string|null} reason
   * @returns {number|null} lastInsertRowid, or null on pre-016 db
   */
  logEnrichment(
    scanVersionId,
    enricher,
    targetKind,
    targetId,
    field,
    fromValue,
    toValue,
    reason,
  ) {
    if (!this._stmtInsertEnrichmentLog) return null;
    const result = this._stmtInsertEnrichmentLog.run(
      scanVersionId,
      enricher,
      targetKind,
      targetId,
      field,
      fromValue ?? null,
      toValue ?? null,
      reason ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Read rows from enrichment_log for a scan_version, optionally filtered by
   * `enricher`. Returns [] (not null, not throwing) on a pre-016 db, on an
   * unknown scan_version_id, or on any read error. Sort order: created_at ASC,
   * id ASC (id is the tie-breaker because created_at granularity is 1s).
   *
   * @param {number} scanVersionId
   * @param {{ enricher?: string }} [opts]
   * @returns {Array<{id:number, scan_version_id:number, enricher:string,
   *   target_kind:string, target_id:number, field:string,
   *   from_value:string|null, to_value:string|null, reason:string|null,
   *   created_at:string}>}
   */
  getEnrichmentLog(scanVersionId, opts = {}) {
    if (!this._stmtSelectEnrichmentLog) return [];
    try {
      if (opts && opts.enricher) {
        return this._stmtSelectEnrichmentLogByEnricher.all(
          scanVersionId,
          opts.enricher,
        );
      }
      return this._stmtSelectEnrichmentLog.all(scanVersionId);
    } catch {
      return [];
    }
  }

  /**
   * Inserts or updates a dependency row for a service.
   *
   * Uses ON CONFLICT DO UPDATE on the 4-column UNIQUE
   * (service_id, ecosystem, package_name, manifest_file) so the row id
   * is preserved across re-scans — callers that chain the id for FK
   * references get stable identifiers.
   *
   * MUST NOT call beginScan/endScan - this is invoked from dep-collector
   * which runs AFTER the scan bracket closes (see manager.js Phase B loop).
   *
   * @param {object} row
   * @param {number} row.service_id
   * @param {number|null} row.scan_version_id
   * @param {string} row.ecosystem - one of npm|pypi|go|cargo|maven|nuget|rubygems
   * @param {string} row.package_name
   * @param {string|null} row.version_spec - raw manifest token (e.g., "^1.2.3")
   * @param {string|null} row.resolved_version - lockfile-pinned version if available
   * @param {string} row.manifest_file - relative path from service root
   * @param {string} [row.dep_kind='direct'] - 'direct' or 'transient'
   * @returns {number|null} service_dependencies.id, or null if table absent (pre-mig-010)
   */
  upsertDependency(row) {
    if (!this._stmtUpsertDependency) return null;
    const params = {
      service_id:       row.service_id,
      scan_version_id:  row.scan_version_id ?? null,
      ecosystem:        row.ecosystem,
      package_name:     row.package_name,
      version_spec:     row.version_spec ?? null,
      resolved_version: row.resolved_version ?? null,
      manifest_file:    row.manifest_file,
      dep_kind:         row.dep_kind ?? 'direct',
    };
    const result = this._stmtUpsertDependency.run(params);
    // lastInsertRowid is 0 on pure UPDATE path in better-sqlite3 — fetch the
    // existing row id so callers always receive the stable identifier.
    if (result.changes > 0 && result.lastInsertRowid > 0) {
      return Number(result.lastInsertRowid);
    }
    // UPDATE path — look up existing id by the 4-col UNIQUE tuple
    const existing = this._db.prepare(`
      SELECT id FROM service_dependencies
      WHERE service_id = ? AND ecosystem = ? AND package_name = ? AND manifest_file = ?
    `).get(params.service_id, params.ecosystem, params.package_name, params.manifest_file);
    return existing ? Number(existing.id) : null;
  }

  /**
   * Returns all service_dependencies rows for a given service, sorted by
   * ecosystem then package_name. Returns [] if the table is absent
   * (pre-migration-010 database).
   *
   * @param {number} serviceId
   * @returns {Array<{id:number, service_id:number, scan_version_id:number|null, ecosystem:string, package_name:string, version_spec:string|null, resolved_version:string|null, manifest_file:string, dep_kind:string}>}
   */
  getDependenciesForService(serviceId) {
    try {
      return this._db.prepare(`
        SELECT id, service_id, scan_version_id, ecosystem, package_name,
               version_spec, resolved_version, manifest_file, dep_kind
        FROM service_dependencies
        WHERE service_id = ?
        ORDER BY ecosystem, package_name
      `).all(serviceId);
    } catch {
      // service_dependencies table absent — pre-migration-010 db
      return [];
    }
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
    // Pre-guard: better-sqlite3 throws "Too few parameter values were provided"
    // when handed an undefined / non-integer bind value. Catch it here with
    // a clearer message. (#8)
    if (!Number.isInteger(repoId)) {
      throw new TypeError(
        `beginScan: repoId must be an integer, got ${typeof repoId} (${JSON.stringify(repoId)}).`,
      );
    }
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
    if (!Number.isInteger(repoId)) {
      throw new TypeError(`endScan: repoId must be an integer, got ${typeof repoId} (${JSON.stringify(repoId)}).`);
    }
    if (!Number.isInteger(scanVersionId)) {
      throw new TypeError(`endScan: scanVersionId must be an integer, got ${typeof scanVersionId} (${JSON.stringify(scanVersionId)}). Pass the value returned by beginScan().`);
    }
    this._stmtEndScan.run(new Date().toISOString(), scanVersionId);

    // TRUST-05: compute quality_score = (high + 0.5 * low) / total and persist
    // it on the scan_versions row. NULL when total = 0 (no connections in this
    // scan). NULL confidence rows count toward `total` but contribute 0 to the
    // numerator (Phase 111 D-02). Best-effort — a write failure here MUST NOT
    // prevent the bracket close, so the call is wrapped in try/catch.
    if (this._stmtSelectQualityBreakdown && this._stmtUpdateQualityScore) {
      try {
        const row = this._stmtSelectQualityBreakdown.get(scanVersionId);
        const total = row?.total ?? 0;
        const high = row?.high ?? 0;
        const low = row?.low ?? 0;
        const score = total > 0 ? (high + 0.5 * low) / total : null;
        this._stmtUpdateQualityScore.run(score, scanVersionId);
      } catch (err) {
        const warn =
          this._logger?.warn?.bind(this._logger) ?? console.warn;
        warn(`[arcanon] endScan: quality_score write failed: ${err.message}`);
      }
    }

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
   * Returns the persisted quality_score for the given scan version, or null
   * when the value has not been written (column absent on a pre-015 db, the
   * scan_version row is missing, or endScan has not yet run for this scan).
   *
   * The score formula and NULL semantics are documented at the SQL site in the
   * constructor and in `endScan` — see Phase 111 CONTEXT D-02. (TRUST-05.)
   *
   * @param {number} scanVersionId
   * @returns {number | null}
   */
  getQualityScore(scanVersionId) {
    if (!this._stmtSelectQualityScore) return null;
    try {
      const row = this._stmtSelectQualityScore.get(scanVersionId);
      return row?.quality_score ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Returns the full quality breakdown for a scan version. Used by the
   * /api/scan-quality HTTP endpoint and by `/arcanon:map` end-of-output.
   *
   * Shape:
   *   {
   *     scan_version_id: number,
   *     total: number,
   *     high: number,
   *     low: number,
   *     null_count: number,
   *     prose_evidence_warnings: number,   // D-01: 0 placeholder for v0.1.3
   *     service_count: number,
   *     quality_score: number | null,
   *     completed_at: string | null,
   *   }
   *
   * `prose_evidence_warnings` returns 0 today — the TRUST-02 prose-evidence
   * rejection logic logs to stderr but does not persist a counter. A future
   * ticket will add a `scan_versions.prose_evidence_warnings INTEGER` column
   * populated by `persistFindings` (out of v0.1.3 scope per CONTEXT D-01).
   *
   * Returns null when the quality_score column is absent (pre-015 db) or when
   * the scan_version row does not exist.
   *
   * @param {number} scanVersionId
   * @returns {object | null}
   */
  getScanQualityBreakdown(scanVersionId) {
    if (!this._stmtSelectQualityBreakdown) return null;
    try {
      const breakdown = this._stmtSelectQualityBreakdown.get(scanVersionId);
      const sv = this._db
        .prepare(
          "SELECT id, completed_at, quality_score, repo_id FROM scan_versions WHERE id = ?",
        )
        .get(scanVersionId);
      if (!sv) return null;
      const serviceCount =
        this._db
          .prepare("SELECT COUNT(*) AS n FROM services WHERE scan_version_id = ?")
          .get(scanVersionId)?.n ?? 0;
      return {
        scan_version_id: scanVersionId,
        total: breakdown?.total ?? 0,
        high: breakdown?.high ?? 0,
        low: breakdown?.low ?? 0,
        null_count: breakdown?.null_count ?? 0,
        // TODO(post-v0.1.3): persist prose_evidence_warnings counter on
        // scan_versions and surface it here. See CONTEXT.md D-01.
        prose_evidence_warnings: 0,
        service_count: serviceCount,
        quality_score: sv.quality_score ?? null,
        completed_at: sv.completed_at ?? null,
      };
    } catch {
      return null;
    }
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

    // Phase 110 (TRUST-04): pull candidate connections + their target's
    // base_path, and apply base_path stripping in JS before comparing against
    // the target's exposed endpoints. Falls back to a SQL shape that omits
    // s_tgt.base_path for pre-migration-014 databases.
    let rows;
    try {
      rows = this._db
        .prepare(
          `
        SELECT c.id, c.method, c.path, c.protocol,
               s_src.name as source, s_tgt.name as target,
               s_tgt.id as target_id, s_tgt.base_path as target_base_path
        FROM connections c
        JOIN services s_src ON c.source_service_id = s_src.id
        JOIN services s_tgt ON c.target_service_id = s_tgt.id
        WHERE c.protocol NOT IN ('internal', 'sdk', 'import')
          AND c.path IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM exposed_endpoints ep
            WHERE ep.service_id = c.target_service_id
          )
      `,
        )
        .all();
    } catch {
      // Pre-migration-014 db: services.base_path doesn't exist. Fall back to
      // the legacy shape (no base_path column) and treat target_base_path as null.
      rows = this._db
        .prepare(
          `
        SELECT c.id, c.method, c.path, c.protocol,
               s_src.name as source, s_tgt.name as target,
               s_tgt.id as target_id
        FROM connections c
        JOIN services s_src ON c.source_service_id = s_src.id
        JOIN services s_tgt ON c.target_service_id = s_tgt.id
        WHERE c.protocol NOT IN ('internal', 'sdk', 'import')
          AND c.path IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM exposed_endpoints ep
            WHERE ep.service_id = c.target_service_id
          )
      `,
        )
        .all()
        .map((r) => ({ ...r, target_base_path: null }));
    }

    const exposedStmt = this._db.prepare(
      `SELECT path FROM exposed_endpoints WHERE service_id = ?`,
    );

    const mismatches = [];
    for (const c of rows) {
      const exposedPaths = new Set(
        exposedStmt.all(c.target_id).map((r) => r.path),
      );
      // Try literal match first — preserves correctness when base_path is
      // absent (D-02) and when the agent emitted the literal prefixed path
      // in `exposes` (Test 8).
      if (exposedPaths.has(c.path)) continue;
      // Try stripped match if target has base_path (D-02: gated on target).
      const stripped = stripBasePath(c.path, c.target_base_path);
      if (stripped !== null && exposedPaths.has(stripped)) continue;
      // Neither match — real mismatch.
      mismatches.push({
        connection_id: c.id,
        source: c.source,
        target: c.target,
        type: "endpoint_not_exposed",
        detail: `${c.method || c.protocol} ${c.path} — ${c.target} does not expose this endpoint`,
      });
    }
    return mismatches;
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
        boundary_entry: svc.boundary_entry || null,
        base_path: svc.base_path || null,
      });
      serviceIdMap.set(svc.name, id);
    }

    // 2. Upsert connections (resolve source/target names to IDs)
    for (const conn of findings.connections || []) {
      const sourceId =
        serviceIdMap.get(conn.source) || this._resolveServiceId(conn.source, repoId);
      if (!sourceId) continue; // can't link an unknown source

      const targetId =
        serviceIdMap.get(conn.target) || this._resolveServiceId(conn.target, repoId);

      // External target with no matching service row → record as an actor +
      // actor_connection instead of dropping the edge entirely. This is the
      // primary path for crossing='external' findings. (#9)
      if (!targetId && conn.crossing === "external") {
        this._upsertActorEdge({
          actorName: conn.target,
          sourceId,
          protocol: conn.protocol,
          path: conn.path,
        });
        continue;
      }

      // Unknown internal target — still skip; we have no row to point at.
      if (!targetId) continue;

      // TRUST-02: evidence guard — runs BEFORE canonicalize+upsert.
      // Skip the connection (and warn) when prose evidence does not appear
      // verbatim in the cited source_file. Lenient on null/missing files
      // (D-05): persist with a warning when the file is unreadable, persist
      // silently when source_file or evidence are null/empty.
      const repoRoot = this._getRepoRootPath(repoId);
      const evVerdict = this._validateEvidence(conn, repoRoot);
      if (!evVerdict.ok) {
        const skipMsg =
          "[persistFindings] skipping connection " +
          conn.source +
          "->" +
          conn.target +
          " (" +
          (conn.protocol || "unknown") +
          " " +
          (conn.method || "") +
          " " +
          (conn.path || "") +
          "): " +
          evVerdict.reason;
        if (this._logger?.warn) this._logger.warn(skipMsg);
        else process.stderr.write(skipMsg + "\n");
        continue; // skip — do NOT upsert this connection
      }
      if (evVerdict.warn) {
        if (this._logger?.warn) this._logger.warn(evVerdict.warn);
        else process.stderr.write(evVerdict.warn + "\n");
        // fall through — persist anyway (D-05)
      }

      // TRUST-03: canonicalize path ({xxx} -> {_}) and merge path_template.
      // Reading the existing path_template BEFORE the INSERT OR REPLACE prevents
      // clobbering on re-scan (the REPLACE deletes-then-inserts).
      const protocol = conn.protocol || "unknown";
      const method = conn.method || null;
      const rawPath = conn.path || null;
      const canonicalPath = canonicalizePath(rawPath);
      const existingTemplate = this._getExistingPathTemplate(
        sourceId,
        targetId,
        protocol,
        method,
        canonicalPath
      );
      const mergedTemplate = this._mergePathTemplates(existingTemplate, rawPath);

      const connId = this.upsertConnection({
        source_service_id: sourceId,
        target_service_id: targetId,
        protocol,
        method,
        path: canonicalPath,
        path_template: mergedTemplate,
        source_file: conn.source_file || null,
        target_file: conn.target_file || null,
        scan_version_id: scanVersionId ?? null,
        crossing: conn.crossing || null,
        confidence: conn.confidence || null,
        evidence: conn.evidence || null,
      });

      // Defensive: if the target IS a known service AND was tagged external,
      // we've already inserted the regular connection above. Don't also create
      // an actor — the existing service row is the authoritative endpoint.
      // (Pre-#9 the actor block also fired here; the SBUG-01 check skipped it
      // for known services. Behavior unchanged for this case.)

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
  /**
   * Insert (or update) an external actor + actor_connection. Used by
   * persistFindings when a connection's target doesn't match a service row
   * but the connection is tagged crossing='external'. (#9)
   *
   * No-op when the migration that creates the actors / actor_connections
   * tables hasn't run yet, or when actorName is missing.
   *
   * @param {{actorName: string, sourceId: number, protocol?: string, path?: string}} opts
   */
  _upsertActorEdge({ actorName, sourceId, protocol = null, path = null }) {
    if (!this._stmtUpsertActor || !this._stmtGetActorByName || !this._stmtUpsertActorConnection) {
      return; // migration 008 not applied — skip silently
    }
    if (!actorName || !sourceId) return;

    // Don't shadow a real service row with an actor of the same name.
    const knownService = this._stmtCheckKnownService
      ? this._stmtCheckKnownService.get(actorName)
      : null;
    if (knownService) return;

    this._stmtUpsertActor.run({
      name: actorName,
      kind: "system",
      direction: "outbound",
      source: "scan",
    });
    const actorRow = this._stmtGetActorByName.get(actorName);
    if (!actorRow) return;
    this._stmtUpsertActorConnection.run({
      actor_id: actorRow.id,
      service_id: sourceId,
      direction: "outbound",
      protocol: protocol || null,
      path: path || null,
    });
  }

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
      '[arcanon] Ambiguous service name "' + name + '" matches ' + rows.length +
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
