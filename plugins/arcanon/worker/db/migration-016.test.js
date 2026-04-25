/**
 * Test suite for migration 016 — enrichment_log table.
 *
 * Phase 111 (TRUST-06, TRUST-14): creates an audit-log table for post-scan
 * reconciliation field changes. Plan 111-03 wires the writes; this test covers
 * the schema-only contract: table exists, FK CASCADE, CHECK constraint on
 * target_kind, indexes present, default created_at.
 *
 * Verifies:
 *   - version export === 16
 *   - Idempotency (CREATE IF NOT EXISTS — re-run is a no-op, table appears once)
 *   - Column schema (10 columns with correct types/nullability)
 *   - CHECK constraint enforces target_kind IN ('service','connection')
 *   - FK to scan_versions(id) with ON DELETE CASCADE
 *   - Indexes idx_enrichment_log_scan_version_id and idx_enrichment_log_enricher present
 *   - INSERT without created_at auto-populates with current datetime
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { up as up015 } from './migrations/015_scan_versions_quality_score.js';
import { version, up as up016 } from './migrations/016_enrichment_log.js';

/**
 * Returns a fresh in-memory db with all prerequisite migrations applied AND
 * 016 applied. FK enforcement is enabled. Seeds a repos row + scan_versions row
 * so audit-log inserts referencing the FK resolve.
 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up005(db); // creates scan_versions
  up008(db);
  up009(db);
  up015(db); // adds scan_versions.quality_score (independent of 016)
  up016(db); // creates enrichment_log
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const svId = db
    .prepare(
      'INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)'
    )
    .run(repoId, '2026-04-25T12:00:00.000Z').lastInsertRowid;
  return { db, repoId, svId };
}

describe('migration 016 — enrichment_log', () => {
  it('exports version === 16', () => {
    assert.equal(version, 16);
    assert.equal(typeof up016, 'function');
  });

  it('is idempotent — running up() twice does not throw and the table appears once', () => {
    const { db } = freshDb();
    assert.doesNotThrow(() => up016(db)); // second run = no-op (CREATE IF NOT EXISTS)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='enrichment_log'")
      .all();
    assert.equal(tables.length, 1, 'enrichment_log table appears exactly once');
  });

  it('has the expected 10-column schema', () => {
    const { db } = freshDb();
    const cols = db.prepare('PRAGMA table_info(enrichment_log)').all();
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    // id — INTEGER PRIMARY KEY AUTOINCREMENT
    assert.ok(byName.id, 'id column exists');
    assert.equal(byName.id.type, 'INTEGER');
    assert.equal(byName.id.pk, 1);

    // scan_version_id — INTEGER NOT NULL
    assert.ok(byName.scan_version_id);
    assert.equal(byName.scan_version_id.type, 'INTEGER');
    assert.equal(byName.scan_version_id.notnull, 1);

    // enricher — TEXT NOT NULL
    assert.ok(byName.enricher);
    assert.equal(byName.enricher.type, 'TEXT');
    assert.equal(byName.enricher.notnull, 1);

    // target_kind — TEXT NOT NULL
    assert.ok(byName.target_kind);
    assert.equal(byName.target_kind.type, 'TEXT');
    assert.equal(byName.target_kind.notnull, 1);

    // target_id — INTEGER NOT NULL
    assert.ok(byName.target_id);
    assert.equal(byName.target_id.type, 'INTEGER');
    assert.equal(byName.target_id.notnull, 1);

    // field — TEXT NOT NULL
    assert.ok(byName.field);
    assert.equal(byName.field.type, 'TEXT');
    assert.equal(byName.field.notnull, 1);

    // from_value — TEXT nullable
    assert.ok(byName.from_value);
    assert.equal(byName.from_value.type, 'TEXT');
    assert.equal(byName.from_value.notnull, 0);

    // to_value — TEXT nullable
    assert.ok(byName.to_value);
    assert.equal(byName.to_value.type, 'TEXT');
    assert.equal(byName.to_value.notnull, 0);

    // reason — TEXT nullable
    assert.ok(byName.reason);
    assert.equal(byName.reason.type, 'TEXT');
    assert.equal(byName.reason.notnull, 0);

    // created_at — TEXT NOT NULL with default
    assert.ok(byName.created_at);
    assert.equal(byName.created_at.type, 'TEXT');
    assert.equal(byName.created_at.notnull, 1);
    assert.ok(byName.created_at.dflt_value, 'created_at has a default value');
  });

  it('CHECK enforces target_kind IN (service, connection)', () => {
    const { db, svId } = freshDb();
    const ins = db.prepare(
      "INSERT INTO enrichment_log (scan_version_id, enricher, target_kind, target_id, field) VALUES (?, 'reconciliation', ?, 1, 'crossing')"
    );
    // Valid: 'service' and 'connection'
    assert.doesNotThrow(() => ins.run(svId, 'service'));
    assert.doesNotThrow(() => ins.run(svId, 'connection'));
    // Invalid: anything else
    assert.throws(() => ins.run(svId, 'invalid'), /CHECK constraint failed/);
    assert.throws(() => ins.run(svId, ''), /CHECK constraint failed/);
  });

  it('FK to scan_versions(id) with ON DELETE CASCADE removes audit rows', () => {
    const { db, svId } = freshDb();
    db.prepare(
      "INSERT INTO enrichment_log (scan_version_id, enricher, target_kind, target_id, field, from_value, to_value, reason) VALUES (?, 'reconciliation', 'connection', 42, 'crossing', 'external', 'cross-service', 'target matches known service: payments')"
    ).run(svId);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM enrichment_log').get().n,
      1
    );
    db.prepare('DELETE FROM scan_versions WHERE id = ?').run(svId);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM enrichment_log').get().n,
      0,
      'CASCADE deletes audit rows when parent scan_versions row is deleted'
    );
  });

  it('indexes idx_enrichment_log_scan_version_id and idx_enrichment_log_enricher are present', () => {
    const { db } = freshDb();
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='enrichment_log'"
      )
      .all()
      .map((r) => r.name);
    assert.ok(
      idx.includes('idx_enrichment_log_scan_version_id'),
      'scan_version_id index present'
    );
    assert.ok(idx.includes('idx_enrichment_log_enricher'), 'enricher index present');
  });

  it('created_at defaults to current datetime when not provided', () => {
    const { db, svId } = freshDb();
    const before = new Date();
    db.prepare(
      "INSERT INTO enrichment_log (scan_version_id, enricher, target_kind, target_id, field) VALUES (?, 'reconciliation', 'service', 1, 'owner')"
    ).run(svId);
    const after = new Date();
    const row = db.prepare('SELECT created_at FROM enrichment_log').get();
    assert.ok(row.created_at, 'created_at populated by default');
    // SQLite datetime('now') format: 'YYYY-MM-DD HH:MM:SS' (UTC)
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // Sanity check: the timestamp is within the test window (with 1s tolerance)
    const ts = new Date(row.created_at + 'Z').getTime();
    assert.ok(ts >= before.getTime() - 1000, 'created_at is at-or-after test start');
    assert.ok(ts <= after.getTime() + 1000, 'created_at is at-or-before test end');
  });
});
