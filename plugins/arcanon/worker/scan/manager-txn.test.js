/**
 * worker/scan/manager-txn.test.js — End-to-end scan atomicity proofs (ISO-03 / ISO-10)
 *
 * Drives the REAL scanRepos() path with a real fully-migrated in-memory
 * QueryEngine and real temp git repos (no mocking of the transaction wrapper
 * or QueryEngine internals beyond the single injected failure point).
 *
 * Three scenarios:
 *
 *   1. ISO-03 happy path — a successful scan produces a completed scan_versions
 *      row (completed_at NOT NULL) and persisted services.
 *
 *   2. ISO-03 / ISO-10 rollback — a forced throw inside the write transaction
 *      (at endScan, so beginScan + persistFindings already ran) rolls back ALL
 *      writes including the scan_versions INSERT. Prior data is intact, no
 *      orphaned NULL-completed scan_versions row exists, and scanRepos resolves
 *      rather than rejects (per-repo catch handles the error).
 *
 *   3. Per-repo isolation (§Q7 Pitfall 6) — repo A's write failure does not
 *      prevent repo B from committing its scan. The result array contains an
 *      error entry for repo A and a success entry for repo B; repo B has a
 *      completed scan_versions row and its service is persisted; repo A has
 *      neither.
 *
 * Run: node --test plugins/arcanon/worker/scan/manager-txn.test.js
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from '../db/sqlite-adapter.js';
import { QueryEngine } from '../db/query-engine.js';
import { scanRepos, setAgentRunner, setScanLogger } from './manager.js';

// All 20 migrations (skipping 012 which was reverted).
import { up as up001 } from '../db/migrations/001_initial_schema.js';
import { up as up002 } from '../db/migrations/002_service_type.js';
import { up as up003 } from '../db/migrations/003_exposed_endpoints.js';
import { up as up004 } from '../db/migrations/004_dedup_constraints.js';
import { up as up005 } from '../db/migrations/005_scan_versions.js';
import { up as up006 } from '../db/migrations/006_dedup_repos.js';
import { up as up007 } from '../db/migrations/007_expose_kind.js';
import { up as up008 } from '../db/migrations/008_actors_metadata.js';
import { up as up009 } from '../db/migrations/009_confidence_enrichment.js';
import { up as up010 } from '../db/migrations/010_service_dependencies.js';
import { up as up011 } from '../db/migrations/011_services_boundary_entry.js';
import { up as up013 } from '../db/migrations/013_connections_path_template.js';
import { up as up014 } from '../db/migrations/014_services_base_path.js';
import { up as up015 } from '../db/migrations/015_scan_versions_quality_score.js';
import { up as up016 } from '../db/migrations/016_enrichment_log.js';
import { up as up017 } from '../db/migrations/017_scan_overrides.js';
import { up as up018 } from '../db/migrations/018_actors_label.js';
import { up as up019 } from '../db/migrations/019_connections_protocol_raw.js';
import { up as up020 } from '../db/migrations/020_actor_connections_protocol_raw.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyAllMigrations(db) {
  up001(db); up002(db); up003(db); up004(db); up005(db); up006(db);
  up007(db); up008(db); up009(db); up010(db); up011(db); up013(db);
  up014(db); up015(db); up016(db); up017(db); up018(db); up019(db); up020(db);
}

/** Build a fresh fully-migrated in-memory database. */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  return db;
}

/**
 * Create a temp git repo with a single commit and return its absolute path.
 * The initial commit ensures a non-empty HEAD so buildScanContext can
 * compute last_scanned_commit.
 */
function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'arcanon-txn-test-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
  execSync('git add index.js', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function cleanupDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/** Discovery agent response — minimal valid JSON for the discovery pass. */
const MINIMAL_DISCOVERY =
  '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';

/** Build a fenced-JSON deep-scan response for a service named `svcName`. */
function makeFindings(svcName) {
  return '```json\n' + JSON.stringify({
    service_name: svcName,
    confidence: 'high',
    services: [
      { name: svcName, root_path: '.', language: 'javascript', confidence: 'high' },
    ],
    connections: [],
    schemas: [],
  }) + '\n```';
}

/**
 * Build a standard agentRunner that returns MINIMAL_DISCOVERY for discovery
 * calls and makeFindings(svcName) for deep-scan calls.
 * `repoFindingsMap` is a Map<repoPath, svcName> for per-repo customisation.
 * If a single svcName string is given, all repos return the same findings.
 */
function makeAgentRunner(repoFindingsMapOrName) {
  const isString = typeof repoFindingsMapOrName === 'string';
  return async (prompt, repoPath) => {
    if (
      prompt.includes('Discovery Agent') ||
      prompt.includes('structure discovery') ||
      prompt.includes('DISCOVERY_JSON') === false && prompt.length < 500
    ) {
      // Discovery call heuristic: discovery prompts contain 'Discovery Agent'
      // or 'structure discovery'; they are short relative to deep-scan prompts.
      // Fall through if neither matches (safe default: return discovery JSON).
    }
    // Reliable discriminator: discovery prompts mention 'Discovery Agent'
    if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
      return MINIMAL_DISCOVERY;
    }
    // Deep scan prompt
    const svcName = isString
      ? repoFindingsMapOrName
      : (repoFindingsMapOrName.get(repoPath) ?? 'unknown-svc');
    return makeFindings(svcName);
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: ISO-03 happy path
// ---------------------------------------------------------------------------

describe('ISO-03 happy path: successful scan persists atomically', () => {
  let repoDir;
  let db;

  beforeEach(() => {
    repoDir = makeTempRepo();
    db = freshDb();
    setScanLogger(null);
  });

  afterEach(() => {
    try { db.close(); } catch (_) {}
    cleanupDir(repoDir);
    setAgentRunner(null);
  });

  test('completed scan has completed_at NOT NULL and persisted service', async () => {
    const qe = new QueryEngine(db);
    setAgentRunner(makeAgentRunner('happy-svc'));

    const results = await scanRepos([repoDir], { skipHubSync: true }, qe);

    assert.equal(results.length, 1, 'must have one result');
    assert.ok(!results[0].error, `scan must not error; got: ${results[0].error}`);
    assert.equal(results[0].mode, 'full');

    // scan_versions row must exist and be completed (ISO-04: completed_at non-NULL)
    const svRow = db.prepare(
      'SELECT completed_at FROM scan_versions ORDER BY id DESC LIMIT 1'
    ).get();
    assert.ok(svRow, 'scan_versions row must exist after successful scan');
    assert.ok(svRow.completed_at,
      'completed_at must be non-NULL — scan is visible as complete (ISO-04)');

    // The service must be persisted in the services table
    const svcRow = db.prepare("SELECT name FROM services WHERE name = 'happy-svc'").get();
    assert.ok(svcRow, 'service "happy-svc" must be persisted in services table');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: ISO-03 / ISO-10 rollback — forced write failure
// ---------------------------------------------------------------------------

describe('ISO-03 / ISO-10: forced write failure rolls back entire scan transaction', () => {
  let repoDir;
  let db;

  beforeEach(() => {
    repoDir = makeTempRepo();
    db = freshDb();
    setScanLogger(null);
  });

  afterEach(() => {
    try { db.close(); } catch (_) {}
    cleanupDir(repoDir);
    setAgentRunner(null);
  });

  test(
    'after forced endScan throw: prior data intact, no orphaned scan_versions row, ' +
    'scanRepos resolves with error result (not rejects)',
    async () => {
      const qe = new QueryEngine(db);

      // --- Prior successful scan: establishes a committed baseline ---
      setAgentRunner(makeAgentRunner('prior-svc'));
      const priorResults = await scanRepos([repoDir], { skipHubSync: true, full: true }, qe);
      assert.equal(priorResults.length, 1, 'prior scan must return one result');
      assert.ok(!priorResults[0].error, `prior scan must succeed; got: ${priorResults[0].error}`);

      // Capture prior state for comparison
      const priorSvCount = db.prepare(
        'SELECT COUNT(*) AS n FROM scan_versions WHERE completed_at IS NOT NULL'
      ).get().n;
      assert.ok(priorSvCount >= 1, 'prior scan must have produced at least one completed sv row');

      const priorSvcRow = db.prepare("SELECT id FROM services WHERE name = 'prior-svc'").get();
      assert.ok(priorSvcRow, '"prior-svc" must be present before rollback test');
      const priorSvcId = priorSvcRow.id;

      // --- Inject failure: override endScan to run all cleanup then throw ---
      // The throw fires INSIDE the write transaction. SQLite adapter issues ROLLBACK.
      // beginScan's scan_versions INSERT + persistFindings are in the same transaction
      // → both are rolled back (ISO-03 + ISO-10).
      const realEndScan = qe.endScan.bind(qe);
      let endScanCallCount = 0;
      qe.endScan = (repoId, scanVersionId) => {
        endScanCallCount++;
        realEndScan(repoId, scanVersionId); // runs cleanup + stamps completed_at
        // Force throw AFTER endScan work — proves the whole transaction rolls back
        throw new Error('forced write failure — ISO-03/ISO-10 proof');
      };

      setAgentRunner(makeAgentRunner('new-svc-must-not-persist'));

      // scanRepos must RESOLVE (not reject) — the per-repo try/catch in Phase B
      // swallows the transaction error and pushes an error result.
      let scanResult;
      await assert.doesNotReject(
        async () => { scanResult = await scanRepos([repoDir], { skipHubSync: true, full: true }, qe); },
        'scanRepos must resolve even when the write transaction throws (per-repo isolation)',
      );

      // Must have returned an error result for the failed repo
      assert.equal(scanResult.length, 1, 'must return one result for the one repo');
      assert.ok(scanResult[0].error,
        'result must carry an error field for the rolled-back scan');
      assert.equal(scanResult[0].findings, null,
        'findings must be null — scan was rolled back');

      // ISO-03: completed scan_versions count must not have increased
      const afterSvCount = db.prepare(
        'SELECT COUNT(*) AS n FROM scan_versions WHERE completed_at IS NOT NULL'
      ).get().n;
      assert.equal(afterSvCount, priorSvCount,
        'ISO-03/ISO-10: no new completed scan_versions row — aborted scan was rolled back');

      // ISO-10: no orphaned (NULL-completed) scan_versions row
      const nullSvRow = db.prepare(
        'SELECT id FROM scan_versions WHERE completed_at IS NULL'
      ).get();
      assert.equal(nullSvRow, undefined,
        'ISO-10: no orphaned scan_versions row — beginScan INSERT was inside the tx and rolled back');

      // ISO-03: new service must NOT be visible (write was rolled back)
      const newSvcRow = db.prepare(
        "SELECT id FROM services WHERE name = 'new-svc-must-not-persist'"
      ).get();
      assert.equal(newSvcRow, undefined,
        'ISO-03: rolled-back service must not be visible in services table');

      // ISO-03: prior data must still be intact and unchanged
      const priorSvcAfter = db.prepare(
        'SELECT id FROM services WHERE id = ?'
      ).get(priorSvcId);
      assert.ok(priorSvcAfter,
        'ISO-03: prior service row must still exist after rollback of second scan');
      assert.equal(priorSvcAfter.id, priorSvcId,
        'ISO-03: prior service ID unchanged — rollback did not touch committed data');

      assert.ok(endScanCallCount >= 1, 'endScan override was exercised (failure was injected)');
    },
  );
});

// ---------------------------------------------------------------------------
// Scenario 3: Per-repo isolation (§Q7 Pitfall 6)
// ---------------------------------------------------------------------------

describe('Per-repo isolation: repo A write failure does not abort repo B', () => {
  let repoDirA;
  let repoDirB;
  let db;

  beforeEach(() => {
    repoDirA = makeTempRepo();
    repoDirB = makeTempRepo();
    db = freshDb();
    setScanLogger(null);
  });

  afterEach(() => {
    try { db.close(); } catch (_) {}
    cleanupDir(repoDirA);
    cleanupDir(repoDirB);
    setAgentRunner(null);
  });

  test(
    'repo B commits its scan even when repo A write transaction throws; ' +
    'result array carries both an error entry and a success entry',
    async () => {
      const qe = new QueryEngine(db);

      // Inject failure: endScan throws on the FIRST call (repo A) only.
      // Phase B processes repos sequentially in array order, so repo A = call 1.
      const realEndScan = qe.endScan.bind(qe);
      let endScanCallCount = 0;
      qe.endScan = (repoId, scanVersionId) => {
        endScanCallCount++;
        if (endScanCallCount === 1) {
          // Repo A: run cleanup then throw — entire repo A transaction rolls back
          realEndScan(repoId, scanVersionId);
          throw new Error('forced failure for repo A — per-repo isolation proof');
        }
        // Repo B: normal path
        return realEndScan(repoId, scanVersionId);
      };

      const findingsMap = new Map([
        [repoDirA, 'svc-a'],
        [repoDirB, 'svc-b'],
      ]);
      setAgentRunner(makeAgentRunner(findingsMap));

      // scanRepos must resolve with results for BOTH repos
      const results = await scanRepos([repoDirA, repoDirB], { skipHubSync: true }, qe);

      assert.equal(results.length, 2, 'must return results for both repos');

      // --- Repo A: error result (write was rolled back) ---
      const resultA = results.find((r) => r.repoPath === repoDirA);
      assert.ok(resultA, 'must have a result entry for repo A');
      assert.ok(resultA.error,
        'repo A result must carry an error field (write transaction was rolled back)');

      // Repo A: no committed scan_versions row
      const repoARow = db.prepare('SELECT id FROM repos WHERE path = ?').get(repoDirA);
      // repoARow may be null if upsertRepo was rolled back too (it runs in Phase A
      // before the write tx, so it may have committed). Either way, no completed sv.
      if (repoARow) {
        const svA = db.prepare(
          'SELECT id FROM scan_versions WHERE repo_id = ? AND completed_at IS NOT NULL'
        ).get(repoARow.id);
        assert.equal(svA, undefined,
          'repo A must have no completed scan_versions row after rollback');
      }

      // Repo A: svc-a must NOT be persisted
      const svcARow = db.prepare("SELECT id FROM services WHERE name = 'svc-a'").get();
      assert.equal(svcARow, undefined,
        'svc-a must not be visible — repo A write transaction was rolled back');

      // --- Repo B: success result with committed data ---
      const resultB = results.find((r) => r.repoPath === repoDirB);
      assert.ok(resultB, 'must have a result entry for repo B');
      assert.ok(!resultB.error,
        `repo B must not have an error: ${resultB.error}`);

      // Repo B: completed scan_versions row
      const repoBRow = db.prepare('SELECT id FROM repos WHERE path = ?').get(repoDirB);
      assert.ok(repoBRow, 'repo B must be registered in repos table');
      const svB = db.prepare(
        'SELECT completed_at FROM scan_versions WHERE repo_id = ? ORDER BY id DESC LIMIT 1'
      ).get(repoBRow.id);
      assert.ok(svB, 'repo B must have a scan_versions row');
      assert.ok(svB.completed_at,
        'repo B completed_at must be non-NULL — repo B scan committed despite repo A rollback');

      // Repo B: svc-b is persisted
      const svcBRow = db.prepare("SELECT name FROM services WHERE name = 'svc-b'").get();
      assert.ok(svcBRow,
        'svc-b must be persisted — repo B write transaction committed independently');

      // Sanity: endScan was called for both repos (2 calls total)
      assert.equal(endScanCallCount, 2,
        'endScan must have been called for both repo A and repo B');
    },
  );
});
