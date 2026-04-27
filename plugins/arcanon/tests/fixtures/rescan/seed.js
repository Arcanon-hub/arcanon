/**
 * tests/fixtures/rescan/seed.js — Phase 118-02 fixture seeder (CORRECT-04, CORRECT-05).
 *
 * Builds an impact-map.db shaped for tests/rescan.bats:
 *   - Applies the canonical migration chain (001..017) so the production
 *     schema — including migration 017's scan_overrides table — is
 *     byte-identical to what /arcanon:rescan will read at runtime.
 *   - Inserts two repos: repo-a, repo-b (paths point at the seed.sh-created
 *     git checkouts under <project-root>/repo-{a,b}).
 *   - For each repo: one prior scan_versions row (so we can assert the
 *     rescan adds a NEW row beside it, distinct from a fresh scan).
 *   - For each repo: a repo_state row stamped with the repo's current HEAD
 *     commit. Without options.full=true the buildScanContext would return
 *     mode='skip'; the rescan path MUST bypass this.
 *
 * Echoes the resolved row IDs as JSON on stdout so the bats test can
 * capture them.
 */

import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
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
  // Uses execFileSync (NOT exec) — args are arrayed, no shell, no injection.
  return childProcess
    .execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    .trim();
}

export function seedRescanFixture({ db, projectRoot }) {
  applyAllMigrations(db);

  const out = { repos: {} };

  for (const name of ['repo-a', 'repo-b']) {
    const repoPath = path.join(projectRoot, name);

    const repoId = db.prepare(
      `INSERT INTO repos (path, name, type, scanned_at)
       VALUES (?, ?, 'single', datetime('now', '-1 hour'))`,
    ).run(repoPath, name).lastInsertRowid;

    const scanVersionId = db.prepare(
      `INSERT INTO scan_versions
         (repo_id, started_at, completed_at, quality_score)
       VALUES (?, datetime('now', '-1 hour'),
                  datetime('now', '-1 hour', '+30 seconds'),
                  0.95)`,
    ).run(repoId).lastInsertRowid;

    // Stamp repo_state with the repo's current HEAD so that without
    // options.full=true the rescan would return mode='skip' (HEAD equals
    // last_scanned_commit). The rescan path MUST bypass this skip.
    const head = gitHead(repoPath);
    db.prepare(
      `INSERT INTO repo_state (repo_id, last_scanned_commit, last_scanned_at)
       VALUES (?, ?, datetime('now', '-1 hour'))`,
    ).run(repoId, head);

    out.repos[name] = {
      repo_id: Number(repoId),
      repo_path: repoPath,
      scan_version_id: Number(scanVersionId),
      head,
    };
  }

  return out;
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
  const { default: Database } = await import('better-sqlite3');
  const { project, db: dbPath } = parseArgs(process.argv.slice(2));
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const result = seedRescanFixture({ db, projectRoot: project });
  db.close();
  process.stdout.write(JSON.stringify(result) + '\n');
}
