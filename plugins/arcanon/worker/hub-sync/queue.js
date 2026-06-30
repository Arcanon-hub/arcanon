/**
 * worker/hub-sync/queue.js — SQLite-backed offline upload queue.
 *
 * When a hub upload fails with a retriable error (5xx, network, 429 after
 * exhaustion) the payload is enqueued and retried later. /arcanon:sync drains
 * the queue on demand; the worker also drains opportunistically on startup.
 *
 * Queue storage: <dataDir>/hub-queue.db (node:sqlite adapter, WAL).
 *
 * Retry schedule (seconds): 30, 120, 600, 3600, 21600. After MAX_ATTEMPTS
 * failed attempts, the row moves to status='dead' — surfaced by /arcanon:status.
 *
 * ── Schema evolution ──────────────────────────────────────────────────────────
 * hub-queue.db is opened directly by this module (new Database(file) →
 * db.exec(SCHEMA)) and is intentionally NOT part of the worker/db/migrations
 * runner (worker/db/database.js openDb / runMigrations). That runner targets
 * the per-project impact-map.db; the uploads table does not exist there, so a
 * numbered 0NN migration file placed in worker/db/migrations/ would target the
 * wrong database.
 *
 * New columns are therefore added here via migrateQueueSchema(), which follows
 * the repo's established idempotent PRAGMA-guarded ADD COLUMN convention
 * (worker/db/migrations/005 and /020): read PRAGMA table_info, issue ALTER
 * TABLE only when the column is absent. Re-running is always a no-op — this
 * gives the same ordered, additive, loss-free semantics as the numbered
 * migration set, applied at the correct database. (SEC-04 schema decision.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import path from "node:path";
import Database from "../db/sqlite-adapter.js";

import { resolveDataDir } from "../lib/data-dir.js";

export const MAX_ATTEMPTS = 5;
export const RETRY_SCHEDULE_SECONDS = [30, 120, 600, 3600, 21600];

const QUEUE_FILE = "hub-queue.db";
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS uploads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    status          TEXT NOT NULL DEFAULT 'pending',
    repo_name       TEXT NOT NULL,
    commit_sha      TEXT NOT NULL,
    project_slug    TEXT,
    body            TEXT NOT NULL,
    last_error      TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    enqueued_at     TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL,
    hub_url         TEXT,
    org_id          TEXT
  );
  CREATE INDEX IF NOT EXISTS uploads_status_next_attempt_idx
    ON uploads(status, next_attempt_at);
  CREATE UNIQUE INDEX IF NOT EXISTS uploads_dedup_idx
    ON uploads(repo_name, commit_sha) WHERE status = 'pending';
`;

let _db = null;

/**
 * Idempotent in-place schema migration for hub-queue.db.
 *
 * Adds hub_url and org_id columns if absent (PRAGMA-guarded, same pattern
 * as migrations 005/020 for impact-map.db). After column ALTERs, quarantines
 * any legacy pending rows that have no bound destination (org_id IS NULL) by
 * moving them to status='held' — these rows predate tenant-binding (SEC-06)
 * and must never be drained to the current org.
 *
 * Re-running is a no-op: the ALTER is skipped when the column already exists,
 * and the UPDATE transitions no rows once all pending rows carry org_id.
 *
 * @param {import('../db/sqlite-adapter.js').default} db
 */
export function migrateQueueSchema(db) {
  const cols = db.prepare("PRAGMA table_info(uploads)").all();
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has("hub_url")) {
    db.exec("ALTER TABLE uploads ADD COLUMN hub_url TEXT;");
  }
  if (!colNames.has("org_id")) {
    db.exec("ALTER TABLE uploads ADD COLUMN org_id TEXT;");
  }

  // Quarantine legacy destination-less pending rows (SEC-06).
  // Any row with status='pending' and org_id IS NULL predates tenant-binding.
  // Move them to 'held' so drain can never retarget them to the current org.
  // This is a no-op once all pending rows carry org_id (guaranteed by the
  // enqueueUpload requirement added in this module).
  db.exec(
    "UPDATE uploads SET status = 'held' WHERE status = 'pending' AND org_id IS NULL;",
  );
}

function openQueueDb(dataDir) {
  const dir = dataDir || resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, QUEUE_FILE);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  migrateQueueSchema(db);
  return db;
}

export function getQueueDb(dataDir) {
  if (!_db) _db = openQueueDb(dataDir);
  return _db;
}

export function _resetQueueDb() {
  try {
    _db?.close();
  } catch {}
  _db = null;
}

function nextAttemptAt(attempt) {
  const seconds =
    RETRY_SCHEDULE_SECONDS[Math.min(attempt - 1, RETRY_SCHEDULE_SECONDS.length - 1)];
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Enqueue an upload for later retry.
 *
 * SEC-04 requirement: entry MUST supply a non-empty hubUrl and orgId. These
 * values are persisted immutably on the row so drain cannot retarget the
 * payload if the active org/credentials change between enqueue and drain time.
 * Callers that cannot supply a destination MUST NOT enqueue — they should
 * surface the auth error directly instead.
 *
 * @param {{ repoName: string, commitSha: string, projectSlug?: string,
 *           body: string, lastError?: string,
 *           hubUrl: string, orgId: string }} entry
 * @param {string} [dataDir]
 * @returns {number|null} The new or existing row id, or null on conflict miss.
 */
export function enqueueUpload(entry, dataDir) {
  if (!entry.hubUrl || !entry.orgId) {
    throw new Error(
      "enqueueUpload: destination required — entry must provide non-empty hubUrl and orgId (SEC-04)",
    );
  }
  const db = getQueueDb(dataDir);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO uploads (status, repo_name, commit_sha, project_slug, body, last_error, attempts, enqueued_at, next_attempt_at, hub_url, org_id)
    VALUES ('pending', @repo_name, @commit_sha, @project_slug, @body, @last_error, 0, @now, @next, @hub_url, @org_id)
    ON CONFLICT(repo_name, commit_sha) WHERE status = 'pending' DO UPDATE SET
      body = excluded.body,
      project_slug = excluded.project_slug,
      last_error = excluded.last_error,
      next_attempt_at = excluded.next_attempt_at,
      hub_url = excluded.hub_url,
      org_id = excluded.org_id
    RETURNING id
  `);
  const row = stmt.get({
    repo_name: entry.repoName,
    commit_sha: entry.commitSha,
    project_slug: entry.projectSlug || null,
    body: entry.body,
    last_error: entry.lastError || null,
    now,
    next: nextAttemptAt(1),
    hub_url: entry.hubUrl,
    org_id: entry.orgId,
  });
  return row?.id ?? null;
}

export function listDueUploads(limit = 50, dataDir) {
  const db = getQueueDb(dataDir);
  const now = new Date().toISOString();
  return db
    .prepare(
      `SELECT * FROM uploads
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC
       LIMIT ?`,
    )
    .all(now, limit);
}

export function listAllUploads(dataDir) {
  const db = getQueueDb(dataDir);
  return db.prepare(`SELECT * FROM uploads ORDER BY enqueued_at DESC`).all();
}

export function deleteUpload(id, dataDir) {
  const db = getQueueDb(dataDir);
  db.prepare(`DELETE FROM uploads WHERE id = ?`).run(id);
}

/**
 * Delete every row with status='dead'. Returns the number deleted.
 * Used by `/arcanon:sync --prune-dead` so dead rows don't accumulate
 * forever in the local queue DB.
 *
 * @param {string} [dataDir]
 * @returns {number}
 */
export function pruneDead(dataDir) {
  const db = getQueueDb(dataDir);
  const info = db.prepare(`DELETE FROM uploads WHERE status = 'dead'`).run();
  return info.changes ?? 0;
}

export function markUploadFailure(id, errorMessage, dataDir) {
  const db = getQueueDb(dataDir);
  const row = db.prepare(`SELECT attempts FROM uploads WHERE id = ?`).get(id);
  if (!row) return { status: "missing", attempts: 0, next_attempt_at: null };
  const nextAttempts = row.attempts + 1;

  if (nextAttempts >= MAX_ATTEMPTS) {
    db.prepare(
      `UPDATE uploads SET status='dead', attempts=?, last_error=?, next_attempt_at=? WHERE id=?`,
    ).run(nextAttempts, errorMessage, new Date().toISOString(), id);
    return { status: "dead", attempts: nextAttempts, next_attempt_at: null };
  }

  const next = nextAttemptAt(nextAttempts + 1);
  db.prepare(
    `UPDATE uploads SET attempts=?, last_error=?, next_attempt_at=? WHERE id=?`,
  ).run(nextAttempts, errorMessage, next, id);
  return { status: "pending", attempts: nextAttempts, next_attempt_at: next };
}

/**
 * Aggregate queue counts by status.
 *
 * Uses a single GROUP BY query so all status values are always counted — no
 * status can be silently omitted as new values (e.g. 'held') are added.
 *
 * @param {string} [dataDir]
 * @returns {{ pending: number, dead: number, held: number, oldestPending: string|null }}
 */
export function queueStats(dataDir) {
  const db = getQueueDb(dataDir);
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM uploads GROUP BY status`).all();
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = r.n;

  const pending = byStatus["pending"] ?? 0;
  const dead = byStatus["dead"] ?? 0;
  const held = byStatus["held"] ?? 0;

  const oldestPending =
    db
      .prepare(`SELECT MIN(enqueued_at) AS ts FROM uploads WHERE status='pending'`)
      .get()?.ts || null;

  return { pending, dead, oldestPending, held };
}
