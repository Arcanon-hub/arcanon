/**
 * worker/scan/git-state.js —  (/03).
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
 *
 * PERF-06 (Phase 143-05): Short-TTL module-level cache (COMMITS_CACHE_TTL_MS)
 * prevents one execFileSync per repo on every /api/scan-freshness UI poll.
 * Only successful (non-null) results are cached — null ("couldn't determine")
 * is not cached so the next call retries. The null-vs-0 distinction is fully
 * preserved. TTL: 30 seconds.
 */

import { execFileSync } from "node:child_process";

/** TTL for the getCommitsSince result cache: 30 seconds. */
const COMMITS_CACHE_TTL_MS = 30 * 1000;

/**
 * Module-level TTL cache.
 * Key: `${repoPath}::${sinceSha}` — Value: { value: number, ts: number }
 * Exported for test introspection only; do not mutate from outside this module.
 *
 * @internal
 */
export const _commitsCache = new Map();

/**
 * Count commits in a repo since the given SHA, on the current branch's HEAD.
 * Returns null when the count cannot be determined (not a git repo, sha
 * unknown, timeout, etc.) — distinct from 0 ("up to date").
 *
 * Results are cached for COMMITS_CACHE_TTL_MS (30s) to avoid spawning one
 * git subprocess per repo on every /api/scan-freshness poll. Null results are
 * not cached so transient errors are retried on the next call.
 *
 * @param {string} repoPath - Absolute path to the git repository root.
 * @param {string|null|undefined} sinceSha - Last scanned commit SHA. Null/empty → null.
 * @returns {number|null}
 */
export function getCommitsSince(repoPath, sinceSha) {
  if (!sinceSha || typeof sinceSha !== "string" || sinceSha.trim().length === 0) {
    return null;
  }
  const sha = sinceSha.trim();
  const key = `${repoPath}::${sha}`;

  // TTL cache hit — return cached value without spawning git.
  const cached = _commitsCache.get(key);
  if (cached !== undefined && Date.now() - cached.ts < COMMITS_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const out = execFileSync(
      "git",
      ["-C", repoPath, "rev-list", "--count", `${sha}..HEAD`],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    );
    const n = parseInt(out.trim(), 10);
    const value = Number.isFinite(n) ? n : null;
    // Only cache non-null (successful) results. Null means "couldn't determine"
    // and should be retried on the next call rather than served from cache.
    if (value !== null) {
      _commitsCache.set(key, { value, ts: Date.now() });
    }
    return value;
  } catch {
    return null;
  }
}
