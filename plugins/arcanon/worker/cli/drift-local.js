#!/usr/bin/env node
/**
 * worker/cli/drift-local.js — Diff two local scan snapshots.
 *
 * Primary path (INTG-01): routes /arcanon:drift graph through the canonical
 * diffScanVersions() engine over two immutable snapshot DBs resolved from
 * map_versions.repos_json (Phase 139 / migration 021). Returns an
 * added/removed/modified report for services and connections.
 *
 * Graceful fallbacks (exit 0, never crash):
 *   A) Fewer than 2 map_versions rows with snapshot_path →
 *      "run /arcanon:map at least twice" guidance.
 *   B) Rows exist but no repos_json (pre-migration-021 DB) →
 *      live-DB diff using listVersions + servicesForVersion +
 *      connectionsForVersion (142-01 SQL-column fix).
 *
 * Multi-repo: diffs the INTERSECTION of repos present in BOTH repos_json
 * arrays (matched by path). A --repo <path> flag narrows to one repo.
 *
 * Kind-mismatch (142-RESEARCH Open Question 1): if the two most-recent
 * snapshots cover different repo sets (e.g. a 'rescan' over repo-A and a
 * 'map' over repo-B) the intersection is empty. We print the snapshot kinds
 * and exit 0 — this is expected for partial-rescan snapshots.
 *
 * Path-traversal guard: snapshot_path must be a relative path with no '..'
 * segment and no absolute prefix (T-142-02-01).
 *
 * Usage:
 *   node worker/cli/drift-local.js [--repo <path>] [--from N] [--json]
 */

import path from "node:path";
import { getQueryEngine } from "../db/pool.js";
import Database from "../db/sqlite-adapter.js";
import { diffScanVersions } from "../diff/scan-version-diff.js";

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Live-DB SQL helpers (exported — used by tests + live-DB fallback)
// ---------------------------------------------------------------------------

export function servicesForVersion(db, scanVersionId) {
  return db
    .prepare(
      `SELECT name, language, root_path, type FROM services WHERE scan_version_id = ?`,
    )
    .all(scanVersionId);
}

export function connectionsForVersion(db, scanVersionId) {
  return db
    .prepare(
      `SELECT src.name AS source, tgt.name AS target, c.protocol, c.method, c.path
         FROM connections c
         JOIN services src ON src.id = c.source_service_id
         JOIN services tgt ON tgt.id = c.target_service_id
         WHERE c.scan_version_id = ?`,
    )
    .all(scanVersionId);
}

export function listVersions(db) {
  return db
    .prepare(
      `SELECT id, started_at FROM scan_versions WHERE completed_at IS NOT NULL ORDER BY id DESC LIMIT 10`,
    )
    .all();
}

// ---------------------------------------------------------------------------
// Internal diff helper (used by live-DB fallback)
// ---------------------------------------------------------------------------

function diffSets(before, after, keyFn) {
  const beforeMap = new Map(before.map((x) => [keyFn(x), x]));
  const afterMap = new Map(after.map((x) => [keyFn(x), x]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of afterMap) {
    if (!beforeMap.has(k)) added.push(v);
    else if (JSON.stringify(beforeMap.get(k)) !== JSON.stringify(v)) {
      changed.push({ before: beforeMap.get(k), after: v });
    }
  }
  for (const [k, v] of beforeMap) if (!afterMap.has(k)) removed.push(v);
  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Path-traversal guard (T-142-02-01)
// ---------------------------------------------------------------------------

/**
 * Returns true if snapshot_path is a safe relative path.
 * Rejects: absolute paths, paths with '..' segments, empty strings.
 *
 * @param {string|null|undefined} p
 * @returns {boolean}
 */
function isSafeSnapshotPath(p) {
  if (!p || typeof p !== "string") return false;
  if (path.isAbsolute(p)) return false;
  const parts = p.split(/[\\/]/);
  if (parts.some((seg) => seg === "..")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Live-DB fallback (142-01 fix: correct SQL columns)
// ---------------------------------------------------------------------------

/**
 * Graceful fallback when repos_json is absent (pre-migration-021 DB) or
 * when fewer than 2 scans have been completed.
 * Uses live scan_versions + services + connections tables directly.
 *
 * @param {import('../db/sqlite-adapter.js').default} db
 * @param {object} flags - Parsed CLI flags
 */
function runLiveDbFallback(db, flags) {
  const versions = listVersions(db);
  if (versions.length < 2) {
    process.stdout.write(
      "only one scan snapshot exists — run /arcanon:map again to capture a second point for drift.\n",
    );
    return null;
  }
  const toId = Number(flags.to) || versions[0].id;
  const fromId = Number(flags.from) || versions[1].id;

  const svcDiff = diffSets(
    servicesForVersion(db, fromId),
    servicesForVersion(db, toId),
    (s) => s.name,
  );
  const connDiff = diffSets(
    connectionsForVersion(db, fromId),
    connectionsForVersion(db, toId),
    (c) => `${c.source}->${c.target}:${c.protocol}:${c.method || ""}:${c.path || ""}`,
  );

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ from: fromId, to: toId, services: svcDiff, connections: connDiff }, null, 2) +
        "\n",
    );
    return { fallback: true, from: fromId, to: toId, services: svcDiff, connections: connDiff };
  }

  process.stdout.write(`Arcanon drift: scan #${fromId} → #${toId}\n\n`);
  process.stdout.write(
    `services:     +${svcDiff.added.length}  -${svcDiff.removed.length}  ~${svcDiff.changed.length}\n`,
  );
  process.stdout.write(
    `connections:  +${connDiff.added.length}  -${connDiff.removed.length}  ~${connDiff.changed.length}\n\n`,
  );

  const section = (title, items, fmt) => {
    if (!items.length) return;
    process.stdout.write(`${title}\n`);
    for (const item of items) process.stdout.write(`  ${fmt(item)}\n`);
    process.stdout.write("\n");
  };

  section("+ added services", svcDiff.added, (s) => `${s.name} (${s.language || "unknown"})`);
  section("- removed services", svcDiff.removed, (s) => `${s.name}`);
  section(
    "~ changed services",
    svcDiff.changed,
    (c) => `${c.after.name}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`,
  );
  section(
    "+ added connections",
    connDiff.added,
    (c) => `${c.source} -[${c.protocol}]-> ${c.target}${c.path ? ` ${c.path}` : ""}`,
  );
  section(
    "- removed connections",
    connDiff.removed,
    (c) => `${c.source} -[${c.protocol}]-> ${c.target}${c.path ? ` ${c.path}` : ""}`,
  );
  section(
    "~ changed connections",
    connDiff.changed,
    (c) => `${c.after.source} -> ${c.after.target}`,
  );

  return { fallback: true, from: fromId, to: toId, services: svcDiff, connections: connDiff };
}

// ---------------------------------------------------------------------------
// Human-readable section printer for diffScanVersions result shape
// ---------------------------------------------------------------------------

function printDiffResult(fromRowId, toRowId, repoPath, result, flags, multiRepo) {
  if (flags.json) return; // handled by caller

  if (multiRepo) {
    process.stdout.write(`\nRepo: ${repoPath}\n`);
  }

  process.stdout.write(`Arcanon drift: snapshot #${fromRowId} → #${toRowId}\n\n`);

  const s = result.summary.services;
  const c = result.summary.connections;
  process.stdout.write(`services:     +${s.added}  -${s.removed}  ~${s.modified}\n`);
  process.stdout.write(`connections:  +${c.added}  -${c.removed}  ~${c.modified}\n\n`);

  const section = (title, items, fmt) => {
    if (!items.length) return;
    process.stdout.write(`${title}\n`);
    for (const item of items) process.stdout.write(`  ${fmt(item)}\n`);
    process.stdout.write("\n");
  };

  section("+ added services", result.services.added,
    (s) => `${s.name} (${s.language || "unknown"})`);
  section("- removed services", result.services.removed,
    (s) => s.name);
  section("~ modified services", result.services.modified,
    (m) => `${m.name}: ${m.changed_fields.map((f) => f.field).join(", ")}`);
  section("+ added connections", result.connections.added,
    (c) => `${c.source_name} -[${c.protocol}]-> ${c.target_name}${c.path ? ` ${c.path}` : ""}`);
  section("- removed connections", result.connections.removed,
    (c) => `${c.source_name} -[${c.protocol}]-> ${c.target_name}${c.path ? ` ${c.path}` : ""}`);
  section("~ modified connections", result.connections.modified,
    (m) => `${m.source_name} -> ${m.target_name}`);
}

// ---------------------------------------------------------------------------
// Testable entry point — exported for test coverage
// ---------------------------------------------------------------------------

/**
 * Core drift logic. Accepts an already-open live DB handle and its directory
 * so tests can drive the snapshot-routing path without touching the pool.
 *
 * @param {object} opts
 * @param {object} opts.flags - Parsed CLI flags (repo, from, json)
 * @param {import('../db/sqlite-adapter.js').default} opts.db - Live project DB
 * @param {string} opts.dbDir - Directory containing the DB file (snapshot paths resolve here)
 * @returns {Promise<object|null>} Diff result, fallback result, or null for guidance messages
 */
export async function runDrift({ flags = {}, db, dbDir }) {
  // -- Step 1: Query map_versions for snapshot rows ---------------------------
  let snapshotRows;
  try {
    snapshotRows = db
      .prepare(
        `SELECT id, snapshot_path, repos_json, kind, created_at
           FROM map_versions
          WHERE snapshot_path IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 10`,
      )
      .all();
  } catch {
    // map_versions table absent or snapshot_path column missing (pre-139 DB)
    snapshotRows = [];
  }

  // -- Step 2: Fallback A — fewer than 2 snapshot rows -----------------------
  if (snapshotRows.length < 2) {
    process.stdout.write(
      "run /arcanon:map at least twice to capture drift\n",
    );
    return null;
  }

  const toRow = snapshotRows[0]; // newest
  // --from N selects a snapshot by map_versions.id; falls back to next-newest
  const fromRow = flags.from
    ? (snapshotRows.find((r) => String(r.id) === String(flags.from)) || snapshotRows[1])
    : snapshotRows[1];

  // -- Step 3: Fallback B — no repos_json (pre-migration-021 DB) -------------
  if (!toRow.repos_json) {
    return runLiveDbFallback(db, flags);
  }

  // -- Step 4: Parse repos_json -----------------------------------------------
  let toRepos, fromRepos;
  try {
    toRepos = JSON.parse(toRow.repos_json);
    fromRepos = JSON.parse(fromRow.repos_json || "[]");
  } catch {
    // Malformed repos_json → fall back to live-DB diff
    return runLiveDbFallback(db, flags);
  }

  if (!Array.isArray(toRepos) || !Array.isArray(fromRepos)) {
    return runLiveDbFallback(db, flags);
  }

  // -- Step 5: Compute INTERSECTION of repos by path -------------------------
  // (142-RESEARCH §Pitfall 1: never blindly index [0] for multi-repo)
  const fromMap = new Map(fromRepos.map((r) => [r.path, r]));
  let sharedRepos = toRepos.filter((r) => fromMap.has(r.path));

  // --repo filter: narrow to a single repo
  if (flags.repo) {
    const targetPath = path.resolve(flags.repo);
    sharedRepos = sharedRepos.filter(
      (r) => r.path === targetPath || r.path === flags.repo,
    );
  }

  // Empty intersection — kind-mismatch or no shared repos
  if (sharedRepos.length === 0) {
    process.stdout.write(
      `no shared repos between the '${toRow.kind || "map"}' snapshot #${toRow.id} ` +
      `and the '${fromRow.kind || "map"}' snapshot #${fromRow.id} — ` +
      `run /arcanon:map to capture a consistent multi-repo snapshot\n`,
    );
    return null;
  }

  // -- Step 6: Per-repo diff via snapshot DBs ---------------------------------
  const repoResults = [];

  for (const sharedRepo of sharedRepos) {
    const fromEntry = fromMap.get(sharedRepo.path);

    // Path-traversal guard (T-142-02-01)
    if (!isSafeSnapshotPath(toRow.snapshot_path) || !isSafeSnapshotPath(fromRow.snapshot_path)) {
      process.stderr.write(
        `[drift] skipping repo ${sharedRepo.path} — unsafe snapshot_path value\n`,
      );
      continue;
    }

    const fromDbPath = path.join(dbDir, fromRow.snapshot_path);
    const toDbPath = path.join(dbDir, toRow.snapshot_path);

    // Open snapshot DBs directly — NEVER via the pool (142-RESEARCH §Pitfall 2)
    let dbFrom = null;
    let dbTo = null;
    try {
      dbFrom = new Database(fromDbPath);
      dbTo = new Database(toDbPath);
      const result = diffScanVersions(
        dbFrom, dbTo,
        fromEntry.scan_version_id,
        sharedRepo.scan_version_id,
      );
      repoResults.push({ repoPath: sharedRepo.path, result });
    } finally {
      // Engine never closes handles — caller must (per scan-version-diff contract)
      if (dbFrom) { try { dbFrom.close(); } catch { /* ignore */ } }
      if (dbTo) { try { dbTo.close(); } catch { /* ignore */ } }
    }
  }

  if (repoResults.length === 0) {
    return null;
  }

  // -- Step 7: Output ---------------------------------------------------------
  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          from: fromRow.id,
          to: toRow.id,
          repos: repoResults.map(({ repoPath, result }) => ({ repoPath, ...result })),
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    const multiRepo = repoResults.length > 1;
    for (const { repoPath, result } of repoResults) {
      printDiffResult(fromRow.id, toRow.id, repoPath, result, flags, multiRepo);
    }
  }

  return { from: fromRow.id, to: toRow.id, repos: repoResults };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const repoPath = path.resolve(flags.repo || process.cwd());
  const qe = getQueryEngine(repoPath);
  if (!qe) {
    process.stderr.write(
      `error: no local scan for ${repoPath} — run /arcanon:map first\n`,
    );
    process.exit(1);
  }
  const db = qe._db;
  const dbDir = path.dirname(db.name);
  await runDrift({ flags, db, dbDir });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
