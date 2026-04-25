/**
 * Migration 013 — Add connections.path_template column. (RED stub)
 *
 * TDD red phase: file exists with required exports so the test suite can
 * import it, but `up()` is a deliberate no-op. Tests asserting the new
 * column / nullability MUST fail in this state. The green-phase commit
 * fills in the actual ALTER TABLE.
 */

export const version = 13;

/**
 * @param {import('better-sqlite3').Database} _db
 */
export function up(_db) {
  // intentionally empty — RED phase
}
