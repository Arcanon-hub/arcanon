/**
 * End-to-end tests for C# auth/db enrichment in auth-db-extractor.js.
 *
 * Run: node --test worker/scan/enrichment/auth-db-extractor.csharp.test.js
 *
 * Uses node:test + node:assert/strict + better-sqlite3 in-memory DB.
 * Exercises C# fixture repos under fixtures/csharp*, fixtures/csharp-identity,
 * fixtures/csharp-empty, and fixtures/csharp-bare.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from '../../db/sqlite-adapter.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { extractAuthAndDb, EXCLUDED_DIRS } from './auth-db-extractor.js';

// ---------------------------------------------------------------------------
// Helpers — copied verbatim from auth-db-extractor.test.js lines 23-85
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
      boundary_entry TEXT,
      auth_mechanism TEXT,
      db_backend     TEXT
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
  db.prepare("INSERT INTO services (repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?)").run(1, 'api', '/tmp/repo/api', 'csharp', 'Program.cs');

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

const FIXTURES_CSHARP          = fileURLToPath(new URL('./fixtures/csharp', import.meta.url));
const FIXTURES_CSHARP_IDENTITY = fileURLToPath(new URL('./fixtures/csharp-identity', import.meta.url));
const FIXTURES_CSHARP_EMPTY    = fileURLToPath(new URL('./fixtures/csharp-empty', import.meta.url));
const FIXTURES_CSHARP_BARE     = fileURLToPath(new URL('./fixtures/csharp-bare', import.meta.url));

// ---------------------------------------------------------------------------
// Test A: ASP.NET Core minimal API with EF Core + JWT
// ---------------------------------------------------------------------------

describe('C# auth/db end-to-end — minimal API + EF Core (JWT + PostgreSQL)', () => {
  it('Test A: auth_mechanism=jwt, db_backend=postgresql', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_CSHARP, 'csharp', 'Program.cs');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'jwt',
      `auth_mechanism should be 'jwt', got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, 'postgresql',
      `db_backend should be 'postgresql', got: ${result.db_backend}`);

    // node_metadata written correctly
    assert.equal(getMeta(db, 1, 'security', 'auth_mechanism'), 'jwt');
    assert.equal(getMeta(db, 1, 'infra', 'db_backend'), 'postgresql');

    // services columns denormalized
    const cols = getServiceCols(db, 1);
    assert.equal(cols.auth_mechanism, 'jwt');
    assert.equal(cols.db_backend, 'postgresql');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test B: ASP.NET Core Identity session auth
// ---------------------------------------------------------------------------

describe('C# auth/db end-to-end — ASP.NET Core Identity (session)', () => {
  it('Test B: auth_mechanism=session for AddDefaultIdentity fixture', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_CSHARP_IDENTITY, 'csharp', 'Program.cs');
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'session',
      `auth_mechanism should be 'session', got: ${result.auth_mechanism}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test C: obj/ and bin/ dirs are excluded
// ---------------------------------------------------------------------------

describe('C# auth/db end-to-end — obj/ and bin/ exclusion', () => {
  it('Test C: EXCLUDED_DIRS contains obj and bin', () => {
    assert.ok(EXCLUDED_DIRS.has('obj'), "'obj' must be in EXCLUDED_DIRS");
    assert.ok(EXCLUDED_DIRS.has('bin'), "'bin' must be in EXCLUDED_DIRS");
  });

  it('Test C (functional): obj/-only fixture yields auth_mechanism=null', async () => {
    // fixtures/csharp-empty/ has NO .cs files at root level — only obj/Debug/Fake.cs
    // containing AddJwtBearer. If obj/ is excluded, auth_mechanism must be null.
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_CSHARP_EMPTY, 'csharp', null);
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, null,
      `auth_mechanism must be null (obj/ should be excluded), got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, null,
      `db_backend must be null for empty fixture, got: ${result.db_backend}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test D: [Authorize] attribute alone — controllers-only pattern
// ---------------------------------------------------------------------------

describe('C# auth/db end-to-end — [Authorize] attribute only (no Program.cs)', () => {
  let tmpRepo;

  before(() => {
    // Create a temp copy containing ONLY Controllers/ to test that [Authorize]
    // alone fires auth_mechanism='session'.
    tmpRepo = join(tmpdir(), `arcanon-test-csharp-authorize-${Date.now()}`);
    mkdirSync(join(tmpRepo, 'Controllers'), { recursive: true });
    cpSync(
      join(FIXTURES_CSHARP, 'Controllers', 'UsersController.cs'),
      join(tmpRepo, 'Controllers', 'UsersController.cs'),
    );
  });

  after(() => {
    if (tmpRepo && existsSync(tmpRepo)) {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it('Test D: [Authorize] attribute yields auth_mechanism=session', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, tmpRepo, 'csharp', null);
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, 'session',
      `[Authorize] alone should yield auth_mechanism='session', got: ${result.auth_mechanism}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test E: Empty C# fixture — no false positives
// ---------------------------------------------------------------------------

describe('C# auth/db end-to-end — bare fixture (no signals)', () => {
  it('Test E: SomeFile.cs with only class declaration — both null', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_CSHARP_BARE, 'csharp', null);
    const result = await extractAuthAndDb(ctx);

    assert.equal(result.auth_mechanism, null,
      `Expected null auth_mechanism for bare fixture, got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, null,
      `Expected null db_backend for bare fixture, got: ${result.db_backend}`);

    db.close();
  });
});
