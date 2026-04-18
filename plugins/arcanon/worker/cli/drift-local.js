#!/usr/bin/env node
/**
 * worker/cli/drift-local.js — Diff two local scan snapshots.
 *
 * Reads the `scan_versions` table in the current repo's SQLite DB and
 * reports added / removed / changed services and connections between
 * the most recent two scans (or between two explicit version IDs).
 *
 * This complements the repo-local drift scripts under scripts/drift-*.sh
 * (which diff OpenAPI specs, package versions, etc.) by surfacing
 * service-graph drift — answering: "Which services or connections
 * appeared, disappeared, or changed between scans?"
 *
 * Usage:
 *   node worker/cli/drift-local.js [--repo <path>] [--from N] [--to N] [--json]
 */

import path from "node:path";
import { getQueryEngine } from "../db/pool.js";

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

function servicesForVersion(db, scanVersionId) {
  return db
    .prepare(
      `SELECT name, language, root_path, type FROM services WHERE scan_version_id = ?`,
    )
    .all(scanVersionId);
}

function connectionsForVersion(db, scanVersionId) {
  return db
    .prepare(
      `SELECT s.name AS source, c.target_name AS target, c.protocol, c.method, c.path
         FROM connections c
         LEFT JOIN services s ON s.id = c.source_service_id
         WHERE c.scan_version_id = ?`,
    )
    .all(scanVersionId);
}

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

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const repoPath = path.resolve(flags.repo || process.cwd());
  const qe = getQueryEngine(repoPath);
  if (!qe) {
    process.stderr.write(`error: no local scan for ${repoPath} — run /arcanon:map first\n`);
    process.exit(1);
  }
  const db = qe._db;

  const versions = db
    .prepare(
      `SELECT id, created_at FROM scan_versions ORDER BY id DESC LIMIT 10`,
    )
    .all();
  if (versions.length < 2) {
    process.stdout.write(
      "only one scan snapshot exists — run /arcanon:map again to capture a second point for drift.\n",
    );
    return;
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
    return;
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
