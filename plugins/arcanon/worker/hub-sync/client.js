/**
 * worker/hub-sync/client.js — HTTP client for POST /api/v1/scans/upload.
 *
 * Contract (from arcanon-hub/packages/api-server/app/routes/scan.py):
 *   Request:  POST {hubUrl}/api/v1/scans/upload
 *             Authorization: Bearer arc_...
 *             Content-Type: application/json
 *             Body: ScanPayloadV1 (< 10 MB)
 *   Response:
 *             202 → { scan_upload_id, status, latest_payload_version } — success OR idempotent hit
 *             400 → project_slug/project not found
 *             401 → missing/invalid key, or JWT used (rejected)
 *             413 → payload too large
 *             422 → Pydantic validation failed
 *             429 → rate limit exceeded (honor Retry-After)
 *             5xx / network → retry with exponential backoff
 *
 * Retry policy: up to RETRY_ATTEMPTS with base delays [1s, 2s, 4s].
 * Honors Retry-After header on 429. 4xx (except 429) is fail-fast — the
 * caller receives the error and may choose to enqueue or surface.
 */

import { serializePayload, MAX_PAYLOAD_BYTES } from "./payload.js";

export const UPLOAD_PATH = "/api/v1/scans/upload";
export const RETRY_ATTEMPTS = 3;
export const BASE_BACKOFFS_MS = [1000, 2000, 4000];
export const DEFAULT_TIMEOUT_MS = 30_000;

export class HubError extends Error {
  constructor(message, { status, retriable, body, attempts } = {}) {
    super(message);
    this.name = "HubError";
    this.status = status ?? null;
    this.retriable = Boolean(retriable);
    this.body = body ?? null;
    this.attempts = attempts ?? null;
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function parseRetryAfter(headerValue, fallbackMs) {
  if (!headerValue) return fallbackMs;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  // Could be an HTTP-date — parse best-effort.
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return fallbackMs;
}

function classify(status) {
  if (status === 202 || status === 409) return { ok: true, retriable: false };
  if (status === 429) return { ok: false, retriable: true };
  if (status >= 500) return { ok: false, retriable: true };
  return { ok: false, retriable: false };
}

// readBodySafe captures the server response body into HubError.body so
// callers can surface the RFC 7807 `detail` field to users. The server's
// current Pydantic error responses do NOT echo submitted fields — if
// that ever changes, this body is logged by the scan manager and could
// end up in worker logs. If a future server version starts echoing
// request fields, redact Authorization before logging.
async function readBodySafe(response) {
  try {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

/**
 * Post a ScanPayloadV1 envelope to Arcanon Hub.
 *
 * @param {object} payload — output of buildScanPayload()
 * @param {object} opts
 * @param {string} opts.apiKey — Bearer token starting with arc_
 * @param {string} opts.hubUrl — e.g. "https://api.arcanon.dev"
 * @param {number} [opts.attempts=3]
 * @param {number[]} [opts.backoffsMs] — override retry delays
 * @param {number} [opts.timeoutMs=30000]
 * @param {(level: string, msg: string, data?: object) => void} [opts.log]
 * @param {typeof fetch} [opts.fetchImpl] — injectable for tests
 * @returns {Promise<{ scan_upload_id: string, status: string, latest_payload_version?: string }>}
 * @throws {HubError}
 */
export async function uploadScan(payload, opts) {
  const {
    apiKey,
    hubUrl,
    attempts = RETRY_ATTEMPTS,
    backoffsMs = BASE_BACKOFFS_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log = () => {},
    fetchImpl = globalThis.fetch,
  } = opts || {};

  if (!fetchImpl) {
    throw new HubError("fetch() is not available — Node.js >= 18 required");
  }
  if (!apiKey) throw new HubError("apiKey is required");
  if (!hubUrl) throw new HubError("hubUrl is required");

  const { body, bytes } = serializePayload(payload);
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new HubError(`payload ${bytes}B exceeds hub ${MAX_PAYLOAD_BYTES}B limit`, {
      status: 413,
      retriable: false,
    });
  }

  const url = new URL(UPLOAD_PATH, hubUrl).toString();
  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "arcanon-plugin-hub-sync",
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      lastErr = new HubError(`network error: ${err.message}`, {
        retriable: true,
        attempts: attempt,
      });
      log("WARN", "hub upload network error", { attempt, error: err.message });
      if (attempt < attempts) {
        await sleep(backoffsMs[attempt - 1] ?? backoffsMs[backoffsMs.length - 1]);
        continue;
      }
      throw lastErr;
    }

    clearTimeout(timer);
    const { ok, retriable } = classify(response.status);
    const responseBody = await readBodySafe(response);

    if (ok) {
      log("INFO", "hub upload ok", { status: response.status, attempt });
      if (responseBody && typeof responseBody === "object") return responseBody;
      return { scan_upload_id: null, status: "accepted" };
    }

    lastErr = new HubError(
      `hub returned ${response.status}${responseBody?.title ? `: ${responseBody.title}` : ""}`,
      { status: response.status, retriable, body: responseBody, attempts: attempt },
    );
    log(retriable ? "WARN" : "ERROR", "hub upload non-success", {
      status: response.status,
      retriable,
      attempt,
    });

    if (!retriable) throw lastErr;

    if (attempt < attempts) {
      let delay = backoffsMs[attempt - 1] ?? backoffsMs[backoffsMs.length - 1];
      if (response.status === 429) {
        delay = parseRetryAfter(response.headers.get("Retry-After"), delay);
      }
      await sleep(delay);
      continue;
    }
  }

  throw lastErr ?? new HubError("upload failed without a captured error");
}
