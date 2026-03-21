/**
 * worker/scan-manager.test.js — Unit tests for scan-manager.js
 *
 * Tests for:
 *  - getChangedFiles(repoPath, sinceCommit)
 *  - buildScanContext(repoPath, repoId, queryEngine, options)
 *  - scanRepos(repoPaths, options, queryEngine) — Task 2
 *
 * Uses real temp git repos for git-based tests (no mocking git itself).
 * Uses node:test + node:assert/strict — zero external dependencies.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getChangedFiles,
  buildScanContext,
  scanRepos,
  setAgentRunner,
} from "./manager.js";

// ---------------------------------------------------------------------------
// Helpers to build temp git repos
// ---------------------------------------------------------------------------

/**
 * Creates a temp directory with a git repo, makes an initial empty commit,
 * and returns the repo path and the initial HEAD commit hash.
 */
function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ligamen-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: "pipe" });
  const head = execSync("git rev-parse HEAD", {
    cwd: dir,
    encoding: "utf8",
  }).trim();
  return { dir, head };
}

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// getChangedFiles tests
// ---------------------------------------------------------------------------

describe("getChangedFiles", () => {
  let repoDir;
  let initialHead;

  before(() => {
    const { dir, head } = makeTempRepo();
    repoDir = dir;
    initialHead = head;
  });

  after(() => cleanupDir(repoDir));

  test("returns { error } when repoPath has no .git", () => {
    const noGitDir = mkdtempSync(join(tmpdir(), "ligamen-nogit-"));
    try {
      const result = getChangedFiles(noGitDir, null);
      assert.ok("error" in result, "should return { error }");
      assert.equal(result.error, "not a git repo");
    } finally {
      cleanupDir(noGitDir);
    }
  });

  test("with sinceCommit=null returns all tracked files as modified", () => {
    // Add a tracked file
    writeFileSync(join(repoDir, "a.txt"), "hello");
    execSync("git add a.txt", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "add a.txt"', { cwd: repoDir, stdio: "pipe" });

    const result = getChangedFiles(repoDir, null);
    assert.ok(Array.isArray(result.modified), "modified should be an array");
    assert.ok(result.modified.includes("a.txt"), "a.txt should be in modified");
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.renamed, []);
  });

  test("detects modified files between two commits", () => {
    // current HEAD is after a.txt added
    const baseCommit = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();
    writeFileSync(join(repoDir, "b.txt"), "world");
    execSync("git add b.txt", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "add b.txt"', { cwd: repoDir, stdio: "pipe" });

    const result = getChangedFiles(repoDir, baseCommit);
    assert.ok(result.modified.includes("b.txt"), "b.txt should be modified");
    assert.ok(
      !result.modified.includes("a.txt"),
      "a.txt not changed since baseCommit",
    );
  });

  test("detects deleted files", () => {
    const baseCommit = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();
    execSync("git rm a.txt", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "remove a.txt"', { cwd: repoDir, stdio: "pipe" });

    const result = getChangedFiles(repoDir, baseCommit);
    assert.ok(result.deleted.includes("a.txt"), "a.txt should be in deleted");
    assert.ok(
      !result.modified.includes("a.txt"),
      "a.txt should not be in modified",
    );
  });

  test("detects renamed files", () => {
    // Add old.txt first, then set base to that commit
    writeFileSync(join(repoDir, "old.txt"), "rename me");
    execSync("git add old.txt", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "add old.txt"', { cwd: repoDir, stdio: "pipe" });
    // Now capture base AFTER old.txt is committed so git can see the rename
    const baseCommit = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();
    execSync("git mv old.txt new.txt", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "rename old to new"', {
      cwd: repoDir,
      stdio: "pipe",
    });

    const result = getChangedFiles(repoDir, baseCommit);
    assert.ok(Array.isArray(result.renamed), "renamed should be an array");
    const rename = result.renamed.find(
      (r) => r.from === "old.txt" && r.to === "new.txt",
    );
    assert.ok(rename, "should have rename entry from=old.txt to=new.txt");
  });
});

// ---------------------------------------------------------------------------
// buildScanContext tests
// ---------------------------------------------------------------------------

describe("buildScanContext", () => {
  let repoDir;
  let currentHead;

  before(() => {
    const { dir, head } = makeTempRepo();
    repoDir = dir;
    currentHead = head;
  });

  after(() => cleanupDir(repoDir));

  test("options.full=true returns mode:full regardless of repo_state", () => {
    const qe = {
      getRepoState: () => ({
        last_scanned_commit: "abc",
        last_scanned_at: null,
      }),
    };
    const ctx = buildScanContext(repoDir, 1, qe, { full: true });
    assert.equal(ctx.mode, "full");
    assert.equal(ctx.files, null);
  });

  test("no repo_state entry returns mode:full (first scan auto-full per SCAN-06)", () => {
    const qe = { getRepoState: () => null };
    const ctx = buildScanContext(repoDir, 1, qe, {});
    assert.equal(ctx.mode, "full");
    assert.equal(ctx.files, null);
  });

  test("repo_state exists and HEAD matches last_scanned_commit returns mode:skip", () => {
    const head = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();
    const qe = {
      getRepoState: () => ({
        last_scanned_commit: head,
        last_scanned_at: null,
      }),
    };
    const ctx = buildScanContext(repoDir, 1, qe, {});
    assert.equal(ctx.mode, "skip");
    assert.equal(ctx.files, null);
  });

  test("repo_state exists with different commit returns mode:incremental with files", () => {
    const oldCommit = "aaaaaaa";
    const qe = {
      getRepoState: () => ({
        last_scanned_commit: oldCommit,
        last_scanned_at: null,
      }),
    };
    // oldCommit doesn't exist in repo, getChangedFiles falls back gracefully
    // For this test, we just check mode and that files has the right shape
    const ctx = buildScanContext(repoDir, 1, qe, {});
    assert.equal(ctx.mode, "incremental");
    assert.ok(
      ctx.files !== null,
      "files should not be null for incremental mode",
    );
  });
});

// ---------------------------------------------------------------------------
// scanRepos tests (Task 2)
// ---------------------------------------------------------------------------

describe("scanRepos", () => {
  let repoDir;

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
    // Add a file so HEAD is a real commit
    writeFileSync(join(dir, "index.js"), "module.exports = {}");
    execSync("git add index.js", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add index.js"', { cwd: dir, stdio: "pipe" });
  });

  after(() => {
    cleanupDir(repoDir);
  });

  beforeEach(() => {
    // Reset agentRunner before each test
    setAgentRunner(null);
  });

  /**
   * Build a minimal mock queryEngine for scanRepos tests.
   * repoState=null means no prior scan (first scan → full).
   * Includes beginScan/persistFindings/endScan for the scan version bracket.
   */
  function makeQueryEngine({ repoState = null } = {}) {
    return {
      upsertRepo: (repoData) => ({ id: 42 }),
      getRepoState: (_id) => repoState,
      setRepoState: (_id, _commit) => {},
      getRepoByPath: (_path) => null,
      beginScan: (_repoId) => 1,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
    };
  }

  test("throws when agentRunner not set", async () => {
    setAgentRunner(null);
    const qe = makeQueryEngine({ repoState: null });
    await assert.rejects(
      () => scanRepos([repoDir], {}, qe),
      /agentRunner not initialized/,
    );
  });

  test("skip mode: repo at HEAD === last_scanned_commit produces zero agent invocations", async () => {
    const head = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();
    const qe = makeQueryEngine({
      repoState: { last_scanned_commit: head, last_scanned_at: null },
    });
    let agentCallCount = 0;
    setAgentRunner(async (_prompt, _path) => {
      agentCallCount++;
      return "";
    });

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(agentCallCount, 0, "agent should not be called for skip");
    assert.equal(results.length, 1);
    assert.equal(results[0].mode, "skip");
    assert.equal(results[0].findings, null);
  });

  test("error isolation: bad agent output for repo 1 does not stop repo 2", async () => {
    const repo2 = makeTempRepo();
    writeFileSync(join(repo2.dir, "app.js"), "const x = 1;");
    execSync("git add app.js", { cwd: repo2.dir, stdio: "pipe" });
    execSync('git commit -m "add app.js"', { cwd: repo2.dir, stdio: "pipe" });

    const qe = makeQueryEngine({ repoState: null });
    let callCount = 0;

    // valid findings JSON
    const validFindings = JSON.stringify({
      service_name: "test-svc",
      confidence: "high",
      services: [
        {
          name: "test-svc",
          root_path: ".",
          language: "javascript",
          confidence: "high",
        },
      ],
      connections: [],
      schemas: [],
    });

    setAgentRunner(async (_prompt, _path) => {
      callCount++;
      if (callCount === 1) return "not valid json at all"; // repo 1 → error
      return `\`\`\`json\n${validFindings}\n\`\`\``; // repo 2 → valid
    });

    const results = await scanRepos([repoDir, repo2.dir], {}, qe);
    assert.equal(callCount, 2, "agent called for both repos");
    assert.equal(
      results[0].findings,
      null,
      "repo 1 findings null due to error",
    );
    assert.ok("error" in results[0], "repo 1 should have error field");
    assert.ok(
      results[1].findings !== null,
      "repo 2 should have valid findings",
    );
    assert.equal(results[1].findings.service_name, "test-svc");

    cleanupDir(repo2.dir);
  });

  test("successful scan returns findings and calls persistFindings", async () => {
    const qe = makeQueryEngine({ repoState: null });
    let persistFindingsCalled = false;
    qe.persistFindings = (_repoId, _findings, _commit, _scanVersionId) => {
      persistFindingsCalled = true;
    };

    const validFindings = JSON.stringify({
      service_name: "my-service",
      confidence: "high",
      services: [
        {
          name: "my-service",
          root_path: ".",
          language: "javascript",
          confidence: "high",
        },
      ],
      connections: [],
      schemas: [],
    });

    setAgentRunner(async () => `\`\`\`json\n${validFindings}\n\`\`\``);

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1);
    assert.equal(results[0].findings.service_name, "my-service");
    assert.ok(
      persistFindingsCalled,
      "persistFindings should be called after successful scan",
    );
  });

  test("agents run sequentially — for...of not Promise.all", async () => {
    const repo2 = makeTempRepo();
    writeFileSync(join(repo2.dir, "b.js"), "const b = 2;");
    execSync("git add b.js", { cwd: repo2.dir, stdio: "pipe" });
    execSync('git commit -m "add b.js"', { cwd: repo2.dir, stdio: "pipe" });

    const qe = makeQueryEngine({ repoState: null });
    const order = [];

    const validFindings = (name) =>
      JSON.stringify({
        service_name: name,
        confidence: "high",
        services: [
          { name, root_path: ".", language: "javascript", confidence: "high" },
        ],
        connections: [],
        schemas: [],
      });

    setAgentRunner(async (_prompt, repoPath) => {
      const name = repoPath === repoDir ? "svc-a" : "svc-b";
      order.push(name);
      return `\`\`\`json\n${validFindings(name)}\n\`\`\``;
    });

    await scanRepos([repoDir, repo2.dir], {}, qe);
    assert.deepEqual(
      order,
      ["svc-a", "svc-b"],
      "agents must run in order (sequential)",
    );

    cleanupDir(repo2.dir);
  });
});

// ---------------------------------------------------------------------------
// scanRepos — incremental prompt constraint (THE-933 / SREL-01)
// ---------------------------------------------------------------------------

describe("scanRepos — incremental prompt constraint", () => {
  let repoDir;
  let firstCommit;

  before(() => {
    // Create a repo with an initial commit so we have a base
    const { dir, head } = makeTempRepo();
    repoDir = dir;
    firstCommit = head;

    // Add a file and make a second commit — the diff between firstCommit and
    // HEAD will contain "the_changed_file.ts" as a modified file
    writeFileSync(join(dir, "the_changed_file.ts"), "export const x = 1;");
    execSync("git add the_changed_file.ts", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add the_changed_file.ts"', {
      cwd: dir,
      stdio: "pipe",
    });
  });

  after(() => cleanupDir(repoDir));

  beforeEach(() => {
    setAgentRunner(null);
  });

  /**
   * queryEngine where getRepoState returns lastCommit as last_scanned_commit.
   * buildScanContext will see HEAD !== lastCommit and produce mode="incremental".
   */
  function makeIncrementalQE(lastCommit) {
    return {
      upsertRepo: (_repoData) => ({ id: 99 }),
      getRepoState: (_id) => ({
        last_scanned_commit: lastCommit,
        last_scanned_at: null,
      }),
      beginScan: (_repoId) => 7,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
    };
  }

  const validFindings = JSON.stringify({
    service_name: "test-svc",
    confidence: "high",
    services: [
      {
        name: "test-svc",
        root_path: ".",
        language: "typescript",
        confidence: "high",
      },
    ],
    connections: [],
    schemas: [],
  });

  test("incremental scan prompt contains INCREMENTAL_CONSTRAINT heading and changed filename", async () => {
    const qe = makeIncrementalQE(firstCommit);

    let capturedPrompt = null;
    setAgentRunner(async (prompt, _repoPath) => {
      capturedPrompt = prompt;
      return `\`\`\`json\n${validFindings}\n\`\`\``;
    });

    const results = await scanRepos([repoDir], {}, qe);

    assert.ok(
      capturedPrompt !== null,
      "agentRunner should have been called",
    );
    assert.match(
      capturedPrompt,
      /INCREMENTAL SCAN/i,
      "prompt must contain INCREMENTAL SCAN heading",
    );
    assert.match(
      capturedPrompt,
      /changed files/i,
      "prompt must mention changed files",
    );
    assert.match(
      capturedPrompt,
      /the_changed_file\.ts/,
      "prompt must list the changed filename",
    );
    assert.match(
      capturedPrompt,
      /You MUST only examine/,
      "prompt must use strong directive language",
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].mode, "incremental");
  });

  test("incremental scan with no changed files produces incremental-noop, agentRunner not called, beginScan not called", async () => {
    // Make a repo with two empty commits so diff between them is empty
    const { dir: noopRepo } = makeTempRepo();
    // HEAD from makeTempRepo is an empty commit
    const firstEmptyCommit = execSync("git rev-parse HEAD", {
      cwd: noopRepo,
      encoding: "utf8",
    }).trim();
    // Make another empty commit — diff between them will have modified=[]
    execSync('git commit --allow-empty -m "second empty commit"', {
      cwd: noopRepo,
      stdio: "pipe",
    });

    let beginScanCallCount = 0;
    const qe = {
      upsertRepo: (_repoData) => ({ id: 100 }),
      getRepoState: (_id) => ({
        last_scanned_commit: firstEmptyCommit,
        last_scanned_at: null,
      }),
      beginScan: (_repoId) => {
        beginScanCallCount++;
        return 8;
      },
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
    };

    let agentCallCount = 0;
    setAgentRunner(async (_prompt, _repoPath) => {
      agentCallCount++;
      return "";
    });

    const results = await scanRepos([noopRepo], {}, qe);

    assert.equal(agentCallCount, 0, "agentRunner must NOT be called for incremental-noop");
    assert.equal(beginScanCallCount, 0, "beginScan must NOT be called for incremental-noop");
    assert.equal(results.length, 1);
    assert.equal(results[0].mode, "incremental-noop");
    assert.equal(results[0].findings, null);

    cleanupDir(noopRepo);
  });
});
