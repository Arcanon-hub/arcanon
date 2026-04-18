import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enqueueUpload,
  listDueUploads,
  listAllUploads,
  markUploadFailure,
  deleteUpload,
  pruneDead,
  queueStats,
  getQueueDb,
  _resetQueueDb,
  MAX_ATTEMPTS,
  RETRY_SCHEDULE_SECONDS,
} from "./queue.js";

function freshQueueDir() {
  _resetQueueDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-queue-"));
  return dir;
}

test("enqueue + listAll round-trips a single row", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload(
    { repoName: "r", commitSha: "c1", projectSlug: "p", body: "{}" },
    dir,
  );
  assert.ok(id);
  const rows = listAllUploads(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repo_name, "r");
  assert.equal(rows[0].status, "pending");
});

test("enqueue dedupes by (repo_name, commit_sha) — replaces body/last_error", () => {
  const dir = freshQueueDir();
  const first = enqueueUpload(
    { repoName: "r", commitSha: "c1", body: "{}", lastError: "fail1" },
    dir,
  );
  const second = enqueueUpload(
    { repoName: "r", commitSha: "c1", body: '{"v":2}', lastError: "fail2" },
    dir,
  );
  assert.equal(first, second); // same id
  const rows = listAllUploads(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, '{"v":2}');
  assert.equal(rows[0].last_error, "fail2");
});

test("markUploadFailure moves row to dead after MAX_ATTEMPTS", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload({ repoName: "r", commitSha: "c2", body: "{}" }, dir);
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    const out = markUploadFailure(id, `attempt ${i}`, dir);
    assert.equal(out.status, "pending");
  }
  const final = markUploadFailure(id, "last", dir);
  assert.equal(final.status, "dead");
  const stats = queueStats(dir);
  assert.equal(stats.dead, 1);
  assert.equal(stats.pending, 0);
});

test("listDueUploads only returns rows whose next_attempt_at has arrived", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload({ repoName: "r", commitSha: "c3", body: "{}" }, dir);
  // A freshly-enqueued row waits 30s before it's due.
  assert.equal(listDueUploads(50, dir).length, 0);
  // After backdating next_attempt_at, it becomes due.
  const db = getQueueDb(dir);
  db.prepare(`UPDATE uploads SET next_attempt_at = ? WHERE id = ?`).run(
    new Date(Date.now() - 1000).toISOString(),
    id,
  );
  const due = listDueUploads(50, dir);
  assert.equal(due.length, 1);
});

test("deleteUpload removes the row", () => {
  const dir = freshQueueDir();
  const id = enqueueUpload({ repoName: "r", commitSha: "c4", body: "{}" }, dir);
  deleteUpload(id, dir);
  assert.equal(listAllUploads(dir).length, 0);
});

test("RETRY_SCHEDULE_SECONDS matches documented policy", () => {
  assert.deepEqual(RETRY_SCHEDULE_SECONDS, [30, 120, 600, 3600, 21600]);
});

test("pruneDead deletes status='dead' rows and leaves pending rows alone", () => {
  const dir = freshQueueDir();
  const pendingId = enqueueUpload({ repoName: "r-pending", commitSha: "c1", body: "{}" }, dir);
  const doomedId = enqueueUpload({ repoName: "r-dead", commitSha: "c2", body: "{}" }, dir);
  // Force the doomed row to dead.
  for (let i = 0; i < MAX_ATTEMPTS; i++) markUploadFailure(doomedId, "sim", dir);
  assert.equal(queueStats(dir).dead, 1);

  const deleted = pruneDead(dir);
  assert.equal(deleted, 1);

  const stats = queueStats(dir);
  assert.equal(stats.dead, 0);
  assert.equal(stats.pending, 1);
  assert.equal(listAllUploads(dir)[0].id, pendingId);
});

test("pruneDead returns 0 when there are no dead rows", () => {
  const dir = freshQueueDir();
  enqueueUpload({ repoName: "r", commitSha: "c", body: "{}" }, dir);
  assert.equal(pruneDead(dir), 0);
});
