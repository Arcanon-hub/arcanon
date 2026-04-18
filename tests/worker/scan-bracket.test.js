/**
 * tests/worker/scan-bracket.test.js
 *
 * Tests for the beginScan/endScan bracket wiring in scanRepos (scan/manager.js).
 *
 * Uses a mock queryEngine that records method calls in order, allowing
 * assertion of the exact call sequence without touching a real SQLite DB.
 */

import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import { scanRepos, setAgentRunner } from "../../worker/scan/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal temp git repo and return its path. */
function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "arcanon-bracket-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  // Initial commit so HEAD is valid
  writeFileSync(join(dir, "index.js"), "module.exports = {}");
  execSync("git add index.js", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
  return dir;
}

/**
 * Build a mock queryEngine that:
 * - Records all method calls in `calls` array as { method, args }
 * - beginScan returns a fixed scan version ID (100)
 * - upsertRepo returns an object with id property
 * - getRepoState returns repoState param (null = first scan → full mode)
 */
function makeMockQE({ repoState = null, scanVersionId = 100 } = {}) {
  const calls = [];

  return {
    calls,
    upsertRepo: (repoData) => {
      calls.push({ method: "upsertRepo", args: [repoData] });
      return { id: 42 };
    },
    getRepoState: (id) => {
      calls.push({ method: "getRepoState", args: [id] });
      return repoState;
    },
    beginScan: (repoId) => {
      calls.push({ method: "beginScan", args: [repoId] });
      return scanVersionId;
    },
    persistFindings: (repoId, findings, commit, svId) => {
      calls.push({ method: "persistFindings", args: [repoId, findings, commit, svId] });
    },
    endScan: (repoId, svId) => {
      calls.push({ method: "endScan", args: [repoId, svId] });
    },
    setRepoState: (repoId, commit) => {
      calls.push({ method: "setRepoState", args: [repoId, commit] });
    },
  };
}

/** A valid findings JSON string (wraps in code fence as agent output). */
function validFindingsResponse(name = "test-svc") {
  return `\`\`\`json\n${JSON.stringify({
    service_name: name,
    confidence: "high",
    services: [{ name, root_path: ".", language: "javascript", confidence: "high" }],
    connections: [],
    schemas: [],
  })}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Test Suite 1: full mode (agent succeeds) — call order assertion
// ---------------------------------------------------------------------------

describe("scanRepos bracket — mode=full, agent succeeds", () => {
  let repoDir;

  before(() => {
    repoDir = makeTempRepo();
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    setAgentRunner(null);
  });

  test("call order: upsertRepo → beginScan → agentRunner → persistFindings (with scanVersionId) → endScan", async () => {
    const qe = makeMockQE({ repoState: null, scanVersionId: 100 });
    const agentCalls = [];

    setAgentRunner(async (_prompt, repoPath) => {
      agentCalls.push(repoPath);
      return validFindingsResponse("test-svc");
    });

    const results = await scanRepos([repoDir], {}, qe);

    // Agent was called once
    assert.equal(agentCalls.length, 1, "agent must be called exactly once");

    // Results unchanged — ScanResult structure preserved
    assert.equal(results.length, 1);
    assert.equal(results[0].mode, "full");
    assert.ok(results[0].findings !== null, "findings should be present");
    assert.equal(results[0].findings.service_name, "test-svc");
    assert.ok(!("beginScan" in results[0]), "ScanResult must not expose beginScan");
    assert.ok(!("scanVersionId" in results[0]), "ScanResult must not expose scanVersionId");

    // Verify call sequence
    const methodNames = qe.calls.map((c) => c.method);

    // upsertRepo comes before beginScan
    const upsertIdx = methodNames.indexOf("upsertRepo");
    const beginIdx = methodNames.indexOf("beginScan");
    const persistIdx = methodNames.indexOf("persistFindings");
    const endIdx = methodNames.indexOf("endScan");

    assert.ok(upsertIdx >= 0, "upsertRepo must be called");
    assert.ok(beginIdx >= 0, "beginScan must be called");
    assert.ok(persistIdx >= 0, "persistFindings must be called");
    assert.ok(endIdx >= 0, "endScan must be called");

    assert.ok(beginIdx > upsertIdx, "beginScan must come after upsertRepo");
    assert.ok(persistIdx > beginIdx, "persistFindings must come after beginScan");
    assert.ok(endIdx > persistIdx, "endScan must come after persistFindings");

    // persistFindings receives the scanVersionId from beginScan
    const persistCall = qe.calls.find((c) => c.method === "persistFindings");
    assert.ok(persistCall, "persistFindings call must exist");
    assert.equal(persistCall.args[3], 100, "persistFindings must receive scanVersionId=100");

    // endScan receives the same scanVersionId
    const endCall = qe.calls.find((c) => c.method === "endScan");
    assert.ok(endCall, "endScan call must exist");
    assert.equal(endCall.args[1], 100, "endScan must receive scanVersionId=100");

    // setRepoState must NOT be called directly (persistFindings handles it)
    assert.ok(
      !methodNames.includes("setRepoState"),
      "setRepoState must NOT be called directly — persistFindings handles it",
    );
  });
});

// ---------------------------------------------------------------------------
// Test Suite 2: skip mode — no bracket calls
// ---------------------------------------------------------------------------

describe("scanRepos bracket — mode=skip", () => {
  let repoDir;

  before(() => {
    repoDir = makeTempRepo();
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    setAgentRunner(null);
  });

  test("skip mode: beginScan and endScan are NOT called", async () => {
    // Get current HEAD so skip mode is triggered
    const head = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();

    const qe = makeMockQE({
      repoState: { last_scanned_commit: head, last_scanned_at: null },
    });

    setAgentRunner(async () => {
      throw new Error("agent must not be called in skip mode");
    });

    const results = await scanRepos([repoDir], {}, qe);

    assert.equal(results.length, 1);
    assert.equal(results[0].mode, "skip");

    const methodNames = qe.calls.map((c) => c.method);
    assert.ok(!methodNames.includes("beginScan"), "beginScan must NOT be called in skip mode");
    assert.ok(!methodNames.includes("endScan"), "endScan must NOT be called in skip mode");
    assert.ok(!methodNames.includes("persistFindings"), "persistFindings must NOT be called in skip mode");
  });
});

// ---------------------------------------------------------------------------
// Test Suite 3: agent parse failure — beginScan called, endScan NOT called
// ---------------------------------------------------------------------------

describe("scanRepos bracket — agent parse failure", () => {
  let repoDir;

  before(() => {
    repoDir = makeTempRepo();
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    setAgentRunner(null);
  });

  test("parse failure: beginScan IS called, endScan is NOT called, prior data preserved", async () => {
    const qe = makeMockQE({ repoState: null, scanVersionId: 200 });

    setAgentRunner(async () => "not valid json at all — parse will fail");

    const results = await scanRepos([repoDir], {}, qe);

    assert.equal(results.length, 1);
    assert.equal(results[0].findings, null);
    assert.ok("error" in results[0], "result must have error field on parse failure");

    const methodNames = qe.calls.map((c) => c.method);

    // beginScan IS called — scan was started
    assert.ok(methodNames.includes("beginScan"), "beginScan must be called even on parse failure");

    // endScan is NOT called — prior data preserved
    assert.ok(!methodNames.includes("endScan"), "endScan must NOT be called on parse failure");

    // persistFindings is NOT called
    assert.ok(!methodNames.includes("persistFindings"), "persistFindings must NOT be called on parse failure");
  });
});
