/**
 * tests/fixtures/correct/seed.js —  fixture seeder .
 *
 * Builds an impact-map.db shaped for tests/correct.bats. Two services
 * (svc-a, svc-b) and one connection (svc-a -> svc-b). Echoes the resolved
 * row IDs as JSON on stdout so the bats test can capture them.
 *
 * Mirrors the diff/freshness/list/overrides seed.js shape: applies the
 * canonical migration chain (001..017) so the production schema —
 * including migration 017's scan_overrides table — is byte-identical to
 * what /arcanon:correct will read at runtime.
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

export function seedCorrectFixture({ db, projectRoot }) {
  applyAllMigrations(db);

  const repoId = db.prepare(
    `INSERT INTO repos (path, name, type, scanned_at)
     VALUES (?, 'apex', 'single', datetime('now', '-1 hour'))`,
  ).run(projectRoot).lastInsertRowid;

  const scanVersionId = db.prepare(
    `INSERT INTO scan_versions
       (repo_id, started_at, completed_at, quality_score)
     VALUES (?, datetime('now', '-1 hour'),
                datetime('now', '-1 hour', '+30 seconds'),
                0.92)`,
  ).run(repoId).lastInsertRowid;

  const svcAId = db.prepare(
    `INSERT INTO services
       (repo_id, name, root_path, language, type, scan_version_id, base_path)
     VALUES (?, 'svc-a', 'services/svc-a', 'javascript', 'service', ?, NULL)`,
  ).run(repoId, scanVersionId).lastInsertRowid;
  const svcBId = db.prepare(
    `INSERT INTO services
       (repo_id, name, root_path, language, type, scan_version_id, base_path)
     VALUES (?, 'svc-b', 'services/svc-b', 'typescript', 'service', ?, NULL)`,
  ).run(repoId, scanVersionId).lastInsertRowid;

  const connectionId = db.prepare(
    `INSERT INTO connections
       (source_service_id, target_service_id, protocol, method, path,
        source_file, target_file, evidence, scan_version_id)
     VALUES (?, ?, 'http', 'GET', '/users',
             'services/svc-a/src/users.ts', 'services/svc-b/users.js',
             'fetch("/users")', ?)`,
  ).run(svcAId, svcBId, scanVersionId).lastInsertRowid;

  return { repoId, scanVersionId, svcAId, svcBId, connectionId };
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
  const ids = seedCorrectFixture({ db, projectRoot: project });
  db.close();
  process.stdout.write(JSON.stringify(ids) + '\n');
}
