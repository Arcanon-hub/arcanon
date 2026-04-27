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
import { openDb, runMigrations, _resetDbSingleton } from "./database.js";
import { QueryEngine } from "./query-engine.js";
import { resolveDataDir } from "../lib/data-dir.js";

const dataDir = resolveDataDir();

/** Cache: projectRoot → QueryEngine */
const pool = new Map();

/**
 * Compute the per-project data directory.
 *
 * Exported (NAV-01, plan 114-01) so that `cmdList` and other read-only CLI
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
 * Open a fresh QueryEngine pointed at the project's SHADOW database
 * (impact-map-shadow.db). NEVER enters the pool cache — every call opens
 * a new handle. Caller MUST close via qe._db.close() when done.
 *
 * Used by /arcanon:shadow-scan, /arcanon:diff --shadow, and tests.
 *
 * Why uncached (RESEARCH §1, Option B): bypasses openDb()'s process-singleton
 * problem entirely (live and shadow can never collide because they don't
 * share a code path), avoids the eviction-on-promote landmine that a cached
 * shadow QE would create (Plan 119-02 promote rename would orphan a stale
 * cached fd), and shadow ops are short-lived so caching offers near-zero
 * benefit. The inline pragma + runMigrations pattern mirrors getQueryEngineByHash.
 *
 * Atomic-promote constraint (RESEARCH §3): the shadow DB lives at
 * `${projectHashDir(root)}/impact-map-shadow.db` — sibling of the live
 * `impact-map.db`. Same parent dir → same filesystem → fs.rename is atomic
 * per POSIX. Plan 119-02's promote relies on this placement. Do NOT change
 * the path without updating that plan.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @param {{ create?: boolean }} [opts] - if create=true, mkdir+open even when shadow DB doesn't exist (used by shadow-scan).
 * @returns {QueryEngine|null} null if shadow DB is absent and create=false.
 */
export function getShadowQueryEngine(projectRoot, opts = {}) {
  if (!projectRoot) return null;
  const dir = projectHashDir(projectRoot);
  const shadowPath = path.join(dir, "impact-map-shadow.db");
  if (!fs.existsSync(shadowPath) && !opts.create) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(shadowPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000");
    db.pragma("busy_timeout = 5000");
    runMigrations(db);
    // Note: NOT cached. Caller is responsible for closing via qe._db.close().
    return new QueryEngine(db, null);
  } catch (err) {
    process.stderr.write(
      `[db-pool] Failed to open shadow DB for ${projectRoot}: ${err.message}\n`,
    );
    return null;
  }
}

/**
 * Drop the cached LIVE QueryEngine for a project, closing its DB handle first.
 *
 * REQUIRED before /arcanon:promote-shadow renames the live DB out from under
 * the worker — otherwise the cached `pool.get(projectRoot)._db` holds an fd
 * to a renamed-out inode and subsequent live-DB operations write to the
 * wrong file (RESEARCH §3, threat T-119-02-01).
 *
 * Implementation note (Plan 119-02 deviation Rule 1 — see SUMMARY): the
 * pool's QueryEngine wraps the same Database instance that `openDb` cached
 * in its module-level `_db` slot (database.js:30). If we only delete the
 * pool entry and close the QE's handle, the next `getQueryEngine` call
 * routes through `openDb` which short-circuits on the still-set `_db`
 * pointing at the now-CLOSED handle — and the caller crashes at first
 * statement prepare. So we ALSO call `_resetDbSingleton()` to clear the
 * database.js cache, ensuring the next `getQueryEngine` opens a fresh
 * handle pointed at whatever file lives at the live path post-promote.
 *
 * Idempotent — safe to call when no entry is cached. Returns false in that
 * case (caller can use the return value to populate the `evicted_cached_qe`
 * field of the promote `--json` output). NOTE: returns true ONLY when the
 * pool had a cached entry — the database.js singleton reset is a side
 * effect, not the return-value gate.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {boolean} true if a cached pool entry was evicted, false if none cached.
 */
export function evictLiveQueryEngine(projectRoot) {
  if (!projectRoot) return false;
  if (!pool.has(projectRoot)) return false;
  const qe = pool.get(projectRoot);
  try { qe._db.close(); } catch { /* already closed — still drop the entry */ }
  pool.delete(projectRoot);
  // Also clear the database.js process-singleton (see comment above) so the
  // next getQueryEngine call opens a fresh handle. Idempotent in database.js.
  _resetDbSingleton();
  return true;
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
