/**
 * worker/hub-sync/evidence-location.test.js — Unit tests for the pure
 * extractEvidenceLocation helper (Phase 120-01 INT-01).
 *
 * The helper is the single source of truth for evidence-snippet line
 * derivation. It is consumed by:
 *   - worker/hub-sync/payload.js (hash-only evidence_mode)
 *   - worker/server/http.js computeVerdict (verify command)
 *
 * Run: node --test plugins/arcanon/worker/hub-sync/evidence-location.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractEvidenceLocation } from "./evidence-location.js";

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function makeTempFile(content, name = "src.js") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-evloc-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return { filePath, projectRoot: dir, relPath: name };
}

// ── 1. Hash determinism ──────────────────────────────────────────────────────

test("INT-01 helper #1 — hash deterministic for given evidence string", () => {
  const out = extractEvidenceLocation("foo bar", null, null);
  assert.equal(out.hash, sha256("foo bar"));
  assert.equal(out.hash.length, 64); // sha256 hex = 64 chars
});

// ── 2. Empty evidence → all-null sentinel ───────────────────────────────────

test("INT-01 helper #2 — empty evidence returns all-null sentinel", () => {
  const out = extractEvidenceLocation("", "anyfile.js", "/tmp/proj");
  assert.deepEqual(out, {
    hash: null,
    start_line: null,
    end_line: null,
    evidence_present: false,
  });
});

// ── 3. No source_file → hash present, lines null ────────────────────────────

test("INT-01 helper #3 — no source_file yields hash but no lines", () => {
  const out = extractEvidenceLocation("foo", null, "/tmp/proj");
  assert.equal(out.hash, sha256("foo"));
  assert.equal(out.start_line, null);
  assert.equal(out.end_line, null);
  assert.equal(out.evidence_present, false);
});

// ── 4. File missing → hash present, lines null ──────────────────────────────

test("INT-01 helper #4 — missing file yields hash but no lines", () => {
  const out = extractEvidenceLocation("foo", "missing.js", "/tmp/proj");
  assert.equal(out.hash, sha256("foo"));
  assert.equal(out.start_line, null);
  assert.equal(out.end_line, null);
  assert.equal(out.evidence_present, false);
});

// ── 5. Snippet not in file → hash present, lines null ──────────────────────

test("INT-01 helper #5 — snippet absent in file yields hash but no lines", () => {
  const { filePath, projectRoot, relPath } = makeTempFile("abc\n");
  try {
    const out = extractEvidenceLocation("xyz", relPath, projectRoot);
    assert.equal(out.hash, sha256("xyz"));
    assert.equal(out.start_line, null);
    assert.equal(out.end_line, null);
    assert.equal(out.evidence_present, false);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

// ── 6. Single-line match → start_line=end_line=2 ────────────────────────────

test("INT-01 helper #6 — single-line match returns 1-indexed line", () => {
  const { filePath, projectRoot, relPath } = makeTempFile("line1\nfoo bar\nline3\n");
  try {
    const out = extractEvidenceLocation("foo bar", relPath, projectRoot);
    assert.equal(out.hash, sha256("foo bar"));
    assert.equal(out.start_line, 2);
    assert.equal(out.end_line, 2);
    assert.equal(out.evidence_present, true);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

// ── 7. Multi-line snippet → end_line offset by newline count ───────────────

test("INT-01 helper #7 — multi-line snippet derives correct end_line", () => {
  const { filePath, projectRoot, relPath } = makeTempFile("a\nb\nc\nd\n");
  try {
    const out = extractEvidenceLocation("b\nc", relPath, projectRoot);
    assert.equal(out.start_line, 2);
    assert.equal(out.end_line, 3);
    assert.equal(out.evidence_present, true);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

// ── 8. Whitespace-only evidence treated as empty ────────────────────────────

test("INT-01 helper #8 — whitespace-only evidence returns null sentinel", () => {
  const { filePath, projectRoot, relPath } = makeTempFile("any\n");
  try {
    const out = extractEvidenceLocation("   \n  ", relPath, projectRoot);
    assert.equal(out.hash, null);
    assert.equal(out.start_line, null);
    assert.equal(out.end_line, null);
    assert.equal(out.evidence_present, false);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

// ── 9. Null/undefined inputs are non-throwing ──────────────────────────────

test("INT-01 helper #9 — null/undefined evidence returns null sentinel without throw", () => {
  assert.doesNotThrow(() => extractEvidenceLocation(null, null, null));
  assert.doesNotThrow(() => extractEvidenceLocation(undefined, undefined, undefined));
  const out = extractEvidenceLocation(null, null, null);
  assert.equal(out.hash, null);
  assert.equal(out.evidence_present, false);
});
