/**
 * worker/db/query-engine.reconciliation-audit.test.js — Phase 111 Plan 03 (TRUST-06, TRUST-14)
 *
 * Integration test for the reconciliation → audit-log path wired in
 * commands/map.md Step 3 (capture _reconciliation field) and Step 5
 * (resolve connection_id and call qe.logEnrichment) under Plan 111-03.
 *
 * The slash-command flow itself (a Claude-driven JS snippet) is not directly
 * unit-testable, so this test reproduces the relevant slice of map.md inline:
 *
 *   1. Two repos: one declares a `payments` service; the other has a connection
 *      with `target: 'payments'`, `crossing: 'external'`.
 *   2. Run Step 3's reconciliation logic on `allFindings` (capture
 *      `_reconciliation` field on the changed connection, mutate `crossing`).
 *   3. Persist findings via persistFindings + endScan (per-repo loop).
 *   4. Run Step 5's audit-log writer: for each connection with
 *      `_reconciliation`, resolve the persisted connection_id and call
 *      qe.logEnrichment.
 *   5. Assert: enrichment_log has one row with the expected schema, and
 *      qe.getEnrichmentLog returns it.
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine.reconciliation-audit.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
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
import { up as up015 } from './migrations/015_scan_versions_quality_score.js';
import { up as up016 } from './migrations/016_enrichment_log.js';
import { QueryEngine } from './query-engine.js';

function applyAllMigrations(db) {
  up001(db); up002(db); up003(db); up004(db); up005(db); up006(db);
  up007(db); up008(db); up009(db); up010(db); up011(db); up013(db);
  up014(db); up015(db); up016(db);
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  return db;
}

/**
 * Run the reconciliation logic from commands/map.md Step 3 over allFindings.
 * Mirrors the patched code verbatim — exercises the same branches the real
 * slash-command runs.
 */
function runStep3Reconciliation(allFindings) {
  const knownServices = new Set();
  for (const finding of allFindings) {
    for (const service of (finding.services || [])) {
      knownServices.add(service.name);
    }
  }
  let count = 0;
  for (const finding of allFindings) {
    for (const conn of (finding.connections || [])) {
      if (conn.crossing === 'external' && knownServices.has(conn.target)) {
        conn._reconciliation = {
          from: 'external',
          to: 'cross-service',
          reason: 'target matches known service: ' + conn.target,
        };
        conn.crossing = 'cross-service';
        count++;
      }
    }
  }
  return count;
}

/**
 * Run the per-repo Step 5 audit-write block from commands/map.md verbatim.
 * Caller has already done JSON.stringify+parse to simulate the temp-file
 * round-trip if desired.
 */
function runStep5AuditWrite(db, qe, findings, repoId, scanVersionId) {
  for (const conn of (findings.connections || [])) {
    if (!conn._reconciliation) continue;
    const sourceRow = db.prepare(
      'SELECT id FROM services WHERE name = ? AND repo_id = ?'
    ).get(conn.source, repoId);
    const targetRow = db.prepare(
      'SELECT id FROM services WHERE name = ?'
    ).get(conn.target);
    if (!sourceRow || !targetRow) continue;
    const connRow = db.prepare(
      'SELECT id FROM connections WHERE source_service_id = ? AND target_service_id = ? AND ' +
      '(path IS ? OR path = ?) AND (method IS ? OR method = ?)'
    ).get(
      sourceRow.id, targetRow.id,
      conn.path || null, conn.path || '',
      conn.method || null, conn.method || ''
    );
    if (!connRow) continue;
    qe.logEnrichment(
      scanVersionId,
      'reconciliation',
      'connection',
      connRow.id,
      'crossing',
      conn._reconciliation.from,
      conn._reconciliation.to,
      conn._reconciliation.reason,
    );
  }
}

describe('reconciliation → enrichment_log integration (Plan 111-03 / TRUST-06, TRUST-14)', () => {
  it('one external→cross-service reclassification produces one audit row with the locked schema', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);

    // Two repos. Repo A declares `payments`. Repo B's `orders` calls payments
    // with crossing='external' (the agent didn't know payments lives in repo A).
    const findingsA = {
      repo_path: '/tmp/repo-a',
      repo_name: 'repo-a',
      services: [
        { name: 'payments', root_path: '/tmp/repo-a/svc', language: 'js' },
      ],
      connections: [],
    };
    const findingsB = {
      repo_path: '/tmp/repo-b',
      repo_name: 'repo-b',
      services: [
        { name: 'orders', root_path: '/tmp/repo-b/svc', language: 'js' },
      ],
      connections: [
        {
          source: 'orders',
          target: 'payments',
          protocol: 'rest',
          method: 'POST',
          path: '/charge',
          crossing: 'external',
          confidence: 'high',
        },
      ],
    };
    const allFindings = [findingsA, findingsB];

    // Step 3: reconciliation. After this, findingsB.connections[0] has
    // _reconciliation attached and crossing === 'cross-service'.
    const reconciledCount = runStep3Reconciliation(allFindings);
    assert.equal(reconciledCount, 1, 'one connection reclassified');
    assert.equal(allFindings[1].connections[0].crossing, 'cross-service');
    assert.deepEqual(allFindings[1].connections[0]._reconciliation, {
      from: 'external',
      to: 'cross-service',
      reason: 'target matches known service: payments',
    });

    // Simulate Step 4/5's JSON round-trip via temp file (writeFileSync +
    // readFileSync). The _reconciliation field MUST survive — it's a plain
    // own enumerable property.
    const findingsBSerialized = JSON.parse(JSON.stringify(allFindings[1]));
    assert.ok(
      findingsBSerialized.connections[0]._reconciliation,
      '_reconciliation field survives JSON round-trip',
    );

    // Step 5: persist + audit-log write. Repo A first.
    const repoIdA = qe.upsertRepo({
      path: findingsA.repo_path, name: findingsA.repo_name, type: 'single',
    });
    const scanA = qe.beginScan(repoIdA);
    qe.persistFindings(repoIdA, findingsA, null, scanA);
    qe.endScan(repoIdA, scanA);
    runStep5AuditWrite(db, qe, findingsA, repoIdA, scanA);

    // Repo B (with the reconciled connection).
    const repoIdB = qe.upsertRepo({
      path: findingsB.repo_path, name: findingsB.repo_name, type: 'single',
    });
    const scanB = qe.beginScan(repoIdB);
    qe.persistFindings(repoIdB, findingsBSerialized, null, scanB);
    qe.endScan(repoIdB, scanB);
    runStep5AuditWrite(db, qe, findingsBSerialized, repoIdB, scanB);

    // Verify: exactly one enrichment_log row with the locked schema.
    const allRows = db.prepare('SELECT * FROM enrichment_log').all();
    assert.equal(allRows.length, 1, 'exactly one audit row');
    const row = allRows[0];
    assert.equal(row.scan_version_id, scanB);
    assert.equal(row.enricher, 'reconciliation');
    assert.equal(row.target_kind, 'connection');
    assert.equal(row.field, 'crossing');
    assert.equal(row.from_value, 'external');
    assert.equal(row.to_value, 'cross-service');
    assert.equal(row.reason, 'target matches known service: payments');

    // target_id must point at a real connections row (FK is not enforced for
    // target_id since target_kind is a discriminant, but the value should be
    // a valid id in the connections table).
    const connRow = db.prepare('SELECT id FROM connections WHERE id = ?').get(row.target_id);
    assert.ok(connRow, 'target_id refers to a real connections row');

    // qe.getEnrichmentLog returns the row.
    const viaApi = qe.getEnrichmentLog(scanB);
    assert.equal(viaApi.length, 1);
    assert.equal(viaApi[0].id, row.id);
  });

  it('non-reconciled connection (no _reconciliation) does not write an audit row', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);

    // Both repos declare their target — no external→cross-service reclassification needed.
    const findings = {
      repo_path: '/tmp/r',
      repo_name: 'r',
      services: [
        { name: 'a', root_path: '/tmp/r/a', language: 'js' },
        { name: 'b', root_path: '/tmp/r/b', language: 'js' },
      ],
      connections: [
        // Already crossing='cross-service' — Step 3 leaves it alone.
        {
          source: 'a', target: 'b',
          protocol: 'rest', method: 'GET', path: '/x',
          crossing: 'cross-service', confidence: 'high',
        },
      ],
    };

    const reconciledCount = runStep3Reconciliation([findings]);
    assert.equal(reconciledCount, 0);
    assert.equal(findings.connections[0]._reconciliation, undefined);

    const repoId = qe.upsertRepo({ path: findings.repo_path, name: findings.repo_name, type: 'single' });
    const sv = qe.beginScan(repoId);
    qe.persistFindings(repoId, findings, null, sv);
    qe.endScan(repoId, sv);
    runStep5AuditWrite(db, qe, findings, repoId, sv);

    const rows = db.prepare('SELECT * FROM enrichment_log').all();
    assert.equal(rows.length, 0, 'no audit rows written when nothing reconciled');
  });

  it('multiple reconciliations in one repo produce one audit row per change', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);

    const findingsA = {
      repo_path: '/tmp/a', repo_name: 'a',
      services: [{ name: 'auth', root_path: '/tmp/a', language: 'js' }],
      connections: [],
    };
    const findingsC = {
      repo_path: '/tmp/c', repo_name: 'c',
      services: [{ name: 'config', root_path: '/tmp/c', language: 'js' }],
      connections: [],
    };
    const findingsB = {
      repo_path: '/tmp/b', repo_name: 'b',
      services: [{ name: 'gateway', root_path: '/tmp/b', language: 'js' }],
      connections: [
        { source: 'gateway', target: 'auth', protocol: 'rest', method: 'POST', path: '/login', crossing: 'external', confidence: 'high' },
        { source: 'gateway', target: 'config', protocol: 'rest', method: 'GET', path: '/cfg', crossing: 'external', confidence: 'high' },
      ],
    };

    const allFindings = [findingsA, findingsC, findingsB];
    const count = runStep3Reconciliation(allFindings);
    assert.equal(count, 2);

    // Persist each repo.
    for (const f of allFindings) {
      const repoId = qe.upsertRepo({ path: f.repo_path, name: f.repo_name, type: 'single' });
      const sv = qe.beginScan(repoId);
      qe.persistFindings(repoId, f, null, sv);
      qe.endScan(repoId, sv);
      runStep5AuditWrite(db, qe, f, repoId, sv);
    }

    // gateway's repo has the 2 audit rows; both for the same scan_version_id.
    const allRows = db.prepare(
      "SELECT * FROM enrichment_log WHERE enricher = 'reconciliation' ORDER BY id"
    ).all();
    assert.equal(allRows.length, 2, 'one audit row per reconciliation');
    const reasons = allRows.map((r) => r.reason).sort();
    assert.deepEqual(reasons, [
      'target matches known service: auth',
      'target matches known service: config',
    ]);
    // All sit on the same scan_version_id (gateway's scan).
    assert.equal(allRows[0].scan_version_id, allRows[1].scan_version_id);
  });
});
