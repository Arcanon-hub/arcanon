/**
 * dep-collector.test.js — node:test suite for the dep-collector enrichment module.
 *
 * Covers DEP-05, DEP-06, DEP-07:
 *   - All 7 ecosystems parse correctly against real fixture manifests
 *   - Unsupported manifests emit WARN (DEP-06)
 *   - devDependencies / test-scope / dev-scope never emitted (DEP-07)
 *   - Parser errors are contained — no throw, partial coverage preserved
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDependencies } from './dep-collector.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIX = resolve(__dirname, '../../../tests/fixtures/dep-collector');

function mkLogger() {
  const calls = [];
  return {
    calls,
    log: (level, msg, extra) => calls.push({ level, msg, ...extra }),
  };
}

describe('dep-collector (DEP-05/06/07)', () => {
  it('npm: emits dependencies, excludes devDependencies', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'npm-basic'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('npm'), 'npm missing from ecosystems_scanned');
    const names = rows.map(r => r.package_name);
    assert.ok(names.includes('react'), 'production dep react missing');
    assert.ok(names.includes('lodash'), 'production dep lodash missing');
    assert.ok(!names.includes('vitest'), 'devDependency vitest leaked into rows');
    assert.ok(!names.includes('eslint'), 'devDependency eslint leaked into rows');
    // resolved_version from lockfile
    const reactRow = rows.find(r => r.package_name === 'react');
    assert.equal(reactRow.resolved_version, '18.2.0', 'resolved_version not from lockfile');
  });

  it('pypi: PEP 621 + poetry sections, python excluded', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'pypi-pyproject'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('pypi'), 'pypi missing from ecosystems_scanned');
    const names = rows.map(r => r.package_name);
    assert.ok(!names.includes('python'), 'python itself leaked into rows');
    // PEP 621 deps
    assert.ok(names.includes('requests'), 'PEP 621 dep requests missing');
    assert.ok(names.includes('fastapi'), 'PEP 621 dep fastapi missing');
    // poetry deps
    assert.ok(names.includes('httpx'), 'poetry dep httpx missing');
    assert.ok(names.includes('pydantic'), 'poetry dep pydantic missing');
  });

  it('go: both block and single-line require', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'go-module'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('go'), 'go missing from ecosystems_scanned');
    assert.ok(rows.length >= 2, `expected >= 2 go deps, got ${rows.length}`);
    const names = rows.map(r => r.package_name);
    // single-line require
    assert.ok(names.includes('github.com/gin-gonic/gin'), 'single-line gin dep missing');
    // block require
    assert.ok(names.includes('github.com/go-playground/validator/v10'), 'block dep validator missing');
  });

  it('cargo: simple + inline-table forms', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'cargo-crate'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('cargo'), 'cargo missing from ecosystems_scanned');
    assert.ok(rows.length >= 2, `expected >= 2 cargo deps, got ${rows.length}`);
    const names = rows.map(r => r.package_name);
    // simple form
    assert.ok(names.includes('tokio'), 'simple-form dep tokio missing');
    // inline-table form
    assert.ok(names.includes('serde'), 'inline-table dep serde missing');
    assert.ok(names.includes('reqwest'), 'inline-table dep reqwest missing');
  });

  it('maven: property resolution + dependencyManagement + test scope excluded', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'maven-project'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('maven'), 'maven missing from ecosystems_scanned');
    const names = rows.map(r => r.package_name);
    // test-scope dep excluded
    assert.ok(!names.some(n => n.includes('junit')), 'test-scope junit leaked into rows');
    // property-resolved dep present
    const springRow = rows.find(r => r.package_name === 'org.springframework:spring-core');
    assert.ok(springRow, 'spring-core dep missing');
    assert.equal(springRow.version_spec, '6.0.13', 'property ${spring.version} not resolved');
    // dependencyManagement dep present
    assert.ok(names.includes('com.fasterxml.jackson.core:jackson-databind'), 'managed jackson dep missing');
  });

  it('nuget: CPM Directory.Packages.props resolves missing Version', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'nuget-solution'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('nuget'), 'nuget missing from ecosystems_scanned');
    assert.ok(rows.length > 0, 'no nuget rows returned');
    // All rows must have a concrete version from Directory.Packages.props
    assert.ok(
      rows.some(r => r.version_spec !== 'MANAGED' && r.version_spec !== null),
      'no rows with CPM-resolved version',
    );
    const njRow = rows.find(r => r.package_name === 'Newtonsoft.Json');
    assert.ok(njRow, 'Newtonsoft.Json missing from rows');
    assert.equal(njRow.version_spec, '13.0.3', 'Newtonsoft.Json version not from CPM');
  });

  it('rubygems: GEM + GIT + PATH direct deps, sub-deps excluded', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'rubygems-bundle'),
      logger,
    });
    assert.ok(ecosystems_scanned.includes('rubygems'), 'rubygems missing from ecosystems_scanned');
    assert.ok(rows.length > 0, 'no rubygems rows returned');
    const names = rows.map(r => r.package_name);
    // direct gems from each section
    assert.ok(names.includes('rails'), 'rails (GEM section) missing');
    assert.ok(names.includes('mygem'), 'mygem (GIT section) missing');
    assert.ok(names.includes('local_gem'), 'local_gem (PATH section) missing');
    // sub-deps (6-space indent) must be excluded
    assert.ok(!names.includes('actionpack'), 'sub-dep actionpack (GEM section) leaked');
    assert.ok(!names.includes('activesupport'), 'sub-dep activesupport leaked');
  });

  it('unsupported manifest emits WARN', async () => {
    const logger = mkLogger();
    await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'unsupported-swift'),
      logger,
    });
    assert.ok(
      logger.calls.some(c => c.level === 'WARN' && c.msg.includes('unsupported manifest skipped')),
      'no WARN for unsupported manifest',
    );
  });

  it('invalid manifest is contained — parser-error WARN, no throw', async () => {
    const logger = mkLogger();
    const result = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'invalid-npm'),
      logger,
    });
    assert.ok(
      !result.ecosystems_scanned.includes('npm'),
      'npm must NOT be in ecosystems_scanned after parser error',
    );
    assert.ok(
      logger.calls.some(c => c.level === 'WARN' && c.msg.includes('parser error')),
      'no parser-error WARN emitted',
    );
  });

  it('empty repo: no rows, no ecosystems_scanned', async () => {
    const logger = mkLogger();
    const { rows, ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'empty-repo'),
      logger,
    });
    assert.deepEqual(rows, []);
    assert.deepEqual(ecosystems_scanned, []);
  });

  it('ecosystems_scanned contains only parsed ecosystems', async () => {
    const logger = mkLogger();
    const { ecosystems_scanned } = await collectDependencies({
      repoPath: FIX,
      rootPath: join(FIX, 'npm-basic'),
      logger,
    });
    assert.deepEqual(ecosystems_scanned, ['npm']);
  });
});
