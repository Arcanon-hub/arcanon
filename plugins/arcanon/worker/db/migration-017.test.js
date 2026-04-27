/**
 * Test suite for migration 017 - scan_overrides table.
 *
 * Phase 117 (CORRECT-01): creates the staged-corrections table that the
 * apply-hook (Plan 117-02) drains BETWEEN persistFindings and endScan, and
 * that the /arcanon:correct command (Phase 118) writes into.
 *
 * Verifies:
 *   - version export === 17
 *   - Idempotency (CREATE IF NOT EXISTS - re-run is a no-op, table appears once)
 *   - Column schema (8 columns with correct types/nullability/defaults)
 *   - CHECK constraint enforces kind IN ('connection','service')
 *   - CHECK constraint enforces action IN ('delete','update','rename','set-base-path')
 *   - Indexes idx_scan_overrides_kind_target and idx_scan_overrides_pending present
 *   - payload defaults to '{}' when omitted on INSERT
 *   - created_by defaults to 'system' when omitted on INSERT
 *   - created_at defaults to current datetime when omitted on INSERT
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { up as up015 } from './migrations/015_scan_versions_quality_score.js';
import { version, up as up017 } from './migrations/017_scan_overrides.js';

/**
 * Returns a fresh in-memory db with prerequisite migrations applied AND
 * 017 applied. FK enforcement is enabled. Seeds repos + scan_versions rows
 * so override-apply test setups referencing the FK resolve.
 *
 * Note: the scan_overrides table only references scan_versions(id) (via
 * applied_in_scan_version_id with ON DELETE SET NULL) - it does NOT depend
 * on enrichment_log (mig 016), so we skip that migration in the chain.
 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up005(db); // creates scan_versions
  up008(db);
  up009(db);
  up015(db); // adds scan_versions.quality_score (independent of 017)
  up017(db); // creates scan_overrides
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

describe('migration 017 - scan_overrides', () => {
  it('exports version === 17', () => {
    assert.equal(version, 17);
    assert.equal(typeof up017, 'function');
  });

  it('migration 017 creates scan_overrides table with the expected 8-column schema', () => {
    const { db } = freshDb();
    const cols = db.prepare('PRAGMA table_info(scan_overrides)').all();
    assert.equal(cols.length, 8, 'scan_overrides has exactly 8 columns');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    // override_id - INTEGER PRIMARY KEY AUTOINCREMENT
    assert.ok(byName.override_id, 'override_id column exists');
    assert.equal(byName.override_id.type, 'INTEGER');
    assert.equal(byName.override_id.pk, 1);

    // kind - TEXT NOT NULL
    assert.ok(byName.kind);
    assert.equal(byName.kind.type, 'TEXT');
    assert.equal(byName.kind.notnull, 1);

    // target_id - INTEGER NOT NULL
    assert.ok(byName.target_id);
    assert.equal(byName.target_id.type, 'INTEGER');
    assert.equal(byName.target_id.notnull, 1);

    // action - TEXT NOT NULL
    assert.ok(byName.action);
    assert.equal(byName.action.type, 'TEXT');
    assert.equal(byName.action.notnull, 1);

    // payload - TEXT NOT NULL DEFAULT '{}'
    assert.ok(byName.payload);
    assert.equal(byName.payload.type, 'TEXT');
    assert.equal(byName.payload.notnull, 1);
    assert.ok(byName.payload.dflt_value, 'payload has a default value');

    // created_at - TEXT NOT NULL with default
    assert.ok(byName.created_at);
    assert.equal(byName.created_at.type, 'TEXT');
    assert.equal(byName.created_at.notnull, 1);
    assert.ok(byName.created_at.dflt_value, 'created_at has a default value');

    // applied_in_scan_version_id - INTEGER nullable
    assert.ok(byName.applied_in_scan_version_id);
    assert.equal(byName.applied_in_scan_version_id.type, 'INTEGER');
    assert.equal(byName.applied_in_scan_version_id.notnull, 0);

    // created_by - TEXT NOT NULL DEFAULT 'system'
    assert.ok(byName.created_by);
    assert.equal(byName.created_by.type, 'TEXT');
    assert.equal(byName.created_by.notnull, 1);
    assert.ok(byName.created_by.dflt_value, 'created_by has a default value');
  });

  it('migration 017 creates expected indexes', () => {
    const { db } = freshDb();
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='scan_overrides'"
      )
      .all()
      .map((r) => r.name);
    assert.ok(
      idx.includes('idx_scan_overrides_kind_target'),
      'idx_scan_overrides_kind_target present'
    );
    assert.ok(
      idx.includes('idx_scan_overrides_pending'),
      'idx_scan_overrides_pending present'
    );
  });

  it('migration 017 is idempotent - second up() does not throw and the table appears once', () => {
    const { db } = freshDb();
    assert.doesNotThrow(() => up017(db));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scan_overrides'")
      .all();
    assert.equal(tables.length, 1, 'scan_overrides table appears exactly once');
    // Indexes still present after idempotent re-run.
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='scan_overrides'"
      )
      .all()
      .map((r) => r.name);
    assert.ok(idx.includes('idx_scan_overrides_kind_target'));
    assert.ok(idx.includes('idx_scan_overrides_pending'));
  });

  it('kind CHECK rejects unknown values', () => {
    const { db } = freshDb();
    const ins = db.prepare(
      "INSERT INTO scan_overrides (kind, target_id, action) VALUES (?, 1, 'delete')"
    );
    // Valid: 'connection' and 'service'
    assert.doesNotThrow(() => ins.run('connection'));
    assert.doesNotThrow(() => ins.run('service'));
    // Invalid: anything else
    assert.throws(() => ins.run('nope'), /CHECK constraint failed/);
    assert.throws(() => ins.run(''), /CHECK constraint failed/);
  });

  it('action CHECK rejects unknown values', () => {
    const { db } = freshDb();
    const ins = db.prepare(
      "INSERT INTO scan_overrides (kind, target_id, action) VALUES ('connection', 1, ?)"
    );
    // All four valid actions accepted.
    assert.doesNotThrow(() => ins.run('delete'));
    assert.doesNotThrow(() => ins.run('update'));
    assert.doesNotThrow(() => ins.run('rename'));
    assert.doesNotThrow(() => ins.run('set-base-path'));
    // Invalid: anything else
    assert.throws(() => ins.run('nope'), /CHECK constraint failed/);
    assert.throws(() => ins.run(''), /CHECK constraint failed/);
  });

  it("payload defaults to '{}' when omitted on INSERT", () => {
    const { db } = freshDb();
    db.prepare(
      "INSERT INTO scan_overrides (kind, target_id, action) VALUES ('connection', 42, 'delete')"
    ).run();
    const row = db.prepare('SELECT payload FROM scan_overrides').get();
    assert.equal(row.payload, '{}', "payload defaults to '{}'");
  });

  it("created_by defaults to 'system' when omitted on INSERT", () => {
    const { db } = freshDb();
    db.prepare(
      "INSERT INTO scan_overrides (kind, target_id, action) VALUES ('connection', 42, 'delete')"
    ).run();
    const row = db.prepare('SELECT created_by FROM scan_overrides').get();
    assert.equal(row.created_by, 'system', "created_by defaults to 'system'");
  });

  it('created_at defaults to current datetime when not provided', () => {
    const { db } = freshDb();
    const before = new Date();
    db.prepare(
      "INSERT INTO scan_overrides (kind, target_id, action) VALUES ('connection', 1, 'delete')"
    ).run();
    const after = new Date();
    const row = db.prepare('SELECT created_at FROM scan_overrides').get();
    assert.ok(row.created_at, 'created_at populated by default');
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const ts = new Date(row.created_at + 'Z').getTime();
    assert.ok(ts >= before.getTime() - 1000, 'created_at is at-or-after test start');
    assert.ok(ts <= after.getTime() + 1000, 'created_at is at-or-before test end');
  });
});
