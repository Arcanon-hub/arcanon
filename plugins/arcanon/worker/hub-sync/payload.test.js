import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  buildScanPayload,
  buildFindingsBlock,
  serializePayload,
  PayloadError,
  KNOWN_TOOLS,
  MAX_PAYLOAD_BYTES,
} from "./payload.js";

function makeTempGitRepo(name = "arcanon-payload-test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + "-"));
  const git = (args) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "test@arcanon.dev"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return dir;
}

test("buildFindingsBlock drops connections whose source is not a known service", () => {
  const findings = {
    services: [{ name: "svc-a", language: "ts" }],
    connections: [
      { source: "svc-a", target: "external", protocol: "rest" },
      { source: "ghost", target: "external", protocol: "rest" },
    ],
  };
  const block = buildFindingsBlock(findings);
  assert.equal(block.connections.length, 1);
  assert.equal(block.connections[0].source, "svc-a");
  assert.equal(block.warnings.length, 1);
  assert.match(block.warnings[0], /dropped connection/);
});

test("buildFindingsBlock sets defaults for missing optional fields", () => {
  const block = buildFindingsBlock({
    services: [{ name: "svc-a" }],
    connections: [{ source: "svc-a", target: "db" }],
  });
  assert.equal(block.services[0].root_path, ".");
  assert.equal(block.services[0].language, "unknown");
  assert.equal(block.services[0].type, "service");
  assert.equal(block.connections[0].protocol, "unknown");
});

test("buildScanPayload requires repoPath", () => {
  assert.throws(
    () => buildScanPayload({ findings: { services: [{ name: "a" }] } }),
    PayloadError,
  );
});

test("buildScanPayload rejects unknown tool names", () => {
  const repoPath = makeTempGitRepo();
  assert.throws(
    () =>
      buildScanPayload({
        findings: { services: [{ name: "a" }] },
        repoPath,
        tool: "not-a-real-tool",
      }),
    /tool "not-a-real-tool"/,
  );
});

test("buildScanPayload derives commit_sha from git", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.metadata.tool, "claude-code");
  assert.match(payload.metadata.commit_sha, /^[0-9a-f]{40}$/);
  assert.equal(payload.metadata.repo_name, path.basename(repoPath));
});

test("buildScanPayload requires findings.services to have at least one entry", () => {
  const repoPath = makeTempGitRepo();
  assert.throws(
    () =>
      buildScanPayload({
        findings: { services: [], connections: [] },
        repoPath,
      }),
    /services must contain at least one/,
  );
});

test("buildScanPayload omits project_slug when not provided", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
  });
  assert.equal(payload.metadata.project_slug, undefined);
});

test("buildScanPayload includes project_slug when provided", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
    projectSlug: "my-proj",
  });
  assert.equal(payload.metadata.project_slug, "my-proj");
});

test("KNOWN_TOOLS matches the server enum", () => {
  assert.deepEqual(
    [...KNOWN_TOOLS].sort(),
    ["claude-code", "cli", "copilot", "cursor", "unknown"].sort(),
  );
});

test("serializePayload rejects payloads larger than MAX_PAYLOAD_BYTES", () => {
  // Build a payload whose body exceeds 10 MB by stuffing connection evidence.
  const big = "x".repeat(MAX_PAYLOAD_BYTES + 1024);
  const fake = {
    version: "1.0",
    metadata: {
      tool: "claude-code",
      repo_name: "r",
      commit_sha: "0".repeat(40),
      scan_mode: "full",
    },
    findings: {
      services: [{ name: "svc" }],
      connections: [{ source: "svc", target: "big", protocol: "rest", evidence: big }],
      schemas: [],
      actors: [],
    },
  };
  assert.throws(() => serializePayload(fake), /exceeds hub limit/);
});

test("serializePayload returns body + byte count under the limit", () => {
  const payload = {
    version: "1.0",
    metadata: { tool: "claude-code", repo_name: "r", commit_sha: "0".repeat(40), scan_mode: "full" },
    findings: { services: [{ name: "svc" }], connections: [], schemas: [], actors: [] },
  };
  const { body, bytes } = serializePayload(payload);
  assert.ok(bytes > 0);
  assert.equal(JSON.parse(body).version, "1.0");
});
