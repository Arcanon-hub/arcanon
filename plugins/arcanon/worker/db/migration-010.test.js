/**
 * Test suite for migration 010 — service_dependencies table.
 *
 * Verifies:
 *   - Idempotency (running up() twice does not throw)
 *   - Table shape (9 columns with correct names)
 *   - CHECK constraint on dep_kind rejects invalid values
 *   - CHECK constraint accepts 'direct' and 'transient'
 *   - UNIQUE constraint is exactly 4-column (service_id, ecosystem, package_name, manifest_file)
 *   - Both indexes are present in sqlite_master
 *   - ON DELETE CASCADE removes dep rows when the parent service is deleted
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up010 } from './migrations/010_service_dependencies.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); // REQUIRED — SQLite FK enforcement is off by default
  up001(db);
  up005(db);
  up010(db);
  // seed a repo + service row so FK-bearing inserts work
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const svcId = db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, 'svc', '/tmp/r', 'js')"
    )
    .run(repoId).lastInsertRowid;
  return { db, svcId };
}

describe('migration 010 — service_dependencies', () => {
  it('is idempotent', () => {
    const { db } = freshDb();
    assert.doesNotThrow(() => up010(db));
  });

  it('has the expected columns', () => {
    const { db } = freshDb();
    const cols = db.prepare('PRAGMA table_info(service_dependencies)').all();
    const names = cols.map((c) => c.name).sort();
    assert.deepEqual(names, [
      'dep_kind',
      'ecosystem',
      'id',
      'manifest_file',
      'package_name',
      'resolved_version',
      'scan_version_id',
      'service_id',
      'version_spec',
    ]);
  });

  it('CHECK rejects invalid dep_kind', () => {
    const { db, svcId } = freshDb();
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO service_dependencies (service_id, ecosystem, package_name, manifest_file, dep_kind) VALUES (?, 'npm', 'pkg', 'package.json', 'broken')"
          )
          .run(svcId),
      /CHECK constraint failed/
    );
  });

  it('CHECK accepts direct and transient', () => {
    const { db, svcId } = freshDb();
    assert.doesNotThrow(() =>
      db
        .prepare(
          "INSERT INTO service_dependencies (service_id, ecosystem, package_name, manifest_file, dep_kind) VALUES (?, 'npm', 'd', 'package.json', 'direct')"
        )
        .run(svcId)
    );
    assert.doesNotThrow(() =>
      db
        .prepare(
          "INSERT INTO service_dependencies (service_id, ecosystem, package_name, manifest_file, dep_kind) VALUES (?, 'npm', 't', 'package.json', 'transient')"
        )
        .run(svcId)
    );
  });

  it('UNIQUE is 4-column — same pkg in different manifests is allowed', () => {
    const { db, svcId } = freshDb();
    const ins = db.prepare(
      'INSERT INTO service_dependencies (service_id, ecosystem, package_name, manifest_file) VALUES (?, ?, ?, ?)'
    );
    ins.run(svcId, 'npm', 'react', 'package.json');
    // Same 3 cols, DIFFERENT manifest_file — allowed (4-col UNIQUE, not 3-col)
    assert.doesNotThrow(() => ins.run(svcId, 'npm', 'react', 'apps/web/package.json'));
    // Identical 4-tuple — rejected
    assert.throws(
      () => ins.run(svcId, 'npm', 'react', 'package.json'),
      /UNIQUE constraint failed/
    );
  });

  it('indexes are present', () => {
    const { db } = freshDb();
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='service_dependencies'"
      )
      .all()
      .map((r) => r.name);
    assert.ok(idx.includes('idx_service_dependencies_package_name'));
    assert.ok(idx.includes('idx_service_dependencies_scan_version'));
  });

  it('ON DELETE CASCADE removes dep rows when service is deleted', () => {
    const { db, svcId } = freshDb();
    db.prepare(
      "INSERT INTO service_dependencies (service_id, ecosystem, package_name, manifest_file) VALUES (?, 'npm', 'react', 'package.json')"
    ).run(svcId);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM service_dependencies').get().n,
      1
    );
    db.prepare('DELETE FROM services WHERE id = ?').run(svcId);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM service_dependencies').get().n,
      0
    );
  });
});
