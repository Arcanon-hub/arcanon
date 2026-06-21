/**
 * tests/fixtures/shadow/seed.js —  fixture seeder .
 *
 * Builds an impact-map.db (live OR shadow) shaped for tests/shadow-scan.bats:
 *   - Applies the canonical migration chain (001..017) so the production
 *     schema is byte-identical to what /arcanon:shadow-scan reads at runtime.
 *   - Inserts: 1 repo (api), 2 services (api-svc, auth-svc), 1 connection
 *     (api-svc -> auth-svc, http GET /login), 1 prior scan_versions row
 *     completed ~1 day ago.
 *   - Stamps repo_state with the api repo's current HEAD so subsequent scans
 *     would mode='skip' without options.full=true.
 *
 * Idempotent — DELETE FROM each table before INSERT (see resetTables).
 *
 * Echoes the resolved row IDs as JSON on stdout for the bats test to capture.
 */

import { execFileSync } from 'node:child_process';
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
import { up as up017 } from '../../../worker/db/migrations/017_scan_overrides.js';

function applyAllMigrations(db) {
  const versions = [];
  const wrap = (fn, v) => { fn(db); versions.push(v); };
  wrap(up001, 1); wrap(up002, 2); wrap(up003, 3); wrap(up004, 4);
  wrap(up005, 5); wrap(up006, 6); wrap(up007, 7); wrap(up008, 8);
  wrap(up009, 9); wrap(up010, 10); wrap(up011, 11); wrap(up013, 13);
  wrap(up014, 14); wrap(up015, 15); wrap(up016, 16); wrap(up017, 17);
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

function gitHead(repoPath) {
  // execFileSync (no shell, args arrayed) — safe against injection by design.
  return execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function resetTables(db) {
  // Idempotent re-seed — order matters for FKs.
  db.exec('DELETE FROM connections;');
  db.exec('DELETE FROM services;');
  db.exec('DELETE FROM repo_state;');
  db.exec('DELETE FROM scan_versions;');
  db.exec('DELETE FROM repos;');
}

export function seedShadowFixture({ db, projectRoot }) {
  applyAllMigrations(db);
  resetTables(db);

  const repoPath = path.join(projectRoot, 'api');

  const repoId = db.prepare(
    `INSERT INTO repos (path, name, type, scanned_at)
     VALUES (?, 'api', 'single', datetime('now', '-1 day'))`,
  ).run(repoPath).lastInsertRowid;

  const scanVersionId = db.prepare(
    `INSERT INTO scan_versions
       (repo_id, started_at, completed_at, quality_score)
     VALUES (?, datetime('now', '-1 day'),
                datetime('now', '-1 day', '+30 seconds'),
                0.95)`,
  ).run(repoId).lastInsertRowid;

  // Two services so we can record a connection between them.
  const apiSvcId = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, 'api-svc', ?, 'js', 'service', ?)`,
  ).run(repoId, repoPath, scanVersionId).lastInsertRowid;

  const authSvcId = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, 'auth-svc', ?, 'js', 'service', ?)`,
  ).run(repoId, repoPath, scanVersionId).lastInsertRowid;

  const connectionId = db.prepare(
    `INSERT INTO connections (
       source_service_id, target_service_id, protocol, method, path,
       source_file, scan_version_id, confidence, evidence
     ) VALUES (?, ?, 'http', 'GET', '/login', NULL, ?, 'high', 'fetch /login')`,
  ).run(apiSvcId, authSvcId, scanVersionId).lastInsertRowid;

  // Stamp repo_state so a subsequent scan would mode='skip' unless options.full.
  const head = gitHead(repoPath);
  db.prepare(
    `INSERT INTO repo_state (repo_id, last_scanned_commit, last_scanned_at)
     VALUES (?, ?, datetime('now', '-1 day'))`,
  ).run(repoId, head);

  return {
    repo: { repo_id: Number(repoId), repo_path: repoPath, head },
    scan_version_id: Number(scanVersionId),
    services: {
      'api-svc': Number(apiSvcId),
      'auth-svc': Number(authSvcId),
    },
    connection_id: Number(connectionId),
  };
}

// ---------------------------------------------------------------------------
// CLI entry — invoked from seed.sh
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { project: null, db: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--db') out.db = argv[++i];
  }
  if (!out.project || !out.db) {
    console.error('usage: seed.js --project <root> --db <path>');
    process.exit(2);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: Database } = await import('../../../worker/db/sqlite-adapter.js');
  const { project, db: dbPath } = parseArgs(process.argv.slice(2));
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const result = seedShadowFixture({ db, projectRoot: project });
  db.close();
  process.stdout.write(JSON.stringify(result) + '\n');
}
