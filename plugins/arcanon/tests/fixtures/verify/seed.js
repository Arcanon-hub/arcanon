/**
 * tests/fixtures/verify/seed.js — Phase 112-02 fixture seeder (TRUST-07/08/09).
 *
 * Builds a tiny SQLite DB shaped exactly like a post-/arcanon:map state:
 *   - 1 repo row (path = projectRoot)
 *   - 1 scan_versions row (started+completed)
 *   - 3 services rows (frontend, users-svc, orders-svc)
 *   - 3 connections rows whose `evidence` substring is guaranteed to appear
 *     in the matching source file under tests/fixtures/verify/source/
 *
 * Two callers:
 *   1. plugins/arcanon/worker/server/http.test.js — imports seedFixture()
 *      directly with an in-memory better-sqlite3 Database.
 *   2. tests/fixtures/verify/seed.sh (called from tests/verify.bats) — runs
 *      this file as a CLI: `node seed.js --project <root> --db <path>`.
 *
 * Read-only contract: the seeder writes the DB ONCE at fixture-build time;
 * /api/verify must NOT modify it (asserted in http.verify.test.js Test 13).
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { up as up001 } from '../../../worker/db/migrations/001_initial_schema.js';
import { up as up002 } from '../../../worker/db/migrations/002_service_type.js';
import { up as up003 } from '../../../worker/db/migrations/003_exposed_endpoints.js';
import { up as up004 } from '../../../worker/db/migrations/004_dedup_constraints.js';
import { up as up005 } from '../../../worker/db/migrations/005_scan_versions.js';
import { up as up006 } from '../../../worker/db/migrations/006_dedup_repos.js';
import { up as up007 } from '../../../worker/db/migrations/007_expose_kind.js';
import { up as up008 } from '../../../worker/db/migrations/008_actors_metadata.js';
import { up as up009 } from '../../../worker/db/migrations/009_confidence_enrichment.js';
import { up as up010 } from '../../../worker/db/migrations/010_service_dependencies.js';
import { up as up011 } from '../../../worker/db/migrations/011_services_boundary_entry.js';
import { up as up013 } from '../../../worker/db/migrations/013_connections_path_template.js';
import { up as up014 } from '../../../worker/db/migrations/014_services_base_path.js';
import { up as up015 } from '../../../worker/db/migrations/015_scan_versions_quality_score.js';
import { up as up016 } from '../../../worker/db/migrations/016_enrichment_log.js';

/**
 * Apply every migration in order on the given Database. Mirrors the pattern
 * used by http.scan-quality.test.js so the schema is identical to production.
 *
 * Also stamps the `schema_versions` tracker so that
 * worker/db/database.js::runMigrations() — invoked the first time the worker
 * resolves the project — sees these versions as already-applied and does not
 * try to re-run them (re-running migration 002 throws "duplicate column name:
 * type"). Tests that import the helper directly (in-memory) don't need the
 * stamping but it is harmless.
 */
export function applyAllMigrations(db) {
  const versions = [];
  const wrap = (fn, v) => { fn(db); versions.push(v); };
  wrap(up001, 1);
  wrap(up002, 2);
  wrap(up003, 3);
  wrap(up004, 4);
  wrap(up005, 5);
  wrap(up006, 6);
  wrap(up007, 7);
  wrap(up008, 8);
  wrap(up009, 9);
  wrap(up010, 10);
  wrap(up011, 11);
  wrap(up013, 13);
  wrap(up014, 14);
  wrap(up015, 15);
  wrap(up016, 16);

  // Mirror what runMigrations() in database.js does after each up().
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO schema_versions (version) VALUES (?)',
  );
  for (const v of versions) ins.run(v);
}

/**
 * Seed three connections with literal-substring evidence that matches the
 * three real source files in tests/fixtures/verify/source/.
 *
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   projectRoot: string,
 * }} args
 * @returns {{ scanVersionId: number, repoId: number, connectionIds: number[] }}
 */
export function seedFixture({ db, projectRoot }) {
  applyAllMigrations(db);

  // 1. repos row
  const repoId = db
    .prepare(
      `INSERT INTO repos (path, name, type, scanned_at)
       VALUES (?, ?, ?, datetime('now'))`,
    )
    .run(projectRoot, path.basename(projectRoot), 'single').lastInsertRowid;

  // 2. scan_versions row (completed_at set so it's the "latest scan")
  const scanVersionId = db
    .prepare(
      `INSERT INTO scan_versions (repo_id, started_at, completed_at)
       VALUES (?, datetime('now', '-1 minute'), datetime('now'))`,
    )
    .run(repoId).lastInsertRowid;

  // 3. services rows — three services so connections have valid FKs.
  const insertService = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const frontendId = insertService.run(
    repoId, 'frontend', `${projectRoot}/frontend`, 'js', 'service', scanVersionId,
  ).lastInsertRowid;
  const usersSvcId = insertService.run(
    repoId, 'users-svc', `${projectRoot}/users-svc`, 'js', 'service', scanVersionId,
  ).lastInsertRowid;
  const ordersSvcId = insertService.run(
    repoId, 'orders-svc', `${projectRoot}/orders-svc`, 'js', 'service', scanVersionId,
  ).lastInsertRowid;

  // 4. connections rows — evidence strings MUST appear literally in the
  //    matching source file under tests/fixtures/verify/source/.
  const insertConn = db.prepare(
    `INSERT INTO connections (
       source_service_id, target_service_id, protocol, method, path,
       source_file, target_file, scan_version_id, confidence, evidence
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const c1 = insertConn.run(
    frontendId, usersSvcId, 'http', 'POST', '/users',
    'tests/fixtures/verify/source/users.js', null, scanVersionId, 'high',
    "router.post('/users', async (req, res)",
  ).lastInsertRowid;

  const c2 = insertConn.run(
    frontendId, ordersSvcId, 'http', 'GET', '/orders',
    'tests/fixtures/verify/source/orders.js', null, scanVersionId, 'high',
    "router.get('/orders', async (req, res)",
  ).lastInsertRowid;

  const c3 = insertConn.run(
    frontendId, usersSvcId, 'http', 'GET', '/admin/dashboard',
    'tests/fixtures/verify/source/admin.js', null, scanVersionId, 'high',
    "router.get('/admin/dashboard', async",
  ).lastInsertRowid;

  return {
    scanVersionId: Number(scanVersionId),
    repoId: Number(repoId),
    connectionIds: [Number(c1), Number(c2), Number(c3)],
  };
}

/**
 * Minimal arg parser — only supports --key value (no shorthand, no =).
 * Used by the CLI mode below.
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI mode — `node seed.js --project <root> --db <db-path>`
// Detects direct invocation via process.argv[1] match, mirroring hub.js.
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.db) {
    process.stderr.write(
      'usage: node seed.js --project <root> --db <db-path>\n',
    );
    process.exit(2);
  }
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(args.db);
  db.pragma('foreign_keys = ON');
  const result = seedFixture({ db, projectRoot: args.project });
  db.close();
  process.stdout.write(JSON.stringify(result) + '\n');
}
