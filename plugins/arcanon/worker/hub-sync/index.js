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
  markUploadDead,
  deleteUpload,
  queueStats,
} from "./queue.js";

export { PayloadError } from "./payload.js";
export { HubError } from "./client.js";
export { AuthError, resolveCredentials, hasCredentials, storeCredentials } from "./auth.js";
export { queueStats, listAllUploads, pruneDead } from "./queue.js";
// consumed by  /arcanon:login  and
// arcanon:status .
export { getKeyInfo, WHOAMI_PATH } from "./whoami.js";

/**
 * Build payload, POST to the hub, optionally enqueue on retriable failures.
 *
 * @param {object} opts — fields forwarded to buildScanPayload, plus:
 * @param {string} [opts.apiKey] — explicit override; else resolveCredentials()
 * @param {string} [opts.hubUrl]
 * @param {string} [opts.orgId] — per-repo override threaded by manager.js .
 *   Wins precedence over ARCANON_ORG_ID env and ~/.arcanon/config.json default_org_id.
 * @param {boolean} [opts.enqueueOnFailure=true]
 * @param {boolean} [opts.libraryDepsEnabled] —  feature flag passthrough
 * @param {"full"|"hash-only"|"none"} [opts.evidenceMode] —  hub.evidence_mode passthrough
 * @param {string} [opts.projectRoot] —  root for hash-only line derivation; defaults to repoPath
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
    creds = resolveCredentials({
      apiKey: opts.apiKey,
      hubUrl: opts.hubUrl,
      orgId: opts.orgId,
    });
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err, warnings };
    throw err;
  }

  try {
    const result = await uploadScan(payload, {
      apiKey: creds.apiKey,
      hubUrl: creds.hubUrl,
      orgId: creds.orgId,
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
          hubUrl: creds.hubUrl,
          orgId: creds.orgId,
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
 * SEC-05: each row is uploaded to ITS stored (hub_url, org_id) — never to the
 * current org. Only the API key is resolved globally (orgIdRequired:false); the
 * destination always comes from the row. Switching the active org after enqueue
 * cannot retarget a queued row.
 *
 * SEC-07: a non-retriable 4xx (401/400/403/404/410) calls markUploadDead(),
 * which transitions the row to status='dead' in a single UPDATE. The drain
 * report's dead/failed counts are driven by the actual persisted transitions so
 * they always match queueStats().
 *
 * @param {object} [opts]
 * @param {string} [opts.apiKey]   — explicit API key override
 * @param {number} [opts.limit=50]
 * @param {Function} [opts.log]
 * @param {typeof fetch} [opts.fetchImpl] — injectable fetch for tests
 * @param {string} [opts.dataDir]  — queue DB directory; defaults to resolveDataDir()
 * @returns {Promise<{ attempted: number, succeeded: number, failed: number, dead: number, stats: object }>}
 */
export async function drainQueue(opts = {}) {
  const log = opts.log || (() => {});
  const dataDir = opts.dataDir;

  let creds;
  try {
    // SEC-05: resolve API key only — a missing machine-default org must not
    // block draining a fully-bound queue (each row carries its own destination).
    creds = resolveCredentials({
      apiKey: opts.apiKey,
      orgIdRequired: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      log("WARN", "drain skipped — no credentials", { error: err.message });
      return {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        dead: 0,
        stats: queueStats(dataDir),
        error: err.message,
      };
    }
    throw err;
  }

  const rows = listDueUploads(opts.limit ?? 50, dataDir);
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const row of rows) {
    // Defense-in-depth (SEC-05): a row without a bound destination must never
    // be routed to the current org. Leave it untouched and count as failed.
    if (!row.hub_url || !row.org_id) {
      log("WARN", "queue row missing destination — skipping (held)", { id: row.id });
      failed++;
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(row.body);
    } catch (err) {
      log("WARN", "queue row has unparsable body — discarding", { id: row.id });
      deleteUpload(row.id, dataDir);
      failed++;
      continue;
    }
    try {
      // SEC-05: use per-row stored destination — not creds.hubUrl / creds.orgId.
      await uploadScan(payload, {
        apiKey: creds.apiKey,
        hubUrl: row.hub_url,
        orgId: row.org_id,
        fetchImpl: opts.fetchImpl,
        log,
      });
      deleteUpload(row.id, dataDir);
      succeeded++;
    } catch (err) {
      if (err instanceof HubError && err.retriable) {
        // Retriable (5xx / network / 429-exhausted): schedule for retry.
        const outcome = markUploadFailure(row.id, err.message, dataDir);
        if (outcome.status === "dead") dead++;
        else failed++;
      } else {
        // Non-retriable (401/400/403/404/410/422): dead in one attempt (SEC-07).
        markUploadDead(row.id, err.message, dataDir);
        dead++;
      }
    }
  }

  return {
    attempted: rows.length,
    succeeded,
    failed,
    dead,
    stats: queueStats(dataDir),
  };
}
