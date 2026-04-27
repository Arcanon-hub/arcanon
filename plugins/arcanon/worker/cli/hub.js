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
import { projectHashDir, evictLiveQueryEngine } from "../db/pool.js";

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

  // FRESH-01/02 (Phase 116-02): best-effort latest-scan freshness via the new
  // /api/scan-freshness endpoint. Surfaces both the quality line ("Latest scan:
  // YYYY-MM-DD (NN% high-confidence)") and the per-repo drift line ("N repo(s)
  // have new commits since last scan: <name> (M new), ..."). The drift line is
  // suppressed when no repo has positive new_commits. Falls back silently to
  // null on any error — worker offline / unreachable / old build without the
  // endpoint. The /api/scan-quality route stays in place for back-compat but
  // is no longer consumed by /arcanon:status.
  const freshness = await _fetchScanFreshness(process.cwd());

  const report = {
    plugin_version: readPackageVersion(),
    data_dir: resolveDataDir(),
    config_file: resolveConfigPath(process.cwd()),
    project_slug: projectSlug,
    hub_auto_sync: hubAutoSync,
    credentials: hasCreds ? "present" : "missing",
    queue: stats,
    scan_freshness: freshness?.report ?? null,
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
  if (freshness?.qualityLine) {
    lines.push(`  ${freshness.qualityLine}`);
  }
  for (const line of freshness?.freshnessLines ?? []) {
    lines.push(`  ${line}`);
  }
  emit(report, flags, lines.join("\n"));
}

/**
 * Fetches scan freshness data from the worker (FRESH-03/04). Returns formatted
 * status output lines plus the raw report for --json mode. Best-effort:
 * returns null on any failure (worker offline, no scan data, network error,
 * old worker without the endpoint). Callers MUST tolerate a null return —
 * status output gracefully omits both freshness lines.
 *
 * Output:
 *   qualityLine     — "Latest scan: 2026-04-23 (87% high-confidence)" (FRESH-01)
 *   freshnessLines  — ["1 repo has new commits since last scan: api (3 new)"]
 *                     Empty array when no repo has positive new_commits drift.
 *   report          — raw JSON for --json mode
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {Promise<{
 *   qualityLine: string,
 *   freshnessLines: string[],
 *   report: object,
 * } | null>}
 */
async function _fetchScanFreshness(projectRoot) {
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

  const url = `http://127.0.0.1:${workerPort}/api/scan-freshness?project=${encodeURIComponent(projectRoot)}`;

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

  // FRESH-01 line: "Latest scan: 2026-04-23 (87% high-confidence)"
  const datePart = (body.last_scan_iso || "").slice(0, 10) || "unknown";
  const pctPart = body.scan_quality_pct === null || body.scan_quality_pct === undefined
    ? "n/a"
    : `${body.scan_quality_pct}% high-confidence`;
  const qualityLine = `Latest scan: ${datePart} (${pctPart})`;

  // FRESH-02 line(s): "N repo(s) have new commits since last scan: <name> (M new), ..."
  // Suppressed entirely when no repo has positive new_commits.
  const repos = Array.isArray(body.repos) ? body.repos : [];
  const drifted = repos.filter((r) => Number.isInteger(r.new_commits) && r.new_commits > 0);
  const freshnessLines = [];
  if (drifted.length > 0) {
    const noun = drifted.length === 1 ? "repo has" : "repos have";
    const detail = drifted.map((r) => `${r.name} (${r.new_commits} new)`).join(", ");
    freshnessLines.push(`${drifted.length} ${noun} new commits since last scan: ${detail}`);
  }
  return { qualityLine, freshnessLines, report: body };
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

  // INT-01 (Phase 120-01): also project c.evidence, c.confidence, c.source_file
  // so the new hub.evidence_mode flag has data to operate on. Pre-migration-009
  // databases lack the evidence/confidence columns; pre-migration-001 still has
  // source_file (it's in the base schema). On column-missing fall back to the
  // original SELECT and inject null fields for the missing columns so the
  // downstream payload code stays uniform.
  //
  // Rule 1 fix: the previous SELECT referenced `c.target_name`, but that column
  // does not exist on the connections table — the canonical pattern (used by
  // worker/diff/scan-version-diff.js loadConnections) is to LEFT JOIN services
  // on c.target_service_id and project `tgt.name AS target`. The target FK can
  // be null for external targets, so the JOIN must be LEFT.
  let connections;
  try {
    connections = db
      .prepare(
        `SELECT s.name AS source,
                tgt.name AS target,
                c.protocol, c.method, c.path,
                c.crossing, c.confidence, c.evidence, c.source_file
           FROM connections c
           JOIN services s ON s.id = c.source_service_id
           LEFT JOIN services tgt ON tgt.id = c.target_service_id
           WHERE s.repo_id = ?`,
      )
      .all(repoRow.id);
  } catch (err) {
    // SQLite reports column-missing as "no such column: <name>". Fall back to
    // the legacy SELECT shape (without confidence/evidence/source_file) and
    // back-fill the new fields as null so payload code can branch uniformly.
    if (/no such column/i.test(String(err.message))) {
      const legacy = db
        .prepare(
          `SELECT s.name AS source,
                  tgt.name AS target,
                  c.protocol, c.method, c.path,
                  c.crossing
             FROM connections c
             JOIN services s ON s.id = c.source_service_id
             LEFT JOIN services tgt ON tgt.id = c.target_service_id
             WHERE s.repo_id = ?`,
        )
        .all(repoRow.id);
      connections = legacy.map((row) => ({
        ...row,
        confidence: null,
        evidence: null,
        source_file: null,
      }));
    } else {
      throw err;
    }
  }

  return { services, connections, schemas: [], actors: [] };
}

async function cmdUpload(flags) {
  const repoPath = path.resolve(flags.repo || process.cwd());
  const cfg = readProjectConfig();
  const projectSlug =
    flags.project || cfg?.hub?.["project-slug"] || cfg?.["project-name"];
  const libraryDepsEnabled = Boolean(cfg?.hub?.beta_features?.library_deps);
  // INT-01 (Phase 120-01): hub.evidence_mode controls per-connection evidence
  // shape and payload version. Default "full" preserves byte-identical legacy
  // output for every existing user. Unknown values are tolerated downstream
  // (buildScanPayload warn-and-falls-back) so a typo here can never break uploads.
  const evidenceMode = cfg?.hub?.evidence_mode || "full";

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
    evidenceMode,        // INT-01 — forwarded to buildScanPayload
    projectRoot: repoPath, // INT-01 — for line-number derivation in hash-only mode
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
  // INT-08: capture {name,label} per actor so the human formatter can render
  // the inline label list and the JSON formatter can emit a structured array.
  // null label is preserved (surfaced as JSON null; human mode falls back to
  // the bare name).
  let actorsArr = [];
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
    actorsArr = actors.map((a) => ({
      name: typeof a?.name === "string" ? a.name : "",
      label: typeof a?.label === "string" ? a.label : null,
    }));
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
      // INT-08: structured per-actor array — {name, label} per row. label is
      // null when the catalog has no match. Stable shape for CI/scripts.
      actors: actorsArr,
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
  // INT-08: when actors are present, append a parenthetical inline label list.
  // Use label when populated; fall back to the raw name. Cap inline labels at
  // 5 with a "+N more" tail for the remainder.
  if (actorsCount === null) {
    lines.push(`  Actors:       unknown`);
  } else if (actorsCount === 0) {
    lines.push(`  Actors:       0 external`);
  } else {
    const display = actorsArr.map((a) => a.label || a.name);
    const MAX_INLINE = 5;
    let inline;
    if (display.length <= MAX_INLINE) {
      inline = display.join(", ");
    } else {
      inline =
        display.slice(0, MAX_INLINE).join(", ") +
        `, +${display.length - MAX_INLINE} more`;
    }
    lines.push(`  Actors:       ${actorsCount} external (${inline})`);
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

  // Check 3 — DB schema head matches migration head (non-critical).
  //
  // Migration head is computed at runtime from the filesystem glob
  // worker/db/migrations/[0-9]+_*.js — NOT a hardcoded constant. This is
  // forward-compatible with Phase 117 (017_scan_overrides.js) etc.; the
  // doctor stays correct without a source change on every migration.
  //
  // DB head comes from a fresh isolated read-only connection (BLOCK 2 — do
  // NOT use openDb()).
  checks.push(
    await runCheck(3, "schema_head", "non-critical", async () => {
      const migDir = path.join(__dirname, "..", "db", "migrations");
      let files;
      try {
        files = fs.readdirSync(migDir);
      } catch (e) {
        return { status: "WARN", detail: `migrations dir unreadable: ${e.code || e.message}` };
      }
      const versions = files
        .filter((f) => /^[0-9]+_.*\.js$/.test(f) && !f.endsWith(".test.js"))
        .map((f) => parseInt(f.match(/^([0-9]+)_/)[1], 10))
        .filter((n) => Number.isFinite(n));
      if (versions.length === 0) {
        return { status: "WARN", detail: "no migrations found on disk" };
      }
      const fsHead = Math.max(...versions);
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      let dbHead;
      try {
        const row = db.prepare("SELECT MAX(version) AS v FROM schema_versions").get();
        dbHead = row && typeof row.v === "number" ? row.v : 0;
      } catch (e) {
        db.close();
        return { status: "WARN", detail: `schema_versions read failed: ${e.message}` };
      } finally {
        db.close();
      }
      return dbHead === fsHead
        ? { status: "PASS", detail: `${dbHead} == ${fsHead}` }
        : { status: "WARN", detail: `db schema ${dbHead} < migration head ${fsHead}` };
    }),
  );

  // Check 4 — arcanon.config.json parses + linked-repos resolve (non-critical).
  //
  // Reads arcanon.config.json from the project root via resolveConfigPath()
  // (already imported at hub.js:37). Then for each entry in the optional
  // top-level `linked-repos` array, asserts the resolved path exists on disk.
  // Missing config is WARN (most projects don't ship one in early Plan-114
  // territory); parse error is WARN; missing linked-repo dir is WARN with
  // the offending path in the detail.
  checks.push(
    await runCheck(4, "config_linked_repos", "non-critical", async () => {
      let cfgPath;
      try {
        cfgPath = resolveConfigPath(cwd);
      } catch (e) {
        return { status: "WARN", detail: `config path resolution failed: ${e.message}` };
      }
      if (!fs.existsSync(cfgPath)) {
        return { status: "WARN", detail: `arcanon.config.json missing at ${cfgPath}` };
      }
      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      } catch (e) {
        return { status: "WARN", detail: `parse error: ${e.message}` };
      }
      const linked = Array.isArray(cfg["linked-repos"]) ? cfg["linked-repos"] : [];
      if (linked.length === 0) {
        return { status: "PASS", detail: "config parsed, no linked repos" };
      }
      // Each entry may be a string (path) or an object {path: "..."}.
      const resolved = linked.map((entry) => {
        const raw = typeof entry === "string" ? entry : entry?.path;
        if (!raw) return { raw: JSON.stringify(entry), abs: null };
        return { raw, abs: path.resolve(cwd, raw) };
      });
      const missing = resolved.filter((e) => !e.abs || !fs.existsSync(e.abs));
      if (missing.length === 0) {
        return { status: "PASS", detail: `${linked.length} linked repos resolved` };
      }
      const names = missing.map((m) => m.raw).join(", ");
      return { status: "WARN", detail: `missing: ${names}` };
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

  // Check 7 — MCP server liveness probe (non-critical).
  //
  // Per FLAG 5 / RESEARCH §4 decision: Option B (liveness probe). Spawn the
  // bundled MCP server, give it 1 second to reach its message loop, then
  // SIGTERM. This is a smoke test (proves the server starts cleanly without
  // crashing on import) — NOT a conformance test. We do not send tools/list
  // and do not implement the initialize handshake; that level of verification
  // is left to a dedicated MCP-conformance suite.
  //
  // Rationale: most MCP-server breakage in practice is import-time (missing
  // dep, bad require path, syntax error). Liveness covers that.
  //
  // PASS conditions (whichever fires first):
  //   1. Any valid JSON-RPC line appears on stdout (server is actively
  //      emitting — proves message loop reached AND active).
  //   2. The process is still alive at the 1s deadline (server reached
  //      its stdio-read loop and is blocked waiting for input — exactly
  //      what a healthy MCP server does without a client connected). This
  //      is the OBSERVED behaviour of the @modelcontextprotocol/sdk stdio
  //      transport: it does not write anything until the client sends a
  //      request, so a clean startup looks like "silent process for 1s".
  //
  // WARN conditions:
  //   - Process exits before the deadline with a non-zero code (crash on
  //     import or in setup).
  //   - Spawn error (ENOENT etc.).
  checks.push(
    await runCheck(7, "mcp_smoke", "non-critical", async () => {
      const serverPath = path.join(__dirname, "..", "mcp", "server.js");
      if (!fs.existsSync(serverPath)) {
        return { status: "WARN", detail: `mcp server.js missing at ${serverPath}` };
      }
      const t0 = Date.now();
      return new Promise((resolve) => {
        const proc = spawn(process.execPath, [serverPath], {
          stdio: ["pipe", "pipe", "pipe"],
          // Inherit env so the server's data-dir resolution matches the
          // doctor's (otherwise the spawned child would default to ~/.arcanon).
          env: process.env,
        });
        let stderrBuf = "";
        let stdoutBuf = "";
        let resolved = false;
        const finish = (result) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          try { proc.kill("SIGTERM"); } catch { /* swallow */ }
          resolve(result);
        };
        // 1s deadline: if the process is still alive at this point with no
        // crash and no error, it's reached the stdio-read loop — PASS.
        const timer = setTimeout(() => {
          finish({ status: "PASS", detail: `mcp server alive in ${Date.now() - t0}ms` });
        }, 1000);

        proc.stdout.on("data", (chunk) => {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg && (msg.jsonrpc === "2.0" || typeof msg.id !== "undefined" || msg.method)) {
                // Active emission proves the message loop is running.
                finish({ status: "PASS", detail: `mcp server alive in ${Date.now() - t0}ms` });
                return;
              }
            } catch {
              /* not yet a complete JSON line — keep buffering */
            }
          }
        });

        // Capture stderr so a crash-on-import can include the first error
        // line in the detail (helps the operator diagnose).
        proc.stderr.on("data", (chunk) => {
          stderrBuf += chunk.toString();
        });

        proc.on("error", (e) => {
          finish({ status: "WARN", detail: `mcp spawn error: ${e.code || e.message}` });
        });

        proc.on("exit", (code, signal) => {
          // SIGTERM is our own kill — ignore. Anything else before the
          // deadline means the server crashed.
          if (signal !== "SIGTERM" && !resolved) {
            const firstStderr = stderrBuf.split("\n").map((l) => l.trim()).find((l) => l) || "";
            const stderrSnippet = firstStderr ? ` (${firstStderr.slice(0, 120)})` : "";
            finish({
              status: "WARN",
              detail: `mcp server exited with code ${code} before deadline${stderrSnippet}`,
            });
          }
        });
      });
    }),
  );

  // Check 8 — hub credentials round-trip (non-critical).
  //
  // SKIP when no credentials are configured (this is the common case for
  // local-only operators and is NOT a failure mode). When creds ARE present,
  // GET ${hubUrl}/api/version with a 5s timeout via fetchWithTimeout. PASS
  // on 2xx, WARN on 401/403 ("auth rejected"), WARN on any other failure
  // ("hub unreachable"). Never logs the bearer token.
  //
  // resolveCredentials() returns { apiKey, hubUrl, source } — note the
  // camelCase field names (NOT api_key / hub_url).
  checks.push(
    await runCheck(8, "hub_credentials", "non-critical", async () => {
      let creds;
      try {
        creds = resolveCredentials();
      } catch {
        return { status: "SKIP", detail: "no credentials configured" };
      }
      const hubUrl = creds.hubUrl;
      if (!hubUrl) {
        return { status: "WARN", detail: "credentials present but no hubUrl resolved" };
      }
      const probeUrl = `${hubUrl.replace(/\/$/, "")}/api/version`;
      const r = await fetchWithTimeout(probeUrl, 5000, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (r.ok) {
        return { status: "PASS", detail: `hub ${hubUrl} authenticated` };
      }
      if (r.status === 401 || r.status === 403) {
        return { status: "WARN", detail: `hub auth rejected: ${r.status}` };
      }
      return { status: "WARN", detail: `hub unreachable: ${r.error || `HTTP ${r.status}`}` };
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

/**
 * cmdDiff — Compare two scan versions (NAV-04, plan 115-02).
 *
 * Read-only: opens the project DB via better-sqlite3 directly (no worker
 * round-trip — diff is a direct SQL read).
 *
 * Selectors accepted by both <scanA> and <scanB>:
 *   - integer scan ID (e.g. 5)
 *   - HEAD or HEAD~N
 *   - ISO 8601 date (YYYY-MM-DD or full timestamp)
 *   - branch name (resolves via git rev-parse + repo_state.last_scanned_commit)
 *
 * Flags:
 *   --json   Emit machine-readable JSON instead of human report.
 *
 * Exit codes (matches verify.md:65-71 convention):
 *   0 — diff completed (with or without changes)
 *   2 — usage error: missing args, unparseable selector, scan not found,
 *        branch not found, HEAD~N out of range
 *
 * Silent in non-Arcanon directories (no impact-map.db) — exits 0 with no
 * output, mirroring /arcanon:list and /arcanon:doctor.
 */
async function cmdDiff(flags, positional) {
  // SHADOW-02 (Plan 119-02) — handle --shadow before the positional/HEAD/ISO
  // resolver. --shadow compares live vs shadow LATEST scans (no positional
  // args needed) and reuses Phase 115's diffScanVersions(dbA, dbB, idA, idB)
  // engine — passing the live DB handle and the shadow DB handle as the two
  // sources. Engine is pool-agnostic and read-only (see scan-version-diff.js
  // module docs), so opening fresh better-sqlite3 readonly handles is safe.
  if (flags.shadow) {
    return cmdDiffShadow(flags);
  }

  const cwd = process.cwd();
  const dbPath = path.join(projectHashDir(cwd), "impact-map.db");
  if (!fs.existsSync(dbPath)) {
    process.exit(0); // silent contract
  }

  if (!positional || positional.length < 2) {
    process.stderr.write("usage: arcanon-hub diff <scanA> <scanB> [--json]\n");
    process.exit(2);
  }
  const [selA, selB] = positional;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const { resolveScanSelector } = await import("../diff/resolve-scan.js");
    const { diffScanVersions } = await import("../diff/scan-version-diff.js");

    let resolvedA, resolvedB;
    try {
      resolvedA = resolveScanSelector(db, selA, cwd);
      resolvedB = resolveScanSelector(db, selB, cwd);
    } catch (e) {
      process.stderr.write(`error: ${e.message}\n`);
      process.exit(2);
    }

    const result = diffScanVersions(db, db, resolvedA.scanId, resolvedB.scanId);

    const scanMeta = (id) =>
      db
        .prepare(
          "SELECT id, completed_at, quality_score FROM scan_versions WHERE id = ?",
        )
        .get(id);
    const metaA = scanMeta(resolvedA.scanId);
    const metaB = scanMeta(resolvedB.scanId);

    if (flags.json) {
      emit(
        {
          project_root: cwd,
          scanA: {
            ...resolvedA,
            completed_at: metaA?.completed_at ?? null,
            quality_score: metaA?.quality_score ?? null,
          },
          scanB: {
            ...resolvedB,
            completed_at: metaB?.completed_at ?? null,
            quality_score: metaB?.quality_score ?? null,
          },
          ...result,
        },
        flags,
      );
      return;
    }

    if (result.same_scan) {
      process.stdout.write(
        `Diff: scan #${resolvedA.scanId} vs scan #${resolvedB.scanId} — identical\n`,
      );
      return;
    }

    const lines = [];
    const headerA = `scan #${resolvedA.scanId} [${resolvedA.resolvedFrom}]${metaA?.completed_at ? ` (${metaA.completed_at})` : ""}`;
    const headerB = `scan #${resolvedB.scanId} [${resolvedB.resolvedFrom}]${metaB?.completed_at ? ` (${metaB.completed_at})` : ""}`;
    lines.push(`Diff: ${headerA} -> ${headerB}`);
    lines.push("");

    // Services
    lines.push("Services");
    lines.push(`  Added (${result.services.added.length}):`);
    for (const s of result.services.added) {
      lines.push(`    + ${s.repo_id}/${s.name} (${s.type})`);
    }
    lines.push(`  Removed (${result.services.removed.length}):`);
    for (const s of result.services.removed) {
      lines.push(`    - ${s.repo_id}/${s.name} (${s.type})`);
    }
    lines.push(`  Modified (${result.services.modified.length}):`);
    for (const s of result.services.modified) {
      const fieldStrs = (s.changed_fields || []).map((f) => {
        if (f.field === "evidence") return "evidence changed";
        return `${f.field} ${f.before ?? "null"} -> ${f.after ?? "null"}`;
      });
      lines.push(`    ~ ${s.repo_id}/${s.name}: ${fieldStrs.join(", ")}`);
    }
    lines.push("");

    // Connections
    lines.push("Connections");
    const connStr = (c) =>
      `${c.source_name} -> ${c.target_name} ${c.protocol}${c.method ? ` ${c.method}` : ""}${c.path ? ` ${c.path}` : ""}`;
    lines.push(`  Added (${result.connections.added.length}):`);
    for (const c of result.connections.added) lines.push(`    + ${connStr(c)}`);
    lines.push(`  Removed (${result.connections.removed.length}):`);
    for (const c of result.connections.removed) lines.push(`    - ${connStr(c)}`);
    lines.push(`  Modified (${result.connections.modified.length}):`);
    for (const c of result.connections.modified) {
      const fieldStrs = (c.changed_fields || []).map((f) => {
        if (f.field === "evidence") return "evidence changed";
        return `${f.field} ${f.before ?? "null"} -> ${f.after ?? "null"}`;
      });
      lines.push(`    ~ ${connStr(c)}: ${fieldStrs.join(", ")}`);
    }
    lines.push("");

    // Summary
    const sv = result.summary.services;
    const cn = result.summary.connections;
    const svParts = [];
    if (sv.added) svParts.push(`${sv.added} added`);
    if (sv.removed) svParts.push(`${sv.removed} removed`);
    if (sv.modified) svParts.push(`${sv.modified} modified`);
    const cnParts = [];
    if (cn.added) cnParts.push(`${cn.added} added`);
    if (cn.removed) cnParts.push(`${cn.removed} removed`);
    if (cn.modified) cnParts.push(`${cn.modified} modified`);
    const summaryLine = `Summary: ${svParts.length ? svParts.join(", ") + " services" : "0 service changes"}; ${cnParts.length ? cnParts.join(", ") + " connections" : "0 connection changes"}`;
    lines.push(summaryLine);

    process.stdout.write(lines.join("\n") + "\n");
  } finally {
    db.close();
  }
}

/**
 * cmdDiffShadow — SHADOW-02 (Phase 119-02).
 *
 * Compares the LATEST completed scan in the live impact-map.db against the
 * LATEST completed scan in the impact-map-shadow.db, reusing Phase 115's
 * `diffScanVersions(dbA, dbB, scanIdA, scanIdB)` engine.
 *
 * Engine reuse rationale: 115's engine takes two raw `better-sqlite3`
 * Database handles (NOT projectRoot strings, NOT pool keys) — see the
 * load-bearing contract documented at scan-version-diff.js:8-31. We open
 * both DBs READ-ONLY here (the engine itself is read-only — test 15 in
 * scan-version-diff.test.js asserts this), so neither file is mutated.
 *
 * Both DBs are opened with `{readonly: true}`, which means SQLite never
 * writes pragma headers back — preserves the byte-identity invariant
 * established by 119-01 Test 8 for the live DB.
 *
 * Latest-scan resolution: `SELECT MAX(id) FROM scan_versions WHERE
 * completed_at IS NOT NULL`. Mirrors the in-progress-scan exclusion that
 * Phase 115's resolveScanSelector uses for HEAD.
 *
 * Exit codes:
 *   0 — diff completed (with or without changes)
 *   2 — no live DB, no shadow DB, OR no completed scan in either side
 */
async function cmdDiffShadow(flags) {
  const cwd = process.cwd();
  const dir = projectHashDir(cwd);
  const livePath = path.join(dir, "impact-map.db");
  const shadowPath = path.join(dir, "impact-map-shadow.db");

  // Silent in non-Arcanon dir (mirrors NAV-01 / SHADOW-01 / SHADOW-03).
  if (!fs.existsSync(livePath) && !fs.existsSync(shadowPath)) {
    process.exit(0);
  }
  if (!fs.existsSync(livePath)) {
    process.stderr.write("error: no live DB to diff against (run /arcanon:map first)\n");
    process.exit(2);
  }
  if (!fs.existsSync(shadowPath)) {
    process.stderr.write("error: no shadow DB to diff against (run /arcanon:shadow-scan first)\n");
    process.exit(2);
  }

  // Open both DBs READ-ONLY. Phase 115's engine is pool-agnostic — see
  // scan-version-diff.js:18-25 for the load-bearing contract.
  const liveDb = new Database(livePath, { readonly: true, fileMustExist: true });
  const shadowDb = new Database(shadowPath, { readonly: true, fileMustExist: true });

  try {
    const liveLatestRow = liveDb
      .prepare("SELECT MAX(id) AS id FROM scan_versions WHERE completed_at IS NOT NULL")
      .get();
    const shadowLatestRow = shadowDb
      .prepare("SELECT MAX(id) AS id FROM scan_versions WHERE completed_at IS NOT NULL")
      .get();
    const liveLatest = liveLatestRow ? liveLatestRow.id : null;
    const shadowLatest = shadowLatestRow ? shadowLatestRow.id : null;

    if (!liveLatest || !shadowLatest) {
      process.stderr.write(
        "error: no completed scan in " +
          (!liveLatest ? "live" : "shadow") +
          " DB\n",
      );
      process.exit(2);
    }

    const { diffScanVersions } = await import("../diff/scan-version-diff.js");
    const result = diffScanVersions(liveDb, shadowDb, liveLatest, shadowLatest);

    if (flags.json) {
      emit(
        {
          project_root: cwd,
          mode: "shadow",
          live_path: livePath,
          shadow_path: shadowPath,
          scanA: { scanId: liveLatest, source: "live" },
          scanB: { scanId: shadowLatest, source: "shadow" },
          ...result,
        },
        flags,
      );
      return;
    }

    if (result.same_scan) {
      // Cross-DB diff cannot truly short-circuit, but if the engine reports
      // it (different DBs but identical content) — surface the same line as
      // /arcanon:diff <id> <id>.
      process.stdout.write(
        "Diff (live vs shadow): scan #" + liveLatest + " vs scan #" + shadowLatest + " — identical\n",
      );
      return;
    }

    const lines = [];
    lines.push(
      "Diff (live vs shadow): live #" + liveLatest + " -> shadow #" + shadowLatest,
    );
    lines.push("");

    // Services
    lines.push("Services");
    lines.push("  Added (" + result.services.added.length + "):");
    for (const s of result.services.added) {
      lines.push("    + " + s.repo_id + "/" + s.name + " (" + s.type + ")");
    }
    lines.push("  Removed (" + result.services.removed.length + "):");
    for (const s of result.services.removed) {
      lines.push("    - " + s.repo_id + "/" + s.name + " (" + s.type + ")");
    }
    lines.push("  Modified (" + result.services.modified.length + "):");
    for (const s of result.services.modified) {
      const fieldStrs = (s.changed_fields || []).map((f) => {
        if (f.field === "evidence") return "evidence changed";
        return f.field + " " + (f.before == null ? "null" : f.before) +
          " -> " + (f.after == null ? "null" : f.after);
      });
      lines.push("    ~ " + s.repo_id + "/" + s.name + ": " + fieldStrs.join(", "));
    }
    lines.push("");

    // Connections
    const connStr = (c) =>
      c.source_name + " -> " + c.target_name + " " + c.protocol +
      (c.method ? " " + c.method : "") + (c.path ? " " + c.path : "");
    lines.push("Connections");
    lines.push("  Added (" + result.connections.added.length + "):");
    for (const c of result.connections.added) lines.push("    + " + connStr(c));
    lines.push("  Removed (" + result.connections.removed.length + "):");
    for (const c of result.connections.removed) lines.push("    - " + connStr(c));
    lines.push("  Modified (" + result.connections.modified.length + "):");
    for (const c of result.connections.modified) {
      const fieldStrs = (c.changed_fields || []).map((f) => {
        if (f.field === "evidence") return "evidence changed";
        return f.field + " " + (f.before == null ? "null" : f.before) +
          " -> " + (f.after == null ? "null" : f.after);
      });
      lines.push("    ~ " + connStr(c) + ": " + fieldStrs.join(", "));
    }
    lines.push("");

    // Summary
    const sv = result.summary.services;
    const cn = result.summary.connections;
    const svParts = [];
    if (sv.added) svParts.push(sv.added + " added");
    if (sv.removed) svParts.push(sv.removed + " removed");
    if (sv.modified) svParts.push(sv.modified + " modified");
    const cnParts = [];
    if (cn.added) cnParts.push(cn.added + " added");
    if (cn.removed) cnParts.push(cn.removed + " removed");
    if (cn.modified) cnParts.push(cn.modified + " modified");
    const summaryLine =
      "Summary: " +
      (svParts.length ? svParts.join(", ") + " services" : "0 service changes") +
      "; " +
      (cnParts.length ? cnParts.join(", ") + " connections" : "0 connection changes");
    lines.push(summaryLine);

    process.stdout.write(lines.join("\n") + "\n");
  } finally {
    try { liveDb.close(); } catch { /* ignore */ }
    try { shadowDb.close(); } catch { /* ignore */ }
  }
}

/**
 * cmdCorrect — Stage a scan-overrides row (CORRECT-02, plan 118-01).
 *
 * Inserts ONE row into the scan_overrides table per invocation. Does NOT
 * apply the override — Phase 117-02's `applyPendingOverrides` consumes the
 * pending row on the next scan run.
 *
 * Subcommand grammar: `correct <kind> --action <action> [target-flags] [payload-flags]`
 *
 *   kind      : connection | service        (positional[0])
 *   action    : delete | update | rename | set-base-path
 *   matrix    : connection allows {delete, update}
 *               service    allows {rename, set-base-path}
 *
 * Target flags:
 *   connection  --connection <id>           (positive integer; FK on connections.id)
 *   service     --service <name>            (resolved to services.id; ambiguous → exit 2)
 *
 * Payload flags (per action):
 *   delete           none — payload null
 *   update           --source <svc> --target <svc>            payload {source, target}
 *   rename           --new-name <name>                        payload {new_name}
 *   set-base-path    --base-path <path>                       payload {base_path}
 *
 * Output (NAV-04 emit() pattern):
 *   human  "correct: queued (override_id=<id>) — kind=<k>, target_id=<t>, action=<a>"
 *          + hint "Apply on next /arcanon:map or /arcanon:rescan run."
 *   json   { ok: true, override_id, kind, target_id, action, payload }
 *
 * Exit codes:
 *   0 — override staged
 *   2 — usage error: bad kind, bad action, action/kind mismatch, missing
 *       required flag, target not found, service name ambiguous
 *
 * Silent in non-Arcanon directories (no impact-map.db) — exits 0 with no
 * output, mirroring /arcanon:list, /arcanon:doctor, /arcanon:diff.
 */
async function cmdCorrect(flags, positional) {
  const cwd = process.cwd();
  const dbPath = path.join(projectHashDir(cwd), "impact-map.db");
  if (!fs.existsSync(dbPath)) {
    process.exit(0); // silent contract
  }

  // ----- 1. Validate kind (positional[0]) -----
  const kind = positional && positional[0];
  if (kind !== "connection" && kind !== "service") {
    process.stderr.write(
      `error: kind '${kind ?? ""}' is not valid — expected 'connection' or 'service'\n` +
        "usage: arcanon-hub correct <connection|service> --action <action> [flags]\n",
    );
    process.exit(2);
  }

  // ----- 2. Validate --action and cross-validate against kind -----
  const action = flags.action;
  const VALID_ACTIONS = new Set(["delete", "update", "rename", "set-base-path"]);
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    process.stderr.write(
      `error: --action '${action ?? ""}' is not valid — expected one of: delete, update, rename, set-base-path\n`,
    );
    process.exit(2);
  }
  const ALLOWED = {
    connection: new Set(["delete", "update"]),
    service: new Set(["rename", "set-base-path"]),
  };
  if (!ALLOWED[kind].has(action)) {
    const validKindForAction = action === "delete" || action === "update" ? "connection" : "service";
    process.stderr.write(
      `error: action '${action}' is only valid for kind '${validKindForAction}' (you passed kind '${kind}')\n`,
    );
    process.exit(2);
  }

  // ----- 3. Resolve target_id -----
  const db = new Database(dbPath);
  let targetId;
  try {
    if (kind === "connection") {
      const idStr = flags.connection !== undefined && flags.connection !== true
        ? String(flags.connection)
        : "";
      if (!/^\d+$/.test(idStr) || Number(idStr) <= 0) {
        process.stderr.write("error: --connection requires a positive integer ID\n");
        process.exit(2);
      }
      targetId = Number(idStr);
      const row = db
        .prepare("SELECT id FROM connections WHERE id = ?")
        .get(targetId);
      if (!row) {
        process.stderr.write(`error: connection ID ${targetId} not found\n`);
        process.exit(2);
      }
    } else {
      const name = flags.service !== undefined && flags.service !== true
        ? String(flags.service)
        : "";
      if (name.length === 0) {
        process.stderr.write("error: --service requires a non-empty name\n");
        process.exit(2);
      }
      const { resolveServiceTarget } = await import("./correct-resolver.js");
      try {
        targetId = resolveServiceTarget(name, db);
      } catch (err) {
        process.stderr.write(`error: ${err.message}\n`);
        process.exit(err.exitCode ?? 2);
      }
    }
  } finally {
    db.close();
  }

  // ----- 4. Construct payload per action -----
  let payload;
  const missing = [];
  if (action === "delete") {
    payload = null;
  } else if (action === "update") {
    const source = flags.source !== undefined && flags.source !== true ? String(flags.source) : "";
    const target = flags.target !== undefined && flags.target !== true ? String(flags.target) : "";
    if (!source) missing.push("--source");
    if (!target) missing.push("--target");
    if (missing.length === 0) payload = { source, target };
  } else if (action === "rename") {
    const newName = flags["new-name"] !== undefined && flags["new-name"] !== true
      ? String(flags["new-name"])
      : "";
    if (!newName) missing.push("--new-name");
    if (missing.length === 0) payload = { new_name: newName };
  } else if (action === "set-base-path") {
    const basePath = flags["base-path"] !== undefined && flags["base-path"] !== true
      ? String(flags["base-path"])
      : "";
    if (!basePath) missing.push("--base-path");
    if (missing.length === 0) payload = { base_path: basePath };
  }
  if (missing.length > 0) {
    process.stderr.write(
      `error: --action ${action} requires ${missing.join(" and ")}\n`,
    );
    process.exit(2);
  }

  // ----- 5. Insert via QueryEngine (Phase 117-01's helper) -----
  const { getQueryEngine } = await import("../db/pool.js");
  const qe = getQueryEngine(cwd);
  if (!qe) {
    // Pool returns null only when projectRoot is falsy or the DB file
    // disappeared between our existsSync check and now. Defensive — the
    // earlier silent-contract guard should have caught this.
    process.stderr.write(`error: project DB not available at ${dbPath}\n`);
    process.exit(2);
  }
  const overrideId = qe.upsertOverride({
    kind,
    target_id: targetId,
    action,
    // Plan 117-01's helper JSON-stringifies internally. Pass the object
    // when we have one; pass null/{} when the action carries no payload.
    payload: payload ?? {},
    created_by: "cli",
  });
  if (overrideId === null) {
    // Pre-mig-017 db. Phase 117-01's downgrade contract returns null when
    // the prepared statement could not arm. Surface clearly.
    process.stderr.write(
      "error: scan_overrides table missing — run migrations (start the worker once via /arcanon:map) and retry\n",
    );
    process.exit(2);
  }

  emit(
    {
      ok: true,
      override_id: overrideId,
      kind,
      target_id: targetId,
      action,
      payload: payload ?? null,
    },
    flags,
    `correct: queued (override_id=${overrideId}) — kind=${kind}, target_id=${targetId}, action=${action}\n` +
      "Apply on next /arcanon:map or /arcanon:rescan run.",
  );
}

/**
 * Detect whether a live scan is in progress for any repo under the project's
 * working directory (T-119-02-04, RESEARCH §3 cross-reference).
 *
 * Scans `${dataDir}/scan-*.lock` lock files (written by manager.js
 * acquireScanLock — see manager.js:535-566) and returns the matching lock
 * path when ALL three conditions hold:
 *
 *   1. The lock JSON parses cleanly with `pid` + `repoPaths` fields.
 *   2. The recorded PID is still alive (process.kill(pid, 0) doesn't throw).
 *   3. At least one entry in `repoPaths` lives under `projectRoot` (prefix
 *      match against `${projectRoot}/`, plus exact-match for the bare cwd).
 *
 * Stale locks (dead PID) are LEFT IN PLACE here — manager.js's own
 * acquireScanLock cleans them up on the next live scan attempt. Promote
 * is a passive consumer; it does not own lock-cleanup.
 *
 * Returns null when no matching active lock is found (the common case).
 *
 * @param {string} projectRoot
 * @returns {string|null} absolute lock path, or null if no active lock blocks promote.
 */
function _findActiveScanLockForProject(projectRoot) {
  const dataDir = resolveDataDir();
  let entries;
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return null; // data dir absent — no locks possible
  }
  const projectPrefix = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
  for (const entry of entries) {
    if (!entry.startsWith("scan-") || !entry.endsWith(".lock")) continue;
    const lockPath = path.join(dataDir, entry);
    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch {
      continue; // corrupted lock — let manager.js clean it up
    }
    if (!lock || typeof lock.pid !== "number" || !Array.isArray(lock.repoPaths)) continue;
    // Check PID is alive (process.kill(pid, 0) returns true when alive).
    try {
      process.kill(lock.pid, 0);
    } catch {
      continue; // dead PID — stale lock; manager.js will clean it up next scan
    }
    // Active scan — check if any repo path is under projectRoot.
    for (const rp of lock.repoPaths) {
      if (typeof rp !== "string") continue;
      if (rp === projectRoot || rp.startsWith(projectPrefix)) {
        return lockPath;
      }
    }
  }
  return null;
}

/**
 * cmdPromoteShadow — SHADOW-03 (Phase 119-02).
 *
 * Atomically swaps `impact-map-shadow.db` over `impact-map.db` with a
 * timestamped backup of the prior live DB. WAL sidecars (-wal, -shm) are
 * renamed alongside the main file in BOTH the backup step and the promote
 * step so SQLite never sees a stale log on next open (RESEARCH §3).
 *
 * Sequence (exact order — DO NOT reorder):
 *   1. Silent no-op when neither live nor shadow exists (NAV-01 contract).
 *   2. Exit 2 if shadow DB is missing (nothing to promote).
 *   3. Exit 2 if a live scan is in progress for any repo under cwd
 *      (T-119-02-04 — promote during scan would write to renamed-out fd).
 *   4. Evict cached LIVE QueryEngine from the worker pool (T-119-02-01).
 *      Idempotent — returns false when no entry was cached.
 *   5. Backup live: rename(live → live.pre-promote-<ts>) + sidecars.
 *   6. Promote shadow: rename(shadow → live) + sidecars.
 *   7. Print backup path on stdout (or full JSON object with --json).
 *
 * Atomic-rename guarantee (RESEARCH §3): both DBs sit as siblings under
 * `projectHashDir(cwd)` → same filesystem → fs.renameSync is atomic per
 * POSIX rename(2). No observable intermediate state on success. On
 * mid-flight failure (e.g., disk full), best-effort rollback restores
 * live from the backup and exits 1.
 *
 * Backups are NEVER auto-deleted (operator cleanup — documented in
 * commands/promote-shadow.md and in the human stdout message).
 *
 * Exit codes:
 *   0 — promoted; backup printed (or first-promote: shadow → live, no backup)
 *   1 — rename failed mid-flight; rollback attempted
 *   2 — no shadow DB to promote, OR active live scan blocks promote
 */
async function cmdPromoteShadow(flags) {
  const projectRoot = process.cwd();
  const dir = projectHashDir(projectRoot);
  const livePath = path.join(dir, "impact-map.db");
  const shadowPath = path.join(dir, "impact-map-shadow.db");

  // Step 1 — silent no-op in non-Arcanon dir (mirrors NAV-01 / SHADOW-01).
  if (!fs.existsSync(livePath) && !fs.existsSync(shadowPath)) {
    process.exit(0);
  }

  // Step 2 — shadow MUST exist (nothing to promote otherwise).
  if (!fs.existsSync(shadowPath)) {
    process.stderr.write(
      "error: no shadow DB to promote (looked for " + shadowPath + ")\n",
    );
    process.exit(2);
  }

  // Step 3 — active-scan-lock guard (T-119-02-04).
  const activeLock = _findActiveScanLockForProject(projectRoot);
  if (activeLock) {
    process.stderr.write(
      "error: scan in progress for this project (lock: " + activeLock +
        "). Wait for the scan to finish, then re-run /arcanon:promote-shadow.\n",
    );
    process.exit(2);
  }

  // Step 4 — evict cached live QE BEFORE any rename (T-119-02-01).
  const evicted = evictLiveQueryEngine(projectRoot);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let backupPath = null;
  let backupSidecarsRenamed = [];

  try {
    if (fs.existsSync(livePath)) {
      // Step 5 — backup live (main + sidecars).
      backupPath = livePath + ".pre-promote-" + ts;
      fs.renameSync(livePath, backupPath);
      for (const sfx of ["-wal", "-shm"]) {
        if (fs.existsSync(livePath + sfx)) {
          fs.renameSync(livePath + sfx, backupPath + sfx);
          backupSidecarsRenamed.push(sfx);
        }
      }
    }

    // Step 6 — promote shadow → live (main + sidecars).
    fs.renameSync(shadowPath, livePath);
    for (const sfx of ["-wal", "-shm"]) {
      if (fs.existsSync(shadowPath + sfx)) {
        fs.renameSync(shadowPath + sfx, livePath + sfx);
      }
    }
  } catch (err) {
    // Best-effort rollback: if the live → backup rename succeeded but
    // the shadow → live rename failed, restore live from the backup so
    // the project isn't left in a half-promoted state.
    if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(livePath)) {
      try {
        fs.renameSync(backupPath, livePath);
        for (const sfx of backupSidecarsRenamed) {
          if (fs.existsSync(backupPath + sfx)) {
            fs.renameSync(backupPath + sfx, livePath + sfx);
          }
        }
      } catch { /* ignore — surfaced via thrown error below */ }
    }
    process.stderr.write("error: promote failed: " + err.message + "\n");
    process.exit(1);
  }

  // Step 7 — report.
  const human = backupPath
    ? "Promoted shadow -> live.\nBackup: " + backupPath +
      "\nDelete backup manually when no longer needed (rollback: mv " + backupPath + " " + livePath + ")."
    : "No live DB to back up; shadow promoted to live.\nLive: " + livePath;
  emit(
    {
      ok: true,
      backup_path: backupPath,
      live_path: livePath,
      evicted_cached_qe: evicted,
    },
    flags,
    human,
  );
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
  diff: cmdDiff,     // NAV-04
  correct: cmdCorrect, // CORRECT-02 stage path (Phase 118-01)
  "promote-shadow": cmdPromoteShadow, // SHADOW-03 (Phase 119-02) — hyphenated key matches the slash-command name
};

async function main() {
  const { sub, flags, positional } = parseArgs(process.argv.slice(2));
  const handler = HANDLERS[sub];
  if (!handler) {
    process.stderr.write(
      `usage: arcanon-hub <${Object.keys(HANDLERS).join("|")}> [options]\n`,
    );
    process.exit(2);
  }
  try {
    await handler(flags, positional);
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
// loadLatestFindings is exported so the INT-01 test can drive the SELECT
// extension (evidence/confidence/source_file) end-to-end without spawning
// the CLI subprocess.
export { _readHubAutoSync, cmdVerify, loadLatestFindings };
