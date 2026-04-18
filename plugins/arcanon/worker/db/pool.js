/**
 * worker/db-pool.js — Per-project DB and QueryEngine pool.
 *
 * The worker is project-agnostic. It resolves the correct DB based on
 * a project root path passed in each request (?project=/path/to/repo).
 * DBs are opened on first access and cached for the worker's lifetime.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { openDb, runMigrations } from "./database.js";
import { QueryEngine } from "./query-engine.js";
import { resolveDataDir } from "../lib/data-dir.js";

const dataDir = resolveDataDir();

/** Cache: projectRoot → QueryEngine */
const pool = new Map();

/**
 * Compute the per-project data directory.
 * @param {string} projectRoot
 * @returns {string}
 */
function projectHashDir(projectRoot) {
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12);
  return path.join(dataDir, "projects", hash);
}

/**
 * Get or create a QueryEngine for the given project root.
 * Opens the SQLite DB on first access, caches for subsequent requests.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {QueryEngine|null} Null if no DB exists for this project.
 */
export function getQueryEngine(projectRoot) {
  if (!projectRoot) return null;

  if (pool.has(projectRoot)) {
    return pool.get(projectRoot);
  }

  const dir = projectHashDir(projectRoot);
  const dbPath = path.join(dir, "impact-map.db");

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    // Use openDb() to ensure migrations run (e.g., adding 'type' column)
    const db = openDb(projectRoot);
    const qe = new QueryEngine(db, null); // logger injected at higher level in future phases
    pool.set(projectRoot, qe);
    return qe;
  } catch (err) {
    process.stderr.write(
      `[db-pool] Failed to open DB for ${projectRoot}: ${err.message}\n`,
    );
    return null;
  }
}

/**
 * List all projects that have a DB.
 * Scans ~/.ligamen/projects/ for impact-map.db files.
 * @returns {Array<{hash: string, dbPath: string, size: number}>}
 */
export function listProjects() {
  const projectsDir = path.join(dataDir, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  return fs
    .readdirSync(projectsDir)
    .filter((hash) =>
      fs.existsSync(path.join(projectsDir, hash, "impact-map.db")),
    )
    .map((hash) => {
      const dbPath = path.join(projectsDir, hash, "impact-map.db");
      const stat = fs.statSync(dbPath);

      // Try to read project root from the repos table
      let projectRoot = null;
      let serviceCount = 0;
      let repoCount = 0;
      try {
        const db = new Database(dbPath, { readonly: true });
        // Note: do NOT set journal_mode on a readonly connection — it requires write access
        const repo = db
          .prepare("SELECT path FROM repos ORDER BY id LIMIT 1")
          .get();
        if (repo) {
          // Project root is the common parent of all repo paths
          const allPaths = db.prepare("SELECT path FROM repos").pluck().all();
          projectRoot = commonParent(allPaths);
        }
        serviceCount = db.prepare("SELECT COUNT(*) as c FROM services").get().c;
        repoCount = db.prepare("SELECT COUNT(*) as c FROM repos").get().c;
        db.close();
      } catch {
        /* ignore — DB may be locked or corrupted */
      }

      return {
        hash,
        dbPath,
        size: stat.size,
        projectRoot,
        serviceCount,
        repoCount,
      };
    })
    .filter(
      (p) =>
        p.serviceCount > 0 &&
        p.projectRoot &&
        p.projectRoot !== "/" &&
        !p.projectRoot.startsWith("/tmp"),
    );
}

/**
 * Find the longest common parent directory of a list of paths.
 * @param {string[]} paths
 * @returns {string|null}
 */
function commonParent(paths) {
  if (!paths || paths.length === 0) return null;
  if (paths.length === 1) return path.dirname(paths[0]);

  const parts = paths.map((p) => p.split("/"));
  const common = [];
  for (let i = 0; i < parts[0].length; i++) {
    const segment = parts[0][i];
    if (parts.every((p) => p[i] === segment)) {
      common.push(segment);
    } else {
      break;
    }
  }
  return common.join("/") || null;
}

/**
 * Get a QueryEngine by project hash (instead of project root).
 * Used by the UI when it only knows the hash from /projects.
 * @param {string} hash
 * @returns {QueryEngine|null}
 */
export function getQueryEngineByHash(hash) {
  const projectsDir = path.join(dataDir, "projects");
  const dir = path.join(projectsDir, hash);
  // Security: validate dir resolves within the projects directory (base-dir guard)
  if (!path.resolve(dir).startsWith(projectsDir + path.sep)) return null;
  const dbPath = path.join(dir, "impact-map.db");

  if (!fs.existsSync(dbPath)) return null;

  // Check if already cached by any project root
  for (const [, qe] of pool) {
    if (qe._db && qe._db.name === dbPath) return qe;
  }

  try {
    // Open with migrations via a temporary openDb call
    // openDb uses projectRoot for hashing, but we already have the DB path.
    // Open directly but run migrations manually.
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    // Run all pending migrations using the same files as openDb()
    runMigrations(db);
    const qe = new QueryEngine(db, null); // logger injected at higher level in future phases
    pool.set(`__hash__${hash}`, qe);
    return qe;
  } catch (err) {
    process.stderr.write(
      `[db-pool] Failed to open DB for hash ${hash}: ${err.message}\n`,
    );
    return null;
  }
}

/**
 * Find a QueryEngine by repo name, searching across all project DBs.
 *
 * 1. First checks the pool cache — if any cached QE has a repos row matching
 *    the given name (case-insensitive), returns it without re-opening.
 * 2. Falls back to scanning all project DBs via listProjects(), queries each
 *    for a repos row with a matching name, and calls getQueryEngine() on the
 *    project root so migrations run and the result is properly pool-cached.
 *
 * @param {string} repoName - Repo name to search for (case-insensitive).
 * @returns {QueryEngine|null}
 */
export function getQueryEngineByRepo(repoName) {
  if (!repoName) return null;

  const nameLower = repoName.toLowerCase();

  // 1. Check pool cache first
  for (const [, qe] of pool) {
    if (qe._db) {
      try {
        const row = qe._db
          .prepare("SELECT id FROM repos WHERE lower(name) = ?")
          .get(nameLower);
        if (row) return qe;
      } catch {
        /* repos table may not exist in this DB */
      }
    }
  }

  // 2. Scan all project DBs
  const projectsDir = path.join(dataDir, "projects");
  if (!fs.existsSync(projectsDir)) return null;

  const hashes = fs
    .readdirSync(projectsDir)
    .filter((h) =>
      fs.existsSync(path.join(projectsDir, h, "impact-map.db")),
    );

  for (const hash of hashes) {
    const dbPath = path.join(projectsDir, hash, "impact-map.db");
    let matched = false;
    let matchedProjectRoot = null;
    try {
      const db = new Database(dbPath, { readonly: true });
      // Note: do NOT set journal_mode on a readonly connection — it requires write access
      try {
        // Check if this DB has a repos row matching the name
        const nameRow = db
          .prepare("SELECT path FROM repos WHERE lower(name) = ?")
          .get(nameLower);
        if (nameRow) {
          matched = true;
          // Determine projectRoot as common parent of all repo paths
          const allPaths = db.prepare("SELECT path FROM repos").pluck().all();
          matchedProjectRoot = commonParent(allPaths);
        }
      } finally {
        db.close();
      }
    } catch {
      /* DB locked, corrupted, or missing repos table — skip */
    }

    if (matched) {
      // Prefer pool-managed instance via getQueryEngine (runs migrations, uses dataDir).
      // This works when the projectRoot hash resolves back to the same dbPath under dataDir.
      if (matchedProjectRoot) {
        const qe = getQueryEngine(matchedProjectRoot);
        if (qe) return qe;
      }
      // Fallback: open by hash key (same path as getQueryEngineByHash — runs inline migrations)
      return getQueryEngineByHash(hash);
    }
  }

  return null;
}
