/**
 * worker/db/query-engine-mismatch-params.test.js — Phase 132 / issue #43
 *
 * Pins the parameterized-route fix for detectMismatches():
 *   - Test 1: parameterized-route match (core #43) — consumed /orgs/{_}/members
 *             against exposed /orgs/{org_id}/members → ZERO mismatches.
 *   - Test 2: param-name drift — consumed {orgId} (blanked to {_}) vs exposed
 *             {org_id} both collapse to {_} → ZERO mismatches.
 *   - Test 3: multi-param route — /orgs/{_}/repos/{_} vs /orgs/{org_id}/repos/{repo_id}
 *             → ZERO mismatches.
 *   - Test 4: events protocol SKIPPED — a nats/events connection is never checked
 *             against HTTP exposed_endpoints → ZERO mismatches.
 *   - Test 5: grpc protocol IS checked — an unexposed grpc path → EXACTLY ONE mismatch.
 *   - Test 6: genuine rest mismatch still flagged — a real unexposed parameterized
 *             route → EXACTLY ONE mismatch (no false negative from canonicalization).
 *   - Test 7: base_path + parameter interaction — /api/orgs/{_}/members vs exposed
 *             /orgs/{org_id}/members with target base_path /api → ZERO mismatches.
 *
 * Fixture fidelity note: production stores connections.path ALREADY {_}-blanked
 * (persist-layer canonicalizePath) but stores exposed_endpoints.path VERBATIM with
 * named params. The raw-SQL insert helpers below do NOT canonicalize, so these tests
 * mirror production by hand: CONNECTION paths are inserted pre-blanked ({_}) and
 * EXPOSED paths with named params.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from './sqlite-adapter.js';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up002 } from './migrations/002_service_type.js';
import { up as up003 } from './migrations/003_exposed_endpoints.js';
import { up as up004 } from './migrations/004_dedup_constraints.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up006 } from './migrations/006_dedup_repos.js';
import { up as up007 } from './migrations/007_expose_kind.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { up as up010 } from './migrations/010_service_dependencies.js';
import { up as up011 } from './migrations/011_services_boundary_entry.js';
import { up as up013 } from './migrations/013_connections_path_template.js';
import { up as up014 } from './migrations/014_services_base_path.js';
import { QueryEngine } from './query-engine.js';

/** Apply migrations 001..011 (pre-014 baseline — no base_path column) */
function applyMigrationsThrough011(db) {
  up001(db);
  up002(db);
  up003(db);
  up004(db);
  up005(db);
  up006(db);
  up007(db);
  up008(db);
  up009(db);
  up010(db);
  up011(db);
}

/** Apply all migrations through 014 (current head) */
function applyAllMigrations(db) {
  applyMigrationsThrough011(db);
  up013(db);
  up014(db);
}

/** Returns a fresh in-memory db at full migration head + a seeded repo */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

/** Inserts a service via SQL directly (bypasses upsert) — for setting up
 *  resolution-test fixtures with arbitrary base_path values. */
function insertService(db, repoId, name, basePath) {
  const stmt = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, base_path)
     VALUES (?, ?, '/tmp/r', 'js', 'service', ?)`
  );
  return stmt.run(repoId, name, basePath ?? null).lastInsertRowid;
}

/** Inserts an exposed endpoint VERBATIM (no canonicalization — mirrors persist). */
function insertExposedEndpoint(db, serviceId, method, pathStr) {
  const stmt = db.prepare(
    `INSERT INTO exposed_endpoints (service_id, method, path) VALUES (?, ?, ?)`
  );
  return stmt.run(serviceId, method, pathStr).lastInsertRowid;
}

/** Inserts a connection VERBATIM (no canonicalization). Tests pass paths
 *  pre-blanked with {_} to mirror what the persist layer stores. */
function insertConnection(db, srcId, tgtId, protocol, method, pathStr) {
  const stmt = db.prepare(
    `INSERT INTO connections (source_service_id, target_service_id, protocol, method, path)
     VALUES (?, ?, ?, ?, ?)`
  );
  return stmt.run(srcId, tgtId, protocol, method, pathStr).lastInsertRowid;
}

// ===========================================================================
// Parameterized-route match + protocol allowlist (issue #43)
// ===========================================================================

describe('detectMismatches — parameterized routes (#43)', () => {
  it('Test 1: parameterized-route match — consumed /orgs/{_}/members vs exposed /orgs/{org_id}/members → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'user-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    insertConnection(db, aId, bId, 'rest', 'GET', '/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'user-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `expected no mismatch but got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('Test 2: param-name drift — consumed {orgId}→{_} vs exposed {org_id} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'user-api-drift', null);
    // Consumer used {orgId}, which the persist layer collapses to {_}.
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    insertConnection(db, aId, bId, 'rest', 'GET', '/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'user-api-drift'
    );
    assert.equal(
      forThisConn.length,
      0,
      `expected no mismatch but got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('Test 3: multi-param route — /orgs/{_}/repos/{_} vs /orgs/{org_id}/repos/{repo_id} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'repo-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/repos/{repo_id}');
    insertConnection(db, aId, bId, 'rest', 'GET', '/orgs/{_}/repos/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'repo-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `expected no mismatch but got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('Test 4: events protocol SKIPPED — a nats/events connection is never flagged', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'event-bus', null);
    // Target exposes only an HTTP endpoint, and does NOT expose the connection path.
    insertExposedEndpoint(db, bId, 'GET', '/health');
    // events is the canonical bucket for nats/kafka — must be skipped.
    insertConnection(db, aId, bId, 'events', null, '/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'event-bus'
    );
    assert.equal(
      forThisConn.length,
      0,
      `events connection must be skipped, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('Test 5: grpc protocol IS checked — an unexposed grpc path → exactly one mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'grpc-api', null);
    insertExposedEndpoint(db, bId, 'POST', '/pkg.Service/Method');
    // Connection calls a grpc path the target does NOT expose.
    insertConnection(db, aId, bId, 'grpc', 'POST', '/pkg.Service/Other');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'grpc-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `expected exactly one grpc mismatch, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('Test 6: genuine rest mismatch still flagged — unexposed parameterized route → one mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'partial-api', null);
    // Target exposes /users, but the consumer calls a parameterized route it does NOT expose.
    insertExposedEndpoint(db, bId, 'GET', '/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'partial-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `canonicalization must not mask a true gap, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('Test 7: base_path + parameter — /api/orgs/{_}/members vs exposed /orgs/{org_id}/members (base_path /api) → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'prefixed-api', '/api');
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'prefixed-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `stripBasePath + canonicalize must match, got: ${JSON.stringify(forThisConn)}`
    );
  });
});
