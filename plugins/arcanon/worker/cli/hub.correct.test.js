/**
 * worker/cli/hub.correct.test.js —  .
 *
 * Pure node tests for the resolveServiceTarget helper. No worker spawn,
 * no migration chain — uses an in-memory better-sqlite3 with the minimal
 * services + repos schema we need to exercise the three resolution
 * branches (one-match / zero-match / multi-match).
 *
 * The handler-side error formatting is covered by tests/correct.bats Test 9.
 * These tests pin the resolver's structured throw contract so that
 * downstream callers can rely on { code, message, exitCode }.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from '../db/sqlite-adapter.js';

import { resolveServiceTarget } from './correct-resolver.js';

function makeDb() {
  const db = new Database(':memory:');
  // Minimal repos + services shape — enough for the resolver's JOIN.
  // We don't need the full migration chain; the resolver only reads the
  // four columns named in its SELECT.
  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id),
      name TEXT NOT NULL,
      root_path TEXT NOT NULL
    );
  `);
  return db;
}

test('resolveServiceTarget: one match returns integer id', () => {
  const db = makeDb();
  const repoId = db.prepare("INSERT INTO repos (path, name) VALUES ('/r', 'r')").run().lastInsertRowid;
  const id = db.prepare(
    "INSERT INTO services (repo_id, name, root_path) VALUES (?, 'auth', 'services/auth')"
  ).run(repoId).lastInsertRowid;

  const resolved = resolveServiceTarget('auth', db);
  assert.equal(resolved, Number(id));
  assert.equal(typeof resolved, 'number');
  db.close();
});

test('resolveServiceTarget: zero match throws NOT_FOUND with exitCode 2', () => {
  const db = makeDb();
  db.prepare("INSERT INTO repos (path, name) VALUES ('/r', 'r')").run();

  let caught;
  try {
    resolveServiceTarget('nonexistent', db);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'should have thrown');
  assert.equal(caught.code, 'NOT_FOUND');
  assert.equal(caught.exitCode, 2);
  assert.match(caught.message, /service 'nonexistent' not found/);
  db.close();
});

test('resolveServiceTarget: multi match throws AMBIGUOUS with disambiguation lines', () => {
  const db = makeDb();
  const repo1 = db.prepare("INSERT INTO repos (path, name) VALUES ('/r1', 'r1')").run().lastInsertRowid;
  const repo2 = db.prepare("INSERT INTO repos (path, name) VALUES ('/r2', 'r2')").run().lastInsertRowid;
  db.prepare(
    "INSERT INTO services (repo_id, name, root_path) VALUES (?, 'svc', 'services/svc')"
  ).run(repo1);
  db.prepare(
    "INSERT INTO services (repo_id, name, root_path) VALUES (?, 'svc', 'apps/svc')"
  ).run(repo2);

  let caught;
  try {
    resolveServiceTarget('svc', db);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'should have thrown');
  assert.equal(caught.code, 'AMBIGUOUS');
  assert.equal(caught.exitCode, 2);
  assert.match(caught.message, /matches 2 services/);
  // Both repo paths must appear so the operator can disambiguate.
  assert.match(caught.message, /\/r1/);
  assert.match(caught.message, /\/r2/);
  // Both root_paths must appear.
  assert.match(caught.message, /services\/svc/);
  assert.match(caught.message, /apps\/svc/);
  db.close();
});

test('resolveServiceTarget: empty/non-string name throws INVALID with exitCode 2', () => {
  const db = makeDb();
  for (const bad of ['', null, undefined, 42, true]) {
    let caught;
    try {
      resolveServiceTarget(bad, db);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, `should throw for ${JSON.stringify(bad)}`);
    assert.equal(caught.code, 'INVALID');
    assert.equal(caught.exitCode, 2);
  }
  db.close();
});
