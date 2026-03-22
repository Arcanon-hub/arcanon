/**
 * Tests for enrichment.js — enrichment pass framework.
 *
 * ENRICH-01: runEnrichmentPass runs all registered enrichers after core scan.
 * ENRICH-02: Each enricher writes to node_metadata with a distinct view key.
 * ENRICH-03: Enricher failures are caught, logged as warn, and skipped — never abort scan.
 *
 * Run: node --test worker/scan/enrichment.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  registerEnricher,
  clearEnrichers,
  runEnrichmentPass,
} from './enrichment.js';

// ---------------------------------------------------------------------------
// Helper: minimal in-memory DB with node_metadata table
// ---------------------------------------------------------------------------

function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE repos (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE services (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id        INTEGER NOT NULL REFERENCES repos(id),
      name           TEXT    NOT NULL,
      root_path      TEXT    NOT NULL,
      language       TEXT,
      boundary_entry TEXT
    );

    CREATE TABLE node_metadata (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      view       TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      source     TEXT,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, view, key)
    );
  `);

  db.prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, ?)").run('/tmp/repo', 'testrepo', 'mono');
  db.prepare("INSERT INTO services (repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?)").run(1, 'api', 'services/api', 'javascript', 'index.js');

  return db;
}

// ---------------------------------------------------------------------------
// Test 1: Registry starts empty; registerEnricher adds entry; clearEnrichers resets
// ---------------------------------------------------------------------------

describe('enrichment registry', () => {
  beforeEach(() => clearEnrichers());

  it('starts with no enrichers and can register one', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    let called = false;
    registerEnricher('test-enricher', async (ctx) => {
      called = true;
      return {};
    });

    await runEnrichmentPass(service, db, null);
    assert.strictEqual(called, true, 'registered enricher should be called');
    db.close();
  });

  it('clearEnrichers resets the registry to empty', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    let callCount = 0;
    registerEnricher('e1', async () => { callCount++; return {}; });
    registerEnricher('e2', async () => { callCount++; return {}; });

    clearEnrichers();

    await runEnrichmentPass(service, db, null);
    assert.strictEqual(callCount, 0, 'no enrichers should run after clearEnrichers');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 2: runEnrichmentPass calls all registered enrichers with correct ctx shape
// ---------------------------------------------------------------------------

describe('runEnrichmentPass ctx shape', () => {
  beforeEach(() => clearEnrichers());

  it('passes correct ctx fields to enricher', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    let receivedCtx;
    registerEnricher('ctx-checker', async (ctx) => {
      receivedCtx = ctx;
      return {};
    });

    await runEnrichmentPass(service, db, null);

    assert.strictEqual(receivedCtx.serviceId, 1);
    assert.strictEqual(receivedCtx.repoPath, 'services/api');
    assert.strictEqual(receivedCtx.language, 'javascript');
    assert.strictEqual(receivedCtx.entryFile, 'index.js');
    assert.strictEqual(receivedCtx.db, db);
    assert.strictEqual(receivedCtx.logger, null);
    db.close();
  });

  it('handles null language and boundary_entry gracefully', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: null, boundary_entry: null };

    let receivedCtx;
    registerEnricher('null-fields-checker', async (ctx) => {
      receivedCtx = ctx;
      return {};
    });

    await runEnrichmentPass(service, db, null);
    assert.strictEqual(receivedCtx.language, null);
    assert.strictEqual(receivedCtx.entryFile, null);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 3: A throwing enricher does not prevent subsequent enrichers from running
// ---------------------------------------------------------------------------

describe('failure isolation (ENRICH-03)', () => {
  beforeEach(() => clearEnrichers());

  it('subsequent enrichers run even if earlier one throws', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    const order = [];
    registerEnricher('thrower', async () => {
      order.push('thrower');
      throw new Error('boom');
    });
    registerEnricher('after-throw', async () => {
      order.push('after-throw');
      return {};
    });

    await runEnrichmentPass(service, db, null);
    assert.deepStrictEqual(order, ['thrower', 'after-throw'], 'both enrichers should be called');
    db.close();
  });

  it('logs a warning when an enricher throws', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    const warnings = [];
    const logger = { warn: (msg) => warnings.push(msg), info: () => {}, debug: () => {} };

    registerEnricher('boom-enricher', async () => {
      throw new Error('test error');
    });

    await runEnrichmentPass(service, db, logger);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('boom-enricher'), 'warning should include enricher name');
    assert.ok(warnings[0].includes('test error'), 'warning should include error message');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Enricher result key-values are written to node_metadata via INSERT OR REPLACE
// ---------------------------------------------------------------------------

describe('node_metadata writes (ENRICH-01, ENRICH-02)', () => {
  beforeEach(() => clearEnrichers());

  it('writes returned key-value pairs to node_metadata', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    registerEnricher('kv-enricher', async () => {
      return { foo: 'bar', baz: 'qux' };
    });

    await runEnrichmentPass(service, db, null);

    const rows = db.prepare("SELECT key, value, view, source FROM node_metadata WHERE service_id = 1 ORDER BY key").all();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].key, 'baz');
    assert.strictEqual(rows[0].value, 'qux');
    assert.strictEqual(rows[0].view, 'enrichment');
    assert.strictEqual(rows[0].source, 'enricher');
    assert.strictEqual(rows[1].key, 'foo');
    assert.strictEqual(rows[1].value, 'bar');
    db.close();
  });

  it('uses INSERT OR REPLACE — second write updates existing row', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    registerEnricher('first', async () => ({ mykey: 'value1' }));
    await runEnrichmentPass(service, db, null);

    clearEnrichers();
    registerEnricher('second', async () => ({ mykey: 'value2' }));
    await runEnrichmentPass(service, db, null);

    const rows = db.prepare("SELECT value FROM node_metadata WHERE service_id = 1 AND key = 'mykey'").all();
    assert.strictEqual(rows.length, 1, 'should be exactly one row after upsert');
    assert.strictEqual(rows[0].value, 'value2', 'should be updated to latest value');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 5: null-safe — runEnrichmentPass with no enrichers completes without error
// ---------------------------------------------------------------------------

describe('null-safety', () => {
  beforeEach(() => clearEnrichers());

  it('runs with no enrichers registered without error', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    await assert.doesNotReject(
      () => runEnrichmentPass(service, db, null),
      'should complete without throwing'
    );
    db.close();
  });

  it('enricher returning undefined does not throw', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    registerEnricher('undefined-returner', async () => { return undefined; });

    await assert.doesNotReject(
      () => runEnrichmentPass(service, db, null),
      'undefined result should be silently skipped'
    );
    db.close();
  });

  it('enricher returning null does not throw', async () => {
    const db = buildDb();
    const service = { id: 1, root_path: 'services/api', language: 'javascript', boundary_entry: 'index.js' };

    registerEnricher('null-returner', async () => { return null; });

    await assert.doesNotReject(
      () => runEnrichmentPass(service, db, null),
      'null result should be silently skipped'
    );
    db.close();
  });
});
