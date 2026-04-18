/**
 * worker/db.js — Database lifecycle module for Ligamen v2.0
 *
 * Opens (or creates) the SQLite database for a project, applies WAL mode and
 * performance pragmas, runs pending migrations, and exposes the singleton
 * database handle via openDb() / getDb().
 *
 * DB path: ~/.ligamen/projects/<sha256(projectRoot).slice(0,12)>/impact-map.db
 *
 * IMPORTANT: This module uses top-level await to preload migration modules.
 * Callers that import this module from an ES module context get the fully
 * initialized module (migrations preloaded). The module-level _migrations
 * array is populated before any openDb() call can execute.
 */

import Database from "better-sqlite3";
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

/** Module-level singleton database instance */
let _db = null;

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
    .filter((f) => f.endsWith(".js"))
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
 * Runs pending migrations before returning. Idempotent — safe to call
 * multiple times; returns the same instance on subsequent calls.
 *
 * @param {string} [projectRoot] - Project root directory. Defaults to process.cwd().
 * @returns {import('better-sqlite3').Database} The open database instance.
 */
export function openDb(projectRoot = process.cwd()) {
  if (_db) return _db;

  const dataDir = projectHashDir(projectRoot);
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

  _db = db;
  return _db;
}

/**
 * Returns the already-opened database instance.
 * @throws {Error} If openDb() has not been called yet.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!_db) {
    throw new Error("Database not initialized. Call openDb() first.");
  }
  return _db;
}

/**
 * Runs all pending migrations in version order.
 * Creates the schema_versions table if absent, then applies any migrations
 * whose version number exceeds the current MAX(version).
 *
 * @param {import('better-sqlite3').Database} db
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
 * @param {{ services: Array, connections?: Array }} findings - Confirmed findings from Phase 19
 * @param {import('./query-engine.js').QueryEngine} queryEngine - QueryEngine instance
 * @param {number} repoId - ID of the repo row in the repos table
 * @returns {void}
 */
export function writeScan(findings, queryEngine, repoId) {
  // Write services to SQLite (synchronous — better-sqlite3)
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

  // Build boundary map from arcanon.config.json (legacy ligamen.config.json supported).
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
  // Gracefully skip if tables don't exist yet (Phase 33 migration may not have run)
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
 * @returns {boolean}
 */
export function isFirstScan() {
  const db = getDb();
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
 * @param {string} [label=''] - Optional label stored in map_versions.
 * @returns {string} Absolute path to the created snapshot file.
 * @throws {Error} If VACUUM INTO fails.
 */
export function createSnapshot(label = "") {
  const db = getDb();

  // Determine the DB file path from the open database
  const dbFilePath = db.name; // better-sqlite3 exposes the DB path as db.name
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotsDir = path.join(path.dirname(dbFilePath), "snapshots");
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const snapshotFile = path.join(snapshotsDir, ts + ".db");
  const relPath = path.join("snapshots", ts + ".db");

  // VACUUM INTO creates a consistent copy — safe during active writes
  // Unlike cp which copies wal + shm sidecars (potentially inconsistent)
  db.exec(`VACUUM INTO '${snapshotFile}'`);

  // Record in map_versions table
  db.prepare(
    "INSERT INTO map_versions (created_at, label, snapshot_path) VALUES (?, ?, ?)",
  ).run(new Date().toISOString(), label, relPath);

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
