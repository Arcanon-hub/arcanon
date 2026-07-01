/**
 * worker/db-pool.js — Per-project DB and QueryEngine pool.
 *
 * The worker is project-agnostic. It resolves the correct DB based on
 * a project root path passed in each request (?project=/path/to/repo).
 * DBs are opened on first access and cached for the worker's lifetime.
 *
 * Phase 137 / ISO-02: the pool Map is keyed by the resolved dbPath
 * (absolute path to impact-map.db) in ALL three entry points so a given
 * DB file can have at most one QueryEngine, no matter which entry point
 * opened it. Trailing-slash / unnormalized variants fold to the same
 * entry via path.resolve() before hashing.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "./sqlite-adapter.js";
import { openDb, runMigrations } from "./database.js";
import { QueryEngine } from "./query-engine.js";
import { resolveDataDir } from "../lib/data-dir.js";

const dataDir = resolveDataDir();

/** Cache: resolved dbPath → QueryEngine (Phase 137 / ISO-02: keyed by DB file path, not projectRoot) */
const pool = new Map();

/**
 * Compute the per-project data directory.
 *
 * Exported (plan 114-01) so that `cmdList` and other read-only CLI
 * handlers can stat the resolved DB path without re-implementing the
 * sha256(project_root)[0:12] convention. Previously module-private — adding
 * `export` is purely additive and does not change call-site behaviour.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function projectHashDir(projectRoot) {
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
 * Phase 137 / ISO-02: the pool Map is keyed by the resolved dbPath (not the
 * raw projectRoot string). path.resolve() is applied before hashing so that
 * trailing-slash and unnormalized variants always resolve to the same entry.
 * A cached entry whose _db.name no longer matches its key is evicted and
 * re-opened (defends against a poisoned entry surviving from a prior run).
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {QueryEngine|null} Null if no DB exists for this project.
 */
export function getQueryEngine(projectRoot) {
  if (!projectRoot) return null;

  const resolved = path.resolve(projectRoot);
  const dir = projectHashDir(resolved);
  const dbPath = path.join(dir, "impact-map.db");

  if (pool.has(dbPath)) {
    const qe = pool.get(dbPath);
    // Invariant: cached handle must point to the expected file.
    // If it doesn't (stale/poisoned entry), evict and fall through to re-open.
    if (qe._db && qe._db.name !== dbPath) {
      pool.delete(dbPath);
    } else {
      return qe;
    }
  }

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    // openDb() is now a pure factory (Phase 137); pass the resolved root so
    // its internal path.resolve() call folds to the same canonical directory.
    const db = openDb(resolved);
    const qe = new QueryEngine(db, null); // logger injected at higher level in future phases
    pool.set(dbPath, qe);
    return qe;
  } catch (err) {
    process.stderr.write(
      `[db-pool] Failed to open DB for ${resolved}: ${err.message}\n`,
    );
    return null;
  }
}

/**
 * List all projects that have a DB.
 * Scans ~/.arcanon/projects/ for impact-map.db files.
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
      let repoPaths = [];
      try {
        const db = new Database(dbPath, { readonly: true });
        // Note: do NOT set journal_mode on a readonly connection — it requires write access
        const repo = db
          .prepare("SELECT path FROM repos ORDER BY id LIMIT 1")
          .get();
        if (repo) {
          // Project root is the common parent of all repo paths
          repoPaths = db.prepare("SELECT path FROM repos").pluck().all();
          projectRoot = commonParent(repoPaths);
        }
        serviceCount = db.prepare("SELECT COUNT(*) as c FROM services").get().c;
        repoCount = db.prepare("SELECT COUNT(*) as c FROM repos").get().c;
        db.close();
      } catch {
        /* ignore — DB may be locked or corrupted */
      }

      // Prefer the explicit "project-name" from arcanon.config.json so the
      // UI shows the user-chosen name instead of the parent directory's
      // basename. Falls back to null (callers display the path basename in
      // that case).
      //
      // Search order:
      //   1. projectRoot  — where the file lives in multi-repo setups
      //   2. each indexed repo path — commonParent of a single-repo
      //      project is its dirname (see commonParent below), so the
      //      config actually lives *inside* the repo. This loop covers
      //      that case.
      let projectName = null;
      const searchRoots = [projectRoot, ...repoPaths].filter(Boolean);
      const seen = new Set();
      for (const root of searchRoots) {
        if (seen.has(root)) continue;
        seen.add(root);
        let matched = false;
        for (const cfgFile of ["arcanon.config.json"]) {
          try {
            const cfg = JSON.parse(
              fs.readFileSync(path.join(root, cfgFile), "utf8"),
            );
            if (cfg && typeof cfg["project-name"] === "string" && cfg["project-name"].length > 0) {
              projectName = cfg["project-name"];
              matched = true;
              break;
            }
          } catch { /* config absent or unreadable — try next */ }
        }
        if (matched) break;
      }

      return {
        hash,
        dbPath,
        size: stat.size,
        projectRoot,
        projectName,
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
 *
 * Phase 137 / ISO-02: the pool entry is now keyed by dbPath (not by
 * `__hash__${hash}`) so a hash lookup and a root lookup for the same file
 * share a single pool entry — preventing two handles to one DB file.
 *
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

  // Check if already cached (pool is keyed by dbPath — covers both root and hash lookups)
  if (pool.has(dbPath)) return pool.get(dbPath);

  try {
    // Open directly (we already have the DB path, not a project root to hash).
    // Run pragmas + migrations to match the openDb() contract.
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    // Run all pending migrations using the same files as openDb()
    runMigrations(db);
    const qe = new QueryEngine(db, null); // logger injected at higher level in future phases
    // Key by dbPath so a subsequent getQueryEngine(root) call for this file
    // finds this entry rather than opening a second handle.
    pool.set(dbPath, qe);
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
