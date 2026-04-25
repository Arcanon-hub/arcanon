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

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getChangedFiles,
  buildScanContext,
  scanRepos,
  setAgentRunner,
  setScanLogger,
  detectRepoType,
  runDiscoveryPass,
  acquireScanLock,
  releaseScanLock,
  scanLockHash,
} from "./manager.js";
import {
  registerEnricher,
  clearEnrichers,
} from "./enrichment.js";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helpers to build temp git repos
// ---------------------------------------------------------------------------

/**
 * Creates a temp directory with a git repo, makes an initial empty commit,
 * and returns the repo path and the initial HEAD commit hash.
 */
function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "arcanon-test-"));
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
    const noGitDir = mkdtempSync(join(tmpdir(), "arcanon-nogit-"));
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

  test("getChangedFiles works with spaces in repo path", () => {
    const dir = mkdtempSync(join(tmpdir(), "arcanon test spaces-"));
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "hello.txt"), "world");
      execSync("git add hello.txt", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "add file"', { cwd: dir, stdio: "pipe" });

      const result = getChangedFiles(dir, null);
      assert.ok(!("error" in result), "should not return error for path with spaces");
      assert.ok(result.modified.includes("hello.txt"), "should list hello.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      upsertRepo: (repoData) => 42,
      getRepoState: (_id) => repoState,
      setRepoState: (_id, _commit) => {},
      getRepoByPath: (_path) => null,
      beginScan: (_repoId) => 1,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
      _db: { prepare: () => ({ all: () => [] }) },
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

    const minimalDiscoveryJson = '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';

    setAgentRunner(async (prompt, _path) => {
      callCount++;
      // Discovery calls return minimal valid JSON; deep scan calls return findings or error
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscoveryJson; // discovery call → valid (always succeeds)
      }
      // Deep scan: repo 1 deep scan is call 2, repo 2 deep scan is call 4
      if (_path === repoDir) return "not valid json at all"; // repo 1 deep scan → error
      return `\`\`\`json\n${validFindings}\n\`\`\``; // repo 2 deep scan → valid
    });

    const results = await scanRepos([repoDir, repo2.dir], {}, qe);
    assert.equal(callCount, 4, "agent called twice per repo (discovery + deep scan)");
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

  test("agents run via Promise.allSettled — parallel fan-out", async () => {
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

    setAgentRunner(async (prompt, repoPath) => {
      // Discovery call — return minimal valid JSON without recording order
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';
      }
      // Deep scan call — record order and return findings
      const name = repoPath === repoDir ? "svc-a" : "svc-b";
      order.push(name);
      return `\`\`\`json\n${validFindings(name)}\n\`\`\``;
    });

    await scanRepos([repoDir, repo2.dir], {}, qe);
    assert.equal(
      order.length,
      2,
      "both deep scan agents must run (parallel fan-out via Promise.allSettled)",
    );

    cleanupDir(repo2.dir);
  });
});

// ---------------------------------------------------------------------------
// scanRepos — retry-once on agentRunner failure
// ---------------------------------------------------------------------------

describe("scanRepos — retry-once on agentRunner failure", () => {
  let repoDir;
  let repo2Dir;

  before(() => {
    const r1 = makeTempRepo();
    repoDir = r1.dir;
    writeFileSync(join(r1.dir, "index.js"), "module.exports = {}");
    execSync("git add index.js", { cwd: r1.dir, stdio: "pipe" });
    execSync('git commit -m "add index.js"', { cwd: r1.dir, stdio: "pipe" });

    const r2 = makeTempRepo();
    repo2Dir = r2.dir;
    writeFileSync(join(r2.dir, "app.js"), "const x = 1;");
    execSync("git add app.js", { cwd: repo2Dir, stdio: "pipe" });
    execSync('git commit -m "add app.js"', { cwd: repo2Dir, stdio: "pipe" });
  });

  after(() => {
    cleanupDir(repoDir);
    cleanupDir(repo2Dir);
  });

  beforeEach(() => {
    setAgentRunner(null);
    setScanLogger(null);
  });

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

  const minimalDiscovery = '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';

  function makeQueryEngine({ repoState = null } = {}) {
    return {
      upsertRepo: (repoData) => 42,
      getRepoState: (_id) => repoState,
      setRepoState: (_id, _commit) => {},
      getRepoByPath: (_path) => null,
      beginScan: (_repoId) => 1,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
      _db: { prepare: () => ({ all: () => [] }) },
    };
  }

  test("failed agentRunner retries once then succeeds", async () => {
    const qe = makeQueryEngine({ repoState: null });
    let callCount = 0;

    setAgentRunner(async (prompt, _path) => {
      // Discovery calls always succeed
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscovery;
      }
      // Deep scan: throw on first attempt, succeed on second
      callCount++;
      if (callCount === 1) {
        throw new Error("agent crashed on first attempt");
      }
      return `\`\`\`json\n${validFindings("retry-svc")}\n\`\`\``;
    });

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1);
    assert.ok(results[0].findings !== null, "retry succeeded — findings must not be null");
    assert.equal(callCount, 2, "agentRunner must be called twice (initial + retry)");
  });

  test("skipped repo after retry failure — WARN with repo name", async () => {
    const qe = makeQueryEngine({ repoState: null });
    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });

    setAgentRunner(async (prompt, _path) => {
      // Discovery calls always succeed
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscovery;
      }
      // Deep scan always throws
      throw new Error("agent crashed");
    });

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1);
    assert.equal(results[0].skipped, true, "result must have skipped: true");

    const warnLog = logs.find((l) => l.level === 'WARN' && (l.extra.repoName !== undefined));
    assert.ok(warnLog !== undefined, "must emit a WARN log with repoName in extra");
    const { basename: _ignored } = await import("node:path");
    const { basename } = await import("node:path");
    assert.equal(warnLog.extra.repoName, basename(repoDir), "WARN log repoName must match basename(repoDir)");
  });

  test("skipped repo does not abort other repos", async () => {
    const qe = makeQueryEngine({ repoState: null });

    setAgentRunner(async (prompt, path) => {
      // Discovery calls always succeed
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscovery;
      }
      // repo1 deep scan always throws; repo2 deep scan succeeds
      if (path === repoDir) {
        throw new Error("agent crashed");
      }
      return `\`\`\`json\n${validFindings("repo2-svc")}\n\`\`\``;
    });

    const results = await scanRepos([repoDir, repo2Dir], {}, qe);
    assert.equal(results.length, 2, "results must have an entry for each repo");

    const r1 = results.find((r) => r.repoPath === repoDir);
    const r2 = results.find((r) => r.repoPath === repo2Dir);

    assert.ok(r1, "result for repo1 must exist");
    assert.equal(r1.skipped, true, "repo1 must be skipped");

    assert.ok(r2, "result for repo2 must exist");
    assert.ok(r2.findings !== null, "repo2 must have valid findings");
  });

  test("no retry on parse failure — only on agentRunner throw", async () => {
    const qe = makeQueryEngine({ repoState: null });
    let deepScanCallCount = 0;

    setAgentRunner(async (prompt, _path) => {
      // Discovery calls always succeed
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscovery;
      }
      // Deep scan: return invalid JSON (does not throw — parse will fail)
      deepScanCallCount++;
      return "not json at all";
    });

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1);
    assert.equal(deepScanCallCount, 1, "agentRunner must be called exactly once — no retry on parse failure");
    assert.ok(results[0].findings === null, "findings must be null on parse failure");
    assert.ok("error" in results[0], "result must have error field on parse failure");
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
      upsertRepo: (_repoData) => 99,
      getRepoState: (_id) => ({
        last_scanned_commit: lastCommit,
        last_scanned_at: null,
      }),
      beginScan: (_repoId) => 7,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
      // _db stub for the post-persist service-id backfill (manager.js:805)
      // and the enrichment-pass SELECT (manager.js:820). Returns empty rows
      // so the loops are no-ops; this test only asserts on the agent prompt.
      _db: {
        prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      },
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
      upsertRepo: (_repoData) => 100,
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

// ---------------------------------------------------------------------------
// scanRepos — SARC-02: prompt content (multi-language examples + DISCOVERY_JSON)
// ---------------------------------------------------------------------------

describe("scanRepos — SARC-02 prompt content", () => {
  let repoDir;

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
    writeFileSync(join(dir, "index.js"), "module.exports = {}");
    execSync("git add index.js", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add index.js"', { cwd: dir, stdio: "pipe" });
  });

  after(() => cleanupDir(repoDir));

  beforeEach(() => {
    setAgentRunner(null);
  });

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

  const mockQE = {
    upsertRepo: (_repoData) => 42,
    getRepoState: (_id) => null,
    setRepoState: (_id, _commit) => {},
    getRepoByPath: (_path) => null,
    beginScan: (_repoId) => 1,
    persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
    endScan: (_repoId, _scanVersionId) => {},
    _db: { prepare: () => ({ all: () => [] }) },
  };

  test("SARC-02: service prompt contains multi-language examples and DISCOVERY_JSON", async () => {
    let capturedPrompt = null;
    setAgentRunner(async (prompt, _repoPath) => {
      // Discovery calls return minimal context; capture deep scan prompt
      if (prompt.includes("Discovery Agent") || prompt.includes("structure discovery")) {
        return '```json\n{"services":[],"route_files":[],"proto_files":[],"openapi_files":[],"event_config_files":[]}\n```';
      }
      capturedPrompt = prompt;
      return `\`\`\`json\n${validFindings}\n\`\`\``;
    });

    await scanRepos([repoDir], {}, mockQE);

    assert.ok(capturedPrompt !== null, "prompt was captured");

    // Multi-language examples (SARC-02 criterion 1)
    assert.ok(capturedPrompt.includes("@RestController"), "prompt includes Java Spring Boot example");
    assert.ok(capturedPrompt.includes("[HttpGet"), "prompt includes C# ASP.NET Core example");
    assert.ok(capturedPrompt.includes("get '/users'"), "prompt includes Ruby on Rails example");
    assert.ok(capturedPrompt.includes("fun getUsers()"), "prompt includes Kotlin example");

    // DISCOVERY_JSON placeholder presence (SARC-02 criterion 2)
    assert.ok(
      capturedPrompt.includes("{{DISCOVERY_JSON}}") || capturedPrompt.includes('"services"'),
      "prompt includes DISCOVERY_JSON placeholder or interpolated discovery context",
    );

    // Fallback instruction (safety for pre-Phase-76)
    assert.ok(capturedPrompt.includes("fall back to scanning all files"), "prompt includes DISCOVERY_JSON fallback");
  });
});

// ---------------------------------------------------------------------------
// scanRepos — enrichment pass wiring (68-02)
// ---------------------------------------------------------------------------

/**
 * Build an in-memory SQLite DB with repos, services, and node_metadata tables.
 * Used to test enrichment wiring: queryEngine._db is passed to runEnrichmentPass.
 */
function buildEnrichmentDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE repos (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );
    CREATE TABLE services (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id        INTEGER NOT NULL REFERENCES repos(id),
      name           TEXT    NOT NULL,
      root_path      TEXT    NOT NULL,
      language       TEXT,
      boundary_entry TEXT
    );
    CREATE TABLE node_metadata (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      view       TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      source     TEXT,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, view, key)
    );
  `);
  // Insert a repo with id=42 to match the mock queryEngine
  db.prepare("INSERT INTO repos (id, path, name, type) VALUES (?, ?, ?, ?)").run(42, "/tmp/test-repo", "test-repo", "service");
  return db;
}

/**
 * Build a queryEngine mock that includes a real _db (with services pre-seeded).
 * persistFindings inserts a service into the DB so enrichment can query it.
 */
function makeEnrichmentQueryEngine(db, { repoState = null } = {}) {
  return {
    _db: db,
    upsertRepo: (_repoData) => 42,
    getRepoState: (_id) => repoState,
    setRepoState: (_id, _commit) => {},
    getRepoByPath: (_path) => null,
    beginScan: (_repoId) => 1,
    persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {
      // Simulate a service being persisted into the DB for repo_id=42
      const existing = db.prepare("SELECT id FROM services WHERE repo_id = 42").get();
      if (!existing) {
        db.prepare(
          "INSERT INTO services (repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?)"
        ).run(42, "test-svc", "/tmp/test-repo", "javascript", "index.js");
      }
    },
    endScan: (_repoId, _scanVersionId) => {},
  };
}

const validFindingsJson = JSON.stringify({
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

describe("scanRepos — enrichment pass wiring", () => {
  let repoDir;
  let enrichmentDb;

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
    writeFileSync(join(dir, "index.js"), "module.exports = {}");
    execSync("git add index.js", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add index.js"', { cwd: dir, stdio: "pipe" });
  });

  after(() => {
    cleanupDir(repoDir);
    if (enrichmentDb) {
      try { enrichmentDb.close(); } catch (_) {}
    }
  });

  beforeEach(() => {
    setAgentRunner(null);
    clearEnrichers();
    enrichmentDb = buildEnrichmentDb();
  });

  test("enrichment called on full scan success: spy enricher receives serviceId", async () => {
    const qe = makeEnrichmentQueryEngine(enrichmentDb);
    let spyCalled = false;
    let spyServiceId = null;

    registerEnricher("spy", async (ctx) => {
      spyCalled = true;
      spyServiceId = ctx.serviceId;
      return {};
    });

    setAgentRunner(async () => `\`\`\`json\n${validFindingsJson}\n\`\`\``);

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1);
    assert.equal(results[0].mode, "full");
    assert.ok(spyCalled, "spy enricher must be called after full scan success");
    assert.ok(typeof spyServiceId === "number", "enricher ctx.serviceId must be a number");
  });

  test("enrichment skipped on skip mode", async () => {
    const head = execSync("git rev-parse HEAD", {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();
    const qe = makeEnrichmentQueryEngine(enrichmentDb, {
      repoState: { last_scanned_commit: head, last_scanned_at: null },
    });
    let spyCalled = false;
    registerEnricher("spy", async () => {
      spyCalled = true;
      return {};
    });

    setAgentRunner(async () => `\`\`\`json\n${validFindingsJson}\n\`\`\``);

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results[0].mode, "skip");
    assert.ok(!spyCalled, "spy enricher must NOT be called for skip mode");
  });

  test("enrichment skipped on incremental-noop", async () => {
    const { dir: noopRepo } = makeTempRepo();
    const firstCommit = execSync("git rev-parse HEAD", {
      cwd: noopRepo,
      encoding: "utf8",
    }).trim();
    execSync('git commit --allow-empty -m "second empty"', {
      cwd: noopRepo,
      stdio: "pipe",
    });

    const qe = makeEnrichmentQueryEngine(enrichmentDb, {
      repoState: { last_scanned_commit: firstCommit, last_scanned_at: null },
    });
    let spyCalled = false;
    registerEnricher("spy", async () => {
      spyCalled = true;
      return {};
    });

    setAgentRunner(async () => `\`\`\`json\n${validFindingsJson}\n\`\`\``);

    const results = await scanRepos([noopRepo], {}, qe);
    assert.equal(results[0].mode, "incremental-noop");
    assert.ok(!spyCalled, "spy enricher must NOT be called for incremental-noop");
    cleanupDir(noopRepo);
  });

  test("scan completes when enricher throws — findings still returned", async () => {
    const qe = makeEnrichmentQueryEngine(enrichmentDb);

    registerEnricher("thrower", async () => {
      throw new Error("enricher boom");
    });

    setAgentRunner(async () => `\`\`\`json\n${validFindingsJson}\n\`\`\``);

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1);
    assert.ok(results[0].findings !== null, "findings must be populated despite throwing enricher");
    assert.ok(!("error" in results[0]), "result must not have top-level error field");
  });

  test("service count unchanged after enrichment", async () => {
    // Pre-seed a service so the count before scan is 1.
    // persistFindings mock uses INSERT OR IGNORE so count stays 1 after scan.
    // Enrichment must not add or remove services.
    enrichmentDb.prepare(
      "INSERT OR IGNORE INTO services (id, repo_id, name, root_path, language, boundary_entry) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, 42, "pre-seeded-svc", "/tmp/test-repo", "javascript", "index.js");

    const qe = makeEnrichmentQueryEngine(enrichmentDb);

    registerEnricher("noop", async () => ({}));

    setAgentRunner(async () => `\`\`\`json\n${validFindingsJson}\n\`\`\``);

    const before = enrichmentDb.prepare("SELECT COUNT(*) as n FROM services").get().n;
    assert.equal(before, 1, "should have one pre-seeded service");
    await scanRepos([repoDir], {}, qe);
    const after = enrichmentDb.prepare("SELECT COUNT(*) as n FROM services").get().n;

    assert.strictEqual(before, after, "enrichment must not change service count");
  });
});

// ---------------------------------------------------------------------------
// detectRepoType tests (SBUG-02)
// ---------------------------------------------------------------------------

describe("detectRepoType", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arcanon-repotype-"));
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  // --- docker-compose exemption (SBUG-02) ---

  test("detectRepoType: repo with only docker-compose.yml (no service entry-point) returns 'infra'", () => {
    writeFileSync(join(tmpDir, "docker-compose.yml"), "version: '3'\nservices:\n  redis:\n    image: redis\n");
    assert.equal(detectRepoType(tmpDir), "infra");
  });

  test("detectRepoType: repo with docker-compose.yml AND package.json with scripts.start returns 'service'", () => {
    writeFileSync(join(tmpDir, "docker-compose.yml"), "version: '3'\n");
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
      name: "my-svc",
      scripts: { start: "node index.js" },
    }));
    assert.equal(detectRepoType(tmpDir), "service");
  });

  test("detectRepoType: repo with docker-compose.yml AND main.py returns 'service'", () => {
    writeFileSync(join(tmpDir, "docker-compose.yml"), "version: '3'\n");
    writeFileSync(join(tmpDir, "main.py"), "from flask import Flask\napp = Flask(__name__)\n");
    assert.equal(detectRepoType(tmpDir), "service");
  });

  test("detectRepoType: repo with docker-compose.yml AND main.go returns 'service'", () => {
    writeFileSync(join(tmpDir, "docker-compose.yml"), "version: '3'\n");
    writeFileSync(join(tmpDir, "main.go"), "package main\nfunc main() {}\n");
    assert.equal(detectRepoType(tmpDir), "service");
  });

  test("detectRepoType: repo with kustomization.yaml returns 'infra' (unchanged behavior)", () => {
    writeFileSync(join(tmpDir, "kustomization.yaml"), "apiVersion: kustomize.config.k8s.io/v1beta1\n");
    assert.equal(detectRepoType(tmpDir), "infra");
  });

  // --- Go library heuristics ---

  test("detectRepoType: Go repo with go.mod but no main.go and no cmd/ dir returns 'library'", () => {
    writeFileSync(join(tmpDir, "go.mod"), "module github.com/example/mylib\n\ngo 1.21\n");
    writeFileSync(join(tmpDir, "mylib.go"), "package mylib\n\nfunc Exported() {}\n");
    assert.equal(detectRepoType(tmpDir), "library");
  });

  test("detectRepoType: Go repo with go.mod and cmd/ dir returns 'service'", () => {
    writeFileSync(join(tmpDir, "go.mod"), "module github.com/example/mysvc\n\ngo 1.21\n");
    mkdirSync(join(tmpDir, "cmd"), { recursive: true });
    writeFileSync(join(tmpDir, "cmd", "main.go"), "package main\nfunc main() {}\n");
    assert.equal(detectRepoType(tmpDir), "service");
  });

  // --- Java library heuristics ---

  test("detectRepoType: Java repo with pom.xml and no Application.java or *Main.java returns 'library'", () => {
    writeFileSync(join(tmpDir, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>\n");
    // Create src/main/java dir but no Application or Main class
    mkdirSync(join(tmpDir, "src", "main", "java", "com", "example"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "main", "java", "com", "example", "MyLib.java"), "package com.example;\npublic class MyLib {}\n");
    assert.equal(detectRepoType(tmpDir), "library");
  });

  test("detectRepoType: Java repo with pom.xml and Application.java returns 'service'", () => {
    writeFileSync(join(tmpDir, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>\n");
    mkdirSync(join(tmpDir, "src", "main", "java", "com", "example"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "main", "java", "com", "example", "Application.java"), "package com.example;\npublic class Application { public static void main(String[] args) {} }\n");
    assert.equal(detectRepoType(tmpDir), "service");
  });

  // --- Poetry library heuristics ---

  test("detectRepoType: Poetry repo with [tool.poetry] but no [tool.poetry.scripts] returns 'library'", () => {
    writeFileSync(join(tmpDir, "pyproject.toml"), "[tool.poetry]\nname = \"mylib\"\nversion = \"0.1.0\"\n\n[tool.poetry.dependencies]\npython = \"^3.11\"\n");
    assert.equal(detectRepoType(tmpDir), "library");
  });

  test("detectRepoType: Poetry repo with [tool.poetry] and [tool.poetry.scripts] returns 'service'", () => {
    writeFileSync(join(tmpDir, "pyproject.toml"), "[tool.poetry]\nname = \"mysvc\"\nversion = \"0.1.0\"\n\n[tool.poetry.scripts]\nmysvc = \"mysvc.main:run\"\n");
    assert.equal(detectRepoType(tmpDir), "service");
  });
});

// ---------------------------------------------------------------------------
// scanRepos — discovery wiring (76-01 SARC-01)
// ---------------------------------------------------------------------------

describe("scanRepos — discovery wiring", () => {
  let repoDir;

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
    writeFileSync(join(dir, "index.js"), "module.exports = {}");
    execSync("git add index.js", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add index.js"', { cwd: dir, stdio: "pipe" });
  });

  after(() => cleanupDir(repoDir));

  beforeEach(() => {
    setAgentRunner(null);
    setScanLogger(null);
  });

  function makeDiscoveryQE({ repoState = null } = {}) {
    return {
      upsertRepo: (_repoData) => 42,
      getRepoState: (_id) => repoState,
      setRepoState: (_id, _commit) => {},
      getRepoByPath: (_path) => null,
      beginScan: (_repoId) => 1,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
      _db: { prepare: () => ({ all: () => [] }) },
    };
  }

  const validFindingsJson = JSON.stringify({
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

  test("two agent calls per repo — discovery then deep scan", async () => {
    const qe = makeDiscoveryQE();
    let callCount = 0;

    setAgentRunner(async (prompt, _repoPath) => {
      callCount++;
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';
      }
      return `\`\`\`json\n${validFindingsJson}\n\`\`\``;
    });

    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(callCount, 2, "agentRunner must be called twice per repo");
    assert.equal(results[0].mode, "full");
    assert.ok(results[0].findings !== null, "findings should be populated");
  });

  test("discovery failure — deep scan still runs with fallback", async () => {
    const qe = makeDiscoveryQE();

    setAgentRunner(async (prompt, _repoPath) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        throw new Error('discovery timeout');
      }
      return `\`\`\`json\n${validFindingsJson}\n\`\`\``;
    });

    const results = await scanRepos([repoDir], {}, qe);
    assert.ok(results[0].findings !== null, "deep scan must produce findings despite discovery failure");
    assert.equal(results[0].mode, "full");
  });

  test("discovery pass log entry emitted with languages array", async () => {
    const qe = makeDiscoveryQE();
    const loggedMessages = [];
    const mockLogger = {
      log: (level, msg, extra = {}) => loggedMessages.push({ level, msg, ...extra }),
      info: (msg, extra) => mockLogger.log('INFO', msg, extra),
      warn: (msg, extra) => mockLogger.log('WARN', msg, extra),
      error: (msg, extra) => mockLogger.log('ERROR', msg, extra),
      debug: (msg, extra) => mockLogger.log('DEBUG', msg, extra),
    };
    setScanLogger(mockLogger);

    setAgentRunner(async (prompt, _repoPath) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return '```json\n{"languages":["javascript","typescript"],"frameworks":["express"],"service_hints":[]}\n```';
      }
      return `\`\`\`json\n${validFindingsJson}\n\`\`\``;
    });

    await scanRepos([repoDir], {}, qe);

    const logEntry = loggedMessages.find((l) => l.msg === 'discovery pass complete');
    assert.ok(logEntry, "discovery pass log entry must be emitted");
    assert.ok(Array.isArray(logEntry.languages), "languages field must be an array");
    assert.ok(logEntry.languages.includes('javascript'), "languages must include 'javascript'");
  });

  test("deep scan prompt contains discovery JSON, not raw placeholder", async () => {
    const qe = makeDiscoveryQE();
    let capturedDeepScanPrompt = null;
    let callCount = 0;

    setAgentRunner(async (prompt, _repoPath) => {
      callCount++;
      if (callCount === 1) {
        // Discovery call — return valid discovery JSON
        return '```json\n{"languages":["javascript"],"frameworks":["express"],"service_hints":[]}\n```';
      }
      // Deep scan call — capture the prompt
      capturedDeepScanPrompt = prompt;
      return `\`\`\`json\n${validFindingsJson}\n\`\`\``;
    });

    await scanRepos([repoDir], {}, qe);

    assert.ok(capturedDeepScanPrompt !== null, "deep scan prompt must be captured");
    assert.ok(
      !capturedDeepScanPrompt.includes("{{DISCOVERY_JSON}}"),
      "deep scan prompt must NOT contain literal {{DISCOVERY_JSON}} placeholder",
    );
    assert.ok(
      capturedDeepScanPrompt.includes('"javascript"'),
      "deep scan prompt must contain discovery output (javascript language)",
    );
  });
});

// ---------------------------------------------------------------------------
// runDiscoveryPass unit tests (76-01 SARC-01)
// ---------------------------------------------------------------------------

describe("runDiscoveryPass", () => {
  let repoDir;

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
  });

  after(() => cleanupDir(repoDir));

  test("returns parsed JSON on valid fenced agent output", async () => {
    const result = await runDiscoveryPass(
      repoDir,
      "Arcanon Discovery Agent — Analyze {{REPO_PATH}}.",
      async () => '```json\n{"languages":["python"],"frameworks":["fastapi"],"service_hints":[]}\n```',
      () => {},
    );
    assert.ok(Array.isArray(result.languages), "languages should be an array");
    assert.equal(result.languages[0], "python");
  });

  test("returns {} when agent returns no JSON block", async () => {
    const result = await runDiscoveryPass(
      repoDir,
      "Analyze {{REPO_PATH}}.",
      async () => "no fenced json here at all",
      () => {},
    );
    assert.equal(JSON.stringify(result), "{}");
  });

  test("returns {} when agent throws", async () => {
    const result = await runDiscoveryPass(
      repoDir,
      "Analyze {{REPO_PATH}}.",
      async () => { throw new Error("discovery timeout"); },
      () => {},
    );
    assert.equal(JSON.stringify(result), "{}");
  });

  test("interpolates {{REPO_PATH}} into discovery prompt before calling agent", async () => {
    let capturedPrompt = null;
    await runDiscoveryPass(
      "/my/test/repo",
      "Analyze {{REPO_PATH}} now.",
      async (prompt) => {
        capturedPrompt = prompt;
        return '```json\n{"languages":[],"frameworks":[],"service_hints":[]}\n```';
      },
      () => {},
    );
    assert.ok(capturedPrompt !== null);
    assert.ok(capturedPrompt.includes("/my/test/repo"), "prompt must have repoPath substituted");
    assert.ok(!capturedPrompt.includes("{{REPO_PATH}}"), "prompt must not contain raw placeholder");
  });

  test("emits INFO log entry with languages, frameworks, service_hints count on success", async () => {
    const logs = [];
    const slog = (level, msg, extra = {}) => logs.push({ level, msg, ...extra });

    await runDiscoveryPass(
      repoDir,
      "Discovery Agent: analyze {{REPO_PATH}}.",
      async () => '```json\n{"languages":["go"],"frameworks":["gin"],"service_hints":[{"name":"svc","type":"service"}]}\n```',
      slog,
    );

    const infoLog = logs.find((l) => l.msg === 'discovery pass complete');
    assert.ok(infoLog, "must emit discovery pass complete log");
    assert.deepEqual(infoLog.languages, ["go"]);
    assert.equal(infoLog.service_hints, 1);
  });

  test("emits WARN log when no JSON block found", async () => {
    const logs = [];
    const slog = (level, msg, extra = {}) => logs.push({ level, msg, ...extra });

    await runDiscoveryPass(
      repoDir,
      "Discovery Agent: {{REPO_PATH}}.",
      async () => "plain text no json",
      slog,
    );

    const warnLog = logs.find((l) => l.msg === 'discovery: no JSON block — using empty context');
    assert.ok(warnLog, "must emit WARN for no JSON block");
  });

  test("emits WARN log with error message when agent throws", async () => {
    const logs = [];
    const slog = (level, msg, extra = {}) => logs.push({ level, msg, ...extra });

    await runDiscoveryPass(
      repoDir,
      "Discovery Agent: {{REPO_PATH}}.",
      async () => { throw new Error("discovery timeout"); },
      slog,
    );

    const warnLog = logs.find((l) => l.msg === 'discovery pass failed — using empty context');
    assert.ok(warnLog, "must emit WARN for agent failure");
    assert.equal(warnLog.error, "discovery timeout");
  });
});

// ---------------------------------------------------------------------------
// concurrent scan locking (SEC-03)
// ---------------------------------------------------------------------------

describe("concurrent scan locking (SEC-03)", () => {
  let repoDir;
  let lockDir;

  const silentSlog = (_level, _msg, _extra = {}) => {};

  const validFindings = JSON.stringify({
    service_name: "lock-test-svc",
    confidence: "high",
    services: [
      { name: "lock-test-svc", root_path: ".", language: "javascript", confidence: "high" },
    ],
    connections: [],
    schemas: [],
  });

  const minimalDiscovery = '```json\n{"languages":["javascript"],"frameworks":[],"service_hints":[]}\n```';

  function makeQueryEngine() {
    return {
      upsertRepo: () => 99,
      getRepoState: () => null,
      setRepoState: () => {},
      getRepoByPath: () => null,
      beginScan: () => 1,
      persistFindings: () => {},
      endScan: () => {},
      _db: { prepare: () => ({ all: () => [] }) },
    };
  }

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
    writeFileSync(join(dir, "app.js"), "const x = 1;");
    execSync("git add app.js", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add app.js"', { cwd: dir, stdio: "pipe" });

    // Use a temp directory as lock dir to avoid polluting ~/.arcanon
    lockDir = mkdtempSync(join(tmpdir(), "arcanon-locktest-"));
    process.env.ARCANON_DATA_DIR = lockDir;
  });

  after(() => {
    delete process.env.ARCANON_DATA_DIR;
    cleanupDir(repoDir);
    cleanupDir(lockDir);
  });

  afterEach(() => {
    setAgentRunner(null);
    // Clean up any leftover lock files between tests
    try {
      for (const f of readdirSync(lockDir)) {
        if (f.endsWith(".lock")) unlinkSync(join(lockDir, f));
      }
    } catch { /* ignore */ }
  });

  test("acquireScanLock, releaseScanLock, and scanLockHash are exported functions", () => {
    assert.equal(typeof acquireScanLock, "function", "acquireScanLock should be exported");
    assert.equal(typeof releaseScanLock, "function", "releaseScanLock should be exported");
    assert.equal(typeof scanLockHash, "function", "scanLockHash should be exported");
  });

  test("scanLockHash returns a 12-char hex string", () => {
    const hash = scanLockHash([repoDir]);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 12);
    assert.ok(/^[0-9a-f]{12}$/.test(hash), "hash should be lowercase hex");
  });

  test("scanRepos acquires lock during scan and releases it after completion", async () => {
    const qe = makeQueryEngine();
    const hash = scanLockHash([repoDir]);
    const expectedLockPath = join(lockDir, `scan-${hash}.lock`);

    let lockExistedDuringScan = false;

    setAgentRunner(async (prompt, _path) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscovery;
      }
      lockExistedDuringScan = existsSync(expectedLockPath);
      return `\`\`\`json\n${validFindings}\n\`\`\``;
    });

    await scanRepos([repoDir], {}, qe);

    assert.ok(lockExistedDuringScan, "lock file should exist during scan");
    assert.ok(!existsSync(expectedLockPath), "lock file should be removed after scan completes");
  });

  test("concurrent scan is rejected with clear error — scan already in progress", async () => {
    const hash = scanLockHash([repoDir]);
    const lockPath = join(lockDir, `scan-${hash}.lock`);

    // Write a lock file with current PID to simulate active scan
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      repoPaths: [repoDir],
    }));

    setAgentRunner(async () => `\`\`\`json\n${validFindings}\n\`\`\``);
    const qe = makeQueryEngine();
    await assert.rejects(
      () => scanRepos([repoDir], {}, qe),
      /scan already in progress/i,
      "should throw with 'scan already in progress' when lock held by active PID",
    );
    // lock file still exists (we own it) — afterEach cleans it up
  });

  test("stale lock (dead PID) is cleaned up and acquireScanLock proceeds", () => {
    const repoPaths = [repoDir];
    const hash = scanLockHash(repoPaths);
    const lockPath = join(lockDir, `scan-${hash}.lock`);

    // PID 999999 is virtually guaranteed not to be running
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      startedAt: new Date().toISOString(),
      repoPaths,
    }));

    const logs = [];
    const testSlog = (level, msg, extra = {}) => logs.push({ level, msg, ...extra });

    let acquiredPath;
    assert.doesNotThrow(() => {
      acquiredPath = acquireScanLock(repoPaths, testSlog);
    }, "acquireScanLock should not throw on stale lock");

    const warnLog = logs.find((l) => l.msg === 'removing stale scan lock');
    assert.ok(warnLog, "should emit WARN when removing stale lock");

    // Clean up via releaseScanLock
    releaseScanLock(acquiredPath);
    assert.ok(!existsSync(lockPath), "lock file should be released after releaseScanLock");
  });

  test("lock is released even when scan agent throws repeatedly (error path)", async () => {
    const qe = makeQueryEngine();
    const hash = scanLockHash([repoDir]);
    const lockPath = join(lockDir, `scan-${hash}.lock`);

    setAgentRunner(async (prompt, _path) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscovery;
      }
      throw new Error("agent crashed — simulated failure");
    });

    // scanRepos catches double-throw and returns skip result — lock must still be released
    const results = await scanRepos([repoDir], {}, qe);
    assert.equal(results.length, 1, "should return one result");
    assert.ok(!existsSync(lockPath), "lock file must be cleaned up even after agent error");
  });
});

// ---------------------------------------------------------------------------
// scanRepos — scan lifecycle logging (SCAN-01, SCAN-02)
// ---------------------------------------------------------------------------

describe("scanRepos — scan lifecycle logging (SCAN-01, SCAN-02)", () => {
  let repoDir;

  before(() => {
    const { dir } = makeTempRepo();
    repoDir = dir;
    writeFileSync(join(dir, "index.js"), "module.exports = {}");
    execSync("git add index.js", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "add index.js"', { cwd: dir, stdio: "pipe" });
  });

  after(() => {
    cleanupDir(repoDir);
  });

  beforeEach(() => {
    setAgentRunner(null);
    setScanLogger(null);
    clearEnrichers();
  });

  function makeQE() {
    return {
      upsertRepo: (_repoData) => 42,
      getRepoState: (_id) => null,
      setRepoState: (_id, _commit) => {},
      getRepoByPath: (_path) => null,
      beginScan: (_repoId) => 1,
      persistFindings: (_repoId, _findings, _commit, _scanVersionId) => {},
      endScan: (_repoId, _scanVersionId) => {},
      _db: { prepare: () => ({ all: () => [] }) },
    };
  }

  const validFindingsForLifecycle = JSON.stringify({
    service_name: "test-svc",
    confidence: "high",
    services: [
      { name: "test-svc", root_path: ".", language: "javascript", confidence: "high" },
    ],
    connections: [],
    schemas: [],
  });

  const minimalDiscoveryForLifecycle =
    '```json\n{"languages":["javascript"],"frameworks":["express"],"service_hints":[]}\n```';

  test("logs BEGIN event with repoCount and mode at start of scanRepos", async () => {
    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });

    setAgentRunner(async (prompt) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscoveryForLifecycle;
      }
      return `\`\`\`json\n${validFindingsForLifecycle}\n\`\`\``;
    });

    const qe = makeQE();
    await scanRepos([repoDir], {}, qe);

    const beginLog = logs.find((l) => l.msg === 'scan BEGIN');
    assert.ok(beginLog !== undefined, "logs must contain a 'scan BEGIN' entry");
    assert.equal(beginLog.extra.repoCount, 1, "repoCount must be 1");
    assert.equal(typeof beginLog.extra.mode, 'string', "mode must be a string");
    assert.equal(beginLog.level, 'INFO', "level must be INFO");
  });

  test("logs END event with totalServices, totalConnections, and durationMs after scanRepos completes", async () => {
    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });

    setAgentRunner(async (prompt) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscoveryForLifecycle;
      }
      return `\`\`\`json\n${validFindingsForLifecycle}\n\`\`\``;
    });

    const qe = makeQE();
    await scanRepos([repoDir], {}, qe);

    const endLog = logs.find((l) => l.msg === 'scan END');
    assert.ok(endLog !== undefined, "logs must contain a 'scan END' entry");
    assert.equal(endLog.extra.totalServices, 1, "totalServices must be 1");
    assert.equal(endLog.extra.totalConnections, 0, "totalConnections must be 0");
    assert.equal(typeof endLog.extra.durationMs, 'number', "durationMs must be a number");
    assert.ok(endLog.extra.durationMs >= 0, "durationMs must be >= 0");
    assert.equal(endLog.level, 'INFO', "level must be INFO");
  });

  test("logs discovery done with languages and frameworks per repo", async () => {
    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });

    setAgentRunner(async (prompt) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return '```json\n{"languages":["javascript"],"frameworks":["express"],"service_hints":[]}\n```';
      }
      return `\`\`\`json\n${validFindingsForLifecycle}\n\`\`\``;
    });

    const qe = makeQE();
    await scanRepos([repoDir], {}, qe);

    const discoveryLog = logs.find((l) => l.msg === 'discovery done');
    assert.ok(discoveryLog !== undefined, "logs must contain a 'discovery done' entry");
    assert.ok(Array.isArray(discoveryLog.extra.languages), "languages must be an array");
    assert.ok(Array.isArray(discoveryLog.extra.frameworks), "frameworks must be an array");
    assert.equal(discoveryLog.level, 'INFO', "level must be INFO");
  });

  test("logs deep scan done with services and connections counts per repo", async () => {
    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });

    setAgentRunner(async (prompt) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscoveryForLifecycle;
      }
      return `\`\`\`json\n${validFindingsForLifecycle}\n\`\`\``;
    });

    const qe = makeQE();
    await scanRepos([repoDir], {}, qe);

    const deepScanLog = logs.find((l) => l.msg === 'deep scan done');
    assert.ok(deepScanLog !== undefined, "logs must contain a 'deep scan done' entry");
    assert.equal(deepScanLog.extra.services, 1, "services count must be 1");
    assert.equal(deepScanLog.extra.connections, 0, "connections count must be 0");
    assert.equal(deepScanLog.level, 'INFO', "level must be INFO");
  });

  test("logs enrichment done with enricherCount after enrichment pass", async () => {
    const logs = [];
    setScanLogger({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });

    const enrichDb = buildEnrichmentDb();
    const qe = makeEnrichmentQueryEngine(enrichDb);

    registerEnricher('test', async () => ({}));

    setAgentRunner(async (prompt) => {
      if (prompt.includes('Discovery Agent') || prompt.includes('structure discovery')) {
        return minimalDiscoveryForLifecycle;
      }
      return `\`\`\`json\n${validFindingsForLifecycle}\n\`\`\``;
    });

    await scanRepos([repoDir], {}, qe);

    const enrichLog = logs.find((l) => l.msg === 'enrichment done');
    assert.ok(enrichLog !== undefined, "logs must contain an 'enrichment done' entry");
    assert.equal(typeof enrichLog.extra.enricherCount, 'number', "enricherCount must be a number");
    assert.equal(enrichLog.level, 'INFO', "level must be INFO");

    enrichDb.close();
  });
});

// ---------------------------------------------------------------------------
// CLN-07 / CLN-08: Two-read pattern tests for _readHubAutoSync
// ---------------------------------------------------------------------------

// Test helper: stub process.stderr.write and return a capture array.
function captureStderr() {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const captured = [];
  process.stderr.write = (chunk, ...rest) => {
    captured.push(String(chunk));
    return true;
  };
  return {
    captured,
    restore: () => { process.stderr.write = originalWrite; },
  };
}

// Dynamic re-import to reset the module-level `_autoUploadDeprecationWarned`
// guard between tests. The ESM import cache returns the same instance, so
// we reset by cache-busting via a query-string on the import specifier.
// Note: registerEnricher calls at module load are idempotent by key, so
// re-importing manager.js multiple times is safe.
async function loadManagerModuleFresh() {
  const specifier = new URL(
    `./manager.js?fresh=${Date.now()}-${Math.random()}`,
    import.meta.url,
  ).href;
  return import(specifier);
}

test("CLN-07: auto-sync=true activates sync without deprecation warning", async () => {
  const capture = captureStderr();
  try {
    const mod = await loadManagerModuleFresh();
    const result = mod._readHubAutoSync({ "auto-sync": true });
    assert.equal(result, true);
    assert.equal(
      capture.captured.filter(s => s.includes("deprecated")).length,
      0,
      "no deprecation warning when new key is used",
    );
  } finally {
    capture.restore();
  }
});

test("CLN-08: auto-upload-only triggers sync AND writes one deprecation warning", async () => {
  const capture = captureStderr();
  try {
    const mod = await loadManagerModuleFresh();
    // First read: warning fires
    const first = mod._readHubAutoSync({ "auto-upload": true });
    // Second read: warning must NOT fire again (once-per-process guard)
    const second = mod._readHubAutoSync({ "auto-upload": true });
    assert.equal(first, true);
    assert.equal(second, true);
    const warnings = capture.captured.filter(s => s.includes("auto-upload"));
    assert.equal(warnings.length, 1, "deprecation warning fires exactly once");
    assert.match(warnings[0], /auto-sync/, "warning mentions new key name");
    assert.match(warnings[0], /auto-upload/, "warning mentions legacy key name");
  } finally {
    capture.restore();
  }
});

test("CLN-07: auto-sync=false beats auto-upload=true (new key wins)", async () => {
  const capture = captureStderr();
  try {
    const mod = await loadManagerModuleFresh();
    const result = mod._readHubAutoSync({ "auto-sync": false, "auto-upload": true });
    assert.equal(result, false, "explicit false on new key disables, ignores legacy true");
    assert.equal(
      capture.captured.filter(s => s.includes("deprecated")).length,
      0,
      "no warning — new key was defined and won",
    );
  } finally {
    capture.restore();
  }
});

test("CLN-07: neither key set disables sync without warning", async () => {
  const capture = captureStderr();
  try {
    const mod = await loadManagerModuleFresh();
    const result = mod._readHubAutoSync({});
    assert.equal(result, false);
    assert.equal(
      capture.captured.filter(s => s.includes("deprecated")).length,
      0,
    );
  } finally {
    capture.restore();
  }
});
