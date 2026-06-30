/**
 * queue.dead.test.js — Unit tests for markUploadDead() and queueStats consistency.
 *
 * SEC-07: a non-retriable dead transition must be unconditional (one call),
 * and queueStats() counters must equal the counts of rows at each status in
 * the database — no drift between the report and persisted state.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enqueueUpload,
  listAllUploads,
  markUploadDead,
  queueStats,
  _resetQueueDb,
} from "./queue.js";

function freshQueueDir() {
  _resetQueueDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-queue-dead-"));
  return dir;
}

// ── (a) single-call dead transition ──────────────────────────────────────────

test("markUploadDead flips a pending row to status='dead' in exactly one call", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload(
    {
      repoName: "repo-a",
      commitSha: "sha-a1",
      body: "{}",
      hubUrl: "https://hub.test",
      orgId: "org-a",
    },
    dir,
  );

  const out = markUploadDead(id, "401 unauthorized", dir);

  // Return value
  assert.equal(out.status, "dead");
  assert.equal(out.attempts, 1, "attempts incremented from 0 to 1 on first dead call");
  assert.equal(out.next_attempt_at, null);

  // Persisted row — status and attempts must be correct.
  // next_attempt_at in the DB holds a placeholder timestamp (NOT NULL constraint);
  // the function's return value carries null to signal "no retry scheduled".
  const rows = listAllUploads(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "dead");
  assert.equal(rows[0].attempts, 1);
  // The row must NOT appear in a future listDueUploads (status != 'pending').
  assert.ok(rows[0].next_attempt_at, "placeholder timestamp present (NOT NULL schema)");
});

// ── (b) queueStats counters equal persisted row states ────────────────────────

test("queueStats().dead === 1 and pending === 0 after markUploadDead; counts match listAllUploads", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload(
    {
      repoName: "repo-b",
      commitSha: "sha-b1",
      body: "{}",
      hubUrl: "https://hub.test",
      orgId: "org-b",
    },
    dir,
  );

  markUploadDead(id, "400 bad request", dir);

  const stats = queueStats(dir);
  assert.equal(stats.dead, 1, "stats.dead should be 1");
  assert.equal(stats.pending, 0, "stats.pending should be 0");

  // Verify counters equal direct row-count from listAllUploads
  const rows = listAllUploads(dir);
  const deadCount = rows.filter((r) => r.status === "dead").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  assert.equal(stats.dead, deadCount, "stats.dead must equal actual dead row count");
  assert.equal(stats.pending, pendingCount, "stats.pending must equal actual pending row count");
});

test("queueStats stays consistent when multiple rows are deaded individually", () => {
  const dir = freshQueueDir();
  const id1 = enqueueUpload(
    { repoName: "repo-c", commitSha: "sha-c1", body: "{}", hubUrl: "https://h.test", orgId: "org-c" },
    dir,
  );
  const id2 = enqueueUpload(
    { repoName: "repo-d", commitSha: "sha-d1", body: "{}", hubUrl: "https://h.test", orgId: "org-c" },
    dir,
  );

  markUploadDead(id1, "403 forbidden", dir);

  let stats = queueStats(dir);
  assert.equal(stats.dead, 1);
  assert.equal(stats.pending, 1);

  markUploadDead(id2, "404 not found", dir);

  stats = queueStats(dir);
  assert.equal(stats.dead, 2);
  assert.equal(stats.pending, 0);

  // Cross-check with list
  const rows = listAllUploads(dir);
  const deadCount = rows.filter((r) => r.status === "dead").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  assert.equal(stats.dead, deadCount);
  assert.equal(stats.pending, pendingCount);
});

// ── (c) missing id is a safe no-op ───────────────────────────────────────────

test("markUploadDead on a non-existent id returns status='missing' and changes nothing", () => {
  const dir = freshQueueDir();
  enqueueUpload(
    { repoName: "repo-e", commitSha: "sha-e1", body: "{}", hubUrl: "https://h.test", orgId: "org-e" },
    dir,
  );

  const out = markUploadDead(9999, "should not affect anything", dir);
  assert.equal(out.status, "missing");
  assert.equal(out.attempts, 0);
  assert.equal(out.next_attempt_at, null);

  // Existing row untouched
  const rows = listAllUploads(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");

  const stats = queueStats(dir);
  assert.equal(stats.pending, 1);
  assert.equal(stats.dead, 0);
});
