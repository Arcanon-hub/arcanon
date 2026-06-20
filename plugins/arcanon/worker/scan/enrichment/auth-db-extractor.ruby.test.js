/**
 * End-to-end tests for Ruby auth/db enrichment in auth-db-extractor.js.
 *
 * Run: node --test worker/scan/enrichment/auth-db-extractor.ruby.test.js
 *
 * Uses node:test + node:assert/strict + better-sqlite3 in-memory DB.
 * Exercises Ruby fixture repos under fixtures/ruby*, fixtures/ruby-httpbasic,
 * fixtures/ruby-mysql, fixtures/ruby-yml-authoritative, fixtures/ruby-empty.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from '../../db/sqlite-adapter.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { extractAuthAndDb } from './auth-db-extractor.js';

// ---------------------------------------------------------------------------
// Helpers — copied verbatim from auth-db-extractor.test.js lines 23-85
// ---------------------------------------------------------------------------

function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS repos (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS services (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id        INTEGER NOT NULL REFERENCES repos(id),
      name           TEXT    NOT NULL,
      root_path      TEXT    NOT NULL,
      language       TEXT,
      boundary_entry TEXT,
      auth_mechanism TEXT,
      db_backend     TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS node_metadata (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      view       TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      source     TEXT,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, view, key)
    )
  `).run();

  db.prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, ?)").run('/tmp/repo', 'testrepo', 'mono');
  db.prepare("INSERT INTO services (repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?)").run(1, 'api', '/tmp/repo/api', 'ruby', 'config/routes.rb');

  return db;
}

// Helper: get node_metadata value for a service
function getMeta(db, serviceId, view, key) {
  const row = db.prepare('SELECT value FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?').get(serviceId, view, key);
  return row ? row.value : undefined;
}

// Helper: get services columns
function getServiceCols(db, serviceId) {
  return db.prepare('SELECT auth_mechanism, db_backend FROM services WHERE id = ?').get(serviceId);
}

// Helper: build a ctx object for tests
function buildCtx(db, repoPath, language, entryFile) {
  return {
    serviceId: 1,
    repoPath,
    language,
    entryFile,
    db,
    logger: null,
  };
}

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES_RUBY           = fileURLToPath(new URL('./fixtures/ruby', import.meta.url));
const FIXTURES_RUBY_HTTPBASIC = fileURLToPath(new URL('./fixtures/ruby-httpbasic', import.meta.url));
const FIXTURES_RUBY_MYSQL     = fileURLToPath(new URL('./fixtures/ruby-mysql', import.meta.url));
const FIXTURES_RUBY_YML_AUTH  = fileURLToPath(new URL('./fixtures/ruby-yml-authoritative', import.meta.url));
const FIXTURES_RUBY_EMPTY     = fileURLToPath(new URL('./fixtures/ruby-empty', import.meta.url));

// ---------------------------------------------------------------------------
// Test A: Rails with Devise + config/database.yml adapter: postgresql
// ---------------------------------------------------------------------------

describe('Ruby auth/db end-to-end — Devise + config/database.yml (postgresql)', () => {
  it('Test A: auth_mechanism=session, db_backend=postgresql (no DATABASE_URL)', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_RUBY, 'ruby', 'config/routes.rb');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'session',
      `auth_mechanism should be 'session' (Devise), got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, 'postgresql',
      `db_backend should be 'postgresql' (from config/database.yml adapter: postgresql), got: ${result.db_backend}`);

    // node_metadata written correctly
    assert.equal(getMeta(db, 1, 'security', 'auth_mechanism'), 'session');
    assert.equal(getMeta(db, 1, 'infra', 'db_backend'), 'postgresql');

    // services columns denormalized
    const cols = getServiceCols(db, 1);
    assert.equal(cols.auth_mechanism, 'session');
    assert.equal(cols.db_backend, 'postgresql');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test B: Rails with HTTP basic auth (authenticate_or_request_with_http_basic)
// ---------------------------------------------------------------------------

describe('Ruby auth/db end-to-end — HTTP basic auth + mysql2 database.yml', () => {
  it('Test B: auth_mechanism non-null (http-basic), db_backend=mysql', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_RUBY_HTTPBASIC, 'ruby', null);
    const result = await extractAuthAndDb(ctx);

    assert.ok(result.auth_mechanism !== null,
      `auth_mechanism should be non-null for authenticate_or_request_with_http_basic, got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, 'mysql',
      `db_backend should be 'mysql' (from config/database.yml adapter: mysql2), got: ${result.db_backend}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test C: Rails with config/database.yml adapter: mysql2
// ---------------------------------------------------------------------------

describe('Ruby auth/db end-to-end — mysql2 adapter in database.yml', () => {
  it('Test C: db_backend=mysql from config/database.yml adapter: mysql2', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_RUBY_MYSQL, 'ruby', 'config/routes.rb');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.db_backend, 'mysql',
      `db_backend should be 'mysql' (adapter: mysql2 normalized to mysql), got: ${result.db_backend}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test D: config/database.yml adapter: sqlite3 is authoritative over pg gem in Gemfile
// ---------------------------------------------------------------------------

describe('Ruby auth/db end-to-end — database.yml authoritative over source signals', () => {
  it('Test D: adapter: sqlite3 in yml wins over pg gem in Gemfile -> db_backend=sqlite', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_RUBY_YML_AUTH, 'ruby', null);
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.db_backend, 'sqlite',
      `db_backend should be 'sqlite' (database.yml adapter: sqlite3 is authoritative over pg gem source signal), got: ${result.db_backend}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test E: Empty Ruby fixture — no signals -> both null
// ---------------------------------------------------------------------------

describe('Ruby auth/db end-to-end — empty fixture (no signals)', () => {
  it('Test E: empty Ruby fixture -> auth_mechanism=null, db_backend=null', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_RUBY_EMPTY, 'ruby', null);
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, null,
      `Expected null auth_mechanism for empty fixture, got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, null,
      `Expected null db_backend for empty fixture, got: ${result.db_backend}`);

    db.close();
  });
});
