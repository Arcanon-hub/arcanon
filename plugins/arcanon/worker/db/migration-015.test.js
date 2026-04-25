/**
 * Test suite for migration 015 — scan_versions.quality_score column.
 *
 * Phase 111 (TRUST-05): adds a REAL column on `scan_versions` for storing the
 * scan-level quality score (high + 0.5*low / total — see CONTEXT.md D-02). The
 * column is nullable; pre-migration rows pick up NULL and new scans populate
 * via endScan() in Plan 111-02.
 *
 * Verifies:
 *   - version export === 15
 *   - Idempotency (up() runs twice without error, column appears exactly once)
 *   - Column shape (quality_score REAL, nullable)
 *   - Existing scan_versions rows preserved (id/repo_id/started_at/completed_at intact, quality_score = NULL)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { version, up as up015 } from './migrations/015_scan_versions_quality_score.js';

/**
 * Returns a fresh in-memory db seeded with the migration prerequisites for
 * scan_versions.quality_score. Only migrations that touch scan_versions or
 * are required by 001's FTS5/triggers are applied — keeps the test isolated.
 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up005(db); // creates scan_versions
  up008(db);
  up009(db);
  // Seed a repo so scan_versions FK inserts resolve
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

describe('migration 015 — scan_versions.quality_score', () => {
  it('exports version === 15', () => {
    assert.equal(version, 15);
    assert.equal(typeof up015, 'function');
  });

  it('is idempotent — running up() twice does not throw and adds the column exactly once', () => {
    const { db } = freshDb();
    assert.doesNotThrow(() => up015(db));
    assert.doesNotThrow(() => up015(db)); // second run = no-op
    const cols = db.prepare('PRAGMA table_info(scan_versions)').all();
    const matches = cols.filter((c) => c.name === 'quality_score');
    assert.equal(matches.length, 1, 'quality_score column appears exactly once');
  });

  it('adds quality_score REAL column (nullable, no default)', () => {
    const { db } = freshDb();
    up015(db);
    const cols = db.prepare('PRAGMA table_info(scan_versions)').all();
    const qsCol = cols.find((c) => c.name === 'quality_score');
    assert.ok(qsCol, 'quality_score column should exist after up015');
    assert.equal(qsCol.type, 'REAL');
    assert.equal(qsCol.notnull, 0); // nullable
    assert.equal(qsCol.dflt_value, null); // no default
  });

  it('preserves pre-existing scan_versions rows; quality_score defaults to NULL after migration', () => {
    const { db, repoId } = freshDb();
    // Insert BEFORE migration 015 so we exercise the "existing rows pick up NULL" path
    const startedAt = '2026-04-25T12:00:00.000Z';
    const completedAt = '2026-04-25T12:05:00.000Z';
    const svId = db
      .prepare(
        'INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)'
      )
      .run(repoId, startedAt, completedAt).lastInsertRowid;
    up015(db);
    const row = db
      .prepare(
        'SELECT id, repo_id, started_at, completed_at, quality_score FROM scan_versions WHERE id = ?'
      )
      .get(svId);
    assert.ok(row, 'pre-existing row still readable after migration');
    assert.equal(row.id, svId);
    assert.equal(row.repo_id, repoId);
    assert.equal(row.started_at, startedAt);
    assert.equal(row.completed_at, completedAt);
    assert.equal(row.quality_score, null); // no backfill
  });

  it('does not modify or drop existing columns on scan_versions', () => {
    const { db } = freshDb();
    const before = db
      .prepare('PRAGMA table_info(scan_versions)')
      .all()
      .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk }))
      .filter((c) => c.name !== 'quality_score');
    up015(db);
    const after = db
      .prepare('PRAGMA table_info(scan_versions)')
      .all()
      .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk }))
      .filter((c) => c.name !== 'quality_score');
    assert.deepEqual(after, before, 'existing columns unchanged after up015');
  });
});
