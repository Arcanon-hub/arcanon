/**
 * Tests for worker/db/database.js — openDb factory behavior (Phase 137 / ISO-01)
 *
 * Asserts the factory contract: openDb() is a stateless factory that returns a
 * fresh handle per call; getDb() throws; _resetDbSingleton() is a no-op.
 *
 * Run: node --test worker/db/database.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, getDb, _resetDbSingleton } from "./database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("openDb() opens a DB, enables WAL + FK pragmas, and creates the file on disk", () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-db-test-"));
  const db = openDb(testRoot);

  assert.ok(db, "db instance returned");
  assert.strictEqual(
    db.pragma("journal_mode", { simple: true }),
    "wal",
    "WAL mode enabled",
  );
  assert.strictEqual(
    db.pragma("foreign_keys", { simple: true }),
    1,
    "FK constraints enabled",
  );
  // db.name is the resolved absolute path to impact-map.db
  assert.ok(fs.existsSync(db.name), `DB file created at ${db.name}`);

  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("openDb(rootA) and openDb(rootB) return handles pointing to different DB files", () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-db-A-"));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-db-B-"));

  const dbA = openDb(rootA);
  const dbB = openDb(rootB);

  assert.notEqual(
    dbA.name,
    dbB.name,
    "Two distinct project roots must yield different DB file paths",
  );

  dbA.close();
  dbB.close();
  fs.rmSync(rootA, { recursive: true, force: true });
  fs.rmSync(rootB, { recursive: true, force: true });
});

test("getDb() throws with a message referencing Phase 137 and ISO-01", () => {
  assert.throws(
    () => getDb(),
    (err) => {
      assert.ok(err instanceof Error, "must throw an Error instance");
      assert.ok(
        err.message.includes("137") && err.message.includes("ISO-01"),
        `error message must reference Phase 137 and ISO-01, got: "${err.message}"`,
      );
      return true;
    },
  );
});

test("_resetDbSingleton() is a no-op that returns false (no module state)", () => {
  const result = _resetDbSingleton();
  assert.strictEqual(result, false, "_resetDbSingleton must return false");
  // Calling it again is safe (idempotent no-op)
  assert.strictEqual(_resetDbSingleton(), false, "second call also returns false");
});
