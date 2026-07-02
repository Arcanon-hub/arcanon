/**
 * worker/db.js — Database lifecycle module for Arcanon v2.0
 *
 * Opens (or creates) the SQLite database for a project, applies WAL mode and
 * performance pragmas, and runs pending migrations.
 *
 * Phase 137 / ISO-01: openDb() is a STATELESS FACTORY — each call opens a
 * fresh DatabaseSync handle for the requested project root. The pool (pool.js)
 * owns caching; this module owns opening. There is no module-level singleton.
 *
 * DB path: <dataDir>/projects/<sha256(path.resolve(projectRoot)).slice(0,12)>/impact-map.db
 *
 * IMPORTANT: This module uses top-level await to preload migration modules.
 * Callers that import this module from an ES module context get the fully
 * initialized module (migrations preloaded). The module-level _migrations
 * array is populated before any openDb() call can execute.
 */

import Database from "./sqlite-adapter.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { syncFindings } from "../server/chroma.js";
import { resolveConfigPath } from "../lib/config-path.js";
import { resolveDataDir } from "../lib/data-dir.js";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Preloaded migration modules, sorted by version */
const _migrations = await loadMigrationsAsync();

/**
 * Asynchronously discovers and imports all migration modules.
 * Called once at module load time via top-level await.
 *
 * @returns {Promise<Array<{version: number, up: (db: any) => void}>>}
 */
async function loadMigrationsAsync() {
  const migrationsDir = path.join(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .sort();

  const migrations = [];
  for (const file of files) {
    const modulePath = pathToFileURL(path.join(migrationsDir, file)).href;
    try {
      const migration = await import(modulePath);
      if (
        migration &&
        typeof migration.version === "number" &&
        typeof migration.up === "function"
      ) {
        migrations.push({ version: migration.version, up: migration.up });
      }
    } catch (err) {
      process.stderr.write(`[db] Failed to load migration ${file}: ${err.message}\n`);
    }
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Computes the project-specific data directory path.
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {string} Full path to the directory (not yet created).
 */
function projectHashDir(projectRoot) {
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12);
  return path.join(resolveDataDir(), "projects", hash);
}

/**
 * Opens (or creates) the SQLite database for the given project root.
 * Runs pending migrations before returning.
 *
 * Phase 137 / ISO-01: this is a PURE FACTORY — each call opens a fresh
 * DatabaseSync handle. No module-level state is consulted or written.
 * Caching is the caller's (pool.js's) responsibility.
 *
 * The projectRoot is resolved via path.resolve() before hashing, so trailing
 * slashes and symlink variants all map to the same DB directory.
 *
 * @param {string} [projectRoot] - Project root directory. Defaults to process.cwd().
 * @returns {import('./sqlite-adapter.js').default} A fresh open database handle.
 */
export function openDb(projectRoot = process.cwd()) {
  const dataDir = projectHashDir(path.resolve(projectRoot));
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "impact-map.db");
  const db = new Database(dbPath);

  // Apply pragmas in specified order
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64 MB page cache
  db.pragma("busy_timeout = 5000"); // 5s — prevents SQLITE_BUSY on concurrent reads

  runMigrations(db);

  return db;
}

/**
 * No-op stub retained for export-surface compatibility.
 *
 * Phase 137 / ISO-01: the module-level _db singleton has been removed; openDb()
 * is now a stateless factory. There is no module state to reset. This function
 * always returns false.
 *
 * @returns {false}
 */
export function _resetDbSingleton() {
  // No module state to reset — openDb() is a pure factory since Phase 137.
  return false;
}

/**
 * Deprecated stub — always throws.
 *
 * Phase 137 / ISO-01: the process-global DB singleton has been removed.
 * Pass the db handle explicitly (thread it from your openDb() call) or
 * obtain a handle through pool.getQueryEngine(projectRoot).
 *
 * @throws {Error} Always — directs callers to the new API.
 */
export function getDb() {
  throw new Error(
    "Phase 137 / ISO-01: DB singleton removed. " +
    "Pass the db handle explicitly or use pool.getQueryEngine(projectRoot).",
  );
}

/**
 * Runs all pending migrations in version order.
 * Creates the schema_versions table if absent, then applies any migrations
 * whose version number exceeds the current MAX(version).
 *
 * @param {import('./sqlite-adapter.js').default} db
 */
export function runMigrations(db) {
  // Ensure migration tracker table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion =
    db.prepare("SELECT MAX(version) FROM schema_versions").pluck().get() ?? 0;

  for (const migration of _migrations) {
    if (migration.version <= currentVersion) continue;

    // Wrap each migration in a transaction for atomicity
    const runMigration = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(
        migration.version,
      );
    });

    runMigration();
  }
}

/**
 * Returns the configured snapshot retention limit.
 * Reads from arcanon.config.json "impact-map": { "history-limit": N }.
 * Falls back to 10 if config is absent or unreadable.
 *
 * @returns {number}
 */
function getHistoryLimit() {
  try {
    const configPath = resolveConfigPath(process.cwd());
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return cfg["impact-map"]?.["history-limit"] ?? 10;
  } catch (_) {
    return 10;
  }
}

/**
 * Persist confirmed scan findings to SQLite using the QueryEngine, then
 * fire-and-forget ChromaDB sync.
 *
 * This is the ONLY allowed persist gate — SQLite writes complete first,
 * then syncFindings() is called as fire-and-forget via .catch().
 * A ChromaDB outage never prevents SQLite persistence.
 *
 * @param {{ services: Array, connections?: Array }} findings - Confirmed findings from 
 * @param {import('./query-engine.js').QueryEngine} queryEngine - QueryEngine instance
 * @param {number} repoId - ID of the repo row in the repos table
 * @returns {void}
 */
export function writeScan(findings, queryEngine, repoId) {
  // Write services to SQLite (synchronous)
  for (const svc of findings.services || []) {
    queryEngine.upsertService({
      repo_id: repoId,
      name: svc.name,
      root_path: svc.root_path || ".",
      language: svc.language || "unknown",
    });
  }

  // Write connections to SQLite (synchronous)
  for (const conn of findings.connections || []) {
    queryEngine.upsertConnection({
      source_service_id: conn.source_service_id,
      target_service_id: conn.target_service_id,
      protocol: conn.protocol || "unknown",
      method: conn.method || null,
      path: conn.path || null,
      source_file: conn.source_file || null,
      target_file: conn.target_file || null,
      crossing: conn.crossing || null,
    });
  }

  // Build boundary map from arcanon.config.json.
  // Gracefully skip when config is absent or has no boundaries key
  const boundaryMap = new Map();
  try {
    const configPath = resolveConfigPath(process.cwd());
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const boundaries = cfg.boundaries || {};
    for (const [boundaryName, members] of Object.entries(boundaries)) {
      for (const memberName of members) {
        boundaryMap.set(memberName, boundaryName);
      }
    }
  } catch { /* config absent or no boundaries key — boundaryMap stays empty */ }

  // Build actor map from DB (actors + actor_connections tables)
  // Gracefully skip if tables don't exist yet ( migration may not have run)
  const actorMap = new Map();
  try {
    const rows = queryEngine._db.prepare(`
      SELECT s.name AS service_name, a.name AS actor_name
      FROM actor_connections ac
      JOIN actors a ON a.id = ac.actor_id
      JOIN services s ON s.id = ac.service_id
      WHERE s.repo_id = ?
    `).all(repoId);
    for (const row of rows) {
      if (!actorMap.has(row.service_name)) actorMap.set(row.service_name, []);
      actorMap.get(row.service_name).push(row.actor_name);
    }
  } catch { /* actors table not yet created — skip enrichment */ }

  // Fire-and-forget ChromaDB sync with enrichment — NEVER await in persist path
  // A ChromaDB outage generates a stderr warning only — SQLite writes already committed
  syncFindings(findings, { boundaryMap, actorMap }).catch((err) =>
    process.stderr.write("[chroma] sync failed: " + err.message + "\n"),
  );
}

/**
 * Returns true if no map versions have been recorded yet (i.e., this is the first scan).
 * Call before writeScan() to detect the first-map-build scenario.
 *
 * Phase 137 / ISO-01: takes an explicit db handle instead of using the removed singleton.
 *
 * @param {import('./sqlite-adapter.js').default} db - Open database handle.
 * @returns {boolean}
 */
export function isFirstScan(db) {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM map_versions").get();
  return (row?.cnt ?? 0) === 0;
}

/**
 * Creates a consistent SQLite snapshot of the current database using VACUUM INTO.
 * Stores the snapshot in a snapshots/ subdirectory adjacent to the DB file.
 * Records the snapshot in map_versions with a relative path.
 * Runs retention cleanup after every snapshot (default limit: 10).
 *
 * VACUUM INTO is used (not cp) because it creates an atomic, consistent copy
 * even during active writes, without copying WAL/SHM sidecar files.
 *
 * Phase 137 / ISO-01: takes an explicit db handle instead of using the removed singleton.
 * Phase 139 / ISO-06: extended with kind and repos params so each map_versions row
 * is self-describing (D-07). MUST be called OUTSIDE any open transaction (D-03 hard
 * constraint — SQLite raises "cannot VACUUM from within a transaction" otherwise).
 *
 * @param {import('./sqlite-adapter.js').default} db - Open database handle.
 * @param {string} [label=''] - Optional label stored in map_versions.
 * @param {string} [kind='map'] - Run kind: 'map' (multi-repo) or 'rescan' (single-repo).
 * @param {Array<{path: string, scan_version_id: number}>} [repos=[]] - Repos covered.
 * @returns {string} Absolute path to the created snapshot file.
 * @throws {Error} If VACUUM INTO fails.
 */
export function createSnapshot(db, label = "", kind = "map", repos = []) {

  // Determine the DB file path from the open database
  const dbFilePath = db.name; // adapter exposes the DB path as db.name

  // In-memory databases have no on-disk location: path.dirname(":memory:") is
  // ".", which would VACUUM a stray snapshots/ dir into CWD (test-suite runs that
  // drive scanRepos on a :memory: DB, e.g. manager-txn.test.js). Snapshots are only
  // meaningful for real file-backed project DBs, so skip in-memory handles.
  if (!dbFilePath || dbFilePath === ":memory:") return null;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotsDir = path.join(path.dirname(dbFilePath), "snapshots");
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const snapshotFile = path.join(snapshotsDir, ts + ".db");
  const relPath = path.join("snapshots", ts + ".db");

  // VACUUM INTO creates a consistent copy — safe during active writes
  // Unlike cp which copies wal + shm sidecars (potentially inconsistent)
  db.exec(`VACUUM INTO '${snapshotFile}'`);

  // Record in map_versions table — 5-column form requires migration 021.
  // Fall back to the legacy 4-column INSERT for pre-021 DBs (test environments
  // that openDb on a DB that hasn't run all migrations yet).
  try {
    db.prepare(
      "INSERT INTO map_versions (created_at, label, snapshot_path, kind, repos_json) VALUES (?, ?, ?, ?, ?)",
    ).run(new Date().toISOString(), label, relPath, kind, JSON.stringify(repos));
  } catch (_) {
    // Pre-021 DB: fall back to legacy 4-column form
    db.prepare(
      "INSERT INTO map_versions (created_at, label, snapshot_path) VALUES (?, ?, ?)",
    ).run(new Date().toISOString(), label, relPath);
  }

  // Retention cleanup: remove oldest snapshots beyond limit
  const limit = getHistoryLimit();
  const toDelete = db
    .prepare(
      "SELECT id, snapshot_path FROM map_versions ORDER BY created_at DESC LIMIT -1 OFFSET ?",
    )
    .all(limit);

  for (const row of toDelete) {
    const fullPath = path.join(path.dirname(dbFilePath), row.snapshot_path);
    try {
      fs.unlinkSync(fullPath);
    } catch (_) {}
    db.prepare("DELETE FROM map_versions WHERE id = ?").run(row.id);
  }

  return snapshotFile;
}

// When run directly as a script, open the DB and report status
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const db = openDb();
  console.log("WAL:", db.pragma("journal_mode", { simple: true }));
  console.log("FK:", db.pragma("foreign_keys", { simple: true }));
  console.log(
    "Tables:",
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .pluck()
      .all()
      .sort()
      .join(", "),
  );
  const schemaVer = db
    .prepare("SELECT MAX(version) FROM schema_versions")
    .pluck()
    .get();
  console.log("Schema version:", schemaVer);
  db.close();
}
