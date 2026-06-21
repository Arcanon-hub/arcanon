/**
 * worker/lib/repo-resolver.test.js —  .
 *
 * Pure unit tests for resolveRepoIdentifier. Uses an in-memory better-sqlite3
 * DB with the minimum schema needed (just the `repos` table). No worker spawn,
 * no migrations beyond CREATE TABLE.
 *
 * Cases:
 *   1 — one match by absolute path → returns row
 *   2 — one match by relative path resolved against projectRoot → returns row
 *   3 — one match by name (path lookup misses) → returns row
 *   4 — zero matches → throws { code: 'NOT_FOUND', exitCode: 2, available }
 *   5 — multi-match by name → throws { code: 'AMBIGUOUS', exitCode: 2, matches }
 *   6 — invalid input (empty / non-string) → throws { code: 'INVALID', exitCode: 2 }
 *   7 — invalid projectRoot → throws { code: 'INVALID', exitCode: 2 }
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import Database from '../db/sqlite-adapter.js';

import { resolveRepoIdentifier } from './repo-resolver.js';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'single',
      last_commit TEXT,
      scanned_at TEXT
    );
  `);
  return db;
}

function insertRepo(db, p, n) {
  return db.prepare(
    `INSERT INTO repos (path, name, type) VALUES (?, ?, 'single')`,
  ).run(p, n).lastInsertRowid;
}

test('one match by absolute path returns row', () => {
  const db = freshDb();
  const projectRoot = '/abs/proj';
  const repoPath = '/abs/proj/api';
  const id = Number(insertRepo(db, repoPath, 'api'));

  const row = resolveRepoIdentifier(repoPath, db, projectRoot);
  assert.equal(row.id, id);
  assert.equal(row.path, repoPath);
  assert.equal(row.name, 'api');
});

test('one match by relative path resolved against projectRoot returns row', () => {
  const db = freshDb();
  const projectRoot = '/abs/proj';
  const repoPath = path.resolve(projectRoot, '../sibling-api');
  const id = Number(insertRepo(db, repoPath, 'sibling-api'));

  const row = resolveRepoIdentifier('../sibling-api', db, projectRoot);
  assert.equal(row.id, id);
  assert.equal(row.path, repoPath);
});

test('one match by name when path lookup misses returns row', () => {
  const db = freshDb();
  const projectRoot = '/abs/proj';
  const repoPath = '/somewhere/else/auth';
  const id = Number(insertRepo(db, repoPath, 'auth'));

  // Bare name resolves to a path under projectRoot which is not registered.
  // Falls through to the name-lookup branch; unique match returns the row.
  const row = resolveRepoIdentifier('auth', db, projectRoot);
  assert.equal(row.id, id);
  assert.equal(row.path, repoPath);
  assert.equal(row.name, 'auth');
});

test('zero matches throws NOT_FOUND with exitCode 2 and available list', () => {
  const db = freshDb();
  insertRepo(db, '/abs/proj/api', 'api');
  insertRepo(db, '/abs/proj/web', 'web');

  try {
    resolveRepoIdentifier('totally-not-a-repo', db, '/abs/proj');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'NOT_FOUND');
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /not found/);
    assert.match(err.message, /api/);
    assert.match(err.message, /web/);
    assert.ok(Array.isArray(err.available));
    assert.equal(err.available.length, 2);
  }
});

test('multi-match by name throws AMBIGUOUS with exitCode 2 and matches list', () => {
  const db = freshDb();
  insertRepo(db, '/repo-a/api', 'api');
  insertRepo(db, '/repo-b/api', 'api');

  try {
    resolveRepoIdentifier('api', db, '/somewhere');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'AMBIGUOUS');
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /matches 2 repos/);
    assert.match(err.message, /\/repo-a\/api/);
    assert.match(err.message, /\/repo-b\/api/);
    assert.ok(Array.isArray(err.matches));
    assert.equal(err.matches.length, 2);
    assert.ok(err.matches.every((m) => typeof m.id === 'number' && typeof m.path === 'string'));
  }
});

test('invalid identifier (empty string or non-string) throws INVALID', () => {
  const db = freshDb();

  for (const bad of ['', null, undefined, 42, {}]) {
    try {
      resolveRepoIdentifier(bad, db, '/abs/proj');
      assert.fail(`expected throw for ${JSON.stringify(bad)}`);
    } catch (err) {
      assert.equal(err.code, 'INVALID');
      assert.equal(err.exitCode, 2);
      assert.match(err.message, /repo identifier required/);
    }
  }
});

test('invalid projectRoot (empty or non-string) throws INVALID', () => {
  const db = freshDb();
  insertRepo(db, '/abs/proj/api', 'api');

  for (const bad of ['', null, undefined]) {
    try {
      resolveRepoIdentifier('api', db, bad);
      assert.fail(`expected throw for projectRoot=${JSON.stringify(bad)}`);
    } catch (err) {
      assert.equal(err.code, 'INVALID');
      assert.equal(err.exitCode, 2);
      assert.match(err.message, /projectRoot required/);
    }
  }
});
