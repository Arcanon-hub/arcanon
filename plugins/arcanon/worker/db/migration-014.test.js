/**
 * Test suite for migration 014 — services.base_path column.
 *
 * Phase 110 (TRUST-04, TRUST-12): adds a TEXT column on `services` for storing
 * a service-level URL prefix (e.g. /api) that reverse proxies/ingress strip
 * before forwarding to the service. Connection resolution uses base_path to
 * strip the prefix from outbound paths before matching against exposed
 * endpoints (D-02 + D-03).
 *
 * Verifies:
 *   - version export === 14
 *   - Idempotency (up() runs twice without error, column appears exactly once)
 *   - Column shape (base_path TEXT, nullable)
 *   - Existing data preserved (pre-existing service row readable, base_path = NULL)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { up as up011 } from './migrations/011_services_boundary_entry.js';
import { version, up as up014 } from './migrations/014_services_base_path.js';

/**
 * Returns a fresh in-memory db seeded with the migration prerequisites for
 * services.base_path. base_path is independent of connections.path_template
 * (migration 013) so we don't apply 013 here — keeps this test isolated.
 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up005(db);
  up008(db);
  up009(db);
  up011(db);
  // Seed a repo so service FK inserts resolve
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

describe('migration 014 — services.base_path', () => {
  it('exports version === 14', () => {
    assert.equal(version, 14);
    assert.equal(typeof up014, 'function');
  });

  it('is idempotent — running up() twice does not throw and adds the column exactly once', () => {
    const { db } = freshDb();
    assert.doesNotThrow(() => up014(db));
    assert.doesNotThrow(() => up014(db)); // second run = no-op
    const cols = db.prepare('PRAGMA table_info(services)').all();
    const matches = cols.filter((c) => c.name === 'base_path');
    assert.equal(matches.length, 1, 'base_path column appears exactly once');
  });

  it('adds base_path TEXT column (nullable)', () => {
    const { db } = freshDb();
    up014(db);
    const cols = db.prepare('PRAGMA table_info(services)').all();
    const bpCol = cols.find((c) => c.name === 'base_path');
    assert.ok(bpCol, 'base_path column should exist after up014');
    assert.equal(bpCol.type, 'TEXT');
    assert.equal(bpCol.notnull, 0); // nullable
    assert.equal(bpCol.dflt_value, null); // no default
  });

  it('preserves pre-existing service rows; base_path defaults to NULL after migration', () => {
    const { db, repoId } = freshDb();
    // Insert BEFORE migration 014
    db.prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, 'pre-existing', '/tmp/r', 'js')"
    ).run(repoId);
    up014(db);
    const row = db
      .prepare('SELECT name, base_path FROM services WHERE name = ?')
      .get('pre-existing');
    assert.ok(row, 'pre-existing row still readable after migration');
    assert.equal(row.name, 'pre-existing');
    assert.equal(row.base_path, null); // D-01: no backfill
  });
});
