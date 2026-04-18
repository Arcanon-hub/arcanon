/**
 * worker/hub-sync/index.js — Public entry point for Arcanon Hub synchronization.
 *
 * High-level flow used by scan manager / CLI commands:
 *
 *   import { syncFindings, drainQueue } from '../hub-sync/index.js';
 *
 *   // Inline upload after scan:
 *   const result = await syncFindings({ findings, repoPath });
 *
 *   // Drain offline queue from /arcanon:sync or worker startup:
 *   const drainReport = await drainQueue();
 *
 * All errors are surfaced to the caller — the caller decides whether to
 * enqueue for later retry. syncFindings() itself enqueues only when the
 * caller passes `enqueueOnFailure: true`.
 */

import { buildScanPayload, PayloadError, serializePayload } from "./payload.js";
import { uploadScan, HubError } from "./client.js";
import { resolveCredentials, AuthError } from "./auth.js";
import {
  enqueueUpload,
  listDueUploads,
  markUploadFailure,
  deleteUpload,
  queueStats,
} from "./queue.js";

export { PayloadError } from "./payload.js";
export { HubError } from "./client.js";
export { AuthError, resolveCredentials, hasCredentials, storeCredentials } from "./auth.js";
export { queueStats, listAllUploads, pruneDead } from "./queue.js";

/**
 * Build payload, POST to the hub, optionally enqueue on retriable failures.
 *
 * @param {object} opts — fields forwarded to buildScanPayload, plus:
 * @param {string} [opts.apiKey] — explicit override; else resolveCredentials()
 * @param {string} [opts.hubUrl]
 * @param {boolean} [opts.enqueueOnFailure=true]
 * @param {Function} [opts.log]
 * @returns {Promise<{ ok: boolean, result?: object, error?: Error, enqueuedId?: number, warnings: string[] }>}
 */
export async function syncFindings(opts = {}) {
  const log = opts.log || (() => {});
  const warnings = [];

  let payload;
  try {
    const built = buildScanPayload(opts);
    payload = built.payload;
    warnings.push(...built.warnings);
  } catch (err) {
    if (err instanceof PayloadError) return { ok: false, error: err, warnings };
    throw err;
  }

  let creds;
  try {
    creds = resolveCredentials({ apiKey: opts.apiKey, hubUrl: opts.hubUrl });
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err, warnings };
    throw err;
  }

  try {
    const result = await uploadScan(payload, {
      apiKey: creds.apiKey,
      hubUrl: creds.hubUrl,
      log,
    });
    return { ok: true, result, warnings };
  } catch (err) {
    if (!(err instanceof HubError)) throw err;
    const enqueueOnFailure = opts.enqueueOnFailure !== false;
    if (err.retriable && enqueueOnFailure) {
      try {
        const { body } = serializePayload(payload);
        const id = enqueueUpload({
          repoName: payload.metadata.repo_name,
          commitSha: payload.metadata.commit_sha,
          projectSlug: payload.metadata.project_slug,
          body,
          lastError: err.message,
        });
        log("INFO", "hub upload enqueued for retry", { queueId: id });
        return { ok: false, error: err, enqueuedId: id, warnings };
      } catch (enqueueErr) {
        log("ERROR", "failed to enqueue upload", { error: enqueueErr.message });
      }
    }
    return { ok: false, error: err, warnings };
  }
}

/**
 * Drain due rows from the offline queue by POSTing them.
 *
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.hubUrl]
 * @param {number} [opts.limit=50]
 * @param {Function} [opts.log]
 * @returns {Promise<{ attempted: number, succeeded: number, failed: number, dead: number, stats: object }>}
 */
export async function drainQueue(opts = {}) {
  const log = opts.log || (() => {});
  let creds;
  try {
    creds = resolveCredentials({ apiKey: opts.apiKey, hubUrl: opts.hubUrl });
  } catch (err) {
    if (err instanceof AuthError) {
      log("WARN", "drain skipped — no credentials", { error: err.message });
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        dead: 0,
        stats: queueStats(),
        error: err.message,
      };
    }
    throw err;
  }

  const rows = listDueUploads(opts.limit ?? 50);
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.body);
    } catch (err) {
      log("WARN", "queue row has unparsable body — discarding", { id: row.id });
      deleteUpload(row.id);
      failed++;
      continue;
    }
    try {
      await uploadScan(payload, { apiKey: creds.apiKey, hubUrl: creds.hubUrl, log });
      deleteUpload(row.id);
      succeeded++;
    } catch (err) {
      if (err instanceof HubError && err.retriable) {
        const outcome = markUploadFailure(row.id, err.message);
        if (outcome.status === "dead") dead++;
        else failed++;
      } else {
        // Non-retriable (e.g. 422 validation) — move to dead.
        markUploadFailure(row.id, err.message);
        dead++;
      }
    }
  }

  return {
    attempted: rows.length,
    succeeded,
    failed,
    dead,
    stats: queueStats(),
  };
}
