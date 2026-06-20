/**
 * tests/fixtures/diff/seed.js —  fixture seeder .
 *
 * Builds a SQLite DB shaped for /arcanon:diff bats tests. Five modes:
 *
 *   default — 2 scans for happy-path integer / modified-row tests
 *   same    — 1 scan for the same-scan short-circuit test
 *   iso     — 3 scans with explicit completed_at timestamps
 *   head    — 4 scans for HEAD / HEAD~N / out-of-range tests
 *   branch  — 2 scans whose repo_state.last_scanned_commit matches branch
 *             SHAs from a real tmp git repo (--git-repo arg)
 *
 * Lives inside plugins/arcanon/tests/fixtures/ so seed.js's `import 'better-sqlite3'`
 * resolves naturally via plugins/arcanon/node_modules/.
 */

import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

function applyAllMigrations(db) {
  const versions = [];
  const wrap = (fn, v) => { fn(db); versions.push(v); };
  wrap(up001, 1); wrap(up002, 2); wrap(up003, 3); wrap(up004, 4); wrap(up005, 5);
  wrap(up006, 6); wrap(up007, 7); wrap(up008, 8); wrap(up009, 9); wrap(up010, 10);
  wrap(up011, 11); wrap(up013, 13); wrap(up014, 14); wrap(up015, 15); wrap(up016, 16);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)');
  for (const v of versions) ins.run(v);
}

function insertScan(db, repoId, completedAt) {
  return db.prepare(
    `INSERT INTO scan_versions (repo_id, started_at, completed_at, quality_score)
     VALUES (?, ?, ?, 0.91)`
  ).run(repoId, completedAt, completedAt).lastInsertRowid;
}

function insertService(db, { repoId, name, scanVersionId, type = 'service', owner = null }) {
  const id = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, ?, ?, 'js', ?, ?)`
  ).run(repoId, name, `/srv/${name}`, type, scanVersionId).lastInsertRowid;
  if (owner !== null) {
    // Owner is reflected in the actors table indirectly; keep simple by adding to evidence
    // for the test (modified-row diff asserts on a different field).
  }
  return id;
}

function insertConnection(db, { sourceId, targetId, scanVersionId, path, evidence }) {
  return db.prepare(
    `INSERT INTO connections
       (source_service_id, target_service_id, protocol, method, path,
        source_file, scan_version_id, confidence, evidence)
     VALUES (?, ?, 'http', 'GET', ?, 'src/api.js', ?, 'high', ?)`
  ).run(sourceId, targetId, path, scanVersionId, evidence).lastInsertRowid;
}

function ensureRepo(db, projectRoot, name) {
  return db.prepare(
    `INSERT INTO repos (path, name, type, scanned_at)
     VALUES (?, ?, 'single', datetime('now'))`
  ).run(`${projectRoot}/${name}`, name).lastInsertRowid;
}

function setRepoState(db, repoId, sha) {
  // repo_state schema: (repo_id UNIQUE, last_scanned_commit, last_scanned_at).
  db.prepare(
    `INSERT OR REPLACE INTO repo_state (repo_id, last_scanned_commit, last_scanned_at)
     VALUES (?, ?, datetime('now'))`
  ).run(repoId, sha);
}

/**
 * default mode: 2 scans demonstrating added/removed deltas.
 *
 * NOTE: production schema enforces UNIQUE(services.repo_id, services.name)
 * and UNIQUE(connections source/target/protocol/method/path), so within a
 * single DB it's impossible to have the same service or connection tagged
 * with two different scan_version_ids. True "modified" diff detection
 * therefore requires the shadow-DB pattern . This fixture
 * exercises the added/removed paths only.
 */
function seedDefault(db, projectRoot) {
  const repoId = ensureRepo(db, projectRoot, 'api');
  const scan1 = insertScan(db, repoId, '2026-04-20T10:00:00Z');
  const scan2 = insertScan(db, repoId, '2026-04-25T10:00:00Z');

  // scan1: 3 services + 3 connections
  const auth = insertService(db, { repoId, name: 'auth-v1', scanVersionId: scan1 });
  const dep = insertService(db, { repoId, name: 'deprecated', scanVersionId: scan1 });
  const legacy = insertService(db, { repoId, name: 'legacy', scanVersionId: scan1 });
  insertConnection(db, { sourceId: auth, targetId: dep, scanVersionId: scan1, path: '/v1/login', evidence: 'POST /v1/login' });
  insertConnection(db, { sourceId: auth, targetId: legacy, scanVersionId: scan1, path: '/v1/logout', evidence: 'POST /v1/logout' });
  insertConnection(db, { sourceId: dep, targetId: legacy, scanVersionId: scan1, path: '/v1/refresh', evidence: 'GET /v1/refresh' });

  // scan2: 1 service ('web', the only one alive) + 1 connection
  // scan-1 services don't appear in scan2's view → diff reports them as removed
  const web = insertService(db, { repoId, name: 'web', scanVersionId: scan2 });
  insertConnection(db, { sourceId: web, targetId: web, scanVersionId: scan2, path: '/v2/health', evidence: 'GET /v2/health' });

  return { scan1, scan2, repoId };
}

/** same mode: 1 scan only. */
function seedSame(db, projectRoot) {
  const repoId = ensureRepo(db, projectRoot, 'api');
  const scan1 = insertScan(db, repoId, '2026-04-25T10:00:00Z');
  const a = insertService(db, { repoId, name: 'auth', scanVersionId: scan1 });
  const b = insertService(db, { repoId, name: 'web', scanVersionId: scan1 });
  insertConnection(db, { sourceId: a, targetId: b, scanVersionId: scan1, path: '/v1/x', evidence: 'GET /v1/x' });
  insertConnection(db, { sourceId: b, targetId: a, scanVersionId: scan1, path: '/v1/y', evidence: 'GET /v1/y' });
  return { scan1, repoId };
}

/** iso mode: 3 scans with explicit completed_at timestamps. */
function seedIso(db, projectRoot) {
  const repoId = ensureRepo(db, projectRoot, 'api');
  const s1 = insertScan(db, repoId, '2026-04-20T10:00:00Z');
  const s2 = insertScan(db, repoId, '2026-04-22T10:00:00Z');
  const s3 = insertScan(db, repoId, '2026-04-25T10:00:00Z');
  // Tiny services so diff has something to chew on
  for (const sv of [s1, s2, s3]) {
    insertService(db, { repoId, name: `svc-${sv}`, scanVersionId: sv });
  }
  return { s1, s2, s3, repoId };
}

/** head mode: 4 scans for HEAD / HEAD~N tests. */
function seedHead(db, projectRoot) {
  const repoId = ensureRepo(db, projectRoot, 'api');
  const ids = [];
  for (let i = 1; i <= 4; i++) {
    const ts = `2026-04-${20 + i}T10:00:00Z`;
    const id = insertScan(db, repoId, ts);
    ids.push(id);
    insertService(db, { repoId, name: `svc-${i}`, scanVersionId: id });
  }
  return { ids, repoId };
}

/** branch mode: 2 scans whose repo_state.last_scanned_commit matches branch SHAs. */
function seedBranch(db, projectRoot, gitRepoPath) {
  if (!gitRepoPath) {
    throw new Error('branch mode requires --git-repo arg');
  }
  const repoId = ensureRepo(db, projectRoot, 'api');
  const mainSha = execFileSync('git', ['-C', gitRepoPath, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const featureSha = execFileSync('git', ['-C', gitRepoPath, 'rev-parse', 'feature-x'], { encoding: 'utf8' }).trim();
  const scanMain = insertScan(db, repoId, '2026-04-20T10:00:00Z');
  const scanFeature = insertScan(db, repoId, '2026-04-25T10:00:00Z');
  // last_scanned_commit must match feature-x branch's HEAD for resolveScanSelector('feature-x')
  setRepoState(db, repoId, featureSha);
  // Also need scan rows tagged with the SHAs they were taken at — store via a per-scan column?
  // Resolver looks up branch via repo_state.last_scanned_commit but for diff we need each
  // scan's commit. Use a side-channel: stash branch shas in services.root_path of a synthetic
  // service per scan so a follow-up SQL can recover them.
  insertService(db, { repoId, name: `_branch_marker_main_${mainSha}`, scanVersionId: scanMain });
  insertService(db, { repoId, name: `_branch_marker_feature_${featureSha}`, scanVersionId: scanFeature });
  return { scanMain, scanFeature, repoId, mainSha, featureSha };
}

const SEEDERS = {
  default: seedDefault,
  same: seedSame,
  iso: seedIso,
  head: seedHead,
  branch: seedBranch,
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.db) {
    process.stderr.write('usage: node seed.js --project <root> --db <db-path> [--mode <mode>] [--git-repo <path>]\n');
    process.exit(2);
  }
  const mode = args.mode || 'default';
  const seeder = SEEDERS[mode];
  if (!seeder) {
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exit(2);
  }
  const Database = (await import('../../../worker/db/sqlite-adapter.js')).default;
  const db = new Database(args.db);
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const result = seeder(db, args.project, args['git-repo']);
  db.close();
  process.stdout.write(JSON.stringify(result) + '\n');
}
