/**
 * Test suite for migration 020 — actor_connections.protocol_raw TEXT NULL column.
 *
 * Adds the `protocol_raw` column to the `actor_connections` table so the original
 * agent-emitted external-actor protocol token (e.g. "NATS", "PostgreSQL") is
 * preserved while actor_connections.protocol holds the canonical bucket (#42).
 * Migration 019 added protocol_raw to `connections` only; 020 closes the actor seam.
 *
 * Verifies:
 *   - version export === 20
 *   - protocol_raw column exists with TEXT type and is nullable after migration
 *   - Idempotency (PRAGMA-guarded ALTER — re-run is a no-op, column once)
 *   - No-op when the column already exists (manual ADD COLUMN before migration)
 *   - Pre-existing actor_connections rows survive the migration with protocol_raw = NULL
 *   - No stale "better-sqlite3" wording in the migration source (node:sqlite codebase)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from './sqlite-adapter.js';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { version, up as up020 } from './migrations/020_actor_connections_protocol_raw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Returns a fresh in-memory db with the initial schema (001) AND migration 008
 * applied (the latter creates the actors + actor_connections tables) but WITHOUT
 * migration 020, so each test applies 020 explicitly under controlled conditions.
 */
function freshDbPre020() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up008(db);
  return db;
}

describe('migration 020 — actor_connections.protocol_raw', () => {
  it('exports version === 20', () => {
    assert.equal(version, 20);
    assert.equal(typeof up020, 'function');
  });

  it('adds the protocol_raw column (TEXT, nullable) to the actor_connections table', () => {
    const db = freshDbPre020();
    up020(db);

    const cols = db.prepare('PRAGMA table_info(actor_connections)').all();
    const col = cols.find((c) => c.name === 'protocol_raw');
    assert.ok(col, 'protocol_raw column exists after migration 020');
    assert.equal(col.type, 'TEXT', 'protocol_raw column is TEXT');
    assert.equal(col.notnull, 0, 'protocol_raw column is nullable');
  });

  it('is idempotent — running up() twice does not throw and the column appears once', () => {
    const db = freshDbPre020();
    up020(db);
    assert.doesNotThrow(() => up020(db), 'second up() call does not throw');

    const cols = db.prepare('PRAGMA table_info(actor_connections)').all();
    const matching = cols.filter((c) => c.name === 'protocol_raw');
    assert.equal(matching.length, 1, 'protocol_raw column appears exactly once');
  });

  it('is a no-op when the column already exists (manual ADD COLUMN before migration)', () => {
    const db = freshDbPre020();
    db.exec('ALTER TABLE actor_connections ADD COLUMN protocol_raw TEXT');
    assert.doesNotThrow(() => up020(db), 'up() does not throw when column present');

    const cols = db.prepare('PRAGMA table_info(actor_connections)').all();
    const matching = cols.filter((c) => c.name === 'protocol_raw');
    assert.equal(matching.length, 1, 'protocol_raw column still appears exactly once');
  });

  it('preserves existing actor_connections rows with protocol_raw = NULL (non-destructive)', () => {
    const db = freshDbPre020();
    const repoId = db
      .prepare('INSERT INTO repos(path,name,type) VALUES(?,?,?)')
      .run('/tmp/r', 'r', 'single').lastInsertRowid;
    const svc = db
      .prepare('INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)')
      .run(repoId, 'svc-a', 'a/', 'js').lastInsertRowid;
    const actorId = db
      .prepare("INSERT INTO actors(name,kind,direction,source) VALUES(?,?,?,?)")
      .run('NATS', 'system', 'outbound', 'scan').lastInsertRowid;
    db.prepare(
      'INSERT INTO actor_connections(actor_id,service_id,direction,protocol,path) VALUES(?,?,?,?,?)',
    ).run(actorId, svc, 'outbound', 'nats', 'topic.x');

    up020(db);

    const row = db
      .prepare('SELECT protocol, protocol_raw FROM actor_connections WHERE protocol = ?')
      .get('nats');
    assert.equal(row.protocol, 'nats', 'pre-existing actor_connections row survives');
    assert.equal(row.protocol_raw, null, 'protocol_raw is NULL after migration');
  });

  it('migration source carries NO stale better-sqlite3 wording', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'migrations', '020_actor_connections_protocol_raw.js'),
      'utf8',
    );
    assert.equal(
      /better-sqlite3/.test(src),
      false,
      'migration 020 must not reference better-sqlite3 (node:sqlite codebase)',
    );
  });
});
