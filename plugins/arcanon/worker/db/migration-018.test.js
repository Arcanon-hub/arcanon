/**
 * Test suite for migration 018 — actors.label TEXT NULL column.
 *
 * Phase 121 (INT-06): adds the `label` column to the `actors` table so the
 * scan enrichment pass can stamp friendly display names matched from
 * `data/known-externals.yaml`.
 *
 * Verifies:
 *   - version export === 18
 *   - label column exists with TEXT type and is nullable on a freshly migrated DB
 *   - Idempotency (PRAGMA-guarded ALTER TABLE — re-run is a no-op, column still
 *     appears exactly once)
 *   - Pre-existing actor rows survive the migration with label = NULL (no
 *     autopopulation; labeling happens at scan time)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { version, up as up018 } from './migrations/018_actors_label.js';

/**
 * Returns a fresh in-memory db with prerequisite migrations applied (001 + 008
 * — enough to bring `actors` into existence) but WITHOUT migration 018, so
 * each test can apply 018 explicitly under controlled conditions.
 */
function freshDbPre018() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up008(db);
  return db;
}

describe('migration 018 — actors.label', () => {
  it('exports version === 18', () => {
    assert.equal(version, 18);
    assert.equal(typeof up018, 'function');
  });

  it('adds the label column (TEXT, nullable) to the actors table', () => {
    const db = freshDbPre018();
    up018(db);

    const cols = db.prepare('PRAGMA table_info(actors)').all();
    const labelCol = cols.find((c) => c.name === 'label');
    assert.ok(labelCol, 'label column exists after migration 018');
    assert.equal(labelCol.type, 'TEXT', 'label column is TEXT');
    assert.equal(labelCol.notnull, 0, 'label column is nullable');
  });

  it('is idempotent — running up() twice does not throw and label appears exactly once', () => {
    const db = freshDbPre018();
    up018(db);
    assert.doesNotThrow(() => up018(db), 'second up() call does not throw');

    const cols = db.prepare('PRAGMA table_info(actors)').all();
    const labelCols = cols.filter((c) => c.name === 'label');
    assert.equal(labelCols.length, 1, 'label column appears exactly once');
  });

  it('is a no-op when the label column already exists (manual ADD COLUMN before migration)', () => {
    const db = freshDbPre018();
    // Simulate a DB where the column was already added (e.g., by a hand-rolled migration)
    db.exec('ALTER TABLE actors ADD COLUMN label TEXT');
    assert.doesNotThrow(() => up018(db), 'up() does not throw on a DB that already has the column');

    const cols = db.prepare('PRAGMA table_info(actors)').all();
    const labelCols = cols.filter((c) => c.name === 'label');
    assert.equal(labelCols.length, 1, 'label column still appears exactly once');
  });

  it('preserves existing actor rows with label = NULL (no autopopulation)', () => {
    const db = freshDbPre018();
    db.prepare("INSERT INTO actors (name, kind, direction, source) VALUES (?, 'system', 'outbound', 'scan')")
      .run('api.stripe.com');

    up018(db);

    const row = db.prepare('SELECT name, label FROM actors WHERE name = ?').get('api.stripe.com');
    assert.equal(row.name, 'api.stripe.com');
    assert.equal(row.label, null, 'pre-existing actor row has label = NULL after migration');
  });
});
