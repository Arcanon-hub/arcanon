/**
 * worker/lib/repo-resolver.js — Resolve a repo identifier (path or name)
 * to a row from the `repos` table.
 *
 * Used by `/arcanon:rescan` (commands/rescan.md). Extracted into its own
 * pure module so the disambiguation logic is unit-testable without an HTTP
 * server. Originally written for Plan 118-02's POST /api/rescan endpoint
 * (deleted; the markdown command now drives scanning directly).
 *
 * Resolution algorithm (see 118-RESEARCH.md §5):
 *   1. Try absolute path lookup — `path.resolve(projectRoot, identifier)`
 *      then `SELECT id, path, name FROM repos WHERE path = ?`.
 *   2. Try name lookup — `SELECT id, path, name FROM repos WHERE name = ?`.
 *      One row → return it. Zero rows → NOT_FOUND. >1 rows → AMBIGUOUS.
 *
 * Errors are thrown as structured objects { code, message, exitCode } —
 * callers (HTTP handler, CLI handler) translate to status codes / exit codes.
 */

import path from "node:path";

/**
 * Resolve a repo identifier to its DB row.
 *
 * @param {string} identifier - Filesystem path (relative or absolute) OR the
 *   value of `repos.name` (typically `basename(repoPath)`).
 * @param {object} db - better-sqlite3 Database handle (caller owns lifecycle).
 * @param {string} projectRoot - Absolute path used to canonicalize relative
 *   path identifiers (typically the worker request's `?project=` param OR
 *   the CLI's process.cwd()).
 * @returns {{id: number, path: string, name: string}}
 * @throws {{code: 'INVALID'|'NOT_FOUND'|'AMBIGUOUS', message: string, exitCode: number, available?: Array, matches?: Array}}
 */
export function resolveRepoIdentifier(identifier, db, projectRoot) {
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw {
      code: "INVALID",
      message: "repo identifier required (path or name)",
      exitCode: 2,
    };
  }
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw {
      code: "INVALID",
      message: "projectRoot required to canonicalize path identifiers",
      exitCode: 2,
    };
  }

  // 1. Try absolute-path lookup first. path.resolve handles both absolute
  //    arguments (returned as-is) and relatives (resolved against projectRoot).
  const absPath = path.resolve(projectRoot, identifier);
  const byPath = db
    .prepare("SELECT id, path, name FROM repos WHERE path = ?")
    .get(absPath);
  if (byPath) return byPath;

  // 2. Try name lookup (no UNIQUE constraint on repos.name — see migration 006).
  const byName = db
    .prepare("SELECT id, path, name FROM repos WHERE name = ?")
    .all(identifier);
  if (byName.length === 1) return byName[0];

  if (byName.length > 1) {
    throw {
      code: "AMBIGUOUS",
      message:
        `repo name '${identifier}' matches ${byName.length} repos: ` +
        byName.map((r) => r.path).join(", ") +
        ". Use the absolute path to disambiguate.",
      exitCode: 2,
      matches: byName.map((r) => ({ id: r.id, path: r.path })),
    };
  }

  // 3. Not found — list every available repo so the operator can correct.
  const all = db
    .prepare("SELECT name, path FROM repos ORDER BY name")
    .all();
  const available = all.map((r) => ({ name: r.name, path: r.path }));
  const lines =
    all.length === 0
      ? "(no repos in this project — run /arcanon:map first)"
      : all.map((r) => `  - ${r.name} (${r.path})`).join("\n");
  throw {
    code: "NOT_FOUND",
    message: `repo '${identifier}' not found. Available repos:\n${lines}`,
    exitCode: 2,
    available,
  };
}
