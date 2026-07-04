/**
 * manager.dep-collector.test.js — Integration tests for dep-collector wiring in Phase B loop
 *
 * Tests:  (collector invoked per service),  (cascade cleanup),  (ecosystems logged)
 *
 * Uses node:test + node:assert/strict. No external test framework.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from '../db/sqlite-adapter.js';
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

  it('scanRepos populates service_dependencies end-to-end', async () => {
    const qe = buildQe();
    setAgentRunner(makeAgentRunner(repoDir));
    await scanRepos([repoDir], { full: true }, qe);

    const deps = qe._db.prepare('SELECT package_name FROM service_dependencies').all();
    const names = deps.map(d => d.package_name);

    assert.ok(names.includes('react'), 'react dep missing from service_dependencies');
    assert.ok(names.includes('lodash'), 'lodash dep missing from service_dependencies');
    assert.ok(!names.includes('vitest'), 'devDependency vitest leaked into service_dependencies');
  });

  it('cascade cleanup when service removed on re-scan', async () => {
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

  it('dep-scan done INFO log includes ecosystemsSeen with npm', async () => {
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

// ---------------------------------------------------------------------------
// PERF-02 — collectDependencies dedup by root_path
//
// Two services sharing a root_path must trigger exactly ONE collectDependencies
// call (the second reuses the cached result). Two services with distinct
// root_paths must each trigger their own call.
//
// Detection strategy: make every package.json at the tested root_path contain
// invalid JSON so each collectDependencies invocation emits a
// 'dep-scan: parser error' WARN through the scan logger. Count those warnings
// to infer how many times the collector was invoked — no ESM mock needed.
// ---------------------------------------------------------------------------

describe('manager.js dep-collector dedup by root_path (PERF-02)', () => {
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

  /**
   * Agent runner that returns 2 services at the provided root_paths.
   * Handles the 2-call-per-repo pattern (discovery on odd, deep scan on even).
   */
  function makeDedupeAgentRunner(repoBaseDir, serviceRootPaths) {
    const discoveryJson = JSON.stringify({
      languages: ['javascript'],
      frameworks: [],
      service_hints: serviceRootPaths.map((rp, i) => ({ name: `svc-${i}` })),
    });

    const findings = {
      service_name: 'svc-0',
      confidence: 'high',
      services: serviceRootPaths.map((rp, i) => ({
        name: `svc-${i}`,
        language: 'javascript',
        root_path: rp,
        type: 'service',
        confidence: 'high',
      })),
      connections: [],
      schemas: [],
    };

    let callCount = 0;
    return async (_prompt, _path) => {
      callCount++;
      if (callCount % 2 === 1) {
        return '```json\n' + discoveryJson + '\n```';
      }
      return '```json\n' + JSON.stringify(findings) + '\n```';
    };
  }

  it('PERF-02: two services with same root_path invoke collectDependencies exactly once', async () => {
    const qe = buildQe();

    // Make api/package.json invalid so every collectDependencies call emits
    // a 'dep-scan: parser error' WARN — this makes invocation count observable.
    const apiDir = join(repoDir, 'api');
    writeFileSync(join(apiDir, 'package.json'), '{ INVALID JSON }');

    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, ...extra }) });

    // Both services point to the SAME root_path (api/).
    setAgentRunner(makeDedupeAgentRunner(repoDir, [apiDir, apiDir]));
    await scanRepos([repoDir], { full: true }, qe);

    // Before dedup: 2 collectDependencies calls → 2 parser errors.
    // After dedup: 1 call (shared root_path cache hit) → 1 parser error.
    const parserErrors = logs.filter(l => l.msg === 'dep-scan: parser error');
    assert.equal(
      parserErrors.length,
      1,
      `PERF-02: expected 1 collector invocation for shared root_path, got ${parserErrors.length}`,
    );
  });

  it('PERF-02: two services with distinct root_paths each invoke collectDependencies (control)', async () => {
    const qe = buildQe();

    // Create a second service directory with its own invalid package.json.
    const apiDir = join(repoDir, 'api');
    const svcBDir = join(repoDir, 'svc-b');
    mkdirSync(svcBDir, { recursive: true });
    writeFileSync(join(apiDir, 'package.json'), '{ INVALID JSON }');
    writeFileSync(join(svcBDir, 'package.json'), '{ ALSO INVALID }');

    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, ...extra }) });

    // Services point to DISTINCT root_paths — each needs its own collect call.
    setAgentRunner(makeDedupeAgentRunner(repoDir, [apiDir, svcBDir]));
    await scanRepos([repoDir], { full: true }, qe);

    // Distinct root_paths: 2 collector calls → 2 parser errors (both before and after fix).
    const parserErrors = logs.filter(l => l.msg === 'dep-scan: parser error');
    assert.equal(
      parserErrors.length,
      2,
      `PERF-02 control: expected 2 collector invocations for distinct root_paths, got ${parserErrors.length}`,
    );
  });
});
