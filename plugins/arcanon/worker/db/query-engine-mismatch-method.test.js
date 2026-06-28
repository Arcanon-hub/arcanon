/**
 * worker/db/query-engine-mismatch-method.test.js — Phase 134 / issue #46
 *
 * Pins the method-aware-matching fix for detectMismatches(). Pre-#46 the
 * exposed set was keyed on PATH ONLY, so a consumed POST /users/{_} silently
 * matched an exposed GET /users/{id}. These tests key on a normalized
 * (method, canonicalPath) composite with two null-method fallbacks that
 * preserve the pre-#46 path-only behavior (zero new false positives):
 *
 *   - M1 (MM-01, the fix): exposed only GET /users/{id}, consumed POST /users/{_}
 *                          → EXACTLY ONE mismatch (endpoint_not_exposed).
 *   - M2 (MM-01): exposed POST /users/{id}, consumed POST /users/{_} → ZERO.
 *   - M3 (MM-04, case-insensitive): exposed GET /things/{id}, consumed `get`
 *                                   /things/{_} → ZERO.
 *   - M4 (MM-02, null-consumed-method fallback): exposed GET /webhooks/{id},
 *        consumed method=null /webhooks/{_} → ZERO (path-only fallback). Contrast:
 *        null method on an unexposed path → EXACTLY ONE (fallback must not
 *        blanket-suppress real gaps).
 *   - M5 (MM-03, null-exposed-method wildcard): exposed method=null /agnostic/{id},
 *        consumed DELETE /agnostic/{_} → ZERO (method-agnostic exposure).
 *   - M6 (MM-05 + MM-01): base_path /api, exposed GET /orgs/{org_id}/members,
 *        consumed POST /api/orgs/{_}/members → EXACTLY ONE (strip succeeds but
 *        method differs). Sibling: consumed GET /api/orgs/{_}/members → ZERO.
 *
 * Fixture fidelity note (mirrors the #43 suite + production): connections.path
 * is inserted ALREADY {_}-blanked (persist-layer canonicalizePath) while
 * exposed_endpoints.path is inserted VERBATIM with named params. The raw-SQL
 * insert helpers below do NOT canonicalize — tests mirror production by hand.
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
// Method-aware mismatch detection (issue #46)
// ===========================================================================

describe('detectMismatches — method-aware matching (#46)', () => {
  it('M1 (MM-01, the fix): consumed POST /users/{_} vs exposed only GET /users/{id} → exactly one mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm1-user-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/users/{id}');
    insertConnection(db, aId, bId, 'rest', 'POST', '/users/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm1-user-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `POST vs only-GET must be flagged (the #46 fix), got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('M2 (MM-01): consumed POST /users/{_} vs exposed POST /users/{id} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm2-user-api', null);
    insertExposedEndpoint(db, bId, 'POST', '/users/{id}');
    insertConnection(db, aId, bId, 'rest', 'POST', '/users/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm2-user-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `matching method (POST/POST) must not be flagged, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('M3 (MM-04, case-insensitive): consumed get /things/{_} vs exposed GET /things/{id} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm3-things-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/things/{id}');
    insertConnection(db, aId, bId, 'rest', 'get', '/things/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm3-things-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `case-insensitive method (get == GET) must match, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('M4a (MM-02, null-consumed-method fallback): consumed method=null /webhooks/{_} vs exposed GET /webhooks/{id} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm4-webhook-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/webhooks/{id}');
    // method-less edge: must fall back to path-only matching (pre-#46 behavior).
    insertConnection(db, aId, bId, 'rest', null, '/webhooks/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm4-webhook-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `null consumed method must fall back to path-only (no new false positive), got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('M4b (MM-02 contrast): consumed method=null on an UNexposed path → exactly one mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm4b-webhook-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/webhooks/{id}');
    // null method, but the path is genuinely not exposed — fallback must NOT suppress this.
    insertConnection(db, aId, bId, 'rest', null, '/missing/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm4b-webhook-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `null-method path-only fallback must still flag a genuinely absent path, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('M5 (MM-03, null-exposed-method wildcard): exposed method=null /agnostic/{id} vs consumed DELETE /agnostic/{_} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm5-agnostic-api', null);
    insertExposedEndpoint(db, bId, null, '/agnostic/{id}');
    insertConnection(db, aId, bId, 'rest', 'DELETE', '/agnostic/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm5-agnostic-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `null exposed method must match any consumed verb (method-agnostic exposure), got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('M6a (MM-05 + MM-01): base_path /api, exposed GET /orgs/{org_id}/members, consumed POST /api/orgs/{_}/members → exactly one mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm6-prefixed-api', '/api');
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    // base_path strip succeeds (/api/orgs → /orgs) but the method differs → still flagged.
    insertConnection(db, aId, bId, 'rest', 'POST', '/api/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm6-prefixed-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `strip succeeds but wrong method must still flag, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('M6b (MM-05): base_path /api, exposed GET /orgs/{org_id}/members, consumed GET /api/orgs/{_}/members → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'm6b-prefixed-api', '/api');
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'm6b-prefixed-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `strip + canonicalize + method all align → no mismatch, got: ${JSON.stringify(forThisConn)}`
    );
  });
});

// ===========================================================================
// Method-aware mismatch detection — hardening (#46 cross-AI review, 134-02)
// ===========================================================================
//
// Robustness-only edges from 134-REVIEWS.md. Behavior for conventional HTTP
// data is already correct (134-01, M1–M6b); these pin the malformed-input and
// null/empty-method corners the review flagged:
//
//   - H1  (MM-06, collision-safe key): a space-containing malformed method must
//         not forge a match via the old `${method} ${path}` join.
//   - H2/H2c (MM-07, empty/whitespace method): "" and "   " normalize to null
//         (unknown) → path-only fallback (and still flag a genuinely absent path).
//   - H3  (MM-09, both methods null): matches by canonical path.
//   - H4/H4b (MM-09, null + concrete co-exposure): null wildcard wins for any verb.
//   - H5/H5b (MM-09, null fallback + base_path): null consumed → path-only AFTER
//         base_path strip (and still flag a stripped-but-absent path).
describe('detectMismatches — method-aware hardening (#46 review)', () => {
  it('H1 (MM-06, collision-safe key): exposed GET "/A /B" vs consumed "GET /A" "/B" → exactly one mismatch (no forged match)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h1-collision-api', null);
    // Exposed: method "GET", canonical path "/A /B" (internal space survives
    // canonicalizePath, which only collapses {param} → {_}). Uppercase path so
    // the malformed-method toUpperCase() on the consumed side cannot diverge by
    // case — isolating the JOIN-CHARACTER collision the review flagged.
    insertExposedEndpoint(db, bId, 'GET', '/A /B');
    // Consumed: malformed method "GET /A" on path "/B". Pre-fix the space-joined
    // key produced "GET /A /B" for BOTH sides → false match (ZERO). The
    // collision-safe representation keeps them distinct → EXACTLY ONE mismatch.
    insertConnection(db, aId, bId, 'rest', 'GET /A', '/B');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h1-collision-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `space-containing method must not forge a match for a different (method,path) pair, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('H1b (MM-06 round-2, control-char forge): exposed GET "/A\\u0001/B" vs consumed "GET\\u0001/A" "/B" → exactly one mismatch (nested Map is collision-proof)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h1b-ctrlchar-api', null);
    // The #46 round-2 review showed U+0001 is NOT a safe delimiter: it is valid
    // in untrusted scan JSON, survives trim(), and SQLite stores it in TEXT. With
    // the old `${method}${path}` join BOTH sides collapse to
    // "GET/A/B" → forged false match (ZERO mismatches). The nested
    // Map<method, Set<path>> has no concatenation, so the two distinct
    // (method,path) pairs cannot collide → EXACTLY ONE mismatch.
    insertExposedEndpoint(db, bId, 'GET', '/A/B');
    insertConnection(db, aId, bId, 'rest', 'GET/A', '/B');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h1b-ctrlchar-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `U+0001 in untrusted method/path must not forge a match, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('H2 (MM-07, empty-string method): consumed "" /e/{_} vs exposed GET /e/{id} → no mismatch (empty → null → path-only)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h2-empty-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/e/{id}');
    insertConnection(db, aId, bId, 'rest', '', '/e/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h2-empty-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `empty-string method must normalize to null and take the path-only fallback, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('H2b (MM-07 contrast): consumed "" on an UNexposed path /missing/{_} → exactly one mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h2b-empty-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/e/{id}');
    insertConnection(db, aId, bId, 'rest', '', '/missing/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h2b-empty-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `empty-method path-only fallback must still flag a genuinely absent path, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('H2c (MM-07, whitespace-only method): consumed "   " /e/{_} vs exposed GET /e/{id} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h2c-ws-api', null);
    insertExposedEndpoint(db, bId, 'GET', '/e/{id}');
    insertConnection(db, aId, bId, 'rest', '   ', '/e/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h2c-ws-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `whitespace-only method must normalize to null and take the path-only fallback, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('H3 (MM-09, both methods null): exposed null /both/{id} vs consumed null /both/{_} → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h3-bothnull-api', null);
    insertExposedEndpoint(db, bId, null, '/both/{id}');
    insertConnection(db, aId, bId, 'rest', null, '/both/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h3-bothnull-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `both methods null must match by canonical path, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('H4 (MM-09, null + concrete co-exposure): exposed (null, POST) on /co/{id}; consumed DELETE /co/{_} → no mismatch (null wildcard wins)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h4-coexpose-api', null);
    // Two exposed rows on the SAME canonical path: a null wildcard + a concrete POST.
    insertExposedEndpoint(db, bId, null, '/co/{id}');
    insertExposedEndpoint(db, bId, 'POST', '/co/{id}');
    insertConnection(db, aId, bId, 'rest', 'DELETE', '/co/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h4-coexpose-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `null wildcard co-exposed with concrete POST must still match DELETE, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('H4b (MM-09, null + concrete co-exposure): consumed GET /co/{_} → no mismatch (concrete POST present but null wildcard matches GET)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h4b-coexpose-api', null);
    insertExposedEndpoint(db, bId, null, '/co/{id}');
    insertExposedEndpoint(db, bId, 'POST', '/co/{id}');
    insertConnection(db, aId, bId, 'rest', 'GET', '/co/{_}');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h4b-coexpose-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `null wildcard must match GET even with a concrete POST co-exposed, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('H5 (MM-09, null fallback + base_path): base_path /api, exposed GET /orgs/{org_id}/members, consumed null /api/orgs/{_}/members → no mismatch', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h5-prefixed-api', '/api');
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    // null consumed method → path-only fallback, applied AFTER base_path strip.
    insertConnection(db, aId, bId, 'rest', null, '/api/orgs/{_}/members');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h5-prefixed-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `null consumed method + base_path strip must match by path, got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('H5b (MM-09 contrast): base_path /api, consumed null /api/orgs/{_}/missing → exactly one mismatch (stripped path genuinely absent)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'h5b-prefixed-api', '/api');
    insertExposedEndpoint(db, bId, 'GET', '/orgs/{org_id}/members');
    insertConnection(db, aId, bId, 'rest', null, '/api/orgs/{_}/missing');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'h5b-prefixed-api'
    );
    assert.equal(
      forThisConn.length,
      1,
      `null-method fallback after strip must still flag a genuinely absent path, got: ${JSON.stringify(forThisConn)}`
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });
});
