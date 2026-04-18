/**
 * Tests for worker/repo-discovery.js
 * Run: node --test worker/repo-discovery.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadFromConfig,
  discoverNew,
  deduplicateRepos,
  saveConfirmed,
  isViewOnlyMode,
  formatRepoList,
} from "./discovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// loadFromConfig
// ---------------------------------------------------------------------------

test("loadFromConfig returns [] when ligamen.config.json is missing", () => {
  const projectRoot = makeTempDir();
  try {
    const result = loadFromConfig(projectRoot);
    assert.deepEqual(result, []);
  } finally {
    cleanup(projectRoot);
  }
});

test("loadFromConfig returns [] when linked-repos key is absent", () => {
  const projectRoot = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(projectRoot, "ligamen.config.json"),
      JSON.stringify({ "impact-map": { history: true } }, null, 2),
    );
    const result = loadFromConfig(projectRoot);
    assert.deepEqual(result, []);
  } finally {
    cleanup(projectRoot);
  }
});

test("loadFromConfig returns resolved absolute paths from config", () => {
  const projectRoot = makeTempDir();
  const parentDir = path.dirname(projectRoot);
  // Create a sibling dir to reference
  const siblingDir = fs.mkdtempSync(path.join(parentDir, "sibling-"));
  try {
    const relPath = path.relative(projectRoot, siblingDir);
    fs.writeFileSync(
      path.join(projectRoot, "ligamen.config.json"),
      JSON.stringify({ "linked-repos": [relPath] }, null, 2),
    );
    const result = loadFromConfig(projectRoot);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, path.resolve(projectRoot, relPath));
    assert.equal(result[0].name, path.basename(siblingDir));
    assert.equal(result[0].source, "config");
    assert.equal(result[0].isNew, false);
  } finally {
    cleanup(projectRoot);
    cleanup(siblingDir);
  }
});

// ---------------------------------------------------------------------------
// discoverNew
// ---------------------------------------------------------------------------

test("discoverNew excludes current project dir", () => {
  const parentDir = makeTempDir();
  const projectRoot = path.join(parentDir, "my-project");
  fs.mkdirSync(projectRoot);
  // Create a package.json in project root (it's a JS project)
  fs.writeFileSync(path.join(projectRoot, "package.json"), "{}");
  try {
    const result = discoverNew(projectRoot, []);
    const paths = result.map((r) => r.path);
    assert.ok(
      !paths.includes(projectRoot),
      "should not include projectRoot itself",
    );
  } finally {
    cleanup(parentDir);
  }
});

test("discoverNew excludes paths already in existingPaths", () => {
  const parentDir = makeTempDir();
  const projectRoot = path.join(parentDir, "my-project");
  fs.mkdirSync(projectRoot);
  const existingRepo = path.join(parentDir, "existing-repo");
  fs.mkdirSync(existingRepo);
  fs.writeFileSync(path.join(existingRepo, "package.json"), "{}");
  try {
    const result = discoverNew(projectRoot, [existingRepo]);
    const paths = result.map((r) => r.path);
    assert.ok(
      !paths.includes(existingRepo),
      "should not include existing path",
    );
  } finally {
    cleanup(parentDir);
  }
});

test("discoverNew returns only dirs containing a manifest file", () => {
  const parentDir = makeTempDir();
  const projectRoot = path.join(parentDir, "my-project");
  fs.mkdirSync(projectRoot);

  // This dir has a manifest — should be discovered
  const jsRepo = path.join(parentDir, "js-repo");
  fs.mkdirSync(jsRepo);
  fs.writeFileSync(path.join(jsRepo, "package.json"), "{}");

  // This dir has a Go manifest
  const goRepo = path.join(parentDir, "go-repo");
  fs.mkdirSync(goRepo);
  fs.writeFileSync(
    path.join(goRepo, "go.mod"),
    "module example.com/go-repo\n\ngo 1.21\n",
  );

  // This dir has no manifest — should NOT be discovered
  const emptyDir = path.join(parentDir, "no-manifest");
  fs.mkdirSync(emptyDir);

  try {
    const result = discoverNew(projectRoot, []);
    const paths = result.map((r) => r.path);
    assert.ok(paths.includes(jsRepo), "js-repo should be discovered");
    assert.ok(paths.includes(goRepo), "go-repo should be discovered");
    assert.ok(
      !paths.includes(emptyDir),
      "no-manifest dir should not be discovered",
    );
    assert.ok(
      !paths.includes(projectRoot),
      "projectRoot should not be discovered",
    );

    // Verify repo object shape
    const jsEntry = result.find((r) => r.path === jsRepo);
    assert.ok(jsEntry, "js-repo entry exists");
    assert.equal(jsEntry.source, "discovered");
    assert.equal(jsEntry.isNew, true);
    assert.equal(jsEntry.name, "js-repo");
  } finally {
    cleanup(parentDir);
  }
});

test("discoverNew detects pyproject.toml, go.mod, Cargo.toml, pom.xml manifests", () => {
  const parentDir = makeTempDir();
  const projectRoot = path.join(parentDir, "my-project");
  fs.mkdirSync(projectRoot);

  const manifests = {
    "py-repo": "pyproject.toml",
    "rust-repo": "Cargo.toml",
    "java-repo": "pom.xml",
  };

  for (const [name, manifest] of Object.entries(manifests)) {
    const repoDir = path.join(parentDir, name);
    fs.mkdirSync(repoDir);
    fs.writeFileSync(path.join(repoDir, manifest), "# manifest");
  }

  try {
    const result = discoverNew(projectRoot, []);
    const paths = result.map((r) => r.path);
    for (const name of Object.keys(manifests)) {
      const repoDir = path.join(parentDir, name);
      assert.ok(paths.includes(repoDir), `${name} should be discovered`);
    }
  } finally {
    cleanup(parentDir);
  }
});

// ---------------------------------------------------------------------------
// deduplicateRepos
// ---------------------------------------------------------------------------

test("deduplicateRepos prefers config source over discovered for same path", () => {
  const somePath = "/tmp/shared-repo";
  const repos = [
    { path: somePath, name: "shared-repo", source: "discovered", isNew: true },
    { path: somePath, name: "shared-repo", source: "config", isNew: false },
  ];
  const result = deduplicateRepos(repos);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "config");
  assert.equal(result[0].isNew, false);
});

test("deduplicateRepos removes exact duplicates (same path)", () => {
  const somePath = "/tmp/my-repo";
  const repos = [
    { path: somePath, name: "my-repo", source: "config", isNew: false },
    { path: somePath, name: "my-repo", source: "config", isNew: false },
  ];
  const result = deduplicateRepos(repos);
  assert.equal(result.length, 1);
});

test("deduplicateRepos keeps distinct paths", () => {
  const repos = [
    { path: "/tmp/repo-a", name: "repo-a", source: "config", isNew: false },
    { path: "/tmp/repo-b", name: "repo-b", source: "discovered", isNew: true },
  ];
  const result = deduplicateRepos(repos);
  assert.equal(result.length, 2);
});

// ---------------------------------------------------------------------------
// saveConfirmed
// ---------------------------------------------------------------------------

test("saveConfirmed round-trip: write then read preserves linked-repos and other keys", () => {
  const projectRoot = makeTempDir();
  try {
    // Write initial config with extra key
    fs.writeFileSync(
      path.join(projectRoot, "ligamen.config.json"),
      JSON.stringify(
        { "impact-map": { history: true }, "other-key": "value" },
        null,
        2,
      ),
    );

    const paths = ["/tmp/repo-a", "/tmp/repo-b"];
    saveConfirmed(projectRoot, paths);

    const saved = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "ligamen.config.json"), "utf8"),
    );
    assert.deepEqual(saved["linked-repos"], paths, "linked-repos persisted");
    assert.deepEqual(
      saved["impact-map"],
      { history: true },
      "impact-map preserved",
    );
    assert.equal(saved["other-key"], "value", "other-key preserved");
  } finally {
    cleanup(projectRoot);
  }
});

test("saveConfirmed creates ligamen.config.json when absent", () => {
  const projectRoot = makeTempDir();
  try {
    const paths = ["/tmp/repo-x"];
    saveConfirmed(projectRoot, paths);

    const configPath = path.join(projectRoot, "ligamen.config.json");
    assert.ok(fs.existsSync(configPath), "config file created");
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(saved["linked-repos"], paths);
  } finally {
    cleanup(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// isViewOnlyMode
// ---------------------------------------------------------------------------

test("isViewOnlyMode returns true only when --view is present", () => {
  assert.equal(isViewOnlyMode(["--view"]), true);
  assert.equal(isViewOnlyMode(["--scan", "--view", "--verbose"]), true);
  assert.equal(isViewOnlyMode([]), false);
  assert.equal(isViewOnlyMode(["--scan"]), false);
  assert.equal(isViewOnlyMode(["--viewer"]), false); // not exact match
});

// ---------------------------------------------------------------------------
// formatRepoList
// ---------------------------------------------------------------------------

test("formatRepoList with mixed new/confirmed repos produces correct output with [NEW] markers", () => {
  const repos = [
    {
      path: "/abs/confirmed-repo",
      name: "confirmed-repo",
      source: "config",
      isNew: false,
    },
    {
      path: "/abs/new-repo",
      name: "new-repo",
      source: "discovered",
      isNew: true,
    },
  ];
  const output = formatRepoList(repos);
  assert.ok(output.includes("Found 2 repos (1 new)"), "summary line correct");
  assert.ok(
    output.includes("[confirmed] /abs/confirmed-repo (confirmed-repo)"),
    "confirmed line present",
  );
  assert.ok(
    output.includes("[NEW] /abs/new-repo (new-repo)"),
    "[NEW] line present",
  );
  assert.ok(
    output.includes("<-- newly discovered"),
    "newly discovered marker present",
  );
  assert.ok(output.includes("Confirm this list"), "instruction line present");
});

test('formatRepoList with zero new repos produces "0 new" in summary', () => {
  const repos = [
    { path: "/abs/repo-a", name: "repo-a", source: "config", isNew: false },
    { path: "/abs/repo-b", name: "repo-b", source: "config", isNew: false },
  ];
  const output = formatRepoList(repos);
  assert.ok(output.includes("Found 2 repos (0 new)"), "summary shows 0 new");
  assert.ok(!output.includes("[NEW]"), "no [NEW] markers when no new repos");
});

test("formatRepoList with empty list returns sensible output", () => {
  const output = formatRepoList([]);
  assert.ok(output.includes("Found 0 repos (0 new)"), "zero repos shown");
});
