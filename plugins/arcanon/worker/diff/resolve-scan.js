/**
 * Scan-version selector resolver —, , Task 1 .
 *
 * Translates an operator-supplied scan-version selector (one of four shapes:
 * integer ID, HEAD/HEAD~N, ISO 8601 date or timestamp, or branch name) into
 * a concrete `scan_versions.id` number.
 *
 * Engine-shape contract (load-bearing — caller passes a raw Database handle):
 *
 *   - Takes a raw Database handle (node:sqlite adapter) — NOT a projectRoot,
 *     NOT a pool key. The caller owns DB lifecycle. This module never opens,
 *     closes, attaches, or mutates the handle it receives.
 *
 *   - Pool-agnostic: imports nothing from `worker/db/pool.js` or
 *     `worker/db/database.js`. Callers open the DB themselves and pass the
 *     handle here without going through the pool. Adding any pool import would
 *     break that contract.
 *
 *   - Read-only: only SELECT statements. No INSERT / UPDATE / DELETE
 *     anywhere in this module.
 *
 * Selector resolution precedence (applied in this exact order, per
 * 115-RESEARCH.md §5.5):
 *
 *   1. /^\d+$/                         → integer scan_versions.id
 *   2. /^HEAD(?:~(\d+))?$/             → HEAD~N offset over completed scans
 *   3. /^(\d{4}-\d{2}-\d{2})(T.*)?$/   → ISO 8601 date or full timestamp
 *   4. fall through                    → branch name (requires projectRoot)
 *
 * **Bare integer always wins** over a 4-digit-year reading. `2026` resolves
 * as integer ID 2026, NEVER as the year 2026. If the operator wants to
 * select the year, they must pass `2026-01-01` (the date form). This is an
 * intentional ergonomic call that matches `git diff <sha> <sha>` UX — see
 * 115-RESEARCH.md §7 question 7 for the rationale.
 *
 * Branch resolver uses `execFileSync` exclusively (NOT shell `exec` /
 * `execSync` / `spawn`). The branch name is passed as an argv element to
 * git, never interpolated into a shell string. This is enforced by a
 * regression test in `resolve-scan.test.js` (test 14) that greps the
 * source. Threat T-115-01-01 in the plan threat model — a shell-exec'd
 * user-controlled branch name would be a command-injection vulnerability.
 */

import { execFileSync } from "node:child_process";

/**
 * List all rows from the `scan_versions` table, newest first.
 *
 * @param {import('../db/sqlite-adapter.js').default} db - open DB handle (caller owns lifecycle)
 * @returns {Array<{id: number, repo_id: number, started_at: string, completed_at: string|null, quality_score: number|null}>}
 */
export function listScanVersions(db) {
  return db
    .prepare(
      `SELECT id, repo_id, started_at, completed_at, quality_score
       FROM scan_versions
       ORDER BY id DESC`
    )
    .all();
}

/**
 * Resolve a selector string to a `scan_versions.id`.
 *
 * Precedence: integer → HEAD/HEAD~N → ISO date → branch (projectRoot required).
 *
 * @param {import('../db/sqlite-adapter.js').default} db - open DB handle (caller owns lifecycle)
 * @param {string} selector - the operator-supplied selector
 * @param {string} [projectRoot] - filesystem path to the project's git working tree;
 *   required only for the branch fallback. Pass undefined for engine callers
 *   that already know the selector is non-branch.
 * @returns {{scanId: number, resolvedFrom: string}}
 * @throws {Error} on missing scan / out-of-range / unparseable input.
 */
export function resolveScanSelector(db, selector, projectRoot) {
  if (typeof selector !== "string" || selector.length === 0) {
    throw new Error("scan selector must be a non-empty string");
  }

  // 1. Integer ID — bare integer always wins (4-digit year ambiguity pinned)
  if (/^\d+$/.test(selector)) {
    const id = Number(selector);
    const row = db
      .prepare("SELECT id FROM scan_versions WHERE id = ?")
      .get(id);
    if (!row) {
      throw new Error(`scan version ${id} not found`);
    }
    return { scanId: id, resolvedFrom: "id" };
  }

  // 2. HEAD / HEAD~N
  const headMatch = selector.match(/^HEAD(?:~(\d+))?$/);
  if (headMatch) {
    const offset = headMatch[1] ? Number(headMatch[1]) : 0;
    const row = db
      .prepare(
        `SELECT id FROM scan_versions
         WHERE completed_at IS NOT NULL
         ORDER BY id DESC LIMIT 1 OFFSET ?`
      )
      .get(offset);
    if (!row) {
      const totalRow = db
        .prepare(
          "SELECT COUNT(*) AS n FROM scan_versions WHERE completed_at IS NOT NULL"
        )
        .get();
      const total = totalRow ? totalRow.n : 0;
      throw new Error(
        `HEAD~${offset} out of range — only ${total} completed scans recorded`
      );
    }
    return { scanId: row.id, resolvedFrom: `HEAD~${offset}` };
  }

  // 3. ISO 8601 date or full timestamp
  const isoMatch = selector.match(/^(\d{4}-\d{2}-\d{2})(T.*)?$/);
  if (isoMatch) {
    // Date-only → end-of-day cutoff. Full timestamp → use selector verbatim.
    const cutoff = isoMatch[2] ? selector : `${isoMatch[1]}T23:59:59.999Z`;
    const row = db
      .prepare(
        `SELECT id FROM scan_versions
         WHERE completed_at IS NOT NULL
           AND completed_at <= ?
         ORDER BY completed_at DESC LIMIT 1`
      )
      .get(cutoff);
    if (!row) {
      throw new Error(`no scan completed on or before ${selector}`);
    }
    return { scanId: row.id, resolvedFrom: `at:${cutoff}` };
  }

  // 4. Branch fallback — requires projectRoot
  if (!projectRoot) {
    throw new Error(
      `branch selector "${selector}" requires a project root`
    );
  }

  let sha;
  try {
    sha = execFileSync(
      "git",
      ["-C", projectRoot, "rev-parse", selector],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (e) {
    throw new Error(
      `git rev-parse failed for branch "${selector}": ${e.message}`
    );
  }

  const row = db
    .prepare(
      `SELECT sv.id
       FROM scan_versions sv
       JOIN repo_state rs ON rs.repo_id = sv.repo_id
       WHERE rs.last_scanned_commit = ?
         AND sv.completed_at IS NOT NULL
       ORDER BY sv.id DESC LIMIT 1`
    )
    .get(sha);
  if (!row) {
    throw new Error(
      `no scan recorded at commit ${sha.slice(0, 8)} (branch ${selector})`
    );
  }
  return {
    scanId: row.id,
    resolvedFrom: `branch:${selector}@${sha.slice(0, 8)}`,
  };
}
