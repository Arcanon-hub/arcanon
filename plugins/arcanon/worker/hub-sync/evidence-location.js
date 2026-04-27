/**
 * worker/hub-sync/evidence-location.js — Compute hash + line range for an
 * evidence snippet relative to its source file.
 *
 * Pure function — no DB, no network, no mutable state. Reads the cited
 * source file at most once per call.
 *
 * Used by:
 *   - worker/hub-sync/payload.js (hash-only evidence_mode — Phase 120-01 INT-01)
 *   - worker/server/http.js computeVerdict (verify command — Phase 112-02 TRUST-01)
 *
 * Single source of truth for evidence line semantics. The agent does not
 * persist line numbers — they are derived at read time from the source
 * file + the literal evidence substring (Phase 109 §D-03 confirmed:
 * connections schema has no line_start/line_end columns).
 *
 * Contract:
 *   - Empty / whitespace-only evidence → all-null sentinel (no hash either).
 *     Mirrors computeVerdict's `if (!evidence) { ... }` short-circuit.
 *   - Hash is sha256(trimmed evidence). Computed even when we cannot locate
 *     lines so the hub can correlate snippets across re-scans by hash alone.
 *   - Lines are 1-indexed; end_line = start_line when the snippet is
 *     single-line. Multi-line snippets add the count of newlines inside the
 *     snippet to start_line.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const NULL_RESULT = Object.freeze({
  hash: null,
  start_line: null,
  end_line: null,
  evidence_present: false,
});

/**
 * @param {string|null|undefined} evidence — agent-emitted snippet (may be empty / null)
 * @param {string|null|undefined} sourceFile — path recorded on the connection (relative or absolute)
 * @param {string|null|undefined} projectRoot — absolute path to resolve a relative sourceFile against
 * @returns {{
 *   hash: string|null,
 *   start_line: number|null,
 *   end_line: number|null,
 *   evidence_present: boolean
 * }}
 */
export function extractEvidenceLocation(evidence, sourceFile, projectRoot) {
  const trimmed = typeof evidence === "string" ? evidence.trim() : "";
  if (!trimmed) {
    return { ...NULL_RESULT };
  }

  const hash = crypto.createHash("sha256").update(trimmed).digest("hex");

  if (!sourceFile || !projectRoot) {
    return { hash, start_line: null, end_line: null, evidence_present: false };
  }

  const absPath = path.resolve(projectRoot, sourceFile);
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return { hash, start_line: null, end_line: null, evidence_present: false };
  }

  const matchIdx = content.indexOf(trimmed);
  if (matchIdx === -1) {
    return { hash, start_line: null, end_line: null, evidence_present: false };
  }

  // 1-indexed line numbers — mirrors http.js computeVerdict algorithm exactly
  // (kept in sync as the single source of truth for evidence-line semantics).
  const start_line = (content.slice(0, matchIdx).match(/\n/g) || []).length + 1;
  const newlinesInSnippet = (trimmed.match(/\n/g) || []).length;
  const end_line = start_line + newlinesInSnippet;

  return { hash, start_line, end_line, evidence_present: true };
}
