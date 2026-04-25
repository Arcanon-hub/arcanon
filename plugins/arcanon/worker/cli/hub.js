#!/usr/bin/env node
/**
 * worker/cli/hub.js — Arcanon Hub CLI entry point.
 *
 * Dispatched by the /arcanon:* slash commands via a thin shell wrapper.
 * Every subcommand prints human-readable output to stdout and exits 0
 * on success, non-zero on failure. JSON output is available with --json.
 *
 * Subcommands:
 *   login     Store an API key in ~/.arcanon/config.json
 *   upload    Upload the last local scan for the current repo
 *   sync      Drain the offline upload queue
 *   status    One-line health report (worker + hub + queue)
 *   version   Print the installed plugin version
 *
 * All subcommands honor:
 *   --api-key <arc_...>       explicit override
 *   --hub-url <url>           override API endpoint
 *   --project <slug>          project slug (org-scoped keys need this)
 *   --json                    emit machine-readable JSON
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  syncFindings,
  drainQueue,
  queueStats,
  listAllUploads,
  pruneDead,
  resolveCredentials,
  storeCredentials,
} from "../hub-sync/index.js";
import { resolveConfigPath } from "../lib/config-path.js";
import { resolveDataDir } from "../lib/data-dir.js";
import { projectHashDir } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CLN-08: Module-level guard ensures the deprecation warning fires at most
// once per worker process, even if _readHubAutoSync is called multiple times.
let _autoUploadDeprecationWarned = false;

/**
 * Read hub.auto-sync with a legacy fallback to hub.auto-upload.
 * Writes a one-time stderr deprecation warning when the legacy key is the
 * sole activator. Remove this helper in v0.2.0 when the fallback is dropped.
 *
 * @param {Record<string, unknown>|undefined} hubBlock The `cfg.hub` object.
 * @returns {boolean} Effective flag value.
 */
function _readHubAutoSync(hubBlock) {
  const newKey = hubBlock?.["auto-sync"];
  const legacyKey = hubBlock?.["auto-upload"];
  // Explicit undefined check so that auto-sync:false beats auto-upload:true.
  if (typeof newKey !== "undefined") return Boolean(newKey);
  if (typeof legacyKey !== "undefined") {
    if (!_autoUploadDeprecationWarned) {
      process.stderr.write(
        "arcanon: config key 'hub.auto-upload' is deprecated — rename to 'hub.auto-sync' (legacy key will be dropped in v0.2.0)\n"
      );
      _autoUploadDeprecationWarned = true;
    }
    return Boolean(legacyKey);
  }
  return false;
}

/**
 * Bounded fetch with timeout. Returns a normalized result object regardless
 * of success/failure so callers don't need try/catch boilerplate.
 *
 * Used by cmdDoctor checks 1, 2, and 8 (NAV-03 / Plan 114-03). The contract
 * documented here is the surface the doctor checks rely on — do NOT change
 * field names without updating cmdDoctor.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @param {RequestInit} [opts]
 * @returns {Promise<{ok: boolean, status: number, json: any, elapsedMs: number, error: string|null}>}
 */
async function fetchWithTimeout(url, timeoutMs, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json, elapsedMs: Date.now() - start, error: null };
  } catch (e) {
    return { ok: false, status: 0, json: null, elapsedMs: Date.now() - start, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

function parseArgs(argv) {
  const [sub, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--json") flags.json = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = rest[i + 1];
      if (val && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { sub, flags, positional };
}

function emit(json, flags, human) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
  } else {
    process.stdout.write(human + "\n");
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
    );
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function readProjectConfig() {
  try {
    const cfgPath = resolveConfigPath(process.cwd());
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

async function cmdVersion(flags) {
  emit({ version: readPackageVersion() }, flags, `arcanon plugin v${readPackageVersion()}`);
}

async function cmdLogin(flags) {
  const apiKey = flags["api-key"] || process.env.ARCANON_API_KEY;
  if (!apiKey) {
    console.error("error: pass --api-key arc_... or set ARCANON_API_KEY");
    process.exit(2);
  }
  const file = storeCredentials(apiKey, { hubUrl: flags["hub-url"] });
  emit(
    { ok: true, stored_at: file, hub_url: flags["hub-url"] || null },
    flags,
    `✓ saved credentials to ${file}${flags["hub-url"] ? ` (hub_url=${flags["hub-url"]})` : ""}`,
  );
}

async function cmdStatus(flags) {
  const stats = queueStats();
  const cfg = readProjectConfig();
  const hubAutoSync = _readHubAutoSync(cfg?.hub);
  const projectSlug = cfg?.hub?.["project-slug"] || cfg?.["project-name"] || null;

  const hasCreds = (() => {
    try {
      resolveCredentials();
      return true;
    } catch {
      return false;
    }
  })();

  // TRUST-05: best-effort latest-scan quality. Resolves the worker port from
  // <dataDir>/worker.port (mirrors the cmdVerify pattern), GETs the new
  // /api/scan-quality endpoint with a 2-second timeout, and formats the line
  // per CONTEXT D-01:
  //   "Latest scan: NN% high-confidence (S services, C connections)"
  // Falls back silently to null on any error — the worker may be offline,
  // unreachable, or running an older version without the endpoint.
  const latestScan = await _fetchLatestScanLine(process.cwd());

  const report = {
    plugin_version: readPackageVersion(),
    data_dir: resolveDataDir(),
    config_file: resolveConfigPath(process.cwd()),
    project_slug: projectSlug,
    hub_auto_sync: hubAutoSync,
    credentials: hasCreds ? "present" : "missing",
    queue: stats,
    latest_scan: latestScan?.report ?? null,
  };

  if (flags.json) {
    emit(report, flags);
    return;
  }
  const lines = [
    `Arcanon v${report.plugin_version}`,
    `  project:      ${report.project_slug || "(none — set project-name in arcanon.config.json)"}`,
    `  credentials:  ${report.credentials === "present" ? "✓ present" : "✗ missing (/arcanon:login)"}`,
    `  auto-sync:    ${hubAutoSync ? "enabled" : "disabled"}`,
    `  queue:        ${stats.pending} pending, ${stats.dead} dead${stats.oldestPending ? `, oldest ${stats.oldestPending}` : ""}`,
    `  data dir:     ${report.data_dir}`,
  ];
  if (latestScan?.line) {
    lines.push(`  ${latestScan.line}`);
  }
  emit(report, flags, lines.join("\n"));
}

/**
 * Fetches the latest-scan quality breakdown from the worker and formats it
 * for the /arcanon:status output (TRUST-05, CONTEXT D-01).
 *
 * Best-effort: returns null on any failure (worker offline, no scan data,
 * old worker without the endpoint, network error). Callers MUST tolerate a
 * null return — the status output gracefully omits the line.
 *
 * @param {string} projectRoot - Absolute path passed as ?project= to the worker
 * @returns {Promise<{ line: string, report: object } | null>}
 */
async function _fetchLatestScanLine(projectRoot) {
  let workerPort = 37888;
  try {
    const portFile = path.join(resolveDataDir(), "worker.port");
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
  } catch {
    if (process.env.ARCANON_WORKER_PORT) {
      const parsed = Number(process.env.ARCANON_WORKER_PORT);
      if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
    }
  }

  const url = `http://127.0.0.1:${workerPort}/api/scan-quality?project=${encodeURIComponent(projectRoot)}`;

  // 2-second timeout — consistent with worker-client.sh worker_running().
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return null; // worker offline / unreachable / aborted
  }
  clearTimeout(timer);

  if (!response.ok) return null; // 404 / 503 / 500 — silently omit

  let body;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!body || body.error) return null;

  const pct = body.quality_score === null
    ? "n/a"
    : `${Math.round(body.quality_score * 100)}%`;
  const line = `Latest scan: ${pct} high-confidence (${body.service_count} services, ${body.total_connections} connections)`;
  return { line, report: body };
}

/**
 * Read the latest findings for a repo from the local SQLite DB and return
 * the shape expected by buildScanPayload().
 */
async function loadLatestFindings(repoPath) {
  const { getQueryEngine } = await import("../db/pool.js");
  const qe = getQueryEngine(repoPath);
  if (!qe) throw new Error(`no local scan found for ${repoPath} — run /arcanon:map first`);
  const db = qe._db;
  const repoRow = db.prepare("SELECT id FROM repos WHERE path = ? LIMIT 1").get(repoPath);
  if (!repoRow) throw new Error(`repo ${repoPath} not indexed — run /arcanon:map`);

  const servicesRaw = db
    .prepare(
      "SELECT id, name, root_path, language, type, boundary_entry FROM services WHERE repo_id = ?",
    )
    .all(repoRow.id);

  // HUB-01: attach per-service deps. getDependenciesForService returns []
  // gracefully on pre-migration-010 DBs (Phase 93-02 contract), so this is
  // safe to call unconditionally — the feature flag determines whether the
  // payload actually emits them.
  const services = servicesRaw.map((s) => ({
    ...s,
    dependencies: qe.getDependenciesForService(s.id),
  }));

  const connections = db
    .prepare(
      `SELECT s.name AS source, c.target_name AS target, c.protocol, c.method, c.path,
              c.crossing
         FROM connections c
         JOIN services s ON s.id = c.source_service_id
         WHERE s.repo_id = ?`,
    )
    .all(repoRow.id);

  return { services, connections, schemas: [], actors: [] };
}

async function cmdUpload(flags) {
  const repoPath = path.resolve(flags.repo || process.cwd());
  const cfg = readProjectConfig();
  const projectSlug =
    flags.project || cfg?.hub?.["project-slug"] || cfg?.["project-name"];
  const libraryDepsEnabled = Boolean(cfg?.hub?.beta_features?.library_deps);

  let findings;
  try {
    findings = await loadLatestFindings(repoPath);
  } catch (err) {
    emit({ ok: false, error: err.message }, flags, `✗ ${err.message}`);
    process.exit(1);
  }

  const outcome = await syncFindings({
    findings,
    repoPath,
    projectSlug,
    apiKey: flags["api-key"],
    hubUrl: flags["hub-url"],
    libraryDepsEnabled,  // HUB-03 feature flag — gates v1.1 emission
    log: flags.verbose ? (lvl, msg, data) => console.error(`[${lvl}] ${msg}`, data || "") : undefined,
  });

  if (outcome.ok) {
    emit(
      { ok: true, scan_upload_id: outcome.result?.scan_upload_id, warnings: outcome.warnings },
      flags,
      `✓ uploaded${outcome.result?.scan_upload_id ? ` (scan_upload_id=${outcome.result.scan_upload_id})` : ""}`,
    );
    return;
  }
  const msg = outcome.error?.message || "unknown error";
  if (outcome.enqueuedId) {
    emit(
      { ok: false, enqueued: true, queue_id: outcome.enqueuedId, error: msg },
      flags,
      `⚠ upload failed, enqueued for retry (#${outcome.enqueuedId}): ${msg}`,
    );
    return;
  }
  emit({ ok: false, error: msg }, flags, `✗ upload failed: ${msg}`);
  process.exit(1);
}

async function cmdSync(flags) {
  let pruned = 0;
  if (flags["prune-dead"]) {
    pruned = pruneDead();
  }

  const report = await drainQueue({
    apiKey: flags["api-key"],
    hubUrl: flags["hub-url"],
    limit: Number(flags.limit) || 50,
  });
  const withPrune = { ...report, pruned };
  if (flags.json) {
    emit(withPrune, flags);
    return;
  }
  const prunePart = pruned > 0 ? ` pruned=${pruned}` : "";
  emit(
    withPrune,
    flags,
    `drain:${prunePart} attempted=${report.attempted} succeeded=${report.succeeded} failed=${report.failed} dead=${report.dead} (pending=${report.stats.pending})`,
  );
}

/**
 * cmdVerify — Re-read cited source files and report per-connection verdicts
 * (TRUST-01). Read-only; never writes to the scan database.
 *
 * Verdicts (D-01, exhaustive): ok | moved | missing | method_mismatch
 *
 * Flags:
 *   --connection <id>  Verify exactly one connection by integer ID
 *   --source <path>    Verify connections whose source_file matches
 *                      (basename match if no `/`, exact match otherwise)
 *   --json             Emit machine-readable JSON
 *   --repo <path>      Override project root (defaults to process.cwd())
 *
 * Exit codes (D-04):
 *   0 — all verdicts ok
 *   1 — at least one non-ok verdict OR truncated cap hit OR worker down
 *   2 — invocation error (bad --connection ID, etc.)
 */
async function cmdVerify(flags) {
  const repoPath = path.resolve(flags.repo || process.cwd());

  const params = new URLSearchParams();
  params.set("project", repoPath);

  if (flags.connection !== undefined && flags.connection !== true) {
    const idStr = String(flags.connection);
    if (!/^\d+$/.test(idStr) || Number(idStr) <= 0) {
      console.error("error: --connection requires a positive integer ID");
      process.exit(2);
    }
    params.set("connection_id", idStr);
  } else if (flags.source !== undefined && flags.source !== true) {
    params.set("source_file", String(flags.source));
  }
  // else: implicit --all (D-06) — no further params

  // Resolve worker port: <dataDir>/worker.port → $ARCANON_WORKER_PORT → 37888
  let workerPort = 37888;
  try {
    const portFile = path.join(resolveDataDir(), "worker.port");
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
  } catch {
    if (process.env.ARCANON_WORKER_PORT) {
      const parsed = Number(process.env.ARCANON_WORKER_PORT);
      if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
    }
  }

  const url = `http://127.0.0.1:${workerPort}/api/verify?${params.toString()}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    const msg = `worker not running — run /arcanon:status to check, then /arcanon:map to start it (${err.message})`;
    if (flags.json) {
      emit({ ok: false, error: msg }, flags);
    } else {
      process.stderr.write(`error: ${msg}\n`);
    }
    process.exit(1);
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    process.stderr.write(`error: invalid response from worker: ${err.message}\n`);
    process.exit(1);
  }

  if (!response.ok) {
    const errMsg = body?.error || `HTTP ${response.status}`;
    // 404 on connection_id / project = treat as user error → exit 1.
    // 400 = bad invocation → exit 2.
    const code = response.status === 400 ? 2 : 1;
    if (flags.json) {
      emit({ ok: false, error: errMsg, status: response.status }, flags);
    } else {
      process.stderr.write(`error: ${errMsg}\n`);
    }
    process.exit(code);
  }

  // Truncated cap — D-03.
  if (body.truncated === true) {
    const msg =
      body.message ||
      `too many connections (${body.total} > 1000) — scope with --source <path> or --connection <id>`;
    if (flags.json) {
      emit(body, flags);
    } else {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  const results = Array.isArray(body.results) ? body.results : [];

  // Empty result set — friendlier than printing just a header.
  if (results.length === 0) {
    if (flags.json) {
      emit(body, flags);
    } else {
      process.stdout.write("no connections found for the given scope\n");
    }
    process.exit(1);
  }

  // Tally
  const counts = { ok: 0, moved: 0, missing: 0, method_mismatch: 0 };
  for (const r of results) {
    if (counts[r.verdict] !== undefined) counts[r.verdict] += 1;
  }
  const allOk = counts.ok === results.length;

  if (flags.json) {
    emit(body, flags);
  } else {
    const headers =
      "connection_id | verdict          | source_file:line_start            | evidence_excerpt";
    const sep =
      "--------------+------------------+-----------------------------------+----------------------";
    const lines = [headers, sep];
    for (const r of results) {
      const idCell = String(r.connection_id).padEnd(13);
      const verdictCell = String(r.verdict).padEnd(16);
      const loc =
        (r.source_file || "(unknown)") +
        ":" +
        (r.line_start !== null && r.line_start !== undefined ? r.line_start : "?");
      const locCell = loc.length > 33 ? loc.slice(0, 32) + "…" : loc.padEnd(33);
      let excerpt;
      if (r.verdict === "moved") {
        excerpt = "(file not found)";
      } else if (r.verdict === "missing") {
        excerpt = "(snippet not found)";
      } else if (r.verdict === "method_mismatch") {
        excerpt = `method '${r.method || "?"}' not in snippet`;
      } else if (r.snippet) {
        excerpt = r.snippet.length > 40 ? r.snippet.slice(0, 39) + "…" : r.snippet;
      } else {
        excerpt = r.message || "";
      }
      lines.push(`${idCell} | ${verdictCell} | ${locCell} | ${excerpt}`);
    }
    lines.push(
      "",
      `${counts.ok} ok, ${counts.moved} moved, ${counts.missing} missing, ${counts.method_mismatch} method_mismatch (total ${results.length})`,
    );
    process.stdout.write(lines.join("\n") + "\n");
  }

  process.exit(allOk ? 0 : 1);
}

/**
 * cmdList — Concise read-only project overview (NAV-01, plan 114-01).
 *
 * Composes from existing endpoints — does not write to the DB, does not
 * register new HTTP routes, does not introduce a new auth surface.
 *
 *   - Project detection: stat ${projectHashDir(cwd)}/impact-map.db. If absent,
 *     `process.exit(0)` with no output (silent contract per RESEARCH §6).
 *   - Repos count: direct sqlite3 SELECT COUNT(*) FROM repos via openDb().
 *   - Services / Connections / Actors: parallel fetch /graph + /api/scan-quality.
 *   - Hub status: queueStats() + resolveCredentials() reuse — same pattern as
 *     cmdStatus (RESEARCH §3 / hub.js:140-191).
 *
 * Flags:
 *   --json   Emit machine-readable JSON instead of the 5-line human report.
 *   --repo   Override project root (defaults to process.cwd()).
 *
 * Exit codes:
 *   0 — overview printed (or silent no-op in non-Arcanon dir).
 *
 * Task 1 (this commit): scaffold only — silent-no-project + handler dispatch.
 * Task 2: full composition + output formatter.
 */
async function cmdList(flags) {
  const repoPath = path.resolve(flags.repo || process.cwd());

  // Project detection — silent no-op in non-Arcanon directories (NAV-01 contract).
  // Each `bash hub.sh list` spawns a fresh node process so projectHashDir's
  // module-cached dataDir picks up the current ARCANON_DATA_DIR env var.
  const dbPath = path.join(projectHashDir(repoPath), "impact-map.db");
  if (!fs.existsSync(dbPath)) {
    // Silent contract — no stdout, no stderr, exit 0.
    process.exit(0);
  }

  // ----- Resolve worker port (mirrors cmdVerify pattern at hub.js:395-407) -----
  let workerPort = 37888;
  try {
    const portFile = path.join(resolveDataDir(), "worker.port");
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
  } catch {
    if (process.env.ARCANON_WORKER_PORT) {
      const parsed = Number(process.env.ARCANON_WORKER_PORT);
      if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
    }
  }
  const projectQS = encodeURIComponent(repoPath);
  const graphUrl = `http://127.0.0.1:${workerPort}/graph?project=${projectQS}`;
  const qualityUrl = `http://127.0.0.1:${workerPort}/api/scan-quality?project=${projectQS}`;

  // ----- Parallel fetch /graph + /api/scan-quality with 5s timeout each -----
  // AbortController per request so a single hung endpoint doesn't block both.
  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return { ok: false, status: response.status };
      try {
        const body = await response.json();
        return { ok: true, body };
      } catch {
        return { ok: false, status: response.status };
      }
    } catch {
      clearTimeout(timer);
      return { ok: false, status: 0 };
    }
  }
  const [graphResult, qualityResult] = await Promise.all([
    fetchJson(graphUrl),
    fetchJson(qualityUrl),
  ]);

  // ----- Repo count via direct sqlite3 (RESEARCH §3 / §7 Q3) -----
  // openDb() runs migrations and caches in module state. Both side-effects
  // are safe inside a project dir and match what the worker itself does.
  let reposCount = 0;
  try {
    const { openDb } = await import("../db/database.js");
    const db = openDb(repoPath);
    const row = db.prepare("SELECT COUNT(*) AS n FROM repos").get();
    if (row && typeof row.n === "number") reposCount = row.n;
  } catch {
    reposCount = 0;
  }

  // ----- Service-type partition + actor count from /graph -----
  // Per RESEARCH §3, the /graph response shape is { services, connections,
  // actors, ... } (see query-engine.js:1481-1644 getGraph()). Each `services`
  // row has a `type` column (migration 002) so the partition is direct; actors
  // are a top-level array.
  let serviceCounts = {
    total: null,
    by_type: { service: null, library: null, infra: null },
  };
  let actorsCount = null;
  if (graphResult.ok) {
    const services = Array.isArray(graphResult.body?.services)
      ? graphResult.body.services
      : [];
    const byType = { service: 0, library: 0, infra: 0 };
    for (const svc of services) {
      const t = svc.type;
      if (t === "service" || t === "library" || t === "infra") {
        byType[t] += 1;
      }
    }
    serviceCounts = { total: services.length, by_type: byType };
    const actors = Array.isArray(graphResult.body?.actors)
      ? graphResult.body.actors
      : [];
    actorsCount = actors.length;
  }

  // ----- Connection breakdown from /api/scan-quality -----
  let connectionsCounts = {
    total: null,
    high_confidence: null,
    low_confidence: null,
    null_confidence: null,
  };
  let scannedAt = null;
  if (qualityResult.ok) {
    const q = qualityResult.body || {};
    connectionsCounts = {
      total: typeof q.total_connections === "number" ? q.total_connections : null,
      high_confidence: typeof q.high_confidence === "number" ? q.high_confidence : null,
      low_confidence: typeof q.low_confidence === "number" ? q.low_confidence : null,
      null_confidence: typeof q.null_confidence === "number" ? q.null_confidence : null,
    };
    scannedAt = q.completed_at || null;
  }

  // ----- Hub status — same pattern as cmdStatus (hub.js:140-191) -----
  const queueRow = queueStats();
  const cfg = readProjectConfig();
  const hubAutoSync = _readHubAutoSync(cfg?.hub);
  const hasCreds = (() => {
    try {
      resolveCredentials();
      return true;
    } catch {
      return false;
    }
  })();
  const hubStatus = !hasCreds
    ? "not configured"
    : hubAutoSync
      ? "synced"
      : "manual";
  const hubReport = {
    status: hubStatus,
    queued: typeof queueRow?.pending === "number" ? queueRow.pending : 0,
  };

  // ----- "scanned Nd ago" or "scanned never" -----
  let scannedHuman = "scanned never";
  if (scannedAt) {
    const ts = Date.parse(scannedAt);
    if (!Number.isNaN(ts)) {
      const ageDays = Math.floor((Date.now() - ts) / 86400000);
      if (ageDays <= 0) {
        scannedHuman = "scanned today";
      } else if (ageDays === 1) {
        scannedHuman = "scanned 1d ago";
      } else {
        scannedHuman = `scanned ${ageDays}d ago`;
      }
    }
  }

  // ----- JSON mode -----
  if (flags.json) {
    const json = {
      project_root: repoPath,
      scanned_at: scannedAt,
      repos_count: reposCount,
      services: serviceCounts,
      connections: connectionsCounts,
      actors_count: actorsCount,
      hub: hubReport,
    };
    emit(json, flags);
    return;
  }

  // ----- Human mode -----
  const lines = [`Arcanon map for ${repoPath} (${scannedHuman})`];

  // Repos line
  lines.push(`  Repos:        ${reposCount} linked`);

  // Services line — graceful degradation when /graph failed.
  if (serviceCounts.total === null) {
    lines.push(`  Services:     unknown`);
  } else {
    const t = serviceCounts.by_type;
    lines.push(
      `  Services:     ${serviceCounts.total} mapped (${t.service} services, ${t.library} libraries, ${t.infra} infra)`,
    );
  }

  // Connections line — graceful degradation when /api/scan-quality failed.
  if (connectionsCounts.total === null) {
    lines.push(`  Connections:  unknown`);
  } else {
    lines.push(
      `  Connections:  ${connectionsCounts.total} (${connectionsCounts.high_confidence ?? 0} high-conf, ${connectionsCounts.low_confidence ?? 0} low-conf)`,
    );
  }

  // Actors line — graceful degradation when /graph failed.
  if (actorsCount === null) {
    lines.push(`  Actors:       unknown`);
  } else {
    lines.push(`  Actors:       ${actorsCount} external`);
  }

  // Hub line.
  lines.push(`  Hub:          ${hubReport.status}, ${hubReport.queued} queued`);

  process.stdout.write(lines.join("\n") + "\n");
}

async function cmdQueue(flags) {
  const rows = listAllUploads();
  if (flags.json) {
    emit({ rows }, flags);
    return;
  }
  if (rows.length === 0) {
    emit({ rows: [] }, flags, "queue: empty");
    return;
  }
  const lines = [
    "status   attempts  repo                          commit     next_attempt_at            last_error",
    ...rows.map(
      (r) =>
        `${r.status.padEnd(8)} ${String(r.attempts).padEnd(9)} ${(r.repo_name || "").padEnd(30)} ${(r.commit_sha || "").slice(0, 10)} ${(r.next_attempt_at || "").padEnd(26)} ${(r.last_error || "").slice(0, 80)}`,
    ),
  ];
  emit({ rows }, flags, lines.join("\n"));
}

/**
 * runCheck — Wrap a single doctor check fn with a 2s overall timeout and
 * exception-to-FAIL conversion. Returns the canonical row shape consumed by
 * formatDoctorTable / the --json emitter.
 *
 * The criticality argument feeds the exit-code computation in cmdDoctor —
 * only `criticality === 'critical' && status === 'FAIL'` contributes to
 * exit code 1 (per the exit-code matrix in 114-03-PLAN.md).
 *
 * @param {number} id
 * @param {string} name
 * @param {'critical'|'non-critical'} criticality
 * @param {() => Promise<{status: 'PASS'|'FAIL'|'WARN'|'SKIP', detail: string}>} fn
 * @returns {Promise<{id: number, name: string, criticality: string, status: string, detail: string}>}
 */
async function runCheck(id, name, criticality, fn) {
  const TIMEOUT_MS = 2000;
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: criticality === "critical" ? "FAIL" : "WARN", detail: `check timed out after ${TIMEOUT_MS}ms` });
    }, TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(() => fn())
        .catch((e) => ({ status: criticality === "critical" ? "FAIL" : "WARN", detail: e.message || String(e) })),
      timeoutPromise,
    ]);
    return { id, name, criticality, status: result.status, detail: result.detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * formatDoctorTable — Human-readable output for /arcanon:doctor.
 * Pretty-prints `id. STATUS  name detail` aligned, plus a summary line.
 *
 * @param {Array<{id:number,name:string,status:string,detail:string}>} checks
 * @param {{pass:number,warn:number,fail:number,skip:number,exit_code:number}} summary
 * @returns {string}
 */
function formatDoctorTable(checks, summary) {
  const lines = [`Arcanon doctor — version ${readPackageVersion()}`, ""];
  // Pad name column to 22 chars for stable alignment across all 8 checks.
  const NAME_WIDTH = 22;
  for (const c of checks) {
    const idCell = String(c.id).padStart(2);
    const statusCell = c.status.padEnd(4);
    const nameCell = c.name.padEnd(NAME_WIDTH);
    lines.push(`  ${idCell}. ${statusCell}  ${nameCell} ${c.detail}`);
  }
  lines.push("");
  lines.push(
    `Summary: ${summary.pass} PASS, ${summary.warn} WARN, ${summary.fail} FAIL, ${summary.skip} SKIP — exit ${summary.exit_code}`,
  );
  return lines.join("\n");
}

/**
 * cmdDoctor — 8-check diagnostic suite (NAV-03 / Plan 114-03).
 *
 * Critical checks (exit 1 on FAIL): 1 (worker reachable), 5 (data dir
 * writable), 6 (DB integrity). Non-critical checks (FAIL → WARN; exit 0):
 * 2 (worker version match), 3 (schema head), 4 (config + linked repos),
 * 7 (MCP smoke), 8 (hub credentials).
 *
 * Read-only contract: no DB writes. Check 6 uses a fresh isolated read-only
 * connection — it does NOT call openDb() (which is a process-cached singleton
 * that would auto-run migrations and could be closed mid-flight). Check 7
 * spawns the bundled MCP server with hardcoded path + arg array (no shell
 * interpolation, no PATH dependency).
 *
 * Silent in non-Arcanon directories (no impact-map.db) — exits 0 with no
 * output, mirroring the /arcanon:list contract.
 *
 * Flags:
 *   --json   Single JSON object {version, project_root, checks[], summary}.
 *
 * Task 1 (this commit): scaffold + checks 1, 2, 5, 6 + check 8 SKIP-only.
 * Task 2: implement checks 3 (schema head), 4 (config), 7 (MCP smoke), and
 * the full check 8 round-trip.
 */
async function cmdDoctor(flags) {
  const cwd = process.cwd();

  // ----- Project detection — silent no-op contract -----
  const dbDir = projectHashDir(cwd);
  const dbPath = path.join(dbDir, "impact-map.db");
  if (!fs.existsSync(dbPath)) {
    process.exit(0);
  }

  // ----- Resolve worker port (mirrors cmdVerify pattern) -----
  let workerPort = 37888;
  try {
    const portFile = path.join(resolveDataDir(), "worker.port");
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
  } catch {
    if (process.env.ARCANON_WORKER_PORT) {
      const parsed = Number(process.env.ARCANON_WORKER_PORT);
      if (Number.isInteger(parsed) && parsed > 0) workerPort = parsed;
    }
  }

  const checks = [];

  // Check 1 — worker HTTP reachable (CRITICAL).
  checks.push(
    await runCheck(1, "worker_reachable", "critical", async () => {
      const r = await fetchWithTimeout(`http://127.0.0.1:${workerPort}/api/readiness`, 2000);
      if (r.ok) return { status: "PASS", detail: `200 OK in ${r.elapsedMs}ms` };
      return { status: "FAIL", detail: `worker unreachable: ${r.error || `HTTP ${r.status}`}` };
    }),
  );

  // Check 2 — worker /api/version matches plugin version (non-critical).
  checks.push(
    await runCheck(2, "worker_version", "non-critical", async () => {
      const installed = readPackageVersion();
      const r = await fetchWithTimeout(`http://127.0.0.1:${workerPort}/api/version`, 2000);
      if (!r.ok) {
        return { status: "WARN", detail: `version endpoint unreachable: ${r.error || `HTTP ${r.status}`}` };
      }
      const wv = r.json && typeof r.json.version === "string" ? r.json.version : null;
      if (!wv) return { status: "WARN", detail: "version endpoint returned malformed body" };
      return wv === installed
        ? { status: "PASS", detail: `${wv} == ${installed}` }
        : { status: "WARN", detail: `worker ${wv} != installed ${installed}` };
    }),
  );

  // Check 3 — DB schema head matches migration head (non-critical, Task 2 stub).
  checks.push(
    await runCheck(3, "schema_head", "non-critical", async () => {
      return { status: "WARN", detail: "schema head check pending Task 2" };
    }),
  );

  // Check 4 — config + linked repos resolve (non-critical, Task 2 stub).
  checks.push(
    await runCheck(4, "config_linked_repos", "non-critical", async () => {
      return { status: "WARN", detail: "config check pending Task 2" };
    }),
  );

  // Check 5 — $ARCANON_DATA_DIR writable (CRITICAL).
  checks.push(
    await runCheck(5, "data_dir_writable", "critical", async () => {
      const dataDir = resolveDataDir();
      if (!fs.existsSync(dataDir)) {
        return { status: "FAIL", detail: `${dataDir} does not exist` };
      }
      const probe = path.join(dataDir, `.doctor-probe-${process.pid}`);
      try {
        fs.writeFileSync(probe, "");
        fs.unlinkSync(probe);
        return { status: "PASS", detail: `${dataDir} (writable)` };
      } catch (e) {
        // Best-effort cleanup if the probe was created but unlink failed.
        try { fs.unlinkSync(probe); } catch { /* swallow */ }
        return { status: "FAIL", detail: `${dataDir} not writable: ${e.code || e.message}` };
      }
    }),
  );

  // Check 6 — DB integrity via PRAGMA quick_check (CRITICAL).
  // CRITICAL implementation note: do NOT use openDb() here — it is a
  // process-cached singleton that runs migrations and would be closed by
  // db.close() below, breaking subsequent worker queries. Use a fresh
  // isolated read-only connection that bypasses the pool entirely.
  checks.push(
    await runCheck(6, "db_integrity", "critical", async () => {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare("PRAGMA quick_check").get();
        // PRAGMA quick_check returns a row with a single column; the column
        // name varies by sqlite version ("quick_check" or "integrity_check"),
        // so read the first value defensively.
        const v = row && (row.quick_check || row.integrity_check || row[Object.keys(row)[0]]);
        return v === "ok"
          ? { status: "PASS", detail: "ok" }
          : { status: "FAIL", detail: `quick_check returned: ${v}` };
      } finally {
        db.close();
      }
    }),
  );

  // Check 7 — MCP server liveness probe (non-critical, Task 2 stub).
  checks.push(
    await runCheck(7, "mcp_smoke", "non-critical", async () => {
      return { status: "WARN", detail: "mcp smoke check pending Task 2" };
    }),
  );

  // Check 8 — hub credentials. SKIP cleanly when no creds are configured.
  // Task 2 will add the round-trip when creds ARE present.
  checks.push(
    await runCheck(8, "hub_credentials", "non-critical", async () => {
      let creds;
      try {
        creds = resolveCredentials();
      } catch {
        return { status: "SKIP", detail: "no credentials configured" };
      }
      // creds present — round-trip pending Task 2.
      return { status: "SKIP", detail: `round-trip pending Task 2 (creds via ${creds.source})` };
    }),
  );

  // Stable order by id (defensive — runCheck calls are sequential today, but
  // a future Promise.all refactor could reorder).
  checks.sort((a, b) => a.id - b.id);

  const summary = {
    pass: checks.filter((c) => c.status === "PASS").length,
    warn: checks.filter((c) => c.status === "WARN").length,
    fail: checks.filter((c) => c.status === "FAIL").length,
    skip: checks.filter((c) => c.status === "SKIP").length,
  };
  // Exit-code matrix: only critical FAIL contributes to exit 1.
  summary.exit_code = checks.some((c) => c.criticality === "critical" && c.status === "FAIL") ? 1 : 0;

  emit(
    { version: readPackageVersion(), project_root: cwd, checks, summary },
    flags,
    formatDoctorTable(checks, summary),
  );
  process.exit(summary.exit_code);
}

const HANDLERS = {
  version: cmdVersion,
  login: cmdLogin,
  status: cmdStatus,
  upload: cmdUpload,
  sync: cmdSync,
  queue: cmdQueue,
  verify: cmdVerify, // TRUST-01
  list: cmdList,     // NAV-01
  doctor: cmdDoctor, // NAV-03
};

async function main() {
  const { sub, flags } = parseArgs(process.argv.slice(2));
  const handler = HANDLERS[sub];
  if (!handler) {
    process.stderr.write(
      `usage: arcanon-hub <${Object.keys(HANDLERS).join("|")}> [options]\n`,
    );
    process.exit(2);
  }
  try {
    await handler(flags);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    if (process.env.ARCANON_DEBUG) process.stderr.write((err.stack || "") + "\n");
    process.exit(1);
  }
}

// Only run as CLI entry point when executed directly; skip when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

// Exported for test access only (_-prefixed = internal helper, not public surface).
export { _readHubAutoSync, cmdVerify };
