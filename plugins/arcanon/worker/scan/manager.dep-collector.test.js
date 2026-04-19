/**
 * manager.dep-collector.test.js — Integration tests for dep-collector wiring in Phase B loop
 *
 * Tests: DEP-09 (collector invoked per service), DEP-10 (cascade cleanup), DEP-11 (ecosystems logged)
 *
 * Uses node:test + node:assert/strict. No external test framework.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/database.js';
import { QueryEngine } from '../db/query-engine.js';
import { scanRepos, setAgentRunner, setScanLogger } from './manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fully-migrated in-memory QueryEngine (all migrations including 010).
 * foreign_keys=ON ensures ON DELETE CASCADE behaves correctly.
 */
function buildQe() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  // boundary_entry is referenced by manager.js's enrichment-pass SELECT but is
  // not added by any migration (it lives only in the prod DDL via a schema drift).
  // Add it here so the enrichment loop runs and dep-collector is reached.
  try { db.exec('ALTER TABLE services ADD COLUMN boundary_entry TEXT'); } catch (_) {}
  return new QueryEngine(db);
}

/**
 * Create a temp directory that is also a git repo.
 * Creates a subdirectory api/ with a package.json containing react + lodash
 * as production deps and vitest as a devDependency.
 */
function mkFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dep-col-'));
  // Init git repo so getChangedFiles / getCurrentHead do not error
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  // Create api service dir with package.json
  const apiDir = join(dir, 'api');
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(join(apiDir, 'package.json'), JSON.stringify({
    name: 'api',
    dependencies: { react: '^18.0.0', lodash: '^4.17.0' },
    devDependencies: { vitest: '^1.0.0' },
  }));

  // Commit so HEAD is a valid ref
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

/**
 * Build an agentRunner stub that handles the discovery + deep scan two-call
 * pattern. Discovery call returns minimal JSON; deep scan returns findings.
 */
function makeAgentRunner(repoDir, { noServices = false } = {}) {
  const discoveryJson = JSON.stringify({
    languages: ['javascript'],
    frameworks: [],
    service_hints: ['api'],
  });

  const findings = noServices
    ? { service_name: 'api', confidence: 'high', services: [], connections: [], schemas: [] }
    : {
        service_name: 'api',
        confidence: 'high',
        services: [{
          name: 'api',
          language: 'javascript',
          root_path: join(repoDir, 'api'),
          type: 'service',
          confidence: 'high',
        }],
        connections: [],
        schemas: [],
      };

  let callCount = 0;
  return async (_prompt, _path) => {
    callCount++;
    // First call per repo is the discovery pass; second is deep scan.
    if (callCount % 2 === 1) {
      return '```json\n' + discoveryJson + '\n```';
    }
    return '```json\n' + JSON.stringify(findings) + '\n```';
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('manager.js dep-collector integration (DEP-09/10/11)', () => {
  let repoDir;

  beforeEach(() => {
    repoDir = mkFixtureRepo();
    setScanLogger(null);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    setAgentRunner(null);
    setScanLogger(null);
  });

  it('scanRepos populates service_dependencies end-to-end (DEP-09)', async () => {
    const qe = buildQe();
    setAgentRunner(makeAgentRunner(repoDir));
    await scanRepos([repoDir], { full: true }, qe);

    const deps = qe._db.prepare('SELECT package_name FROM service_dependencies').all();
    const names = deps.map(d => d.package_name);

    assert.ok(names.includes('react'), 'react dep missing from service_dependencies');
    assert.ok(names.includes('lodash'), 'lodash dep missing from service_dependencies');
    assert.ok(!names.includes('vitest'), 'devDependency vitest leaked into service_dependencies');
  });

  it('cascade cleanup when service removed on re-scan (DEP-10)', async () => {
    const qe = buildQe();

    // First scan: service present — deps populated
    setAgentRunner(makeAgentRunner(repoDir));
    await scanRepos([repoDir], { full: true }, qe);
    const before = qe._db.prepare('SELECT COUNT(*) AS n FROM service_dependencies').get().n;
    assert.ok(before > 0, 'baseline scan must produce deps');

    // Second scan: agent reports NO services — endScan removes the service row —
    // ON DELETE CASCADE auto-removes dep rows (no new DELETE statement needed)
    setAgentRunner(makeAgentRunner(repoDir, { noServices: true }));
    await scanRepos([repoDir], { full: true }, qe);
    const after = qe._db.prepare('SELECT COUNT(*) AS n FROM service_dependencies').get().n;
    // cascade delete must zero out service_dependencies
    assert.equal(after, 0, 'cascade delete must zero out service_dependencies');
  });

  it('collector throw does not fail scan (DEP-09 error containment)', async () => {
    const qe = buildQe();
    // Write invalid JSON to the package.json to force a parser error inside collectDependencies.
    // The collector wraps each parser in tryParser; the catch emits WARN and does NOT re-throw.
    // scanRepos must still resolve (not reject) even when the parser errors.
    writeFileSync(join(repoDir, 'api', 'package.json'), '{ not valid json ');
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "break package.json"', { cwd: repoDir, stdio: 'pipe' });

    setAgentRunner(makeAgentRunner(repoDir));
    await assert.doesNotReject(
      () => scanRepos([repoDir], { full: true }, qe),
      'scan must not reject when collectDependencies parser errors',
    );
  });

  it('dep-scan done INFO log includes ecosystemsSeen with npm (DEP-11)', async () => {
    const qe = buildQe();
    const calls = [];
    setScanLogger({ log: (level, msg, extra) => calls.push({ level, msg, ...extra }) });

    setAgentRunner(makeAgentRunner(repoDir));
    await scanRepos([repoDir], { full: true }, qe);

    const depDone = calls.find(c => c.msg === 'dep-scan done');
    assert.ok(depDone, 'INFO dep-scan done entry missing from scan log');
    assert.ok(Array.isArray(depDone.ecosystemsSeen), 'ecosystemsSeen must be an array');
    assert.ok(depDone.ecosystemsSeen.includes('npm'), 'ecosystemsSeen must include npm for package.json fixture');
    assert.equal(depDone.level, 'INFO', 'dep-scan done must be logged at INFO level');
  });
});
