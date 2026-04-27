/**
 * tests/fixtures/list/seed.js — Phase 114-01 fixture seeder (NAV-01).
 *
 * Builds a SQLite DB shaped exactly like a post-/arcanon:map state, with the
 * specific shape the /arcanon:list happy-path test (Test 5) asserts against:
 *
 *   - 3 rows in `repos`        (api, worker, web)
 *   - 1 row  in `scan_versions` (~2 days ago, quality_score = 0.91)
 *   - 8 rows in `services`     (5 type='service', 2 type='library', 1 type='infra')
 *   - 47 rows in `connections` (41 confidence='high', 6 confidence='low', 0 NULL)
 *   - 4 rows in `actors`       (with matching actor_connections rows)
 *
 * `--no-scan` mode skips the scan_versions row so Test 7 can assert that
 * /arcanon:list does not crash when no completed scan exists yet.
 *
 * Lives inside plugins/arcanon/tests/fixtures/ so seed.js's `import 'better-sqlite3'`
 * resolves naturally via plugins/arcanon/node_modules/. No cwd hack needed.
 *
 * Read-only contract: the seeder writes the DB ONCE at fixture-build time;
 * /arcanon:list must NOT modify it. This is asserted indirectly by the
 * "exit 0 silent in non-project" test plus the read-only design of cmdList.
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
import { up as up018 } from '../../../worker/db/migrations/018_actors_label.js';

/**
 * Apply every migration in order on the given Database. Mirrors the pattern
 * used by tests/fixtures/verify/seed.js so the schema is identical to the
 * production runMigrations() path.
 */
function applyAllMigrations(db) {
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
  wrap(up017, 17);
  wrap(up018, 18);

  // Mirror what runMigrations() in database.js does after each up() so the
  // worker's idempotent runMigrations() call (triggered when openDb() runs
  // on the first cmdList request) sees these versions as already-applied.
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
 * Seed the Phase 114-01 list fixture into a fresh DB.
 *
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   projectRoot: string,
 *   noScan?: boolean,
 * }} args
 * @returns {{
 *   scanVersionId: number | null,
 *   repoIds: number[],
 *   serviceIds: number[],
 *   connectionIds: number[],
 *   actorIds: number[],
 * }}
 */
export function seedListFixture({
  db,
  projectRoot,
  noScan = false,
  withLabels = false,
  withManyLabels = false,
  noActors = false,
  // Phase 121-02 INT-09 / Test 5.x: seed N bare actors (label NULL) by name,
  // so the labeling pass can populate label end-to-end via the merged catalog.
  // Pass an array of strings, e.g. ['custom.example.com', 'api.stripe.com'].
  actorsNamed = null,
}) {
  applyAllMigrations(db);

  // 1. repos — 3 rows. Names exactly match the Test 5 narrative.
  const insertRepo = db.prepare(
    `INSERT INTO repos (path, name, type, scanned_at)
     VALUES (?, ?, 'single', datetime('now'))`,
  );
  const repoApiId = insertRepo.run(`${projectRoot}/api`, 'api').lastInsertRowid;
  const repoWorkerId = insertRepo.run(`${projectRoot}/worker`, 'worker').lastInsertRowid;
  const repoWebId = insertRepo.run(`${projectRoot}/web`, 'web').lastInsertRowid;

  // 2. scan_versions — one row dated ~2 days ago with quality_score set.
  let scanVersionId = null;
  if (!noScan) {
    scanVersionId = db
      .prepare(
        `INSERT INTO scan_versions
           (repo_id, started_at, completed_at, quality_score)
         VALUES (?, datetime('now', '-2 days', '-1 minute'),
                    datetime('now', '-2 days'),
                    0.91)`,
      )
      .run(repoApiId).lastInsertRowid;
  }

  // 3. services — 8 rows: 5 type='service', 2 type='library', 1 type='infra'.
  const insertService = db.prepare(
    `INSERT INTO services
       (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const serviceIds = [];
  for (let i = 1; i <= 5; i++) {
    const repoId = [repoApiId, repoWorkerId, repoWebId][i % 3];
    serviceIds.push(
      insertService.run(
        repoId,
        `svc-${i}`,
        `${projectRoot}/services/svc-${i}`,
        'js',
        'service',
        scanVersionId,
      ).lastInsertRowid,
    );
  }
  for (let i = 1; i <= 2; i++) {
    serviceIds.push(
      insertService.run(
        repoApiId,
        `lib-${i}`,
        `${projectRoot}/libs/lib-${i}`,
        'js',
        'library',
        scanVersionId,
      ).lastInsertRowid,
    );
  }
  serviceIds.push(
    insertService.run(
      repoApiId,
      'infra-1',
      `${projectRoot}/infra/infra-1`,
      'tf',
      'infra',
      scanVersionId,
    ).lastInsertRowid,
  );

  // 4. connections — 47 rows: 41 high, 6 low, 0 NULL.
  const insertConn = db.prepare(
    `INSERT INTO connections
       (source_service_id, target_service_id, protocol, method, path,
        source_file, scan_version_id, confidence, evidence)
     VALUES (?, ?, 'http', 'GET', ?, ?, ?, ?, ?)`,
  );
  const connectionIds = [];
  for (let i = 0; i < 47; i++) {
    const src = serviceIds[i % 5];
    const tgt = serviceIds[(i + 1) % 5];
    const confidence = i < 41 ? 'high' : 'low';
    const connPath = `/api/endpoint-${i}`;
    const sourceFile = `services/svc-${(i % 5) + 1}/route-${i}.js`;
    const evidence = `// stub evidence for connection ${i}`;
    connectionIds.push(
      insertConn.run(src, tgt, connPath, sourceFile, scanVersionId, confidence, evidence)
        .lastInsertRowid,
    );
  }

  // 5. actors — pluggable based on mode flags. Default = 4 unlabeled actors
  // (the original Phase 114-01 fixture). The Phase 121 Plan 02 INT-08 modes:
  //   --with-labels        4 actors: 2 labeled (Stripe API, GitHub API),
  //                                   2 raw (raw1.example.com, raw2.example.com)
  //   --with-many-labels   8 actors all labeled (proves +N more truncation)
  //   --no-actors          0 actors (proves bare "0 external" line)
  const insertActorWithLabel = db.prepare(
    `INSERT INTO actors (name, kind, direction, source, label)
     VALUES (?, 'system', 'outbound', 'scan', ?)`,
  );
  const insertActorConn = db.prepare(
    `INSERT INTO actor_connections
       (actor_id, service_id, direction, protocol, path)
     VALUES (?, ?, 'outbound', 'http', ?)`,
  );
  const actorIds = [];

  /**
   * Seed `actors` rows + the matching `actor_connections` link to a service.
   * @param {Array<{name: string, label: string|null}>} specs
   */
  function seedActorRows(specs) {
    for (let i = 0; i < specs.length; i++) {
      const { name, label } = specs[i];
      const actorId = insertActorWithLabel.run(name, label).lastInsertRowid;
      actorIds.push(actorId);
      // Link each actor to one of the seeded services so the per-repo
      // actor-labeling JOIN (services.repo_id -> actors via actor_connections)
      // visits this actor.
      insertActorConn.run(actorId, serviceIds[i % serviceIds.length], `/external/${i + 1}`);
    }
  }

  if (noActors) {
    // Skip — empty actors table.
  } else if (Array.isArray(actorsNamed) && actorsNamed.length > 0) {
    // INT-09 Test 5.x: bare actors (label NULL). The actor-labeling pass +
    // merged catalog populates label end-to-end.
    seedActorRows(actorsNamed.map((name) => ({ name, label: null })));
  } else if (withManyLabels) {
    seedActorRows([
      { name: 'api.stripe.com', label: 'Stripe API' },
      { name: 'api.github.com', label: 'GitHub API' },
      { name: 'hooks.slack.com', label: 'Slack' },
      { name: '*.datadoghq.com', label: 'Datadog' },
      { name: 'sentry.io', label: 'Sentry' },
      { name: 'auth.example.com', label: 'Auth0' },
      { name: 'cloudflare.example.com', label: 'Cloudflare' },
      { name: 'aws.example.com', label: 'AWS Lambda' },
    ]);
  } else if (withLabels) {
    seedActorRows([
      { name: 'api.stripe.com', label: 'Stripe API' },
      { name: 'api.github.com', label: 'GitHub API' },
      { name: 'raw1.example.com', label: null },
      { name: 'raw2.example.com', label: null },
    ]);
  } else {
    seedActorRows([
      { name: 'external-actor-1', label: null },
      { name: 'external-actor-2', label: null },
      { name: 'external-actor-3', label: null },
      { name: 'external-actor-4', label: null },
    ]);
  }

  return {
    scanVersionId: scanVersionId !== null ? Number(scanVersionId) : null,
    repoIds: [repoApiId, repoWorkerId, repoWebId].map(Number),
    serviceIds: serviceIds.map(Number),
    connectionIds: connectionIds.map(Number),
    actorIds: actorIds.map(Number),
  };
}

/**
 * Minimal arg parser — only supports --key value (no shorthand, no =).
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

// CLI mode — `node seed.js --project <root> --db <db-path> [--no-scan]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.db) {
    process.stderr.write(
      'usage: node seed.js --project <root> --db <db-path> [--no-scan]\n',
    );
    process.exit(2);
  }
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(args.db);
  db.pragma('foreign_keys = ON');
  // INT-09: --actors-named-csv accepts a comma-separated list of bare actor
  // names (label NULL). Used by tests/externals-labels.bats to seed actors
  // whose label is filled by the labeling pass against the merged catalog.
  const actorsNamed =
    typeof args['actors-named-csv'] === 'string'
      ? args['actors-named-csv'].split(',').map((s) => s.trim()).filter(Boolean)
      : null;

  const result = seedListFixture({
    db,
    projectRoot: args.project,
    noScan: Boolean(args['no-scan']),
    withLabels: Boolean(args['with-labels']),
    withManyLabels: Boolean(args['with-many-labels']),
    noActors: Boolean(args['no-actors']),
    actorsNamed,
  });
  db.close();
  process.stdout.write(JSON.stringify(result) + '\n');
}
