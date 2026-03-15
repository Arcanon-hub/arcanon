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
import { QueryEngine } from "./query-engine.js";

const dataDir =
  process.env.ALLCLEAR_DATA_DIR || path.join(os.homedir(), ".allclear");

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
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    const qe = new QueryEngine(db);
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
 * Scans ~/.allclear/projects/ for impact-map.db files.
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
        db.pragma("journal_mode = WAL");
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
    });
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
  const dir = path.join(dataDir, "projects", hash);
  const dbPath = path.join(dir, "impact-map.db");

  if (!fs.existsSync(dbPath)) return null;

  // Check if already cached by any project root
  for (const [, qe] of pool) {
    if (qe._db && qe._db.name === dbPath) return qe;
  }

  try {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    const qe = new QueryEngine(db);
    // Cache with hash as key since we don't know the project root
    pool.set(`__hash__${hash}`, qe);
    return qe;
  } catch (err) {
    process.stderr.write(
      `[db-pool] Failed to open DB for hash ${hash}: ${err.message}\n`,
    );
    return null;
  }
}
