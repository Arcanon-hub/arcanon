#!/usr/bin/env node
/**
 * tests/fixtures/integration/evidence-mode/build-payload.mjs
 *
 * Phase 120-01 INT-01 — bats E2E driver. Spawned by tests/hub-evidence-mode.bats
 * once per fixture config; prints a single-line JSON object that the bats
 * @test blocks pattern-match against.
 *
 * Usage: node build-payload.mjs <full|hash-only|none>
 *
 * Output (stdout, one line of JSON):
 *   {"version": "<v>", "evidence": <string|object|undefined>}
 *
 * The script:
 *   1. Reads the matching arcanon.config.<mode>.json from this directory.
 *   2. Constructs an in-memory findings shape with one connection whose
 *      evidence equals the literal string at line 1 of source.js.
 *   3. Calls buildScanPayload({findings, repoPath, evidenceMode, projectRoot})
 *      with projectRoot = this fixture directory so the hash-only line
 *      derivation can re-read source.js relative to it.
 *   4. Prints {version, evidence} from the resulting payload.
 *
 * Uses an absolute-path import to the plugin's payload module so the script
 * is invariant to the CWD that bats happens to use.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildScanPayload } from "../../../../worker/hub-sync/payload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mode = process.argv[2];
if (!mode || !["full", "hash-only", "none"].includes(mode)) {
  process.stderr.write(
    `usage: node build-payload.mjs <full|hash-only|none>\n`,
  );
  process.exit(2);
}

const cfgPath = path.join(__dirname, `arcanon.config.${mode}.json`);
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const evidenceMode = cfg?.hub?.evidence_mode;
if (!evidenceMode) {
  process.stderr.write(
    `fixture config missing hub.evidence_mode at ${cfgPath}\n`,
  );
  process.exit(2);
}

// The fixture source.js literal at line 1.
const EVIDENCE_LITERAL = "fetch('https://api.example.com/users');";

// buildScanPayload requires a real git repo so deriveGitMetadata can produce
// commit_sha. Build a one-shot ephemeral repo in tmp and seed it with the
// fixture source file at the same relative path the connection cites.
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-evmode-bats-"));
try {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: tmpRepo,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
  git(["init", "-q"]);
  git(["config", "user.email", "test@arcanon.dev"]);
  git(["config", "user.name", "Test"]);
  fs.copyFileSync(
    path.join(__dirname, "source.js"),
    path.join(tmpRepo, "source.js"),
  );
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);

  const findings = {
    services: [{ name: "svc-a", language: "js" }],
    connections: [
      {
        source: "svc-a",
        target: "users-api",
        protocol: "rest",
        evidence: EVIDENCE_LITERAL,
        source_file: "source.js",
      },
    ],
  };

  const { payload } = buildScanPayload({
    findings,
    repoPath: tmpRepo,
    projectRoot: tmpRepo, // line derivation reads source.js relative to here
    evidenceMode,
  });

  const conn = payload.findings.connections[0];
  const out = { version: payload.version };
  if ("evidence" in conn) out.evidence = conn.evidence;
  process.stdout.write(JSON.stringify(out) + "\n");
} finally {
  fs.rmSync(tmpRepo, { recursive: true, force: true });
}
