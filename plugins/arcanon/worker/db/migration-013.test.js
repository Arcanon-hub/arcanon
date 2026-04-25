/**
 * Test suite for migration 013 — connections.path_template column.
 *
 * Phase 109 (TRUST-03): adds a TEXT column on `connections` for storing
 * the original (un-canonicalized) path template(s). The canonical form
 * lives in the existing `path` column (D-02). No backfill — pre-migration
 * rows retain `path_template = NULL` (D-06).
 *
 * Verifies:
 *   - version export === 13
 *   - Idempotency (up() runs twice without error)
 *   - Column shape (path_template TEXT, nullable)
 *   - Nullability — insert without path_template yields NULL
 *   - No backfill — rows inserted before migration retain NULL after
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { version, up as up013 } from './migrations/013_connections_path_template.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up005(db);
  up008(db);
  up009(db);
  // Seed a repo + 2 services so connection FK inserts resolve
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const aId = db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, 'a', '/tmp/r', 'js')"
    )
    .run(repoId).lastInsertRowid;
  const bId = db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, 'b', '/tmp/r', 'js')"
    )
    .run(repoId).lastInsertRowid;
  return { db, aId, bId };
}

describe('migration 013 — connections.path_template', () => {
  it('exports version === 13', () => {
    assert.equal(version, 13);
  });

  it('is idempotent', () => {
    const { db } = freshDb();
    assert.doesNotThrow(() => up013(db));
    assert.doesNotThrow(() => up013(db)); // second run = no-op
  });

  it('adds path_template TEXT column', () => {
    const { db } = freshDb();
    up013(db);
    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const ptCol = cols.find((c) => c.name === 'path_template');
    assert.ok(ptCol, 'path_template column should exist after up013');
    assert.equal(ptCol.type, 'TEXT');
    // SQLite reports notnull=0 for nullable columns
    assert.equal(ptCol.notnull, 0);
  });

  it('column is nullable — insert without path_template succeeds and yields NULL', () => {
    const { db, aId, bId } = freshDb();
    up013(db);
    db.prepare(
      'INSERT INTO connections (source_service_id, target_service_id, protocol, path) VALUES (?, ?, ?, ?)'
    ).run(aId, bId, 'rest', '/api/x');
    const row = db.prepare('SELECT path_template FROM connections').get();
    assert.equal(row.path_template, null);
  });

  it('does not backfill existing rows from path (D-06 — explicit no-op)', () => {
    const { db, aId, bId } = freshDb();
    // Insert BEFORE migration 013
    db.prepare(
      'INSERT INTO connections (source_service_id, target_service_id, protocol, path) VALUES (?, ?, ?, ?)'
    ).run(aId, bId, 'rest', '/runtime/streams/{stream_id}');
    up013(db);
    const row = db.prepare('SELECT path, path_template FROM connections').get();
    assert.equal(row.path, '/runtime/streams/{stream_id}'); // path unchanged
    assert.equal(row.path_template, null); // NOT backfilled — D-06
  });
});
