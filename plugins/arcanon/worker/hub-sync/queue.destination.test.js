/**
 * queue.destination.test.js — node:test coverage for:
 *   - Schema migration: hub_url + org_id columns added idempotently (Task 1)
 *   - Destination binding + destination requirement in enqueueUpload (Task 2)
 *   - Legacy pending rows quarantined to status='held' by migrateQueueSchema (Task 2)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "../db/sqlite-adapter.js";

import {
  getQueueDb,
  _resetQueueDb,
  enqueueUpload,
  listDueUploads,
  listAllUploads,
  queueStats,
} from "./queue.js";

/** Per-test isolation: reset the module singleton and return a fresh temp dir. */
function freshQueueDir() {
  _resetQueueDb();
  return fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-dest-"));
}

// ── Task 1: Schema migration ─────────────────────────────────────────────────

test("fresh queue DB has hub_url and org_id columns", () => {
  const dir = freshQueueDir();
  getQueueDb(dir);
  const db = getQueueDb(dir); // uses cached singleton
  const cols = db.prepare("PRAGMA table_info(uploads)").all();
  const names = cols.map((c) => c.name);
  assert.ok(names.includes("hub_url"), "expected hub_url column in uploads");
  assert.ok(names.includes("org_id"), "expected org_id column in uploads");
});

test("legacy DB (no destination columns) gains hub_url and org_id after open, existing row preserved with NULL destination", () => {
  const dir = freshQueueDir();

  // Build a legacy DB: only the original schema, no hub_url / org_id columns.
  const legacySchema = `
    CREATE TABLE IF NOT EXISTS uploads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      status          TEXT NOT NULL DEFAULT 'pending',
      repo_name       TEXT NOT NULL,
      commit_sha      TEXT NOT NULL,
      project_slug    TEXT,
      body            TEXT NOT NULL,
      last_error      TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      enqueued_at     TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL
    );
  `;
  const now = new Date().toISOString();
  const rawDb = new Database(path.join(dir, "hub-queue.db"));
  rawDb.exec(legacySchema);
  rawDb.exec(`
    INSERT INTO uploads (status, repo_name, commit_sha, body, enqueued_at, next_attempt_at)
    VALUES ('pending', 'legacy-repo', 'abc123', '{}', '${now}', '${now}')
  `);
  rawDb.close();

  // Now open via getQueueDb — this runs migrateQueueSchema.
  _resetQueueDb();
  getQueueDb(dir);
  const db = getQueueDb(dir);

  // Both destination columns must be present.
  const cols = db.prepare("PRAGMA table_info(uploads)").all();
  const names = cols.map((c) => c.name);
  assert.ok(names.includes("hub_url"), "expected hub_url column after migration");
  assert.ok(names.includes("org_id"), "expected org_id column after migration");

  // The legacy row must survive (now in 'held' status — see Task 2 tests).
  const rows = db.prepare("SELECT * FROM uploads").all();
  assert.equal(rows.length, 1, "legacy row must survive migration");
  assert.equal(rows[0].repo_name, "legacy-repo");
  // hub_url and org_id must be NULL (no synthetic default was injected).
  assert.equal(rows[0].hub_url, null, "hub_url should be NULL for legacy row");
  assert.equal(rows[0].org_id, null, "org_id should be NULL for legacy row");
});

test("opening an already-migrated DB a second time is a no-op (idempotent)", () => {
  const dir = freshQueueDir();

  // First open — runs migration.
  getQueueDb(dir);
  _resetQueueDb();

  // Second open — must not throw, must not alter or corrupt.
  assert.doesNotThrow(() => {
    getQueueDb(dir);
  }, "second open must not throw");

  const db = getQueueDb(dir);
  const cols = db.prepare("PRAGMA table_info(uploads)").all();
  const names = cols.map((c) => c.name);
  assert.ok(names.includes("hub_url"), "hub_url still present after second open");
  assert.ok(names.includes("org_id"), "org_id still present after second open");
});

// ── Task 2: Destination binding + requirement ────────────────────────────────

test("enqueueUpload persists hub_url and org_id onto the row", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload(
    {
      repoName: "my-repo",
      commitSha: "deadbeef",
      body: "{}",
      hubUrl: "https://hub.example.com",
      orgId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    dir,
  );
  assert.ok(id, "enqueue must return a row id");
  const rows = listAllUploads(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hub_url, "https://hub.example.com");
  assert.equal(rows[0].org_id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(rows[0].status, "pending");
});

test("enqueueUpload throws and writes no row when hubUrl is absent", () => {
  const dir = freshQueueDir();
  assert.throws(
    () =>
      enqueueUpload(
        { repoName: "r", commitSha: "c1", body: "{}", orgId: "some-org" },
        dir,
      ),
    /destination required/i,
    "must throw when hubUrl is missing",
  );
  assert.equal(listAllUploads(dir).length, 0, "no row must be written");
});

test("enqueueUpload throws and writes no row when orgId is absent", () => {
  const dir = freshQueueDir();
  assert.throws(
    () =>
      enqueueUpload(
        { repoName: "r", commitSha: "c1", body: "{}", hubUrl: "https://hub.example.com" },
        dir,
      ),
    /destination required/i,
    "must throw when orgId is missing",
  );
  assert.equal(listAllUploads(dir).length, 0, "no row must be written");
});

// ── Task 2: Legacy hold (SEC-06) ─────────────────────────────────────────────

test("legacy pending row (org_id NULL) becomes 'held' after migration, excluded from listDueUploads, counted in queueStats().held", () => {
  const dir = freshQueueDir();

  // Create a legacy DB with a pending row that has no destination.
  const legacySchema = `
    CREATE TABLE IF NOT EXISTS uploads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      status          TEXT NOT NULL DEFAULT 'pending',
      repo_name       TEXT NOT NULL,
      commit_sha      TEXT NOT NULL,
      project_slug    TEXT,
      body            TEXT NOT NULL,
      last_error      TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      enqueued_at     TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS uploads_status_next_attempt_idx
      ON uploads(status, next_attempt_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uploads_dedup_idx
      ON uploads(repo_name, commit_sha) WHERE status = 'pending';
  `;
  // Use a backdated next_attempt_at so it would be "due" if not held.
  const past = new Date(Date.now() - 60000).toISOString();
  const rawDb = new Database(path.join(dir, "hub-queue.db"));
  rawDb.exec(legacySchema);
  rawDb.exec(`
    INSERT INTO uploads (status, repo_name, commit_sha, body, enqueued_at, next_attempt_at)
    VALUES ('pending', 'legacy-repo', 'abc123', '{}', '${past}', '${past}')
  `);
  rawDb.close();

  // Open via getQueueDb — migration runs, holds legacy row.
  _resetQueueDb();
  getQueueDb(dir);

  // Legacy row must now be 'held'.
  const rows = listAllUploads(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "held", "legacy row must be moved to held");

  // listDueUploads must NOT return held rows even though next_attempt_at is past.
  const due = listDueUploads(50, dir);
  assert.equal(due.length, 0, "held row must not appear in listDueUploads");

  // queueStats must show held=1, pending=0.
  const stats = queueStats(dir);
  assert.equal(stats.held, 1, "queueStats().held must be 1");
  assert.equal(stats.pending, 0, "queueStats().pending must exclude held row");
});

test("queueStats returns numeric pending, dead, held, oldestPending with correct meaning", () => {
  const dir = freshQueueDir();

  // Enqueue two proper (bound) rows.
  enqueueUpload(
    { repoName: "r1", commitSha: "c1", body: "{}", hubUrl: "https://h.test", orgId: "org-1" },
    dir,
  );
  enqueueUpload(
    { repoName: "r2", commitSha: "c2", body: "{}", hubUrl: "https://h.test", orgId: "org-1" },
    dir,
  );

  const stats = queueStats(dir);
  assert.equal(typeof stats.pending, "number", "pending must be a number");
  assert.equal(typeof stats.dead, "number", "dead must be a number");
  assert.equal(typeof stats.held, "number", "held must be a number");
  assert.equal(stats.pending, 2, "both bound rows should be pending");
  assert.equal(stats.dead, 0);
  assert.equal(stats.held, 0, "no held rows in a fresh DB with bound enqueues");
  assert.ok(
    stats.oldestPending === null || typeof stats.oldestPending === "string",
    "oldestPending must be null or ISO string",
  );
});
