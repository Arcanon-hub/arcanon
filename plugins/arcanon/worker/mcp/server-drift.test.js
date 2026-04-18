/**
 * Tests for drift tools (Phase 48) — MCP tool implementations
 * Run: node --test worker/mcp/server-drift.test.js
 *
 * Wave 0 scaffold: tests for drift_versions (Plan 01), drift_types (Plan 02),
 * drift_openapi (Plan 03).  Plans 02 and 03 will add their own tests here.
 *
 * These tests exercise the query logic functions directly with an in-memory
 * SQLite database and temporary filesystem repos, bypassing the MCP SDK layer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Named imports from server.js — will fail (RED) until Task 2 adds the export.
import { queryDriftVersions, queryDriftTypes, queryDriftOpenapi } from "./server.js";

// ─────────────────────────────────────────────────────────────
// Test DB helpers
// ─────────────────────────────────────────────────────────────

/**
 * Create an in-memory SQLite DB with the minimal repos + services schema
 * required by the drift tools.
 */
function createDriftTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      last_commit TEXT,
      scanned_at TEXT
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER REFERENCES repos(id),
      name TEXT NOT NULL,
      root_path TEXT,
      language TEXT
    );
  `);

  return db;
}

/**
 * Create a temporary directory that acts as a fake repo root.
 * Writes any provided manifest files into the directory.
 *
 * @param {string} name - Short label (used in directory path for debug clarity)
 * @param {Record<string, string | object>} manifestFiles - filename → content map.
 *   String content is written as-is; objects are JSON.stringify'd.
 * @returns {{ repoPath: string, cleanup: () => void }}
 */
function createTempRepo(name, manifestFiles = {}) {
  const repoPath = path.join(
    os.tmpdir(),
    `ligamen-test-${name}-${Date.now()}`,
  );
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [filename, content] of Object.entries(manifestFiles)) {
    const fullPath = path.join(repoPath, filename);
    // Create parent directories for nested paths (e.g. 'src/types.ts')
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(
      fullPath,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return { repoPath, cleanup: () => fs.rmSync(repoPath, { recursive: true, force: true }) };
}

// ─────────────────────────────────────────────────────────────
// queryDriftVersions — Plan 01 tests
// ─────────────────────────────────────────────────────────────

test("queryDriftVersions: null db returns empty findings and repos_scanned=0", async () => {
  const result = await queryDriftVersions(null, {});
  assert.deepEqual(result, { findings: [], repos_scanned: 0 });
});

test("queryDriftVersions: CRITICAL finding when same package has different exact versions", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("react-old", {
    "package.json": { dependencies: { react: "17.0.0" } },
  });
  const repo2 = createTempRepo("react-new", {
    "package.json": { dependencies: { react: "18.0.0" } },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "repo-old", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "repo-new", null, null, null,
  );

  const result = await queryDriftVersions(db, {});
  assert.ok(Array.isArray(result.findings), "findings should be array");
  const reactFinding = result.findings.find((f) => f.item === "react");
  assert.ok(reactFinding, "should have a finding for react");
  assert.equal(reactFinding.level, "CRITICAL", `expected CRITICAL, got ${reactFinding.level}`);
  assert.ok(Array.isArray(reactFinding.repos), "repos should be array");
  assert.ok(reactFinding.repos.includes("repo-old"), "repos should include repo-old");
  assert.ok(reactFinding.repos.includes("repo-new"), "repos should include repo-new");
  assert.ok(typeof reactFinding.detail === "string", "detail should be string");
});

test("queryDriftVersions: WARN finding when same package has different range specifiers (^18 vs ~18)", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("range-caret", {
    "package.json": { dependencies: { react: "^18.0.0" } },
  });
  const repo2 = createTempRepo("range-tilde", {
    "package.json": { dependencies: { react: "~18.0.0" } },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "repo-caret", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "repo-tilde", null, null, null,
  );

  const result = await queryDriftVersions(db, {});
  const reactFinding = result.findings.find((f) => f.item === "react");
  assert.ok(reactFinding, "should have a finding for react");
  assert.equal(reactFinding.level, "WARN", `expected WARN, got ${reactFinding.level}`);
});

test("queryDriftVersions: INFO finding when same package has identical exact versions", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("same-a", {
    "package.json": { dependencies: { lodash: "4.17.21" } },
  });
  const repo2 = createTempRepo("same-b", {
    "package.json": { dependencies: { lodash: "4.17.21" } },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "repo-a", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "repo-b", null, null, null,
  );

  // With default severity=WARN, INFO findings are suppressed.
  // Use severity="all" (or severity="INFO") to see INFO entries.
  const result = await queryDriftVersions(db, { severity: "all" });
  const lodashFinding = result.findings.find((f) => f.item === "lodash");
  assert.ok(lodashFinding, "should have an INFO finding for lodash when severity=all");
  assert.equal(lodashFinding.level, "INFO", `expected INFO, got ${lodashFinding?.level}`);
});

test("queryDriftVersions: repos_scanned equals number of repos whose paths exist on disk", async (t) => {
  const db = createDriftTestDb();

  const repo1 = createTempRepo("scan-count", {
    "package.json": { dependencies: { express: "4.18.0" } },
  });
  t.after(() => {
    repo1.cleanup();
    db.close();
  });

  // Insert one real path and one non-existent path.
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "real-repo", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, "/nonexistent/path/xyz-12345", "ghost-repo", null, null, null,
  );

  const result = await queryDriftVersions(db, {});
  // Only the real repo path exists on disk.
  assert.equal(result.repos_scanned, 1, `expected repos_scanned=1, got ${result.repos_scanned}`);
});

test("queryDriftVersions: severity=CRITICAL suppresses WARN findings", async (t) => {
  const db = createDriftTestDb();

  // Two repos: one CRITICAL mismatch (react) and one WARN (lodash range specifiers).
  const repo1 = createTempRepo("severity-a", {
    "package.json": {
      dependencies: {
        react: "17.0.0",   // CRITICAL: version mismatch with repo2
        lodash: "^4.17.21", // WARN: different range specifier from repo2
      },
    },
  });
  const repo2 = createTempRepo("severity-b", {
    "package.json": {
      dependencies: {
        react: "18.0.0",
        lodash: "~4.17.21",
      },
    },
  });
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "sev-repo-a", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "sev-repo-b", null, null, null,
  );

  const result = await queryDriftVersions(db, { severity: "CRITICAL" });
  const levels = result.findings.map((f) => f.level);
  assert.ok(levels.includes("CRITICAL"), "should include CRITICAL finding");
  assert.ok(!levels.includes("WARN"), "should not include WARN when severity=CRITICAL");
  assert.ok(!levels.includes("INFO"), "should not include INFO when severity=CRITICAL");
});

test("queryDriftVersions: repos with no manifest files produce no findings for that repo", async (t) => {
  const db = createDriftTestDb();

  // repo1 has a manifest, repo2 is an empty dir (no package.json / go.mod / Cargo.toml).
  const repo1 = createTempRepo("with-manifest", {
    "package.json": { dependencies: { axios: "1.0.0" } },
  });
  const repo2 = createTempRepo("no-manifest", {}); // Empty directory.
  t.after(() => {
    repo1.cleanup();
    repo2.cleanup();
    db.close();
  });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    1, repo1.repoPath, "with-manifest-repo", null, null, null,
  );
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(
    2, repo2.repoPath, "no-manifest-repo", null, null, null,
  );

  const result = await queryDriftVersions(db, { severity: "all" });
  // axios only appears in one repo — no drift finding expected.
  const axiosFinding = result.findings.find((f) => f.item === "axios");
  assert.equal(axiosFinding, undefined, "should not have a finding for a package in only one repo");
  // Both repos were scanned (paths exist on disk).
  assert.equal(result.repos_scanned, 2);
});

// ─────────────────────────────────────────────────────────────
// queryDriftTypes — Plan 02 tests
// ─────────────────────────────────────────────────────────────

test("queryDriftTypes: null db returns empty findings and repos_scanned=0", async () => {
  const result = await queryDriftTypes(null, {});
  assert.deepEqual(result, { findings: [], repos_scanned: 0 });
});

test("queryDriftTypes: CRITICAL finding when same TS interface name has different fields", async (t) => {
  const db = createDriftTestDb();

  const repoA = createTempRepo("ts-a", {
    "package.json": JSON.stringify({ name: "repo-a" }),
    "src/types.ts": "export interface UserProfile { id: string; name: string; }\n",
  });
  const repoB = createTempRepo("ts-b", {
    "package.json": JSON.stringify({ name: "repo-b" }),
    "src/types.ts": "export interface UserProfile { id: string; email: string; role: string; }\n",
  });
  t.after(() => { repoA.cleanup(); repoB.cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, repoA.repoPath, "repo-a", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, repoB.repoPath, "repo-b", null, null, null);

  const result = await queryDriftTypes(db, {});
  assert.ok(Array.isArray(result.findings), "findings should be an array");
  const criticalFinding = result.findings.find(
    (f) => f.level === "CRITICAL" && f.item.includes("UserProfile"),
  );
  assert.ok(criticalFinding, "should have a CRITICAL finding for UserProfile");
  assert.ok(criticalFinding.item.includes("(ts)"), "item should include language tag (ts)");
  assert.ok(Array.isArray(criticalFinding.repos), "repos should be an array");
});

test("queryDriftTypes: INFO finding when same TS interface name has identical fields", async (t) => {
  const db = createDriftTestDb();

  const identicalContent = "export interface SharedConfig { timeout: number; retries: number; }\n";
  const repoA = createTempRepo("ts-same-a", {
    "package.json": JSON.stringify({ name: "repo-same-a" }),
    "src/types.ts": identicalContent,
  });
  const repoB = createTempRepo("ts-same-b", {
    "package.json": JSON.stringify({ name: "repo-same-b" }),
    "src/types.ts": identicalContent,
  });
  t.after(() => { repoA.cleanup(); repoB.cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, repoA.repoPath, "repo-same-a", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, repoB.repoPath, "repo-same-b", null, null, null);

  // Use severity="all" so INFO findings are included
  const result = await queryDriftTypes(db, { severity: "all" });
  const infoFinding = result.findings.find(
    (f) => f.level === "INFO" && f.item.includes("SharedConfig"),
  );
  assert.ok(infoFinding, "should have an INFO finding for SharedConfig when fields are identical");
});

test("queryDriftTypes: no finding when TS repo and Go repo share same type name (cross-language suppressed)", async (t) => {
  const db = createDriftTestDb();

  const tsRepo = createTempRepo("ts-cross", {
    "package.json": JSON.stringify({ name: "ts-repo" }),
    "src/types.ts": "export interface Order { id: string; total: number; }\n",
  });
  const goRepo = createTempRepo("go-cross", {
    "go.mod": "module go-repo\n\ngo 1.21\n",
    "order.go": "package main\n\ntype Order struct {\n\tID string\n\tTotal float64\n}\n",
  });
  t.after(() => { tsRepo.cleanup(); goRepo.cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, tsRepo.repoPath, "ts-repo", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, goRepo.repoPath, "go-repo", null, null, null);

  const result = await queryDriftTypes(db, { severity: "all" });
  // Order appears in both repos but in different languages — should produce no cross-language finding
  const orderFinding = result.findings.find((f) => f.item.includes("Order"));
  assert.equal(orderFinding, undefined, "should not compare types across different languages");
});

test("queryDriftTypes: repos_scanned reflects repos whose paths exist on disk", async (t) => {
  const db = createDriftTestDb();

  const realRepo = createTempRepo("ts-real", {
    "package.json": JSON.stringify({ name: "real-ts-repo" }),
    "src/types.ts": "export interface Config { debug: boolean; }\n",
  });
  t.after(() => { realRepo.cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, realRepo.repoPath, "real-ts-repo", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, "/nonexistent/ghost-types-repo", "ghost-repo", null, null, null);

  const result = await queryDriftTypes(db, {});
  assert.equal(result.repos_scanned, 1, `expected repos_scanned=1, got ${result.repos_scanned}`);
});

test("queryDriftTypes: severity=CRITICAL suppresses INFO findings", async (t) => {
  const db = createDriftTestDb();

  // Two repos: one CRITICAL pair (UserEvent — different fields) and one INFO pair (AppConfig — same fields)
  const content1 = [
    "export interface UserEvent { userId: string; action: string; }\n",
    "export interface AppConfig { timeout: number; }\n",
  ].join("");
  const content2 = [
    "export interface UserEvent { userId: string; action: string; timestamp: number; }\n",
    "export interface AppConfig { timeout: number; }\n",
  ].join("");

  const repoA = createTempRepo("ts-sev-a", {
    "package.json": JSON.stringify({ name: "sev-repo-a" }),
    "src/types.ts": content1,
  });
  const repoB = createTempRepo("ts-sev-b", {
    "package.json": JSON.stringify({ name: "sev-repo-b" }),
    "src/types.ts": content2,
  });
  t.after(() => { repoA.cleanup(); repoB.cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, repoA.repoPath, "sev-repo-a", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, repoB.repoPath, "sev-repo-b", null, null, null);

  const result = await queryDriftTypes(db, { severity: "CRITICAL" });
  const levels = result.findings.map((f) => f.level);
  assert.ok(levels.includes("CRITICAL"), "should include CRITICAL finding");
  assert.ok(!levels.includes("INFO"), "should suppress INFO findings when severity=CRITICAL");
});

// ─────────────────────────────────────────────────────────────
// queryDriftOpenapi — Plan 03 tests
// ─────────────────────────────────────────────────────────────

const MINIMAL_OPENAPI_SPEC = `openapi: "3.0.0"
info:
  title: Test API
  version: "1.0.0"
paths:
  /users:
    get:
      summary: Get users
      responses:
        "200":
          description: OK
`;

test("queryDriftOpenapi: null db returns empty findings, repos_scanned=0, tool_available=false", async () => {
  const result = await queryDriftOpenapi(null, {});
  assert.deepEqual(result, { findings: [], repos_scanned: 0, tool_available: false });
});

test("queryDriftOpenapi: fewer than 2 repos with specs returns empty findings", async (t) => {
  const db = createDriftTestDb();
  const { repoPath, cleanup } = createTempRepo("oapi-single", {
    "openapi.yaml": MINIMAL_OPENAPI_SPEC,
    "package.json": { name: "svc-single" },
  });
  t.after(() => { cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, repoPath, "svc-single", null, null, null);

  const result = await queryDriftOpenapi(db, {});
  assert.ok(Array.isArray(result.findings), "findings must be array");
  assert.equal(result.findings.length, 0, "should have no findings with only 1 repo having spec");
  assert.equal(typeof result.tool_available, "boolean", "tool_available must be boolean");
});

test("queryDriftOpenapi: two repos with no openapi specs returns empty findings", async (t) => {
  const db = createDriftTestDb();
  const repoA = createTempRepo("no-spec-a", { "package.json": { name: "svc-a" } });
  const repoB = createTempRepo("no-spec-b", { "package.json": { name: "svc-b" } });
  t.after(() => { repoA.cleanup(); repoB.cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, repoA.repoPath, "svc-a", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, repoB.repoPath, "svc-b", null, null, null);

  const result = await queryDriftOpenapi(db, {});
  assert.ok(Array.isArray(result.findings), "findings must be array");
  assert.equal(result.findings.length, 0, "should have no findings when no repos have OpenAPI specs");
  assert.equal(typeof result.tool_available, "boolean", "tool_available must be boolean");
});

test("queryDriftOpenapi: two repos with specs returns findings array (tool_available is boolean)", async (t) => {
  const { repoPath: rA, cleanup: cA } = createTempRepo("oapi-a", {
    "openapi.yaml": MINIMAL_OPENAPI_SPEC,
    "package.json": { name: "svc-a" },
  });
  const { repoPath: rB, cleanup: cB } = createTempRepo("oapi-b", {
    "openapi.yaml": MINIMAL_OPENAPI_SPEC,
    "package.json": { name: "svc-b" },
  });
  t.after(() => { cA(); cB(); });

  const db = createDriftTestDb();
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, rA, "svc-a", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, rB, "svc-b", null, null, null);
  t.after(() => db.close());

  const result = await queryDriftOpenapi(db, {});
  assert.ok(Array.isArray(result.findings), "findings must be array");
  assert.equal(typeof result.tool_available, "boolean", "tool_available must be boolean");
  // Result depends on whether oasdiff is installed — just verify shape is correct
  assert.ok(typeof result.repos_scanned === "number", "repos_scanned must be number");
});

test("queryDriftOpenapi: repos_scanned equals count of repos whose paths exist on disk", async (t) => {
  const db = createDriftTestDb();
  const { repoPath, cleanup } = createTempRepo("oapi-scan", {
    "openapi.yaml": MINIMAL_OPENAPI_SPEC,
    "package.json": { name: "svc-scan" },
  });
  t.after(() => { cleanup(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, repoPath, "svc-scan", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, "/nonexistent/ghost-oapi-repo", "ghost-oapi", null, null, null);

  const result = await queryDriftOpenapi(db, {});
  assert.equal(result.repos_scanned, 1, `expected repos_scanned=1, got ${result.repos_scanned}`);
});

test("queryDriftOpenapi: tool_available field is present as boolean in result", async (t) => {
  const db = createDriftTestDb();
  const { repoPath: rA, cleanup: cA } = createTempRepo("oapi-bool-a", {
    "openapi.yaml": MINIMAL_OPENAPI_SPEC,
    "package.json": { name: "bool-svc-a" },
  });
  const { repoPath: rB, cleanup: cB } = createTempRepo("oapi-bool-b", {
    "openapi.yaml": MINIMAL_OPENAPI_SPEC,
    "package.json": { name: "bool-svc-b" },
  });
  t.after(() => { cA(); cB(); db.close(); });

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(1, rA, "bool-svc-a", null, null, null);
  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, ?)").run(2, rB, "bool-svc-b", null, null, null);

  const result = await queryDriftOpenapi(db, {});
  assert.ok("tool_available" in result, "result must have tool_available field");
  assert.equal(typeof result.tool_available, "boolean", "tool_available must be a boolean");
});
