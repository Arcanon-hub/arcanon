/**
 * Migration 002 — Add type column to services table
 *
 * Adds service type classification: 'service', 'library', or 'sdk'.
 * Defaults to 'service' for existing rows.
 */

export const version = 2;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';
  `);
}
