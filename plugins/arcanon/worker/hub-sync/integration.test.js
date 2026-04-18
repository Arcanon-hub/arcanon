/**
 * integration.test.js — End-to-end test with a mock hub server.
 *
 * Spins up a tiny HTTP server that mimics the Arcanon Hub upload endpoint,
 * then exercises syncFindings() through the full pipeline: build payload,
 * serialize, POST, parse response. Also exercises failure → enqueue flow.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { syncFindings } from "./index.js";
import { _resetQueueDb, queueStats } from "./queue.js";

function makeTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-integration-"));
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "it@arcanon.dev"]);
  git(["config", "user.name", "Integration"]);
  fs.writeFileSync(path.join(dir, "README"), "hello");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return dir;
}

function startMockHub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => handler(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("syncFindings happy-path round-trips through mock hub", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  process.env.ARCANON_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "arcanon-it-data-"),
  );
  process.env.ARCANON_API_KEY = "arc_it";

  let seen = null;
  const { server, url } = await startMockHub((req, res, body) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization, body };
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ scan_upload_id: "uuid-1", status: "processing", latest_payload_version: "1.0" }));
  });

  try {
    const outcome = await syncFindings({
      findings: {
        services: [{ name: "svc-a", language: "ts" }],
        connections: [{ source: "svc-a", target: "db", protocol: "rest" }],
      },
      repoPath,
      projectSlug: "integration-test",
      hubUrl: url,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.scan_upload_id, "uuid-1");
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/api/v1/scans/upload");
    assert.equal(seen.auth, "Bearer arc_it");
    const body = JSON.parse(seen.body);
    assert.equal(body.version, "1.0");
    assert.equal(body.metadata.tool, "claude-code");
    assert.equal(body.metadata.project_slug, "integration-test");
    assert.equal(body.findings.services.length, 1);
  } finally {
    await stopServer(server);
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_DATA_DIR;
  }
});

test("syncFindings enqueues payload when hub returns 5xx", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-data-"));
  process.env.ARCANON_DATA_DIR = dataDir;
  process.env.ARCANON_API_KEY = "arc_it";

  const { server, url } = await startMockHub((req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ title: "service unavailable" }));
  });

  try {
    const outcome = await syncFindings({
      findings: {
        services: [{ name: "svc-a", language: "ts" }],
        connections: [],
      },
      repoPath,
      projectSlug: "integration-test",
      hubUrl: url,
    });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.enqueuedId, "expected retriable failure to enqueue");
    const stats = queueStats();
    assert.equal(stats.pending, 1);
  } finally {
    await stopServer(server);
    _resetQueueDb();
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_DATA_DIR;
  }
});

test("syncFindings surfaces 422 without enqueueing", async () => {
  _resetQueueDb();
  const repoPath = makeTempGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-it-data-"));
  process.env.ARCANON_DATA_DIR = dataDir;
  process.env.ARCANON_API_KEY = "arc_it";

  const { server, url } = await startMockHub((req, res) => {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ title: "validation failed", detail: "bad tool" }));
  });

  try {
    const outcome = await syncFindings({
      findings: { services: [{ name: "svc" }], connections: [] },
      repoPath,
      projectSlug: "it",
      hubUrl: url,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.enqueuedId, undefined, "422 must not enqueue");
    const stats = queueStats();
    assert.equal(stats.pending, 0);
  } finally {
    await stopServer(server);
    _resetQueueDb();
    delete process.env.ARCANON_API_KEY;
    delete process.env.ARCANON_DATA_DIR;
  }
});
