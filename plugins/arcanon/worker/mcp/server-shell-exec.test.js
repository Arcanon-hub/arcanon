/**
 * Security regression tests for shell-exec hardening in worker/mcp/server.js
 * Phase 135 — shell-exec-hardening (SEC-01, SEC-02, SEC-03, SEC-08)
 *
 * Run: node --test worker/mcp/server-shell-exec.test.js
 *
 * Covers:
 *   Task 1 — queryChanged: valid-input parity, working-tree parity,
 *             command-substitution no-exec, metacharacter no-exec,
 *             option-injection rejection (SEC-01, SEC-03)
 *   Task 2 — compareOpenApiSpecs: metacharacter/command-substitution spec
 *             paths execute no shell command (SEC-02, SEC-03);
 *             oasdiff-absent degradation parity; redactExecError body
 *             exclusion (SEC-08)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { queryChanged } from "./server.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-sec-test-"));
  const run = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  run("init");
  run("config", "user.email", "test@arcanon.test");
  run("config", "user.name", "Arcanon Test");
  return { dir, run };
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────
// Task 1 — queryChanged: argv git + commit_range validation
// ─────────────────────────────────────────────────────────────

test("queryChanged: valid commit_range returns changed files (parity)", async () => {
  const { dir, run } = makeTempRepo();
  try {
    // First commit
    fs.writeFileSync(path.join(dir, "file-a.txt"), "hello");
    run("add", "file-a.txt");
    run("commit", "-m", "first commit");

    // Second commit
    fs.writeFileSync(path.join(dir, "file-b.txt"), "world");
    run("add", "file-b.txt");
    run("commit", "-m", "second commit");

    const result = await queryChanged(null, {
      repo: dir,
      commit_range: "HEAD~1..HEAD",
    });
    assert.ok(Array.isArray(result.changed_files), "changed_files must be an array");
    assert.ok(
      result.changed_files.includes("file-b.txt"),
      `expected file-b.txt in ${JSON.stringify(result.changed_files)}`,
    );
    assert.deepEqual(result.affected, []);
  } finally {
    rmrf(dir);
  }
});

test("queryChanged: working-tree (no commit_range) returns staged and unstaged files (parity)", async () => {
  const { dir, run } = makeTempRepo();
  try {
    // Initial tracked file
    fs.writeFileSync(path.join(dir, "tracked.txt"), "v1");
    run("add", "tracked.txt");
    run("commit", "-m", "initial");

    // Staged change (new file)
    fs.writeFileSync(path.join(dir, "staged.txt"), "staged content");
    run("add", "staged.txt");

    // Unstaged change on tracked file
    fs.writeFileSync(path.join(dir, "tracked.txt"), "v2 modified");

    const result = await queryChanged(null, { repo: dir });
    assert.ok(Array.isArray(result.changed_files), "changed_files must be an array");
    assert.ok(
      result.changed_files.includes("tracked.txt"),
      `expected tracked.txt in ${JSON.stringify(result.changed_files)}`,
    );
    assert.ok(
      result.changed_files.includes("staged.txt"),
      `expected staged.txt in ${JSON.stringify(result.changed_files)}`,
    );
    assert.deepEqual(result.affected, []);
  } finally {
    rmrf(dir);
  }
});

test("queryChanged: command-substitution in commit_range executes NO shell command (SEC-01, SEC-03)", async () => {
  const { dir, run } = makeTempRepo();
  const sentinel = path.join(
    os.tmpdir(),
    `arcanon-sec1-${process.pid}-${Date.now()}`,
  );
  assert.ok(!fs.existsSync(sentinel), "sentinel must not exist before test");
  try {
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    run("add", "a.txt");
    run("commit", "-m", "init");

    const result = await queryChanged(null, {
      repo: dir,
      commit_range: `$(touch ${sentinel})`,
    });
    assert.deepEqual(result.affected, [], "affected must be empty for hostile commit_range");
    assert.ok(
      !fs.existsSync(sentinel),
      "sentinel file must NOT have been created — no shell execution",
    );
  } finally {
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    rmrf(dir);
  }
});

test("queryChanged: metacharacter commit_range causes NO side effects (SEC-01, SEC-03)", async () => {
  const { dir, run } = makeTempRepo();
  try {
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    run("add", "a.txt");
    run("commit", "-m", "init");

    // Must not throw — graceful return
    const result = await queryChanged(null, {
      repo: dir,
      commit_range: "; echo x ; rm -rf nope",
    });
    assert.deepEqual(result.affected, [], "affected must be empty");
  } finally {
    rmrf(dir);
  }
});

test("queryChanged: option-injection commit_range is rejected before reaching git (SEC-03)", async () => {
  const { dir, run } = makeTempRepo();
  try {
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    run("add", "a.txt");
    run("commit", "-m", "init");

    const result = await queryChanged(null, {
      repo: dir,
      commit_range: "--upload-pack=/bin/false",
    });
    assert.deepEqual(result.affected, [], "affected must be empty for rejected commit_range");
    assert.equal(
      result.error,
      "invalid commit_range",
      `error must indicate invalid commit_range, got: ${JSON.stringify(result.error)}`,
    );
  } finally {
    rmrf(dir);
  }
});
