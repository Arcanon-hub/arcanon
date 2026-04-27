/**
 * worker/cli/correct-resolver.js — service-name → service.id resolver for
 * /arcanon:correct (Phase 118-01, CORRECT-02).
 *
 * Pure helper. Extracted from cmdCorrect so the resolution logic — the
 * non-trivial branch of the handler — can be unit-tested with an in-memory
 * better-sqlite3 db without spawning the worker or stubbing the whole CLI.
 *
 * Contract:
 *   - 1 match  → returns the integer service id.
 *   - 0 match  → throws { code: "NOT_FOUND", message: "service '<n>' not found", exitCode: 2 }.
 *   - >1 match → throws { code: "AMBIGUOUS", message: "<friendly disambiguation>", exitCode: 2 }.
 *
 * Caller is responsible for catching the thrown object, writing to stderr,
 * and exiting with `err.exitCode`. Throwing structured errors keeps the
 * resolver pure and the handler I/O at the boundary.
 */

/**
 * Resolve a service name to its integer id.
 *
 * @param {string} name              Service name as supplied by the operator (--service flag).
 * @param {import('better-sqlite3').Database} db  Open better-sqlite3 handle to impact-map.db.
 * @returns {number} services.id of the unique match.
 * @throws {{code: 'NOT_FOUND'|'AMBIGUOUS', message: string, exitCode: 2}}
 */
export function resolveServiceTarget(name, db) {
  if (typeof name !== "string" || name.length === 0) {
    throw {
      code: "INVALID",
      message: "--service requires a non-empty name",
      exitCode: 2,
    };
  }

  // Pull (id, name, repo_id, root_path) so the disambiguation message can
  // surface enough context for the operator to pick a unique match. The
  // schema does not enforce UNIQUE(name) (mig 001 only constrains
  // (repo_id, name)), so multiple repos legitimately share a service name.
  const rows = db
    .prepare(
      "SELECT s.id, s.name, s.repo_id, s.root_path, r.path AS repo_path " +
      "FROM services s LEFT JOIN repos r ON r.id = s.repo_id " +
      "WHERE s.name = ? ORDER BY s.id ASC"
    )
    .all(name);

  if (rows.length === 0) {
    throw {
      code: "NOT_FOUND",
      message: `service '${name}' not found`,
      exitCode: 2,
    };
  }

  if (rows.length > 1) {
    const lines = rows.map(
      (r) => `  - id=${r.id} repo=${r.repo_path || `<repo:${r.repo_id}>`} root_path=${r.root_path}`
    );
    throw {
      code: "AMBIGUOUS",
      message:
        `service name '${name}' matches ${rows.length} services — disambiguate with the integer id:\n` +
        lines.join("\n"),
      exitCode: 2,
    };
  }

  return rows[0].id;
}
