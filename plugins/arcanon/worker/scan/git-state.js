/**
 * worker/scan/git-state.js — Phase 116-02 (FRESH-02/03).
 *
 * Pure helper that shells out to git via execFileSync (mirroring the existing
 * pattern at worker/scan/manager.js:317 — getChangedFiles / getCurrentHead).
 * Used by GET /api/scan-freshness to compute per-repo "new commits since last
 * scan" counts.
 *
 * Design notes:
 *   - `null` is a meaningful return value: it means "couldn't determine"
 *     (never scanned, sha rebased away, repo path moved, timeout). Distinct
 *     from `0` ("up to date").
 *   - 5s timeout protects against corrupted refs / filesystem stalls.
 *   - Uses execFileSync (not exec) — no shell, no injection surface even if
 *     sinceSha contained shell metacharacters.
 *   - We use `rev-list --count <sha>..HEAD` rather than `git log | wc -l`:
 *     single git invocation, no pipe, hits git's own performance-optimized
 *     counting path (RESEARCH §8).
 */

import { execFileSync } from "node:child_process";

/**
 * Count commits in a repo since the given SHA, on the current branch's HEAD.
 * Returns null when the count cannot be determined (not a git repo, sha
 * unknown, timeout, etc.) — distinct from 0 ("up to date").
 *
 * @param {string} repoPath - Absolute path to the git repository root.
 * @param {string|null|undefined} sinceSha - Last scanned commit SHA. Null/empty → null.
 * @returns {number|null}
 */
export function getCommitsSince(repoPath, sinceSha) {
  if (!sinceSha || typeof sinceSha !== "string" || sinceSha.trim().length === 0) {
    return null;
  }
  try {
    const out = execFileSync(
      "git",
      ["-C", repoPath, "rev-list", "--count", `${sinceSha.trim()}..HEAD`],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    );
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
