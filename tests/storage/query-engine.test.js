/**
 * tests/storage/query-engine.test.js
 *
 * Persistent test suite for QueryEngine (worker/query-engine.js).
 * Uses Node.js built-in test runner (node:test, available since Node 18+)
 * and the assert module. Each test case uses an isolated temp directory.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { openDb } from '../../worker/db.js';
import { QueryEngine } from '../../worker/query-engine.js';

/** Create a fresh isolated DB + QueryEngine for each test group */
function makeQE() {
  const dir = path.join(os.tmpdir(), 'allclear-test-' + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const db = openDb(dir);
  const qe = new QueryEngine(db);
  return { db, qe };
}

// ---------------------------------------------------------------------------
// 1. Database setup
// ---------------------------------------------------------------------------
describe('database setup', () => {
  it('openDb creates a WAL database', () => {
    const { db } = makeQE();
    const mode = db.pragma('journal_mode', { simple: true });
    assert.strictEqual(mode, 'wal');
    db.close();
  });

  it('QueryEngine constructor accepts db without throwing', () => {
    const { db, qe } = makeQE();
    assert.ok(qe instanceof QueryEngine);
    db.close();
  });

  it('openDb is idempotent — same instance returned on repeat call', () => {
    const dir = path.join(os.tmpdir(), 'allclear-test-' + crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const db1 = openDb(dir);
    const db2 = openDb(dir);
    assert.strictEqual(db1, db2);
    db1.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Schema integrity
// ---------------------------------------------------------------------------
describe('schema', () => {
  it('all 7 domain tables are present', () => {
    const { db } = makeQE();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
    const required = ['repos', 'services', 'connections', 'schemas', 'fields', 'map_versions', 'repo_state'];
    for (const t of required) {
      assert.ok(tables.includes(t), `table '${t}' should exist`);
    }
    db.close();
  });

  it('schema_version is 1', () => {
    const { db } = makeQE();
    const ver = db.prepare('SELECT MAX(version) FROM schema_versions').pluck().get();
    assert.strictEqual(ver, 1);
    db.close();
  });

  it('FTS5 virtual tables are present', () => {
    const { db } = makeQE();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
    for (const t of ['services_fts', 'connections_fts', 'fields_fts']) {
      assert.ok(tables.includes(t), `FTS5 table '${t}' should exist`);
    }
    db.close();
  });
});

// ---------------------------------------------------------------------------
// 3. Transitive traversal
// ---------------------------------------------------------------------------
describe('transitive traversal', () => {
  /** Seed a linear chain: A → B → C → D and return their IDs */
  function seedChain(qe) {
    const rId = qe.upsertRepo({ path: '/r', name: 'r', type: 'single' });
    const [A, B, C, D] = ['svc-a', 'svc-b', 'svc-c', 'svc-d'].map(n =>
      qe.upsertService({ repo_id: rId, name: n, root_path: '/r/' + n, language: 'node' })
    );
    qe.upsertConnection({ source_service_id: A, target_service_id: B, protocol: 'rest', method: 'GET', path: '/b' });
    qe.upsertConnection({ source_service_id: B, target_service_id: C, protocol: 'rest', method: 'GET', path: '/c' });
    qe.upsertConnection({ source_service_id: C, target_service_id: D, protocol: 'rest', method: 'GET', path: '/d' });
    return { A, B, C, D };
  }

  it('3-hop chain: A→B→C→D returns B, C, D with correct depths', () => {
    const { db, qe } = makeQE();
    const { A, B, C, D } = seedChain(qe);
    const hits = qe.transitiveImpact(A);
    const names = hits.map(h => h.name).sort();
    assert.deepStrictEqual(names, ['svc-b', 'svc-c', 'svc-d'], 'should return B, C, D');
    assert.strictEqual(hits.find(h => h.name === 'svc-b').depth, 1, 'B at depth 1');
    assert.strictEqual(hits.find(h => h.name === 'svc-c').depth, 2, 'C at depth 2');
    assert.strictEqual(hits.find(h => h.name === 'svc-d').depth, 3, 'D at depth 3');
    db.close();
  });

  it('depth limit: maxDepth=2 excludes D (depth 3)', () => {
    const { db, qe } = makeQE();
    const { A } = seedChain(qe);
    const hits = qe.transitiveImpact(A, { maxDepth: 2 });
    const names = hits.map(h => h.name);
    assert.ok(names.includes('svc-b'), 'B should be included');
    assert.ok(names.includes('svc-c'), 'C should be included');
    assert.ok(!names.includes('svc-d'), 'D should be excluded at maxDepth=2');
    db.close();
  });

  it('cycle detection: A→B→C→A terminates without infinite loop', () => {
    const { db, qe } = makeQE();
    const { A, C } = seedChain(qe);
    // Create cycle: C → A
    qe.upsertConnection({ source_service_id: C, target_service_id: A, protocol: 'rest', method: 'GET', path: '/cycle' });
    const hits = qe.transitiveImpact(A);
    // Must terminate and return a bounded result
    assert.ok(hits.length < 100, 'cycle should not produce unbounded results');
    // A itself should not appear in downstream results
    assert.ok(!hits.find(h => h.name === 'svc-a'), 'source A should not appear in its own downstream');
    db.close();
  });

  it('upstream direction: transitiveImpact(D, upstream) returns C, B, A', () => {
    const { db, qe } = makeQE();
    const { A, D } = seedChain(qe);
    const up = qe.transitiveImpact(D, { direction: 'upstream' });
    const names = up.map(h => h.name).sort();
    assert.ok(names.includes('svc-a'), 'upstream from D should include A');
    assert.ok(names.includes('svc-b'), 'upstream from D should include B');
    assert.ok(names.includes('svc-c'), 'upstream from D should include C');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Breaking change classification
// ---------------------------------------------------------------------------
describe('breaking change classification', () => {
  function seedService(qe) {
    const rId = qe.upsertRepo({ path: '/r', name: 'r', type: 'single' });
    const sId = qe.upsertService({ repo_id: rId, name: 'svc-a', root_path: '/r/svc-a', language: 'node' });
    const cId = qe.upsertConnection({ source_service_id: sId, target_service_id: sId, protocol: 'rest', method: 'GET', path: '/users' });
    return { sId, cId };
  }

  it('removed endpoint is classified as CRITICAL', () => {
    const { db, qe } = makeQE();
    const { sId } = seedService(qe);
    // Remove the connection
    db.prepare('DELETE FROM connections WHERE method=? AND path=?').run('GET', '/users');
    const result = qe.classifyImpact([{ type: 'removed', serviceId: sId, method: 'GET', path: '/users' }]);
    assert.ok(result.length > 0, 'should return at least one result');
    assert.strictEqual(result[0].severity, 'CRITICAL', 'removed endpoint should be CRITICAL');
    db.close();
  });

  it('changed field type is classified as WARN', () => {
    const { db, qe } = makeQE();
    const result = qe.classifyImpact([{ type: 'changed', serviceId: 1, fieldName: 'id', oldType: 'int', newType: 'string' }]);
    assert.ok(result.length > 0, 'should return at least one result');
    assert.strictEqual(result[0].severity, 'WARN', 'changed field type should be WARN');
    db.close();
  });

  it('added field is classified as INFO', () => {
    const { db, qe } = makeQE();
    const result = qe.classifyImpact([{ type: 'added', serviceId: 1, fieldName: 'email' }]);
    assert.ok(result.length > 0, 'should return at least one result');
    assert.strictEqual(result[0].severity, 'INFO', 'added field should be INFO');
    db.close();
  });

  it('mixed changes are sorted CRITICAL, WARN, INFO', () => {
    const { db, qe } = makeQE();
    const { sId } = seedService(qe);
    db.prepare('DELETE FROM connections WHERE method=? AND path=?').run('GET', '/users');
    const result = qe.classifyImpact([
      { type: 'added', serviceId: sId, fieldName: 'email' },
      { type: 'changed', serviceId: sId, fieldName: 'id', oldType: 'int', newType: 'string' },
      { type: 'removed', serviceId: sId, method: 'GET', path: '/users' },
    ]);
    assert.strictEqual(result[0].severity, 'CRITICAL', 'first result should be CRITICAL');
    assert.strictEqual(result[1].severity, 'WARN', 'second result should be WARN');
    assert.strictEqual(result[2].severity, 'INFO', 'third result should be INFO');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// 5. FTS5 search
// ---------------------------------------------------------------------------
describe('FTS5 search', () => {
  it('finds service by name', () => {
    const { db, qe } = makeQE();
    const rId = qe.upsertRepo({ path: '/r', name: 'r', type: 'single' });
    qe.upsertService({ repo_id: rId, name: 'payment-service', root_path: '/r/payment', language: 'node' });
    const results = qe.search('payment');
    assert.ok(results.length > 0, 'should find payment-service');
    assert.ok(results.some(r => r.kind === 'service'), 'result kind should be service');
    db.close();
  });

  it('finds connection by path', () => {
    const { db, qe } = makeQE();
    const rId = qe.upsertRepo({ path: '/r', name: 'r', type: 'single' });
    const sId = qe.upsertService({ repo_id: rId, name: 'svc-a', root_path: '/r/a', language: 'node' });
    qe.upsertConnection({ source_service_id: sId, target_service_id: sId, protocol: 'rest', method: 'GET', path: '/invoices/list' });
    const results = qe.search('invoices');
    assert.ok(results.length > 0, 'should find connection by path');
    assert.ok(results.some(r => r.kind === 'connection'), 'result kind should be connection');
    db.close();
  });

  it('returns empty array for unknown query (not an error)', () => {
    const { db, qe } = makeQE();
    const results = qe.search('nonexistent-xyz-query-abc-999');
    assert.ok(Array.isArray(results), 'should return array');
    assert.strictEqual(results.length, 0, 'should return empty array for unknown query');
    db.close();
  });
});
