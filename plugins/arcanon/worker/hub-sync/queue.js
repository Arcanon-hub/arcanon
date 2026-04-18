/**
 * worker/hub-sync/queue.js — SQLite-backed offline upload queue.
 *
 * When a hub upload fails with a retriable error (5xx, network, 429 after
 * exhaustion) the payload is enqueued and retried later. /arcanon:sync drains
 * the queue on demand; the worker also drains opportunistically on startup.
 *
 * Queue storage: <dataDir>/hub-queue.db (better-sqlite3, WAL).
 *
 * Retry schedule (seconds): 30, 120, 600, 3600, 21600. After MAX_ATTEMPTS
 * failed attempts, the row moves to status='dead' — surfaced by /arcanon:status.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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
    next_attempt_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS uploads_status_next_attempt_idx
    ON uploads(status, next_attempt_at);
  CREATE UNIQUE INDEX IF NOT EXISTS uploads_dedup_idx
    ON uploads(repo_name, commit_sha) WHERE status = 'pending';
`;

let _db = null;

function openQueueDb(dataDir) {
  const dir = dataDir || resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, QUEUE_FILE);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
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

export function enqueueUpload(entry, dataDir) {
  const db = getQueueDb(dataDir);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO uploads (status, repo_name, commit_sha, project_slug, body, last_error, attempts, enqueued_at, next_attempt_at)
    VALUES ('pending', @repo_name, @commit_sha, @project_slug, @body, @last_error, 0, @now, @next)
    ON CONFLICT(repo_name, commit_sha) WHERE status = 'pending' DO UPDATE SET
      body = excluded.body,
      project_slug = excluded.project_slug,
      last_error = excluded.last_error,
      next_attempt_at = excluded.next_attempt_at
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

export function queueStats(dataDir) {
  const db = getQueueDb(dataDir);
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM uploads WHERE status='pending'`).get().n;
  const dead = db.prepare(`SELECT COUNT(*) AS n FROM uploads WHERE status='dead'`).get().n;
  const oldestPending =
    db
      .prepare(`SELECT MIN(enqueued_at) AS ts FROM uploads WHERE status='pending'`)
      .get()?.ts || null;
  return { pending, dead, oldestPending };
}
