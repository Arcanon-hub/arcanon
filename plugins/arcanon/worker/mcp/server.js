#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { z } from "zod";
import { createLogger } from '../lib/logger.js';
import { getQueryEngine, getQueryEngineByHash, getQueryEngineByRepo } from '../db/pool.js';
import { enrichImpactResult, enrichSearchResult, enrichAffectedResult } from '../db/query-engine.js';
import { chromaSearch, isChromaAvailable } from '../server/chroma.js';
import { resolveDataDir } from '../lib/data-dir.js';

const dataDir = resolveDataDir();

/** Maximum hop depth for transitive impact graph traversal. */
const MAX_TRANSITIVE_DEPTH = 7;
/** Timeout in milliseconds for transitive impact queries. */
const QUERY_TIMEOUT_MS = 30_000;

let _mcpLogLevel = 'INFO';
try {
  const _settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  if (_settings.LIGAMEN_LOG_LEVEL) _mcpLogLevel = _settings.LIGAMEN_LOG_LEVEL;
} catch { /* settings absent — use default */ }

const logger = createLogger({ dataDir, logLevel: _mcpLogLevel, component: 'mcp' });

/**
 * Resolve the per-project DB path: ~/.ligamen/projects/<hash>/impact-map.db
 * Uses the same hashing logic as worker/db.js projectHashDir().
 */
function resolveDbPath(projectRoot = process.cwd()) {
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12);
  return path.join(dataDir, "projects", hash, "impact-map.db");
}

const dbPath =
  process.env.LIGAMEN_DB_PATH ||
  resolveDbPath(process.env.LIGAMEN_PROJECT_ROOT || process.cwd());

/**
 * Open the SQLite database in read-only mode.
 * Returns null if the file does not exist or if any error occurs.
 *
 * @deprecated Tool handlers no longer use openDb() — they use resolveDb() instead.
 *   openDb() is kept as a named export for backward compatibility with existing tests.
 */
export function openDb() {
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
    return db;
  } catch (err) {
    logger.error('Failed to open database', { error: err.message, stack: err.stack });
    return null;
  }
}

/**
 * Resolve a QueryEngine for a given project identifier per-call.
 * Accepts: absolute path, 12-char hex hash, repo name, or undefined (fallback to env/cwd).
 *
 * @param {string|undefined} project - Project identifier or undefined for default.
 * @returns {import('../db/query-engine.js').QueryEngine|null}
 */
export function resolveDb(project) {
  if (!project) {
    const root = process.env.LIGAMEN_PROJECT_ROOT || process.cwd();
    return getQueryEngine(root);
  }
  // Absolute path → validate it resolves within <dataDir>/projects/ (~/.arcanon or legacy ~/.ligamen)
  if (path.isAbsolute(project)) {
    const baseDir = path.join(dataDir, 'projects');
    const normalized = path.resolve(project);
    // Security: reject any path that escapes the projects directory
    if (!normalized.startsWith(baseDir + path.sep) && normalized !== baseDir) return null;
    return getQueryEngine(project);
  }
  // 12-char hex hash
  // Safe: regex rejects non-hex chars including '.' and '/'
  if (/^[0-9a-f]{12}$/.test(project)) {
    return getQueryEngineByHash(project);
  }
  // Repo name — search all project DBs
  return getQueryEngineByRepo(project);
}

// ─────────────────────────────────────────────────────────────
// Pure query functions (exported for testing)
// ─────────────────────────────────────────────────────────────

/**
 * Query impact for a given service.
 * @param {Database|null} db
 * @param {{ service: string, endpoint?: string, direction?: string, transitive?: boolean }} params
 * @returns {{ results: Array }}
 */
export async function queryImpact(
  db,
  { service, endpoint, direction = "consumes", transitive = false },
) {
  if (!db) return { results: [] };

  const svcRow = db
    .prepare("SELECT id FROM services WHERE name = ?")
    .get(service);
  if (!svcRow) return { results: [] };
  const serviceId = svcRow.id;

  if (transitive) {
    // Recursive CTE for full transitive impact — bounded at MAX_TRANSITIVE_DEPTH
    const cte = `
      WITH RECURSIVE impacted(id, depth, path) AS (
        SELECT ${direction === "consumes" ? "target_service_id" : "source_service_id"}, 1,
               CAST(? AS TEXT) || ',' || CAST(${direction === "consumes" ? "target_service_id" : "source_service_id"} AS TEXT)
        FROM connections WHERE ${direction === "consumes" ? "source_service_id" : "target_service_id"} = ?
        UNION ALL
        SELECT ${direction === "consumes" ? "c.target_service_id" : "c.source_service_id"}, i.depth + 1,
               i.path || ',' || CAST(${direction === "consumes" ? "c.target_service_id" : "c.source_service_id"} AS TEXT)
        FROM connections c JOIN impacted i ON ${direction === "consumes" ? "c.source_service_id" : "c.target_service_id"} = i.id
        WHERE i.path NOT LIKE '%,' || CAST(${direction === "consumes" ? "c.target_service_id" : "c.source_service_id"} AS TEXT) || ',%'
          AND i.depth < ${MAX_TRANSITIVE_DEPTH}
      )
      SELECT DISTINCT i.id, i.depth, s.name as service, c.protocol, c.method, c.path as path
      FROM impacted i
      JOIN services s ON s.id = i.id
      JOIN connections c ON (
        ${
          direction === "consumes"
            ? "c.source_service_id = i.id OR c.target_service_id = i.id"
            : "c.source_service_id = i.id OR c.target_service_id = i.id"
        }
      )
      ORDER BY i.depth, s.name
    `;

    // Interrupt the synchronous SQLite query if it runs over QUERY_TIMEOUT_MS.
    // better-sqlite3 exposes db.interrupt() which raises SQLITE_INTERRUPT.
    let rows;
    const timer = setTimeout(() => {
      try { db.interrupt?.(); } catch { /* ignore if already done */ }
    }, QUERY_TIMEOUT_MS);
    try {
      rows = db.prepare(cte).all(serviceId, serviceId);
      clearTimeout(timer);
    } catch (e) {
      clearTimeout(timer);
      if (e.message && /interrupt/i.test(e.message)) {
        return { results: [], error: "Query timeout: transitive impact query exceeded 30s", timeout: true };
      }
      throw e;
    }

    const results = rows.map((r) => ({
      service: r.service,
      protocol: r.protocol,
      method: r.method,
      path: r.path,
      depth: r.depth,
    }));

    // Detect truncation: if any row reached the depth cap, notify the caller.
    const maxFound = results.reduce((m, r) => Math.max(m, r.depth), 0);
    const truncated = maxFound >= MAX_TRANSITIVE_DEPTH;
    return {
      results,
      ...(truncated && {
        truncated: true,
        notice: `Results truncated at depth ${MAX_TRANSITIVE_DEPTH}`,
      }),
    };
  }

  // Direct (non-transitive) query
  let query;
  if (direction === "consumes") {
    query = `
      SELECT s.name as service, c.protocol, c.method, c.path as path, 1 as depth
      FROM connections c
      JOIN services s ON s.id = c.target_service_id
      WHERE c.source_service_id = ?
    `;
  } else {
    query = `
      SELECT s.name as service, c.protocol, c.method, c.path as path, 1 as depth
      FROM connections c
      JOIN services s ON s.id = c.source_service_id
      WHERE c.target_service_id = ?
    `;
  }

  if (endpoint) {
    query += " AND c.path LIKE ?";
    const rows = db.prepare(query).all(serviceId, `%${endpoint}%`);
    return { results: rows };
  }

  const rows = db.prepare(query).all(serviceId);
  return { results: rows };
}

/**
 * Query which services are affected by changed files.
 * @param {Database|null} db
 * @param {{ repo?: string, commit_range?: string, _changedFiles?: string[] }} params
 * @returns {{ affected: Array, changed_files: string[], error?: string }}
 */
export async function queryChanged(
  db,
  { repo, commit_range, _changedFiles } = {},
) {
  // Allow tests to inject changed files directly (bypasses git)
  let changedFiles = _changedFiles;
  let gitError = null;

  if (!changedFiles) {
    const cwd = repo || process.cwd();
    try {
      if (commit_range) {
        const out = execSync(`git diff --name-only ${commit_range}`, {
          cwd,
          encoding: "utf8",
        });
        changedFiles = out.trim().split("\n").filter(Boolean);
      } else {
        const unstaged = execSync("git diff --name-only HEAD", {
          cwd,
          encoding: "utf8",
        });
        const staged = execSync("git diff --name-only --cached", {
          cwd,
          encoding: "utf8",
        });
        changedFiles = [
          ...new Set([
            ...unstaged.trim().split("\n").filter(Boolean),
            ...staged.trim().split("\n").filter(Boolean),
          ]),
        ];
      }
    } catch (err) {
      gitError = "not a git repo";
      changedFiles = [];
    }
  }

  if (!db) {
    const result = { affected: [], changed_files: changedFiles };
    if (gitError) result.error = gitError;
    return result;
  }

  if (changedFiles.length === 0) {
    const result = { affected: [], changed_files: [] };
    if (gitError) result.error = gitError;
    return result;
  }

  const affectedMap = new Map();
  const stmt = db.prepare(`
    SELECT DISTINCT s.name, COUNT(c.id) as connection_count
    FROM services s
    JOIN connections c ON (c.source_service_id = s.id OR c.target_service_id = s.id)
    WHERE c.source_file LIKE ? OR c.target_file LIKE ?
    GROUP BY s.name
  `);

  for (const file of changedFiles) {
    const pattern = `%${file}%`;
    const rows = stmt.all(pattern, pattern);
    for (const row of rows) {
      if (!affectedMap.has(row.name)) {
        affectedMap.set(row.name, row.connection_count);
      }
    }
  }

  const affected = Array.from(affectedMap.entries()).map(
    ([service, connection_count]) => ({
      service,
      connection_count,
    }),
  );

  const result = { affected, changed_files: changedFiles };
  if (gitError) result.error = gitError;
  return result;
}

/**
 * Return the dependency subgraph for a service.
 * @param {Database|null} db
 * @param {{ service: string, depth?: number, direction?: string }} params
 * @returns {{ nodes: Array, edges: Array }}
 */
export async function queryGraph(
  db,
  { service, depth = 2, direction = "both" },
) {
  if (!db) return { nodes: [], edges: [] };

  const svcRow = db
    .prepare("SELECT id, name, language FROM services WHERE name = ?")
    .get(service);
  if (!svcRow) return { nodes: [], edges: [] };
  const serviceId = svcRow.id;
  const maxDepth = Math.min(depth, 5);

  const nodeMap = new Map();
  const edgeSet = new Set();
  const edges = [];

  nodeMap.set(svcRow.id, {
    id: svcRow.id,
    name: svcRow.name,
    language: svcRow.language,
  });

  // Traverse downstream (this service → targets)
  if (direction === "downstream" || direction === "both") {
    const cte = `
      WITH RECURSIVE traversal(id, depth) AS (
        SELECT target_service_id, 1 FROM connections WHERE source_service_id = ?
        UNION ALL
        SELECT c.target_service_id, t.depth + 1
        FROM connections c JOIN traversal t ON c.source_service_id = t.id
        WHERE t.depth < ?
      )
      SELECT DISTINCT id FROM traversal
    `;
    const reachable = db.prepare(cte).all(serviceId, maxDepth);
    for (const { id } of reachable) {
      if (!nodeMap.has(id)) {
        const s = db
          .prepare("SELECT id, name, language FROM services WHERE id = ?")
          .get(id);
        if (s)
          nodeMap.set(id, { id: s.id, name: s.name, language: s.language });
      }
    }

    // Collect edges among reachable nodes
    const reachableIds = [serviceId, ...reachable.map((r) => r.id)];
    const connStmt = db.prepare(`
      SELECT c.id, s1.name as source, s2.name as target, c.protocol, c.method, c.path
      FROM connections c
      JOIN services s1 ON c.source_service_id = s1.id
      JOIN services s2 ON c.target_service_id = s2.id
      WHERE c.source_service_id IN (${reachableIds.map(() => "?").join(",")})
        AND c.target_service_id IN (${reachableIds.map(() => "?").join(",")})
    `);
    const conns = connStmt.all(...reachableIds, ...reachableIds);
    for (const conn of conns) {
      const key = `${conn.source}→${conn.target}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          source: conn.source,
          target: conn.target,
          protocol: conn.protocol,
          method: conn.method,
          path: conn.path,
        });
      }
    }
  }

  // Traverse upstream (sources → this service)
  if (direction === "upstream" || direction === "both") {
    const cte = `
      WITH RECURSIVE traversal(id, depth) AS (
        SELECT source_service_id, 1 FROM connections WHERE target_service_id = ?
        UNION ALL
        SELECT c.source_service_id, t.depth + 1
        FROM connections c JOIN traversal t ON c.target_service_id = t.id
        WHERE t.depth < ?
      )
      SELECT DISTINCT id FROM traversal
    `;
    const reachable = db.prepare(cte).all(serviceId, maxDepth);
    for (const { id } of reachable) {
      if (!nodeMap.has(id)) {
        const s = db
          .prepare("SELECT id, name, language FROM services WHERE id = ?")
          .get(id);
        if (s)
          nodeMap.set(id, { id: s.id, name: s.name, language: s.language });
      }
    }

    // Collect upstream edges
    const reachableIds = [serviceId, ...reachable.map((r) => r.id)];
    const connStmt = db.prepare(`
      SELECT c.id, s1.name as source, s2.name as target, c.protocol, c.method, c.path
      FROM connections c
      JOIN services s1 ON c.source_service_id = s1.id
      JOIN services s2 ON c.target_service_id = s2.id
      WHERE c.source_service_id IN (${reachableIds.map(() => "?").join(",")})
        AND c.target_service_id IN (${reachableIds.map(() => "?").join(",")})
    `);
    const conns = connStmt.all(...reachableIds, ...reachableIds);
    for (const conn of conns) {
      const key = `${conn.source}→${conn.target}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          source: conn.source,
          target: conn.target,
          protocol: conn.protocol,
          method: conn.method,
          path: conn.path,
        });
      }
    }
  }

  // Remove the root service node from result nodes list (return only connected nodes)
  // Actually include all nodes including root for full subgraph
  const nodes = Array.from(nodeMap.values()).filter((n) => n.id !== serviceId);

  return { nodes, edges };
}

/**
 * Full-text search across connections: ChromaDB -> FTS5 -> SQL LIKE fallback.
 * @param {Database|null} db
 * @param {{ query: string, limit?: number }} params
 * @returns {{ results: Array, search_mode: string }}
 */
export async function querySearch(db, { query, limit = 20 }) {
  if (!db) return { results: [] };

  // Tier 1: ChromaDB semantic search (when available)
  if (isChromaAvailable()) {
    try {
      const chromaResults = await chromaSearch(query, limit);
      if (chromaResults.length > 0) {
        return {
          results: chromaResults.map((r) => ({
            path: r.document || r.id,
            protocol: (r.metadata && r.metadata.protocol) || "unknown",
            source_service: (r.metadata && r.metadata.source) || "unknown",
            target_service: (r.metadata && r.metadata.target) || "unknown",
            score: r.score,
          })),
          search_mode: "chroma",
        };
      }
    } catch (err) {
      logger.warn('ChromaDB search failed, falling back to FTS5', { error: err.message });
    }
  }

  // Tier 2: FTS5 keyword search
  try {
    const rows = db
      .prepare(
        `
      SELECT c.path, c.protocol,
             s_src.name as source_service,
             s_tgt.name as target_service
      FROM connections_fts fts
      JOIN connections c ON c.rowid = fts.rowid
      JOIN services s_src ON c.source_service_id = s_src.id
      JOIN services s_tgt ON c.target_service_id = s_tgt.id
      WHERE connections_fts MATCH ?
      LIMIT ?
    `,
      )
      .all(query, limit);
    return { results: rows, search_mode: "fts5" };
  } catch (err) {
    // If FTS5 table doesn't exist, fall through to SQL LIKE
    if (!err.message || !err.message.includes("no such table: connections_fts")) {
      logger.error('querySearch FTS5 error', { error: err.message, stack: err.stack });
    }
  }

  // Tier 3: SQL LIKE fallback (always available)
  const pattern = `%${query}%`;
  const rows = db
    .prepare(
      `
    SELECT c.path, c.protocol,
           s_src.name as source_service,
           s_tgt.name as target_service
    FROM connections c
    JOIN services s_src ON c.source_service_id = s_src.id
    JOIN services s_tgt ON c.target_service_id = s_tgt.id
    WHERE c.path LIKE ? OR c.source_file LIKE ?
    LIMIT ?
  `,
    )
    .all(pattern, pattern, limit);
  return { results: rows, search_mode: "sql_fallback" };
}

// ─────────────────────────────────────────────────────────────
// Drift helpers (shared across drift_versions, drift_types, drift_openapi)
// ─────────────────────────────────────────────────────────────

/**
 * Get all scanned repo paths from DB, or empty array if db is null.
 * @param {import('better-sqlite3').Database|null} db
 * @returns {{ path: string, name: string }[]}
 */
function getDriftRepos(db) {
  if (!db) return [];
  try {
    return db.prepare("SELECT path, name FROM repos").all();
  } catch { return []; }
}

/**
 * Strip leading semver range specifiers (^, ~, >=, <=, >, <, ==) for comparison.
 * Port of normalize_version() from scripts/drift-versions.sh.
 * @param {string} v
 * @returns {string}
 */
function normalizeVersion(v) {
  return v.replace(/^[^0-9a-zA-Z]*/, '').replace(/^[^0-9]*/, '');
}

/**
 * Returns true if version string starts with a range specifier character.
 * Port of has_range_specifier() from scripts/drift-versions.sh.
 * @param {string} v
 * @returns {boolean}
 */
function hasRangeSpecifier(v) {
  return /^[\^~>=<]/.test(v);
}

/**
 * Extract dependency name→version map from package.json.
 * Port of extract_versions() package.json section from scripts/drift-versions.sh.
 * @param {string} repoPath
 * @returns {Record<string, string>}
 */
function extractPackageJsonVersions(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch { return {}; }
}

/**
 * Extract dependency name→version map from go.mod.
 * Port of extract_versions() go.mod section from scripts/drift-versions.sh.
 * @param {string} repoPath
 * @returns {Record<string, string>}
 */
function extractGoModVersions(repoPath) {
  const modPath = path.join(repoPath, 'go.mod');
  if (!fs.existsSync(modPath)) return {};
  const versions = {};
  try {
    const lines = fs.readFileSync(modPath, 'utf8').split('\n');
    let inBlock = false;
    for (const line of lines) {
      if (/^require \(/.test(line)) { inBlock = true; continue; }
      if (/^\)/.test(line)) { inBlock = false; continue; }
      if (inBlock && /^\t/.test(line)) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] && parts[1]) versions[parts[0]] = parts[1];
      }
      const m = line.match(/^require (\S+) (\S+)/);
      if (m) versions[m[1]] = m[2];
    }
  } catch { /* ignore */ }
  return versions;
}

/**
 * Extract dependency name→version map from Cargo.toml [dependencies] section.
 * Uses line-by-line regex (no yq required) — port of awk fallback in scripts/drift-versions.sh.
 * @param {string} repoPath
 * @returns {Record<string, string>}
 */
function extractCargoVersions(repoPath) {
  const tomlPath = path.join(repoPath, 'Cargo.toml');
  if (!fs.existsSync(tomlPath)) return {};
  const versions = {};
  try {
    const lines = fs.readFileSync(tomlPath, 'utf8').split('\n');
    let inDeps = false;
    for (const line of lines) {
      if (/^\[dependencies\]/.test(line)) { inDeps = true; continue; }
      if (/^\[/.test(line) && !/^\[dependencies\]/.test(line)) { inDeps = false; continue; }
      if (!inDeps) continue;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const name = trimmed.split(/\s*=/)[0].trim();
      if (!name) continue;
      // Simple form: name = "1.2.3"
      const simpleMatch = trimmed.match(/=\s*"([0-9][^"]*)"$/);
      if (simpleMatch) { versions[name] = simpleMatch[1]; continue; }
      // Inline table: name = { version = "1.2.3", ... }
      const tableMatch = trimmed.match(/version\s*=\s*"([^"]+)"/);
      if (tableMatch) { versions[name] = tableMatch[1]; }
    }
  } catch { /* ignore */ }
  return versions;
}

/**
 * Extract all dependency versions from a repo path (all manifest types).
 * @param {string} repoPath
 * @returns {Record<string, string>}
 */
function extractAllVersions(repoPath) {
  return {
    ...extractPackageJsonVersions(repoPath),
    ...extractGoModVersions(repoPath),
    ...extractCargoVersions(repoPath),
  };
}

/**
 * Query dependency version mismatches across all scanned repos.
 * Port of the main comparison loop in scripts/drift-versions.sh.
 * @param {import('better-sqlite3').Database|null} db
 * @param {{ severity?: string }} params
 * @returns {{ findings: Array, repos_scanned: number }}
 */
export async function queryDriftVersions(db, { severity = "WARN" } = {}) {
  const repos = getDriftRepos(db);
  if (repos.length === 0) return { findings: [], repos_scanned: 0 };

  // Build package→{repoName: version} map.
  // Only include repos whose paths exist on disk.
  const pkgMap = new Map(); // pkg name → Map<repoName, rawVersion>
  let reposScanned = 0;

  for (const repo of repos) {
    if (!fs.existsSync(repo.path)) continue;
    reposScanned++;
    const versions = extractAllVersions(repo.path);
    for (const [pkg, ver] of Object.entries(versions)) {
      if (!pkgMap.has(pkg)) pkgMap.set(pkg, new Map());
      pkgMap.get(pkg).set(repo.name, ver);
    }
  }

  const findings = [];
  const severityOrder = { CRITICAL: 3, WARN: 2, INFO: 1, all: 0 };
  const minSeverity = severityOrder[severity] ?? severityOrder.WARN;

  for (const [pkg, repoVersions] of pkgMap) {
    if (repoVersions.size < 2) continue; // only in one repo — not drift

    const entries = Array.from(repoVersions.entries()); // [[repoName, rawVersion], ...]
    const normalizedVersions = entries.map(([, v]) => normalizeVersion(v));
    const uniqueNormalized = new Set(normalizedVersions);

    let level, detail;
    if (uniqueNormalized.size > 1) {
      // Exact version mismatch
      const hasAnyRange = entries.some(([, v]) => hasRangeSpecifier(v));
      if (hasAnyRange) {
        level = "WARN";
        detail = "Different locking strategies: " + entries.map(([r, v]) => `${r}=${v}`).join(" ");
      } else {
        level = "CRITICAL";
        detail = "Version mismatch: " + entries.map(([r, v]) => `${r}=${v}`).join(" ");
      }
    } else {
      // Normalized versions match — check raw strings differ (range specifier mismatch)
      const rawVersions = new Set(entries.map(([, v]) => v));
      if (rawVersions.size > 1) {
        level = "WARN";
        detail = "Different range specifiers: " + entries.map(([r, v]) => `${r}=${v}`).join(" ");
      } else {
        level = "INFO";
        detail = `All at same version (${normalizedVersions[0]})`;
      }
    }

    const levelOrder = severityOrder[level] ?? 0;
    if (severity === "all" || levelOrder >= minSeverity) {
      findings.push({
        level,
        item: pkg,
        repos: entries.map(([r]) => r),
        detail,
      });
    }
  }

  return { findings, repos_scanned: reposScanned };
}

/**
 * Detect repo language from manifest files. Port of detect_repo_language() in drift-types.sh.
 * @param {string} repoPath
 * @returns {'ts'|'go'|'py'|'rs'|'unknown'}
 */
function detectRepoLanguage(repoPath) {
  if (fs.existsSync(path.join(repoPath, 'package.json'))) return 'ts';
  if (fs.existsSync(path.join(repoPath, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(repoPath, 'pyproject.toml')) || fs.existsSync(path.join(repoPath, 'setup.py'))) return 'py';
  if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) return 'rs';
  return 'unknown';
}

/**
 * Recursively collect files matching an extension within a directory, up to maxDepth hops.
 * @param {string} dir - Start directory
 * @param {string} ext - File extension including dot (e.g. '.ts')
 * @param {number} maxDepth
 * @returns {string[]}
 */
function collectFiles(dir, ext, maxDepth = 4) {
  const results = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  }
  walk(dir, 0);
  return results;
}

/**
 * Extract exported type/interface/struct names from a repo.
 * Port of extract_type_names() dispatch logic in drift-types.sh.
 * Capped at 50 names per repo (research Pitfall 5).
 * @param {string} repoPath
 * @param {'ts'|'go'|'py'|'rs'} lang
 * @returns {string[]}
 */
function extractTypeNames(repoPath, lang) {
  const names = new Set();
  const cap = 50;

  if (lang === 'ts') {
    const srcDir = path.join(repoPath, 'src');
    const searchDir = fs.existsSync(srcDir) ? srcDir : repoPath;
    for (const file of collectFiles(searchDir, '.ts')) {
      if (names.size >= cap) break;
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const m of content.matchAll(/export\s+(?:interface|type)\s+([A-Z][A-Za-z0-9_]+)/g)) {
          names.add(m[1]);
          if (names.size >= cap) break;
        }
      } catch { /* skip unreadable file */ }
    }
  } else if (lang === 'go') {
    for (const file of collectFiles(repoPath, '.go')) {
      if (names.size >= cap) break;
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const m of content.matchAll(/^type\s+([A-Z][A-Za-z0-9_]+)\s+struct/gm)) {
          names.add(m[1]);
          if (names.size >= cap) break;
        }
      } catch { /* skip */ }
    }
  } else if (lang === 'py') {
    const srcDir = path.join(repoPath, 'src');
    const searchDir = fs.existsSync(srcDir) ? srcDir : repoPath;
    for (const file of collectFiles(searchDir, '.py')) {
      if (names.size >= cap) break;
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const m of content.matchAll(/^class\s+([A-Z][A-Za-z0-9_]+)/gm)) {
          names.add(m[1]);
          if (names.size >= cap) break;
        }
      } catch { /* skip */ }
    }
  } else if (lang === 'rs') {
    const srcDir = path.join(repoPath, 'src');
    const searchDir = fs.existsSync(srcDir) ? srcDir : repoPath;
    for (const file of collectFiles(searchDir, '.rs')) {
      if (names.size >= cap) break;
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const m of content.matchAll(/^pub\s+struct\s+([A-Z][A-Za-z0-9_]+)/gm)) {
          names.add(m[1]);
          if (names.size >= cap) break;
        }
      } catch { /* skip */ }
    }
  }

  return Array.from(names);
}

/**
 * Extract the body of a named type definition from a repo.
 * Returns sorted lines of the type body for comparison.
 * Port of extract_type_body() from drift-types.sh.
 * @param {string} repoPath
 * @param {string} typeName
 * @param {'ts'|'go'|'py'|'rs'} lang
 * @returns {string}
 */
function extractTypeBody(repoPath, typeName, lang) {
  let searchDir = repoPath;
  let ext = '.ts';
  if (lang === 'ts') {
    ext = '.ts';
    const src = path.join(repoPath, 'src');
    if (fs.existsSync(src)) searchDir = src;
  } else if (lang === 'go') {
    ext = '.go';
  } else if (lang === 'py') {
    ext = '.py';
    const src = path.join(repoPath, 'src');
    if (fs.existsSync(src)) searchDir = src;
  } else if (lang === 'rs') {
    ext = '.rs';
    const src = path.join(repoPath, 'src');
    if (fs.existsSync(src)) searchDir = src;
  }

  for (const file of collectFiles(searchDir, ext)) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      let found = false;
      let depth = 0;
      const body = [];

      for (const line of lines) {
        if (!found) {
          if (lang === 'ts' && new RegExp(`(interface|type)\\s+${typeName}[^A-Za-z0-9_]`).test(line)) {
            found = true;
          } else if (lang === 'go' && new RegExp(`^type\\s+${typeName}\\s+struct`).test(line)) {
            found = true;
          } else if (lang === 'py' && new RegExp(`^class\\s+${typeName}[:(]`).test(line)) {
            found = true;
          } else if (lang === 'rs' && new RegExp(`pub\\s+struct\\s+${typeName}[^A-Za-z0-9_]`).test(line)) {
            found = true;
          }
          if (found) {
            // Handle inline single-line declarations: extract body from declaration line itself.
            // e.g. "export interface Foo { a: string; b: number; }"
            if (lang !== 'py') {
              const openIdx = line.indexOf('{');
              if (openIdx !== -1) {
                // Count braces on this declaration line to track depth
                depth += (line.match(/{/g) || []).length;
                depth -= (line.match(/}/g) || []).length;
                if (depth <= 0) {
                  // Single-line definition — extract the content between the braces
                  const inlineBody = line.slice(openIdx + 1, line.lastIndexOf('}')).trim();
                  if (inlineBody) {
                    // Split on ';' or ',' to get individual fields
                    const fields = inlineBody.split(/[;,]/).map(s => s.trim()).filter(Boolean);
                    if (fields.length > 0) {
                      body.push(...fields);
                      break; // done — single-line definition fully parsed
                    }
                  }
                  // Empty braces or nothing useful — stop
                  break;
                }
                // Opening brace found but not closed on same line — continue collecting next lines
              }
            }
            continue;
          }
        } else {
          // For ts/go/rs: track braces; for py: track indentation
          if (lang === 'py') {
            if (/^[^ \t]/.test(line) && line.trim()) break;
            body.push(line.trim());
          } else {
            depth += (line.match(/{/g) || []).length;
            depth -= (line.match(/}/g) || []).length;
            if (depth < 0) break;
            body.push(line.trim());
          }
        }
      }
      if (body.length > 0) return body.filter(Boolean).sort().join('\n');
    } catch { /* skip */ }
  }
  return '';
}

/**
 * Query shared type/struct/interface mismatches across repos of the same language.
 * Port of the main comparison loop in scripts/drift-types.sh.
 * @param {import('better-sqlite3').Database|null} db
 * @param {{ severity?: string }} params
 * @returns {{ findings: Array, repos_scanned: number }}
 */
export async function queryDriftTypes(db, { severity = "WARN" } = {}) {
  const repos = getDriftRepos(db);
  if (repos.length === 0) return { findings: [], repos_scanned: 0 };

  // Group repos by language (only valid paths)
  const langGroups = new Map(); // lang → [{ path, name }]
  let reposScanned = 0;

  for (const repo of repos) {
    if (!fs.existsSync(repo.path)) continue;
    reposScanned++;
    const lang = detectRepoLanguage(repo.path);
    if (lang === 'unknown') continue;
    if (!langGroups.has(lang)) langGroups.set(lang, []);
    langGroups.get(lang).push(repo);
  }

  const findings = [];
  const severityOrder = { CRITICAL: 3, WARN: 2, INFO: 1, all: 0 };
  const minSeverity = severityOrder[severity] ?? severityOrder.WARN;

  for (const [lang, langRepos] of langGroups) {
    if (langRepos.length < 2) continue; // need 2+ repos of same language

    // Collect type names per repo (capped at 50)
    const typeRepoMap = new Map(); // typeName → [repo, ...]

    for (const repo of langRepos) {
      const names = extractTypeNames(repo.path, lang);
      for (const name of names) {
        if (!typeRepoMap.has(name)) typeRepoMap.set(name, []);
        typeRepoMap.get(name).push(repo);
      }
    }

    // Find shared types (in 2+ repos) and compare bodies
    for (const [typeName, reposWithType] of typeRepoMap) {
      if (reposWithType.length < 2) continue;

      const bodyA = extractTypeBody(reposWithType[0].path, typeName, lang);
      let hasDiff = false;
      const diffDetails = [];

      for (let i = 1; i < reposWithType.length; i++) {
        const bodyB = extractTypeBody(reposWithType[i].path, typeName, lang);
        if (bodyA !== bodyB) {
          hasDiff = true;
          diffDetails.push(`${reposWithType[0].name} vs ${reposWithType[i].name}: bodies differ`);
        }
      }

      const level = hasDiff ? "CRITICAL" : "INFO";
      const detail = hasDiff
        ? "Field differences: " + diffDetails.join("; ")
        : "Fields match across all repos";
      const levelOrder = severityOrder[level] ?? 0;

      if (severity === "all" || levelOrder >= minSeverity) {
        findings.push({
          level,
          item: `${typeName} (${lang})`,
          repos: reposWithType.map(r => r.name),
          detail,
        });
      }
    }
  }

  return { findings, repos_scanned: reposScanned };
}

/**
 * Well-known OpenAPI spec file locations in order of convention frequency.
 * Port of OPENAPI_CANDIDATES from scripts/drift-openapi.sh.
 */
const OPENAPI_CANDIDATES = [
  'openapi.yaml', 'openapi.yml', 'openapi.json',
  'swagger.yaml', 'swagger.yml', 'swagger.json',
  'api/openapi.yaml', 'api/openapi.yml', 'api/openapi.json',
  'api/swagger.yaml', 'docs/openapi.yaml', 'spec/openapi.yaml',
];

/**
 * Find an OpenAPI spec file in a repo directory.
 * Checks well-known paths first, then falls back to a recursive scan (maxdepth 3).
 * Port of find_openapi_spec() from scripts/drift-openapi.sh.
 * @param {string} repoPath
 * @returns {string|null} Absolute path to spec file, or null if not found
 */
function findOpenApiSpec(repoPath) {
  for (const candidate of OPENAPI_CANDIDATES) {
    const full = path.join(repoPath, candidate);
    if (fs.existsSync(full)) return full;
  }
  // Fallback: recursive scan limited to maxdepth 3
  for (const file of collectFiles(repoPath, '.yaml', 3).concat(collectFiles(repoPath, '.json', 3))) {
    const base = path.basename(file);
    if (base === 'openapi.yaml' || base === 'openapi.json' || base === 'openapi.yml') return file;
  }
  return null;
}

/**
 * Compare two OpenAPI spec files using oasdiff (with graceful degradation).
 * Port of compare_openapi() from scripts/drift-openapi.sh.
 * Uses 5-second timeout on execSync calls (research Pitfall 3).
 * @param {string} specA - Absolute path to first spec
 * @param {string} specB - Absolute path to second spec
 * @param {string} repoA - Repo name for first spec
 * @param {string} repoB - Repo name for second spec
 * @returns {{ findings: Array, tool_used: string }}
 */
function compareOpenApiSpecs(specA, specB, repoA, repoB) {
  const findings = [];
  let toolUsed = 'none';

  try {
    execSync('which oasdiff', { stdio: 'ignore', timeout: 2000 });
    toolUsed = 'oasdiff';

    // Breaking changes
    let breaking = '';
    try {
      breaking = execSync(`oasdiff breaking "${specA}" "${specB}"`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
    } catch (err) {
      if (err.code === 'ETIMEDOUT') {
        findings.push({
          level: 'INFO',
          item: 'openapi-spec',
          repos: [repoA, repoB],
          detail: 'oasdiff comparison timed out (5s). Spec may be too large.',
        });
        return { findings, tool_used: toolUsed };
      }
      // Non-zero exit = oasdiff found breaking changes in stderr/stdout
      breaking = (err.stdout || '').trim();
    }
    if (breaking) {
      const preview = breaking.split('\n').slice(0, 10).join(' ');
      findings.push({
        level: 'CRITICAL',
        item: 'openapi-spec',
        repos: [repoA, repoB],
        detail: `Breaking changes: ${preview}`,
      });
    }

    // Non-breaking diffs
    let diffOut = '';
    try {
      diffOut = execSync(`oasdiff diff "${specA}" "${specB}" --format text`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
    } catch (err) {
      diffOut = (err.stdout || '').trim();
    }
    if (diffOut) {
      const preview = diffOut.split('\n').slice(0, 20).join(' ');
      findings.push({
        level: 'WARN',
        item: 'openapi-spec',
        repos: [repoA, repoB],
        detail: `Non-breaking diffs: ${preview}`,
      });
    }

    if (!breaking && !diffOut) {
      findings.push({
        level: 'INFO',
        item: 'openapi-spec',
        repos: [repoA, repoB],
        detail: 'OpenAPI specs are identical',
      });
    }
  } catch {
    // oasdiff not available
    findings.push({
      level: 'INFO',
      item: 'openapi-spec',
      repos: [repoA, repoB],
      detail: 'Install oasdiff for full OpenAPI comparison',
    });
  }

  return { findings, tool_used: toolUsed };
}

/**
 * Query OpenAPI spec breaking changes across all scanned repos.
 * Port of the main comparison loop in scripts/drift-openapi.sh.
 * Uses pairwise comparison for N <= 5 repos; hub-and-spoke for N > 5.
 * @param {import('better-sqlite3').Database|null} db
 * @param {{ severity?: string }} params
 * @returns {{ findings: Array, repos_scanned: number, tool_available: boolean }}
 */
export async function queryDriftOpenapi(db, { severity = "WARN" } = {}) {
  const repos = getDriftRepos(db);
  if (repos.length === 0) return { findings: [], repos_scanned: 0, tool_available: false };

  // Collect repos with OpenAPI specs (valid paths only)
  const reposWithSpecs = [];
  let reposScanned = 0;

  for (const repo of repos) {
    if (!fs.existsSync(repo.path)) continue;
    reposScanned++;
    const specPath = findOpenApiSpec(repo.path);
    if (specPath) {
      reposWithSpecs.push({ ...repo, specPath });
    }
  }

  // Check oasdiff availability once
  let oasdiffAvailable = false;
  try {
    execSync('which oasdiff', { stdio: 'ignore', timeout: 2000 });
    oasdiffAvailable = true;
  } catch { /* not available */ }

  if (reposWithSpecs.length < 2) {
    return { findings: [], repos_scanned: reposScanned, tool_available: oasdiffAvailable };
  }

  const allFindings = [];
  const severityOrder = { CRITICAL: 3, WARN: 2, INFO: 1, all: 0 };
  const minSeverity = severityOrder[severity] ?? severityOrder.WARN;

  /**
   * Helper: compare a pair and add findings after severity filtering.
   */
  function addPairFindings(repoA, repoB) {
    const { findings } = compareOpenApiSpecs(
      repoA.specPath, repoB.specPath,
      repoA.name, repoB.name,
    );
    for (const f of findings) {
      const levelOrder = severityOrder[f.level] ?? 0;
      if (severity === "all" || levelOrder >= minSeverity) {
        allFindings.push(f);
      }
    }
  }

  if (reposWithSpecs.length <= 5) {
    // Full pairwise comparison (N*(N-1)/2 pairs)
    for (let i = 0; i < reposWithSpecs.length - 1; i++) {
      for (let j = i + 1; j < reposWithSpecs.length; j++) {
        addPairFindings(reposWithSpecs[i], reposWithSpecs[j]);
      }
    }
  } else {
    // Hub-and-spoke: compare each against first repo only
    for (let i = 1; i < reposWithSpecs.length; i++) {
      addPairFindings(reposWithSpecs[0], reposWithSpecs[i]);
    }
  }

  return { findings: allFindings, repos_scanned: reposScanned, tool_available: oasdiffAvailable };
}

/**
 * Trigger a scan via the HTTP worker, or return unavailable if worker is not running.
 * @param {{ repo?: string, full?: boolean }} params
 * @returns {{ status: string, message: string }}
 */
export async function queryScan({ repo, full = false } = {}) {
  try {
    const portFilePath = path.join(dataDir, "worker.port");
    let port;
    try {
      port = fs.readFileSync(portFilePath, "utf8").trim();
    } catch {
      return {
        status: "unavailable",
        message:
          "Worker not running. Run /ligamen:map to build the dependency map.",
      };
    }

    if (!port) {
      return {
        status: "unavailable",
        message:
          "Worker not running. Run /ligamen:map to build the dependency map.",
      };
    }

    // Check readiness with 2-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`http://localhost:${port}/api/readiness`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        return {
          status: "unavailable",
          message: `Worker not responding on port ${port}.`,
        };
      }
    } catch (err) {
      clearTimeout(timeout);
      logger.error('queryScan readiness check failed', { error: err.message, stack: err.stack });
      return {
        status: "unavailable",
        message: `Worker not responding on port ${port}.`,
      };
    }

    // Trigger scan
    try {
      await fetch(`http://localhost:${port}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, full }),
      });
      return {
        status: "triggered",
        message: "Scan started. Results will be available after confirmation.",
      };
    } catch (err) {
      logger.error('queryScan fetch failed', { error: err.message, stack: err.stack });
      return { status: "error", message: err.message };
    }
  } catch (err) {
    logger.error('queryScan failed', { error: err.message, stack: err.stack });
    return { status: "error", message: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// MCP Server setup
// ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: "ligamen-impact", version: "2.0.0" });

// ── impact_query ─────────────────────────────────────────────
server.tool(
  "impact_query",
  "Query which services consume or are consumed by a given service. Returns direct or transitive dependency relationships.",
  {
    service: z.string().describe("Name of the service to query"),
    endpoint: z
      .string()
      .optional()
      .describe("Filter by specific endpoint path"),
    direction: z
      .enum(["consumes", "exposes"])
      .default("consumes")
      .describe(
        "consumes = services this service calls; exposes = services that call this service",
      ),
    transitive: z
      .boolean()
      .default(false)
      .describe(
        "When true, follows dependency chains transitively (up to depth 7)",
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd.",
      ),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const raw = await queryImpact(qe?._db ?? null, params);
      // Enrich with type-aware summary when db is available
      const result = qe?._db
        ? enrichImpactResult(qe._db, params.service, raw.results)
        : raw;
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('impact_query failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── impact_changed ───────────────────────────────────────────
server.tool(
  "impact_changed",
  "Identify which services are affected by currently changed files in the git working tree.",
  {
    repo: z
      .string()
      .optional()
      .describe("Absolute path to the git repo (defaults to cwd)"),
    commit_range: z
      .string()
      .optional()
      .describe(
        'Git commit range e.g. "HEAD~3..HEAD" — if omitted, uses working tree diff',
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd.",
      ),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const raw = await queryChanged(qe?._db ?? null, params);
      const enrichedAffected = qe?._db
        ? enrichAffectedResult(qe._db, raw.affected)
        : raw.affected.map(r => ({ ...r, owner: null, auth_mechanism: null, db_backend: null }));
      const result = { ...raw, affected: enrichedAffected };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('impact_changed failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── impact_graph ─────────────────────────────────────────────
server.tool(
  "impact_graph",
  "Return the dependency subgraph (nodes + edges) for a service up to a given depth.",
  {
    service: z.string().describe("Name of the service to centre the graph on"),
    depth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(2)
      .describe("How many hops to traverse (max 5)"),
    direction: z
      .enum(["upstream", "downstream", "both"])
      .default("both")
      .describe(
        "Which direction to traverse: upstream = callers, downstream = callees, both = full neighbourhood",
      ),
    project: z
      .string()
      .optional()
      .describe(
        "Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd.",
      ),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const result = await queryGraph(qe?._db ?? null, params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('impact_graph failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── impact_search ─────────────────────────────────────────────
server.tool(
  "impact_search",
  "Full-text search across all service connections by path, protocol, or file name. Falls back to SQL LIKE when FTS5 index is unavailable.",
  {
    query: z
      .string()
      .describe(
        "Search term to match against connection paths, protocols, and file names",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of results to return"),
    project: z
      .string()
      .optional()
      .describe(
        "Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd.",
      ),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const raw = await querySearch(qe?._db ?? null, params);
      // Enrich results with actor relationship sentences
      const enrichedResults = qe?._db
        ? enrichSearchResult(qe._db, raw.results)
        : raw.results;
      const result = { ...raw, results: enrichedResults };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('impact_search failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── impact_scan ──────────────────────────────────────────────
server.tool(
  "impact_scan",
  "Trigger a dependency scan via the Ligamen HTTP worker. Returns unavailable when the worker is not running.",
  {
    repo: z
      .string()
      .optional()
      .describe("Absolute path to the repo to scan (defaults to cwd)"),
    full: z
      .boolean()
      .default(false)
      .describe(
        "When true, forces a full re-scan instead of an incremental scan",
      ),
  },
  async (params) => {
    try {
      const result = await queryScan(params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('impact_scan failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── drift_versions ────────────────────────────────────────────
server.tool(
  "drift_versions",
  "Query dependency version mismatches across scanned repos. Returns CRITICAL when exact versions differ across repos, WARN when range specifiers differ.",
  {
    severity: z.enum(["CRITICAL", "WARN", "INFO", "all"]).default("WARN")
      .describe("Minimum finding severity to include in results. CRITICAL = exact version mismatch; WARN = range specifier mismatch; INFO = all match; all = include everything."),
    project: z.string().optional()
      .describe("Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd."),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const result = await queryDriftVersions(qe?._db ?? null, params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('drift_versions failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── drift_types ───────────────────────────────────────────────
server.tool(
  "drift_types",
  "Query shared type, interface, and struct definition mismatches across repos of the same language. Only compares repos within the same language group (TypeScript vs TypeScript, Go vs Go, etc).",
  {
    severity: z.enum(["CRITICAL", "WARN", "INFO", "all"]).default("WARN")
      .describe("Minimum finding severity. CRITICAL = shared type has different fields; INFO = fields match."),
    project: z.string().optional()
      .describe("Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd."),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const result = await queryDriftTypes(qe?._db ?? null, params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('drift_types failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

// ── drift_openapi ─────────────────────────────────────────────
server.tool(
  "drift_openapi",
  "Query OpenAPI spec breaking changes across scanned repos. Uses oasdiff when installed for full structural comparison with $ref resolution; returns an informational message when oasdiff is unavailable. For N > 5 repos with specs, uses hub-and-spoke comparison strategy.",
  {
    severity: z.enum(["CRITICAL", "WARN", "INFO", "all"]).default("WARN")
      .describe("Minimum finding severity. CRITICAL = breaking API changes; WARN = non-breaking diffs; INFO = identical or tool unavailable."),
    project: z.string().optional()
      .describe("Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd."),
  },
  async (params) => {
    try {
      const qe = resolveDb(params.project);
      if (!qe && params.project) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
      }
      const result = await queryDriftOpenapi(qe?._db ?? null, params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      logger.error('drift_openapi failed', { error: err.message, stack: err.stack });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGTERM", () => process.exit(0));
