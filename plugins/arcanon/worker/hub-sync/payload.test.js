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

// ── HUB-01/02/03: libraryDepsEnabled gate + schemaVersion derivation ──────────

test("buildFindingsBlock(findings) with no opts returns schemaVersion 1.0 (backward compat)", () => {
  const block = buildFindingsBlock({ services: [{ name: "svc" }] });
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined);
});

test("buildFindingsBlock with libraryDepsEnabled=false returns schemaVersion 1.0 and no per-service deps", () => {
  const findings = {
    services: [{ name: "svc", dependencies: [{ package_name: "express" }] }],
  };
  const block = buildFindingsBlock(findings, { libraryDepsEnabled: false });
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined);
});

test("buildFindingsBlock with libraryDepsEnabled=true but all services have empty deps returns schemaVersion 1.0 (flag-on fallback)", () => {
  const findings = {
    services: [{ name: "svc-a", dependencies: [] }, { name: "svc-b" }],
  };
  const block = buildFindingsBlock(findings, { libraryDepsEnabled: true });
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined);
  assert.equal(block.services[1].dependencies, undefined);
});

test("buildFindingsBlock with libraryDepsEnabled=true and non-empty deps returns schemaVersion 1.1 with per-service dependencies", () => {
  const dep = { id: 1, service_id: 10, ecosystem: "npm", package_name: "express", version_spec: "^4", resolved_version: "4.18.0", manifest_file: "package.json", dep_kind: "direct" };
  const findings = {
    services: [
      { name: "svc-a", dependencies: [dep] },
      { name: "svc-b" },
    ],
  };
  const block = buildFindingsBlock(findings, { libraryDepsEnabled: true });
  assert.equal(block.schemaVersion, "1.1");
  assert.deepEqual(block.services[0].dependencies, [dep]);
  assert.deepEqual(block.services[1].dependencies, []);
});

test("buildScanPayload without libraryDepsEnabled emits version 1.0 (default)", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc" }] },
    repoPath,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.findings.services[0].dependencies, undefined);
});

test("buildScanPayload with libraryDepsEnabled=true and non-empty deps emits version 1.1", () => {
  const repoPath = makeTempGitRepo();
  const dep = { id: 1, service_id: 1, ecosystem: "npm", package_name: "lodash", version_spec: "^4", resolved_version: "4.17.21", manifest_file: "package.json", dep_kind: "direct" };
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc", dependencies: [dep] }] },
    repoPath,
    libraryDepsEnabled: true,
  });
  assert.equal(payload.version, "1.1");
  assert.deepEqual(payload.findings.services[0].dependencies, [dep]);
});

test("buildScanPayload with libraryDepsEnabled=true but empty deps emits version 1.0 (fallback)", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: { services: [{ name: "svc", dependencies: [] }] },
    repoPath,
    libraryDepsEnabled: true,
  });
  assert.equal(payload.version, "1.0");
  assert.equal(payload.findings.services[0].dependencies, undefined);
});

// ---------------------------------------------------------------------------
// HUB-04 / HUB-05 — Phase 96-02: additional matrix coverage + regression guard
// ---------------------------------------------------------------------------

// Shared fixture — matches Phase 93-02 getDependenciesForService return shape.
const SAMPLE_DEP_ROW = {
  id: 1,
  service_id: 42,
  scan_version_id: 7,
  ecosystem: "npm",
  package_name: "react",
  version_spec: "^18.2.0",
  resolved_version: "18.2.0",
  manifest_file: "package.json",
  dep_kind: "direct",
};

test("HUB-05 regression guard: buildFindingsBlock with no opts returns schemaVersion='1.0' and omits per-service dependencies", () => {
  const block = buildFindingsBlock({
    services: [{ name: "svc-a", language: "ts" }],
    connections: [{ source: "svc-a", target: "db", protocol: "tcp" }],
  });
  // Default path MUST be v1.0 — proves backward compat for every caller that
  // never opts into the feature flag.
  assert.equal(block.schemaVersion, "1.0");
  assert.equal(block.services[0].dependencies, undefined, "v1.0 services must NOT carry a dependencies key");
  // Shape regression — existing keys are still present and unchanged.
  assert.equal(block.services[0].name, "svc-a");
  assert.equal(block.services[0].language, "ts");
  assert.equal(block.services[0].root_path, ".");
  assert.equal(block.services[0].type, "service");
  assert.ok(Array.isArray(block.connections));
  assert.ok(Array.isArray(block.schemas));
  assert.ok(Array.isArray(block.actors));
});

test("HUB-04 matrix #3: flag OFF + populated deps → schemaVersion='1.0', deps suppressed (flag is authoritative)", () => {
  const block = buildFindingsBlock(
    {
      services: [{ name: "svc-a", language: "ts", dependencies: [SAMPLE_DEP_ROW] }],
      connections: [],
    },
    { libraryDepsEnabled: false },
  );
  assert.equal(block.schemaVersion, "1.0", "flag OFF dominates — dep data is ignored");
  assert.equal(block.services[0].dependencies, undefined, "v1.0 must NOT leak the input dependencies array");
});

test("HUB-04 matrix #5 (mixed services): flag ON + one service with deps + one without → v1.1 with dependencies on both", () => {
  const block = buildFindingsBlock(
    {
      services: [
        { name: "svc-has-deps", language: "ts", dependencies: [SAMPLE_DEP_ROW] },
        { name: "svc-no-deps", language: "go", dependencies: [] },
        { name: "svc-missing-field", language: "py" }, // no dependencies key at all
      ],
      connections: [],
    },
    { libraryDepsEnabled: true },
  );
  // Any non-empty service → v1.1 envelope; every service in the envelope carries dependencies.
  assert.equal(block.schemaVersion, "1.1");
  assert.deepEqual(block.services[0].dependencies, [SAMPLE_DEP_ROW]);
  assert.deepEqual(block.services[1].dependencies, []);
  // Service with no dependencies field in input gets dependencies: [] on output (never undefined on v1.1 path)
  assert.deepEqual(block.services[2].dependencies, []);
});

test("HUB-04 end-to-end default: buildScanPayload without libraryDepsEnabled emits payload.version='1.0' (regression)", () => {
  const repoPath = makeTempGitRepo();
  const { payload } = buildScanPayload({
    findings: {
      services: [{ name: "svc-a", dependencies: [SAMPLE_DEP_ROW] }],
      connections: [],
    },
    repoPath,
    // libraryDepsEnabled intentionally omitted — default false
  });
  assert.equal(payload.version, "1.0");
  assert.equal(
    payload.findings.services[0].dependencies,
    undefined,
    "v1.0 must not leak dependencies even if caller supplied them in findings",
  );
});
