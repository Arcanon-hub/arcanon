import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from './sqlite-adapter.js';
import { runMigrations } from './database.js';
import { QueryEngine } from './query-engine.js';

/**
 * Build a fully-migrated in-memory DB.
 * withMig010=true  (default) — all migrations including 010 (production state)
 * withMig010=false — drops service_dependencies after full migration to simulate
 *                    a pre-migration-010 DB for graceful-absence tests.
 */
function seedDb(withMig010 = true) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  if (!withMig010) {
    db.exec('DROP TABLE IF EXISTS service_dependencies');
    db.exec('DROP INDEX IF EXISTS idx_service_dependencies_package_name');
    db.exec('DROP INDEX IF EXISTS idx_service_dependencies_scan_version');
  }
  const repoId = db.prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r','r','single')").run().lastInsertRowid;
  const svcId = db.prepare("INSERT INTO services (repo_id, name, root_path, language) VALUES (?, 'svc', '/tmp/r', 'js')").run(repoId).lastInsertRowid;
  const scanVer = db.prepare("INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)").run(repoId, new Date().toISOString()).lastInsertRowid;
  return { db, svcId, scanVer, qe: new QueryEngine(db) };
}

describe('QueryEngine dependencies API', () => {
  it('upsertDependency preserves row id across repeat upserts', () => {
    const { svcId, qe, scanVer } = seedDb();
    const id1 = qe.upsertDependency({
      service_id: svcId, scan_version_id: scanVer,
      ecosystem: 'npm', package_name: 'react',
      version_spec: '^18.0.0', resolved_version: '18.2.0',
      manifest_file: 'package.json',
    });
    const id2 = qe.upsertDependency({
      service_id: svcId, scan_version_id: scanVer,
      ecosystem: 'npm', package_name: 'react',
      version_spec: '^18.3.0', resolved_version: '18.3.1',
      manifest_file: 'package.json',
    });
    assert.equal(id2, id1, 'row id MUST be stable across re-upsert');
  });

  it('upsertDependency update-on-conflict replaces version_spec and resolved_version', () => {
    const { db, svcId, qe, scanVer } = seedDb();
    qe.upsertDependency({
      service_id: svcId, scan_version_id: scanVer,
      ecosystem: 'npm', package_name: 'react',
      version_spec: '^18.0.0', resolved_version: '18.2.0',
      manifest_file: 'package.json',
    });
    qe.upsertDependency({
      service_id: svcId, scan_version_id: scanVer,
      ecosystem: 'npm', package_name: 'react',
      version_spec: '^19.0.0', resolved_version: '19.0.1',
      manifest_file: 'package.json',
    });
    const rows = db.prepare("SELECT version_spec, resolved_version FROM service_dependencies WHERE package_name = 'react'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version_spec, '^19.0.0');
    assert.equal(rows[0].resolved_version, '19.0.1');
  });

  it('different manifest_file for same package creates a second row', () => {
    const { svcId, qe, scanVer } = seedDb();
    const id1 = qe.upsertDependency({
      service_id: svcId, scan_version_id: scanVer,
      ecosystem: 'npm', package_name: 'react',
      manifest_file: 'package.json',
      version_spec: '^18.0.0', resolved_version: null,
    });
    const id2 = qe.upsertDependency({
      service_id: svcId, scan_version_id: scanVer,
      ecosystem: 'npm', package_name: 'react',
      manifest_file: 'apps/web/package.json',
      version_spec: '^19.0.0', resolved_version: null,
    });
    assert.notEqual(id1, id2);
  });

  it('dep_kind defaults to direct when omitted', () => {
    const { db, svcId, qe } = seedDb();
    qe.upsertDependency({
      service_id: svcId, scan_version_id: null,
      ecosystem: 'npm', package_name: 'react',
      manifest_file: 'package.json',
      version_spec: null, resolved_version: null,
    });
    const row = db.prepare("SELECT dep_kind FROM service_dependencies").get();
    assert.equal(row.dep_kind, 'direct');
  });

  it('getDependenciesForService returns sorted rows', () => {
    const { svcId, qe, scanVer } = seedDb();
    qe.upsertDependency({ service_id: svcId, scan_version_id: scanVer, ecosystem: 'pypi', package_name: 'requests', manifest_file: 'pyproject.toml', version_spec: '^2.31', resolved_version: null });
    qe.upsertDependency({ service_id: svcId, scan_version_id: scanVer, ecosystem: 'npm', package_name: 'zustand', manifest_file: 'package.json', version_spec: '^4.0', resolved_version: null });
    qe.upsertDependency({ service_id: svcId, scan_version_id: scanVer, ecosystem: 'npm', package_name: 'react', manifest_file: 'package.json', version_spec: '^18', resolved_version: null });
    const rows = qe.getDependenciesForService(svcId);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map(r => [r.ecosystem, r.package_name]),
      [['npm','react'], ['npm','zustand'], ['pypi','requests']]
    );
  });

  it('getDependenciesForService returns [] for service with no deps', () => {
    const { qe, svcId } = seedDb();
    assert.deepEqual(qe.getDependenciesForService(svcId), []);
  });

  it('graceful absence on pre-migration-010 database', () => {
    const { qe, svcId } = seedDb(/* withMig010 */ false);
    assert.equal(qe.upsertDependency({
      service_id: svcId, scan_version_id: null,
      ecosystem: 'npm', package_name: 'react',
      manifest_file: 'package.json',
      version_spec: null, resolved_version: null,
    }), null);
    assert.deepEqual(qe.getDependenciesForService(svcId), []);
  });
});
