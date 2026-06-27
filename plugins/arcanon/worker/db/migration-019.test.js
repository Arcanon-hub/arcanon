/**
 * Test suite for migration 019 — connections.protocol_raw TEXT NULL column.
 *
 * Adds the `protocol_raw` column to the `connections` table so the original
 * agent-emitted protocol token (e.g. "NATS", "PostgreSQL") is preserved while
 * connections.protocol holds the canonical bucket (#42).
 *
 * Verifies:
 *   - version export === 19
 *   - protocol_raw column exists with TEXT type and is nullable after migration
 *   - Idempotency (PRAGMA-guarded ALTER — re-run is a no-op, column once)
 *   - Pre-existing connection rows survive the migration with protocol_raw = NULL
 *   - No stale "better-sqlite3" wording in the migration source (node:sqlite codebase)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from './sqlite-adapter.js';
import { up as up001 } from './migrations/001_initial_schema.js';
import { version, up as up019 } from './migrations/019_connections_protocol_raw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Returns a fresh in-memory db with the initial schema applied (001 — enough to
 * bring `connections` into existence) but WITHOUT migration 019, so each test
 * applies 019 explicitly under controlled conditions.
 */
function freshDbPre019() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  return db;
}

describe('migration 019 — connections.protocol_raw', () => {
  it('exports version === 19', () => {
    assert.equal(version, 19);
    assert.equal(typeof up019, 'function');
  });

  it('adds the protocol_raw column (TEXT, nullable) to the connections table', () => {
    const db = freshDbPre019();
    up019(db);

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const col = cols.find((c) => c.name === 'protocol_raw');
    assert.ok(col, 'protocol_raw column exists after migration 019');
    assert.equal(col.type, 'TEXT', 'protocol_raw column is TEXT');
    assert.equal(col.notnull, 0, 'protocol_raw column is nullable');
  });

  it('is idempotent — running up() twice does not throw and the column appears once', () => {
    const db = freshDbPre019();
    up019(db);
    assert.doesNotThrow(() => up019(db), 'second up() call does not throw');

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const matching = cols.filter((c) => c.name === 'protocol_raw');
    assert.equal(matching.length, 1, 'protocol_raw column appears exactly once');
  });

  it('is a no-op when the column already exists (manual ADD COLUMN before migration)', () => {
    const db = freshDbPre019();
    db.exec('ALTER TABLE connections ADD COLUMN protocol_raw TEXT');
    assert.doesNotThrow(() => up019(db), 'up() does not throw when column present');

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const matching = cols.filter((c) => c.name === 'protocol_raw');
    assert.equal(matching.length, 1, 'protocol_raw column still appears exactly once');
  });

  it('preserves existing connection rows with protocol_raw = NULL (non-destructive)', () => {
    const db = freshDbPre019();
    const repoId = db
      .prepare("INSERT INTO repos(path,name,type) VALUES(?,?,?)")
      .run('/tmp/r', 'r', 'single').lastInsertRowid;
    const svcA = db
      .prepare('INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)')
      .run(repoId, 'svc-a', 'a/', 'js').lastInsertRowid;
    const svcB = db
      .prepare('INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)')
      .run(repoId, 'svc-b', 'b/', 'js').lastInsertRowid;
    db.prepare(
      'INSERT INTO connections(source_service_id,target_service_id,protocol,method,path) VALUES(?,?,?,?,?)',
    ).run(svcA, svcB, 'kafka', 'produce', 'topic.x');

    up019(db);

    const row = db
      .prepare('SELECT protocol, protocol_raw FROM connections WHERE protocol = ?')
      .get('kafka');
    assert.equal(row.protocol, 'kafka', 'pre-existing row survives');
    assert.equal(row.protocol_raw, null, 'protocol_raw is NULL after migration');
  });

  it('migration source carries NO stale better-sqlite3 wording', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'migrations', '019_connections_protocol_raw.js'),
      'utf8',
    );
    assert.equal(
      /better-sqlite3/.test(src),
      false,
      'migration 019 must not reference better-sqlite3 (node:sqlite codebase)',
    );
  });
});
