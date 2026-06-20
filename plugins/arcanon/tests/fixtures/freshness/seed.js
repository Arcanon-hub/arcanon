/**
 * tests/fixtures/freshness/seed.js —  fixture seeder .
 *
 * Builds the on-disk state needed by tests/freshness.bats:
 *   1. A real git repo at <projectRoot>/repo-a/ with 4 commits (1 init + 3
 *      follow-ups). The init commit's SHA becomes `last_scanned_commit`, so
 *      `git rev-list --count <init>..HEAD` returns 3.
 *   2. A SQLite DB at <dbPath> with all migrations applied, populated with:
 *        repos        — one row {name=repo-a, path=<abs>, type=single}
 *        repo_state   — one row {repo_id, last_scanned_commit=<init SHA>}
 *        scan_versions — one row {repo_id, started_at, completed_at(-1h), quality_score=0.87}
 *        services / connections — minimal data so the endpoint has something
 *                                 to render (1 service, 0 connections).
 *
 * Echoes the captured INIT_SHA to stdout (last line) so the bats test can
 * assert on it.
 *
 * Read-only contract: the fixture writes the DB ONCE; the worker MUST NOT
 * modify it during the test.
 *
 * Uses execFileSync (not exec) — no shell, no injection surface even if
 * paths contain special chars.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)');
  for (const v of versions) ins.run(v);
}

function gitRun(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Arcanon Test',
      GIT_AUTHOR_EMAIL: 'test@arcanon.local',
      GIT_COMMITTER_NAME: 'Arcanon Test',
      GIT_COMMITTER_EMAIL: 'test@arcanon.local',
    },
  }).trim();
}

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.db) {
    process.stderr.write('usage: node seed.js --project <root> --db <db-path>\n');
    process.exit(2);
  }

  const projectRoot = args.project;
  const dbPath = args.db;
  const repoDir = `${projectRoot}/repo-a`;

  mkdirSync(repoDir, { recursive: true });
  gitRun(repoDir, ['init', '-q', '-b', 'main']);
  gitRun(repoDir, ['commit', '--allow-empty', '-q', '-m', 'init']);
  const initSha = gitRun(repoDir, ['rev-parse', 'HEAD']);
  gitRun(repoDir, ['commit', '--allow-empty', '-q', '-m', 'c1']);
  gitRun(repoDir, ['commit', '--allow-empty', '-q', '-m', 'c2']);
  gitRun(repoDir, ['commit', '--allow-empty', '-q', '-m', 'c3']);

  const Database = (await import('../../../worker/db/sqlite-adapter.js')).default;
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);

  const repoId = Number(
    db.prepare(
      `INSERT INTO repos (path, name, type, scanned_at)
         VALUES (?, ?, ?, datetime('now'))`,
    ).run(repoDir, 'repo-a', 'single').lastInsertRowid,
  );

  db.prepare(
    `INSERT INTO repo_state (repo_id, last_scanned_commit, last_scanned_at)
       VALUES (?, ?, datetime('now', '-1 hour'))`,
  ).run(repoId, initSha);

  const scanVersionId = Number(
    db.prepare(
      `INSERT INTO scan_versions (repo_id, started_at, completed_at, quality_score)
         VALUES (?, datetime('now', '-1 hour', '-1 minute'),
                    datetime('now', '-1 hour'),
                    0.87)`,
    ).run(repoId).lastInsertRowid,
  );

  db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(repoId, 'svc-a', `${repoDir}/svc-a`, 'js', 'service', scanVersionId);

  db.close();
  process.stdout.write(initSha + '\n');
}
