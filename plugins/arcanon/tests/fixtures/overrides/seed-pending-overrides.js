/**
 * tests/fixtures/overrides/seed-pending-overrides.js —  .
 *
 * Seeds an impact-map.db with the schema state the apply-hook E2E test
 * (tests/scan-overrides-apply.bats) expects:
 *
 *   - 1 repo (apex)
 *   - 1 scan_versions row (the previous completed scan)
 *   - 2 services: api (id=1) and web (id=2)
 *   - 1 connection: web -> api (id=1)
 *   - 3 pending scan_overrides:
 *       1. delete the connection (kind=connection, action=delete)
 *       2. rename web -> frontend (kind=service, action=rename)
 *       3. delete a non-existent service id 999 (dangling - exercises )
 *
 * Lives inside plugins/arcanon/tests/fixtures/ so seed.js's
 * better-sqlite3 import resolves naturally via plugins/arcanon/node_modules/.
 *
 * Mirrors the freshness/list/diff seed.js shape (canonical applyAllMigrations).
 */

import { fileURLToPath } from 'node:url';

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

  // Mirror runMigrations() in database.js so the worker's idempotent
  // runMigrations() call (on first connection) sees these as already-applied.
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
 * Seed the apply-hook E2E fixture into a fresh DB.
 *
 * @param {{ db: import('../../../worker/db/sqlite-adapter.js').Database, projectRoot: string }} args
 * @returns object with repo/service/connection/override IDs
 */
export function seedPendingOverridesFixture({ db, projectRoot }) {
  applyAllMigrations(db);

  // 1. repo
  const repoId = db.prepare(
    `INSERT INTO repos (path, name, type, scanned_at)
     VALUES (?, 'apex', 'single', datetime('now', '-1 hour'))`,
  ).run(projectRoot).lastInsertRowid;

  // 2. previous scan_version (so the apply-hook can stamp into a NEW one)
  const scanVersionId = db.prepare(
    `INSERT INTO scan_versions
       (repo_id, started_at, completed_at, quality_score)
     VALUES (?, datetime('now', '-1 hour'),
                datetime('now', '-1 hour', '+30 seconds'),
                0.85)`,
  ).run(repoId).lastInsertRowid;

  // 3. services - api and web. scan_version_id points at the previous
  //    scan so the agent rerun would normally re-stamp them; the apply-hook
  //    fires AFTER persistFindings re-tags them with the new scan_version_id.
  const apiServiceId = db.prepare(
    `INSERT INTO services
       (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, 'api', 'services/api', 'javascript', 'service', ?)`,
  ).run(repoId, scanVersionId).lastInsertRowid;
  const webServiceId = db.prepare(
    `INSERT INTO services
       (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, 'web', 'services/web', 'typescript', 'service', ?)`,
  ).run(repoId, scanVersionId).lastInsertRowid;

  // 4. connection - web -> api
  const connectionId = db.prepare(
    `INSERT INTO connections
       (source_service_id, target_service_id, protocol, method, path,
        source_file, target_file, evidence, scan_version_id)
     VALUES (?, ?, 'http', 'GET', '/users',
             'services/web/src/users.ts', 'services/api/users.js',
             'fetch("/users")', ?)`,
  ).run(webServiceId, apiServiceId, scanVersionId).lastInsertRowid;

  // 5. three pending overrides
  const insertOverride = db.prepare(
    `INSERT INTO scan_overrides (kind, target_id, action, payload, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const delConnId = insertOverride.run(
    'connection', connectionId, 'delete', '{}', 'fixture',
  ).lastInsertRowid;

  const renameId = insertOverride.run(
    'service', webServiceId, 'rename',
    JSON.stringify({ new_name: 'frontend' }),
    'fixture',
  ).lastInsertRowid;

  const danglingId = insertOverride.run(
    'service', 999, 'delete', '{}', 'fixture',
  ).lastInsertRowid;

  return {
    repoId,
    scanVersionId,
    apiServiceId,
    webServiceId,
    connectionId,
    overrideIds: {
      delConn: delConnId,
      rename: renameId,
      dangling: danglingId,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entry - invoked from seed-pending-overrides.sh
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { project: null, db: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--db') out.db = argv[++i];
  }
  if (!out.project || !out.db) {
    console.error('usage: seed-pending-overrides.js --project <root> --db <path>');
    process.exit(2);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: Database } = await import('../../../worker/db/sqlite-adapter.js');
  const { project, db: dbPath } = parseArgs(process.argv.slice(2));
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const ids = seedPendingOverridesFixture({ db, projectRoot: project });
  db.close();
  // Echo the IDs as JSON on stdout for the caller to capture if needed.
  process.stdout.write(JSON.stringify(ids) + '\n');
}
