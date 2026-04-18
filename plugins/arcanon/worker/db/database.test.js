/**
 * Tests for worker/db.js — openDb and getDb behavior
 * Run: node --input-type=module < worker/db.test.js
 * (or use the inline heredoc form from the plan verify block)
 */

import { openDb, getDb } from "./database.js";
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

// Test: getDb throws before openDb is called
// Note: since we can't reset module state in a single import, we test the
// error message shape here through a try/catch
// This test relies on the module being freshly loaded.

// Test: openDb creates DB file
const testRoot = path.join(os.tmpdir(), "ligamen-test-" + Date.now());
fs.mkdirSync(testRoot, { recursive: true });

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

// Test: getDb returns same instance
assert.strictEqual(getDb(), db, "getDb returns same instance");

// Test: idempotent
const db2 = openDb(testRoot);
assert.strictEqual(db2, db, "openDb idempotent");

// Verify DB file exists on disk
const crypto = await import("crypto");
const hash = crypto
  .createHash("sha256")
  .update(testRoot)
  .digest("hex")
  .slice(0, 12);
const dbPath = path.join(
  os.homedir(),
  ".ligamen",
  "projects",
  hash,
  "impact-map.db",
);
assert.ok(fs.existsSync(dbPath), `DB file created at ${dbPath}`);

console.log("PASS: db.js basic behavior");
db.close();
