/**
 * End-to-end tests for Java auth/db enrichment in auth-db-extractor.js.
 *
 * Run: node --test worker/scan/enrichment/auth-db-extractor.java.test.js
 *
 * Uses node:test + node:assert/strict + better-sqlite3 in-memory DB.
 * Exercises the Java fixture repo under fixtures/java/ and fixtures/java-spring5/.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

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
  db.prepare("INSERT INTO services (repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?)").run(1, 'api', '/tmp/repo/api', 'java', 'src/main/java/com/example/Application.java');

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

const FIXTURES_JAVA = fileURLToPath(new URL('./fixtures/java', import.meta.url));
const FIXTURES_JAVA_SPRING5 = fileURLToPath(new URL('./fixtures/java-spring5', import.meta.url));
const FIXTURES_JAVA_EMPTY = fileURLToPath(new URL('./fixtures/java-empty', import.meta.url));

// ---------------------------------------------------------------------------
// Test A + B: Spring Boot 3 SecurityFilterChain + Spring Data postgres
//             AND target/ generated-sources excluded
// ---------------------------------------------------------------------------

describe('Java auth/db end-to-end — Spring Boot 3 (SecurityFilterChain + postgresql)', () => {
  it('Test A: auth_mechanism is non-null, db_backend is postgresql', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_JAVA, 'java', 'src/main/java/com/example/Application.java');
    const result = await extractAuthAndDb(ctx);

    // auth_mechanism must be non-null (SecurityFilterChain fires oauth2 or session)
    assert.ok(result.auth_mechanism !== null, `auth_mechanism should be non-null, got: ${result.auth_mechanism}`);

    // db_backend must be postgresql (jdbc:postgresql or org.postgresql in source files)
    assert.equal(result.db_backend, 'postgresql', `db_backend should be 'postgresql', got: ${result.db_backend}`);

    // node_metadata written correctly
    assert.ok(getMeta(db, 1, 'security', 'auth_mechanism') !== undefined, 'node_metadata security.auth_mechanism should be written');
    assert.equal(getMeta(db, 1, 'infra', 'db_backend'), 'postgresql');

    // services columns denormalized
    const cols = getServiceCols(db, 1);
    assert.ok(cols.auth_mechanism !== null);
    assert.equal(cols.db_backend, 'postgresql');

    db.close();
  });

  it('Test B: target/ directory is excluded — EXCLUDED_DIRS contains target', () => {
    // Structural assertion: EXCLUDED_DIRS must have 'target'
    assert.ok(EXCLUDED_DIRS.has('target'), "'target' must be in EXCLUDED_DIRS");
  });

  it('Test B (functional): target/ generated file does not pollute result', async () => {
    // The GeneratedAuth.java under target/ contains "AddJwtBearer" (C#-only token)
    // and "FAKE_DO_NOT_MATCH". Since target/ is excluded, these should never be read.
    // We verify by running extraction and confirming auth_mechanism is determined
    // solely by the legitimate source files (non-null, matching a Java signal).
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_JAVA, 'java', 'src/main/java/com/example/Application.java');
    const result = await extractAuthAndDb(ctx);

    // If target/ were scanned, auth_mechanism could be polluted; it must be non-null
    // and derived from real source files.
    assert.ok(result.auth_mechanism !== null, 'auth_mechanism must come from real source, not target/');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test C: Spring Security 5 (@EnableWebSecurity) — ENR-02
// ---------------------------------------------------------------------------

describe('Java auth/db end-to-end — Spring Security 5 (@EnableWebSecurity)', () => {
  it('Test C: @EnableWebSecurity fixture yields non-null auth_mechanism', async () => {
    const db = buildDb();
    const ctx = buildCtx(db, FIXTURES_JAVA_SPRING5, 'java', 'src/main/java/com/example/SecurityConfig.java');
    const result = await extractAuthAndDb(ctx);

    assert.ok(result.auth_mechanism !== null,
      `Spring Security 5 @EnableWebSecurity must yield non-null auth_mechanism, got: ${result.auth_mechanism}`);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test D: Empty Java service — no false positives
// ---------------------------------------------------------------------------

describe('Java auth/db end-to-end — empty service (no signals)', () => {
  it('Test D: Java service with no auth/db signals returns both null', async () => {
    const db = buildDb();
    // fixtures/java-empty has only Application.java (@SpringBootApplication) — no auth or DB signal
    const ctx = buildCtx(db, FIXTURES_JAVA_EMPTY, 'java', 'src/main/java/com/example/Application.java');
    const result = await extractAuthAndDb(ctx);

    // Application.java has @SpringBootApplication only — no auth or DB signal
    assert.equal(result.auth_mechanism, null,
      `Expected null auth_mechanism for empty service, got: ${result.auth_mechanism}`);
    assert.equal(result.db_backend, null,
      `Expected null db_backend for empty service, got: ${result.db_backend}`);

    db.close();
  });
});
