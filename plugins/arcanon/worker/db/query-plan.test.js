/**
 * worker/db/query-plan.test.js
 *
 * PERF-03: EXPLAIN QUERY PLAN tests proving that the three indexes added by
 * migration 024 are used by the SQLite query planner on a realistic fixture.
 *
 * SQLite legitimately prefers full-table scans on tiny tables (< ~10 rows)
 * because the index B-tree overhead exceeds the scan cost. This fixture inserts
 * 110 connections and 60 services to cross the optimizer's threshold.
 *
 * Selectivity rationale:
 *   - 5 scan_version_ids × 22 connections per bucket → ~20% selectivity
 *   - 5 scan_version_ids × 12 services per bucket   → ~20% selectivity
 *   - 60 unique target_service_ids across 110 connections → varied
 * At 20% selectivity, SQLite's unanalyzed-table heuristics reliably prefer
 * the index over a full scan.
 *
 * Run: node --test worker/db/query-plan.test.js
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from './sqlite-adapter.js';
import { runMigrations } from './database.js';

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated in-memory database (all 024 migrations)
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Fixture
//
// Inserts: 1 repo, 5 scan_versions, 60 services, 110 connections.
//
// 60 services is the minimum needed for the services index test to be reliable:
// SQLite's query planner switches from full-scan to index-seek at roughly 8–10
// rows for unanalyzed tables; 60 rows gives comfortable headroom. Connections
// uses 110 rows for the same reason.
//
// Paths are unique per connection row (/route/0 … /route/109) so the
// uq_connections_dedup unique index on (source_service_id, target_service_id,
// protocol, method, path) is never violated.
// ---------------------------------------------------------------------------

function insertFixture(db) {
  // 1 repo
  const repoId = db.prepare(
    "INSERT INTO repos (path, name, type) VALUES (?, ?, ?)"
  ).run('/perf-test-repo', 'perf-test-repo', 'single').lastInsertRowid;

  // 5 scan_versions so scan_version_id predicates are selective (~20%)
  const svStmt = db.prepare(
    "INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)"
  );
  const svIds = [];
  for (let i = 0; i < 5; i++) {
    const id = svStmt.run(repoId, `2026-01-0${i + 1}T00:00:00.000Z`).lastInsertRowid;
    svIds.push(id);
  }

  // 60 services — 12 per scan_version_id bucket
  const svcStmt = db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language, scan_version_id) VALUES (?, ?, ?, ?, ?)"
  );
  const svcIds = [];
  for (let i = 0; i < 60; i++) {
    const id = svcStmt.run(
      repoId,
      `svc-${i}`,
      `/svc-${i}`,
      'js',
      svIds[i % 5]   // 12 services per scan_version_id
    ).lastInsertRowid;
    svcIds.push(id);
  }

  // 110 connections — varied target_service_id and scan_version_id
  const connStmt = db.prepare(
    "INSERT INTO connections (source_service_id, target_service_id, protocol, path, scan_version_id) VALUES (?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < 110; i++) {
    connStmt.run(
      svcIds[i % 60],          // varied source
      svcIds[(i + 1) % 60],    // varied target (~22 connections per target bucket)
      'http',
      `/route/${i}`,            // unique path — avoids uq_connections_dedup conflicts
      svIds[i % 5]              // varied scan_version_id (~22 per bucket)
    );
  }

  return { repoId, svIds, svcIds };
}

// ---------------------------------------------------------------------------
// EXPLAIN QUERY PLAN helper
// ---------------------------------------------------------------------------

/**
 * Runs EXPLAIN QUERY PLAN for the given SQL and asserts that at least one row
 * in the plan output has a `detail` containing indexName.
 *
 * On failure, the assertion message includes the full plan detail so that a
 * regression (e.g. a dropped index causing a full scan) is immediately legible.
 *
 * @param {import('./sqlite-adapter.js').default} db
 * @param {string} sql        SQL query (without the EXPLAIN QUERY PLAN prefix)
 * @param {Array}  params     Positional parameters for the SQL
 * @param {string} indexName  Expected substring in a plan row's `detail`
 */
function assertUsesIndex(db, sql, params, indexName) {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
  const detail = plan.map(r => r.detail).join('\n');
  assert.ok(
    plan.some(r => r.detail.includes(indexName)),
    `Expected index '${indexName}' in query plan but got:\n${detail}`
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PERF-03: EXPLAIN QUERY PLAN index coverage (migration 024)', () => {
  test('upstream-impact CTE uses idx_connections_target_service_id', () => {
    const db = makeDb();
    const { svcIds } = insertFixture(db);

    // This mirrors _stmtUpstream in query-engine.js and the detectMismatches
    // connection query — both filter on target_service_id.
    assertUsesIndex(
      db,
      'SELECT source_service_id FROM connections WHERE target_service_id = ?',
      [svcIds[0]],
      'idx_connections_target_service_id'
    );
  });

  test('scan-version filter on connections uses idx_connections_scan_version_id', () => {
    const db = makeDb();
    const { svIds } = insertFixture(db);

    // Mirrors the endScan quality query and verify route at http.js:476-509.
    assertUsesIndex(
      db,
      'SELECT id FROM connections WHERE scan_version_id = ?',
      [svIds[0]],
      'idx_connections_scan_version_id'
    );
  });

  test('scan-version filter on services uses idx_services_scan_version_id', () => {
    const db = makeDb();
    const { svIds } = insertFixture(db);

    // Mirrors the endScan stale-row DELETE and quality breakdown at
    // query-engine.js:1484-1520.
    assertUsesIndex(
      db,
      'SELECT id FROM services WHERE scan_version_id = ?',
      [svIds[0]],
      'idx_services_scan_version_id'
    );
  });
});
