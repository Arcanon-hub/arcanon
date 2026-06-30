/**
 * drain-tenant.test.js — Integration tests for drainQueue tenant-safety (SEC-05, SEC-07).
 *
 * SEC-05 cross-org isolation: a row enqueued under org A must be uploaded to A
 * even after the active credentials switch to org B.
 *
 * SEC-07 dead-in-one: a non-retriable 4xx (401/400) transitions the row to
 * status='dead' after exactly ONE drain attempt, with report counters matching
 * the persisted queueStats.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enqueueUpload,
  listAllUploads,
  queueStats,
  getQueueDb,
  _resetQueueDb,
} from "./queue.js";
import { drainQueue } from "./index.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function freshQueueDir() {
  _resetQueueDb();
  return fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-drain-tenant-"));
}

/** Backdate next_attempt_at so the row is immediately due. */
function backdateRow(dir, id) {
  const db = getQueueDb(dir);
  db.prepare(`UPDATE uploads SET next_attempt_at = ? WHERE id = ?`).run(
    new Date(Date.now() - 2000).toISOString(),
    id,
  );
}

/** Save + restore a subset of env vars around a test body (async-safe). */
function withEnv(vars, fn) {
  return async () => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      _resetQueueDb();
    }
  };
}

/** Minimal JSON body that uploadScan will accept (builds a trivial payload). */
const BODY = JSON.stringify({
  schema_version: "1.0",
  metadata: { repo_name: "r", commit_sha: "abc", project_slug: "p" },
  findings: [],
});

// ── SEC-05: cross-org isolation ───────────────────────────────────────────────

test(
  "SEC-05: drainQueue uploads to row.hub_url/org_id (org A), not the active creds (org B)",
  withEnv(
    {
      ARCANON_API_KEY: "arc_testkey",
      ARCANON_ORG_ID: "org-B",
      ARCANON_HUB_URL: "https://b.example",
    },
    async () => {
      const dir = freshQueueDir();
      const captured = [];

      const fetchImpl = async (url, reqOpts) => {
        captured.push({ url, headers: reqOpts.headers });
        return {
          status: 202,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ scan_upload_id: "s1", status: "accepted" }),
        };
      };

      // Enqueue under org A — destination is immutably stored on the row.
      const id = enqueueUpload(
        {
          repoName: "r",
          commitSha: "sha-sec05",
          body: BODY,
          hubUrl: "https://a.example",
          orgId: "org-A",
        },
        dir,
      );
      backdateRow(dir, id);

      const report = await drainQueue({ fetchImpl, dataDir: dir });

      // One successful upload
      assert.equal(report.succeeded, 1, "report.succeeded should be 1");
      assert.equal(report.failed, 0);
      assert.equal(report.dead, 0);

      // Exactly one HTTP request was made
      assert.equal(captured.length, 1, "fetchImpl called exactly once");

      // Request went to org A's URL — NEVER to b.example
      assert.ok(
        captured[0].url.startsWith("https://a.example"),
        `Expected URL to start with https://a.example, got: ${captured[0].url}`,
      );
      assert.equal(
        captured[0].headers["X-Org-Id"],
        "org-A",
        `Expected X-Org-Id=org-A, got: ${captured[0].headers["X-Org-Id"]}`,
      );

      // Row deleted on success (202)
      assert.equal(listAllUploads(dir).length, 0, "successful row must be deleted");
    },
  ),
);

test(
  "SEC-05: request never goes to active-org URL (b.example) when row is bound to a.example",
  withEnv(
    {
      ARCANON_API_KEY: "arc_testkey",
      ARCANON_ORG_ID: "org-B",
      ARCANON_HUB_URL: "https://b.example",
    },
    async () => {
      const dir = freshQueueDir();
      const requestUrls = [];

      const fetchImpl = async (url) => {
        requestUrls.push(url);
        return {
          status: 202,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({ scan_upload_id: "s2", status: "accepted" }),
        };
      };

      const id = enqueueUpload(
        {
          repoName: "r",
          commitSha: "sha-sec05-b",
          body: BODY,
          hubUrl: "https://a.example",
          orgId: "org-A",
        },
        dir,
      );
      backdateRow(dir, id);

      await drainQueue({ fetchImpl, dataDir: dir });

      // No request should have gone to b.example
      const wrongUrls = requestUrls.filter((u) => u.includes("b.example"));
      assert.equal(
        wrongUrls.length,
        0,
        `Expected no requests to b.example; got: ${JSON.stringify(wrongUrls)}`,
      );
    },
  ),
);

// ── SEC-07: dead-in-one-attempt for non-retriable 4xx ─────────────────────────

test(
  "SEC-07: 401 response transitions row to dead in a single drain; counters match persisted state",
  withEnv(
    { ARCANON_API_KEY: "arc_testkey", ARCANON_ORG_ID: "org-A", ARCANON_HUB_URL: "https://a.example" },
    async () => {
      const dir = freshQueueDir();

      const fetchImpl = async () => ({
        status: 401,
        headers: { get: () => null },
        text: async () => JSON.stringify({ code: "invalid_key", title: "Unauthorized" }),
      });

      const id = enqueueUpload(
        { repoName: "r", commitSha: "sha-401", body: BODY, hubUrl: "https://a.example", orgId: "org-A" },
        dir,
      );
      backdateRow(dir, id);

      const report = await drainQueue({ fetchImpl, dataDir: dir });

      // Report counters
      assert.equal(report.attempted, 1, "attempted should be 1");
      assert.equal(report.dead, 1, "dead should be 1");
      assert.equal(report.failed, 0, "failed should be 0");
      assert.equal(report.succeeded, 0);

      // Persisted row state
      const rows = listAllUploads(dir);
      assert.equal(rows.length, 1, "row must still exist (status=dead)");
      assert.equal(rows[0].status, "dead", "row status must be dead");
      assert.equal(rows[0].attempts, 1, "row attempts must be 1 (tried once)");

      // queueStats matches persisted state
      const stats = queueStats(dir);
      assert.equal(stats.dead, 1, "queueStats.dead must be 1");
      assert.equal(stats.pending, 0, "queueStats.pending must be 0");

      // report.dead matches queueStats.dead (no counter drift)
      assert.equal(report.dead, stats.dead, "report.dead must equal queueStats.dead");
    },
  ),
);

test(
  "SEC-07: 400 response transitions row to dead in a single drain",
  withEnv(
    { ARCANON_API_KEY: "arc_testkey", ARCANON_ORG_ID: "org-A", ARCANON_HUB_URL: "https://a.example" },
    async () => {
      const dir = freshQueueDir();

      const fetchImpl = async () => ({
        status: 400,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ code: "invalid_x_org_id", title: "Bad Request" }),
      });

      const id = enqueueUpload(
        { repoName: "r", commitSha: "sha-400", body: BODY, hubUrl: "https://a.example", orgId: "org-A" },
        dir,
      );
      backdateRow(dir, id);

      const report = await drainQueue({ fetchImpl, dataDir: dir });

      assert.equal(report.dead, 1);
      assert.equal(report.failed, 0);
      assert.equal(report.attempted, 1);

      const rows = listAllUploads(dir);
      assert.equal(rows[0].status, "dead");

      const stats = queueStats(dir);
      assert.equal(stats.dead, 1);
      assert.equal(stats.pending, 0);
      assert.equal(report.dead, stats.dead);
    },
  ),
);

// ── Defense-in-depth: missing destination is never sent to current org ─────────

test(
  "drainQueue skips a due row whose hub_url/org_id is missing — never uploads to current org",
  withEnv(
    { ARCANON_API_KEY: "arc_testkey", ARCANON_ORG_ID: "org-B", ARCANON_HUB_URL: "https://b.example" },
    async () => {
      const dir = freshQueueDir();
      const requestUrls = [];

      const fetchImpl = async (url) => {
        requestUrls.push(url);
        return {
          status: 202,
          headers: { get: () => null },
          text: async () => JSON.stringify({ scan_upload_id: "s3", status: "accepted" }),
        };
      };

      // Insert a row directly with null destination (bypasses enqueueUpload validation)
      const db = getQueueDb(dir);
      db.prepare(
        `INSERT INTO uploads (status, repo_name, commit_sha, body, attempts, enqueued_at, next_attempt_at, hub_url, org_id)
         VALUES ('pending', 'r', 'sha-nodest', '{}', 0, datetime('now'), datetime('now', '-1 minute'), NULL, NULL)`,
      ).run();

      const report = await drainQueue({ fetchImpl, dataDir: dir });

      // The row must NOT have been uploaded anywhere
      assert.equal(requestUrls.length, 0, "fetchImpl must never be called for a missing-destination row");
      assert.equal(report.succeeded, 0);
      assert.equal(report.failed, 1, "missing-destination row counted as failed");
      assert.equal(report.dead, 0);

      // Row left untouched (still pending — held-like)
      const rows = listAllUploads(dir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "pending");
    },
  ),
);
