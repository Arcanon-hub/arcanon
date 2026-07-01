/**
 * Test suite for migration 021 — map_versions.kind TEXT and map_versions.repos_json TEXT.
 *
 * Adds `kind TEXT NOT NULL DEFAULT 'map'` and `repos_json TEXT` to map_versions so
 * each snapshot row is self-describing: kind distinguishes full map runs from
 * single-repo rescans; repos_json carries {path, scan_version_id} pairs that
 * Phase 142's diff engine reads without querying the snapshot DB.
 *
 * Verifies:
 *   - version export === 21
 *   - kind column exists (TEXT, NOT NULL, default 'map') after migration
 *   - repos_json column exists (TEXT, nullable) after migration
 *   - Idempotency (PRAGMA-guarded ALTER — re-run is a no-op, each column once)
 *   - Pre-existing map_versions rows survive with kind='map' and repos_json=NULL
 *   - No stale "better-sqlite3" wording in the migration source (node:sqlite codebase)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from './sqlite-adapter.js';
import { up as up001 } from './migrations/001_initial_schema.js';
import { version, up as up021 } from './migrations/021_map_versions_kind_repos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Returns a fresh in-memory db with the initial schema (001) applied but WITHOUT
 * migration 021, so each test applies 021 explicitly under controlled conditions.
 */
function freshDbPre021() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  return db;
}

describe('migration 021 — map_versions.kind + repos_json', () => {
  it('exports version === 21', () => {
    assert.equal(version, 21);
    assert.equal(typeof up021, 'function');
  });

  it('adds the kind column (TEXT, NOT NULL, default map) to map_versions', () => {
    const db = freshDbPre021();
    up021(db);

    const cols = db.prepare('PRAGMA table_info(map_versions)').all();
    const col = cols.find((c) => c.name === 'kind');
    assert.ok(col, 'kind column exists after migration 021');
    assert.equal(col.type, 'TEXT', 'kind column is TEXT');
    assert.equal(col.notnull, 1, 'kind column is NOT NULL');
    assert.equal(col.dflt_value, "'map'", "kind column defaults to 'map'");
  });

  it('adds the repos_json column (TEXT, nullable) to map_versions', () => {
    const db = freshDbPre021();
    up021(db);

    const cols = db.prepare('PRAGMA table_info(map_versions)').all();
    const col = cols.find((c) => c.name === 'repos_json');
    assert.ok(col, 'repos_json column exists after migration 021');
    assert.equal(col.type, 'TEXT', 'repos_json column is TEXT');
    assert.equal(col.notnull, 0, 'repos_json column is nullable');
  });

  it('is idempotent — running up() twice does not throw and each column appears once', () => {
    const db = freshDbPre021();
    up021(db);
    assert.doesNotThrow(() => up021(db), 'second up() call does not throw');

    const cols = db.prepare('PRAGMA table_info(map_versions)').all();
    const kindCols = cols.filter((c) => c.name === 'kind');
    const reposJsonCols = cols.filter((c) => c.name === 'repos_json');
    assert.equal(kindCols.length, 1, 'kind column appears exactly once');
    assert.equal(reposJsonCols.length, 1, 'repos_json column appears exactly once');
  });

  it('is a no-op when kind already exists (manual ADD COLUMN before migration)', () => {
    const db = freshDbPre021();
    db.exec("ALTER TABLE map_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'map'");
    assert.doesNotThrow(() => up021(db), 'up() does not throw when kind is pre-existing');

    const cols = db.prepare('PRAGMA table_info(map_versions)').all();
    const kindCols = cols.filter((c) => c.name === 'kind');
    assert.equal(kindCols.length, 1, 'kind column still appears exactly once');
  });

  it('preserves existing map_versions rows — kind defaults to map, repos_json is NULL', () => {
    const db = freshDbPre021();
    // Insert a pre-migration row (4-column schema)
    db.prepare(
      "INSERT INTO map_versions (created_at, label, snapshot_path) VALUES (?, ?, ?)"
    ).run(new Date().toISOString(), 'pre-migration-run', 'snapshots/old.db');

    up021(db);

    const row = db.prepare("SELECT * FROM map_versions WHERE label = 'pre-migration-run'").get();
    assert.ok(row, 'pre-existing map_versions row survives the migration');
    assert.equal(row.kind, 'map', "pre-existing row gets kind='map' via column default");
    assert.equal(row.repos_json, null, 'pre-existing row has repos_json=NULL');
    assert.equal(row.snapshot_path, 'snapshots/old.db', 'snapshot_path is unchanged');
  });

  it('migration source carries NO stale better-sqlite3 wording', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'migrations', '021_map_versions_kind_repos.js'),
      'utf8',
    );
    assert.equal(
      /better-sqlite3/.test(src),
      false,
      'migration 021 must not reference better-sqlite3 (node:sqlite codebase)',
    );
  });
});
