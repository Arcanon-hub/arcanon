/**
 * Tests for worker/mcp-server.js — MCP tool implementations
 * Run: node --test worker/mcp-server.test.js
 *
 * These tests exercise the query logic functions by calling them directly
 * with an in-memory SQLite database, bypassing the MCP SDK layer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Import the query functions exported from mcp-server.js
import {
  queryImpact,
  queryChanged,
  queryGraph,
  querySearch,
} from './mcp-server.js';

// ─────────────────────────────────────────────────────────────
// Test DB setup helpers
// ─────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      last_commit TEXT,
      scanned_at TEXT
    );

    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER REFERENCES repos(id),
      name TEXT NOT NULL,
      root_path TEXT,
      language TEXT
    );

    CREATE TABLE connections (
      id INTEGER PRIMARY KEY,
      source_service_id INTEGER REFERENCES services(id),
      target_service_id INTEGER REFERENCES services(id),
      protocol TEXT,
      method TEXT,
      path TEXT,
      source_file TEXT,
      target_file TEXT
    );

    CREATE TABLE schemas (
      id INTEGER PRIMARY KEY,
      connection_id INTEGER REFERENCES connections(id),
      role TEXT,
      name TEXT,
      file TEXT
    );

    CREATE TABLE fields (
      id INTEGER PRIMARY KEY,
      schema_id INTEGER REFERENCES schemas(id),
      name TEXT,
      type TEXT,
      required INTEGER
    );

    CREATE VIRTUAL TABLE connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content=connections,
      content_rowid=id
    );

    CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
      VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
  `);

  // Seed data
  db.prepare('INSERT INTO repos VALUES (1, ?, ?, ?, ?, ?)').run('/repo', 'main-repo', 'monorepo', null, null);
  db.prepare('INSERT INTO services VALUES (?, ?, ?, ?, ?)').run(1, 1, 'order-service', '/repo/orders', 'javascript');
  db.prepare('INSERT INTO services VALUES (?, ?, ?, ?, ?)').run(2, 1, 'payment-service', '/repo/payments', 'javascript');
  db.prepare('INSERT INTO services VALUES (?, ?, ?, ?, ?)').run(3, 1, 'notification-service', '/repo/notifications', 'python');
  db.prepare('INSERT INTO services VALUES (?, ?, ?, ?, ?)').run(4, 1, 'audit-service', '/repo/audit', 'python');

  // order-service → payment-service (order-service consumes payment-service)
  db.prepare('INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    1, 1, 2, 'http', 'POST', '/payments/charge',
    '/repo/orders/src/checkout.js', '/repo/payments/src/handler.js'
  );
  // payment-service → notification-service
  db.prepare('INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    2, 2, 3, 'http', 'POST', '/notify/payment',
    '/repo/payments/src/notify.js', '/repo/notifications/src/handler.js'
  );
  // notification-service → audit-service (transitive from order-service)
  db.prepare('INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    3, 3, 4, 'http', 'POST', '/audit/log',
    '/repo/notifications/src/audit.js', '/repo/audit/src/handler.js'
  );

  return db;
}

// ─────────────────────────────────────────────────────────────
// queryImpact tests
// ─────────────────────────────────────────────────────────────

test('queryImpact: direct consumers of order-service (direction=consumes)', async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: 'order-service',
    direction: 'consumes',
    transitive: false,
  });
  db.close();
  assert.ok(Array.isArray(result.results), 'results should be array');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].service, 'payment-service');
  assert.equal(result.results[0].protocol, 'http');
  assert.equal(result.results[0].method, 'POST');
  assert.equal(result.results[0].path, '/payments/charge');
  assert.equal(result.results[0].depth, 1);
});

test('queryImpact: exposes direction returns services that consume this service', async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: 'payment-service',
    direction: 'exposes',
    transitive: false,
  });
  db.close();
  assert.ok(Array.isArray(result.results), 'results should be array');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].service, 'order-service');
});

test('queryImpact: transitive=true returns all downstream services', async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: 'order-service',
    direction: 'consumes',
    transitive: true,
  });
  db.close();
  assert.ok(Array.isArray(result.results), 'results should be array');
  // Should include payment-service, notification-service, audit-service
  assert.ok(result.results.length >= 3, `expected >= 3 transitive results, got ${result.results.length}`);
  const names = result.results.map(r => r.service);
  assert.ok(names.includes('payment-service'), 'should include payment-service');
  assert.ok(names.includes('notification-service'), 'should include notification-service');
  assert.ok(names.includes('audit-service'), 'should include audit-service');
});

test('queryImpact: unknown service returns empty results', async () => {
  const db = createTestDb();
  const result = await queryImpact(db, { service: 'unknown-service', direction: 'consumes', transitive: false });
  db.close();
  assert.deepEqual(result, { results: [] });
});

test('queryImpact: null db returns empty results', async () => {
  const result = await queryImpact(null, { service: 'order-service', direction: 'consumes', transitive: false });
  assert.deepEqual(result, { results: [] });
});

// ─────────────────────────────────────────────────────────────
// queryChanged tests
// ─────────────────────────────────────────────────────────────

test('queryChanged: null db returns empty affected array', async () => {
  const result = await queryChanged(null, { repo: '/some/path' });
  assert.deepEqual(result.affected, []);
});

test('queryChanged: files with no matching connections return empty affected', async () => {
  const db = createTestDb();
  // Pass changedFiles directly to bypass git
  const result = await queryChanged(db, { _changedFiles: ['/unrelated/file.js'] });
  db.close();
  assert.deepEqual(result.affected, []);
});

test('queryChanged: changed file matches source_file returns affected service', async () => {
  const db = createTestDb();
  const result = await queryChanged(db, { _changedFiles: ['/repo/orders/src/checkout.js'] });
  db.close();
  assert.ok(Array.isArray(result.affected), 'affected should be array');
  assert.ok(result.affected.length >= 1);
  const names = result.affected.map(a => a.service);
  assert.ok(names.includes('order-service'), 'should include order-service');
});

test('queryChanged: changed_files is included in response', async () => {
  const db = createTestDb();
  const result = await queryChanged(db, { _changedFiles: ['foo.js', 'bar.js'] });
  db.close();
  assert.ok(Array.isArray(result.changed_files));
  assert.ok(result.changed_files.includes('foo.js'));
});

// ─────────────────────────────────────────────────────────────
// queryGraph tests
// ─────────────────────────────────────────────────────────────

test('queryGraph: null db returns empty nodes/edges', async () => {
  const result = await queryGraph(null, { service: 'order-service', depth: 2, direction: 'both' });
  assert.deepEqual(result, { nodes: [], edges: [] });
});

test('queryGraph: unknown service returns empty nodes/edges', async () => {
  const db = createTestDb();
  const result = await queryGraph(db, { service: 'unknown', depth: 2, direction: 'both' });
  db.close();
  assert.deepEqual(result, { nodes: [], edges: [] });
});

test('queryGraph: downstream from order-service depth=1 returns payment-service node', async () => {
  const db = createTestDb();
  const result = await queryGraph(db, { service: 'order-service', depth: 1, direction: 'downstream' });
  db.close();
  assert.ok(Array.isArray(result.nodes), 'nodes should be array');
  assert.ok(Array.isArray(result.edges), 'edges should be array');
  const nodeNames = result.nodes.map(n => n.name);
  assert.ok(nodeNames.includes('payment-service'), 'should include payment-service node');
  assert.ok(result.edges.length >= 1, 'should include at least one edge');
  assert.equal(result.edges[0].source, 'order-service');
  assert.equal(result.edges[0].target, 'payment-service');
});

test('queryGraph: depth=2 downstream includes transitive services', async () => {
  const db = createTestDb();
  const result = await queryGraph(db, { service: 'order-service', depth: 2, direction: 'downstream' });
  db.close();
  const nodeNames = result.nodes.map(n => n.name);
  assert.ok(nodeNames.includes('payment-service'), 'should include payment-service');
  assert.ok(nodeNames.includes('notification-service'), 'should include notification-service');
});

test('queryGraph: nodes have id, name, language fields', async () => {
  const db = createTestDb();
  const result = await queryGraph(db, { service: 'order-service', depth: 1, direction: 'downstream' });
  db.close();
  const node = result.nodes[0];
  assert.ok('id' in node, 'node should have id');
  assert.ok('name' in node, 'node should have name');
  assert.ok('language' in node, 'node should have language');
});
