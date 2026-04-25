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
import { fileURLToPath } from "node:url";

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

const HANDLERS = {
  version: cmdVersion,
  login: cmdLogin,
  status: cmdStatus,
  upload: cmdUpload,
  sync: cmdSync,
  queue: cmdQueue,
  verify: cmdVerify, // TRUST-01
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
