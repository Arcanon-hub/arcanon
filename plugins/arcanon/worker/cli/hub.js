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
import Database from "../db/sqlite-adapter.js";

import {
  syncFindings,
  drainQueue,
  queueStats,
  listAllUploads,
  pruneDead,
  resolveCredentials,
  storeCredentials,
  getKeyInfo,
  AuthError,
  HubError,
} from "../hub-sync/index.js";
import { resolveConfigPath } from "../lib/config-path.js";
import { resolveDataDir } from "../lib/data-dir.js";
import { maskHome } from "../lib/path-mask.js";
import { readHubAutoSync as _readHubAutoSync } from "../lib/hub-config.js";
import { projectHashDir } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bounded fetch with timeout. Returns a normalized result object regardless
 * of success/failure so callers don't need try/catch boilerplate.
 *
 * Used by cmdDoctor checks 1, 2, and 8. The contract
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

/**
 * Whoami-driven login flow.
 *
 * Calls GET /api/v1/auth/whoami to discover org grants for the supplied key,
 * then applies the 4×2 branch table (whoami outcome × --org-id provided/not).
 *
 * Exit codes:
 *   0 — success (or warn-and-store when hub unavailable + --org-id supplied)
 *   2 — failure (no key, bad key format, invalid uuid, 0 grants, AuthError,
 *               hub unavailable without --org-id)
 *   7 — multi-grant prompt: stdout emits __ARCANON_GRANT_PROMPT__ sentinel +
 *       JSON grants array for the slash-command markdown layer to handle via
 *       AskUserQuestion + re-invocation with --org-id <chosen>.
 *
 * Security: the api key is NEVER echoed to stdout or stderr.
 */
async function cmdLogin(flags, positional) {
  // Resolve api key: positional arg first (from slash command), then --api-key flag, then env.
  const apiKey = positional?.[0] || flags["api-key"] || process.env.ARCANON_API_KEY;
  if (!apiKey) {
    process.stderr.write("error: pass --api-key arc_... or set ARCANON_API_KEY\n");
    process.exit(2);
  }
  if (!apiKey.startsWith("arc_")) {
    process.stderr.write("error: api key must start with arc_\n");
    process.exit(2);
  }

  // Resolve optional --org-id with uuid v4 validation.
  const orgId = flags["org-id"] || null;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (orgId && !UUID_RE.test(orgId)) {
    process.stderr.write(`error: --org-id must be a uuid (got ${orgId})\n`);
    process.exit(2);
  }

  // Resolve hub URL for whoami: flag → env → home config → default.
  // Use resolveCredentials with orgIdRequired:false to get hubUrl without requiring org.
  let hubUrlForWhoami;
  try {
    const creds = resolveCredentials({
      apiKey,
      hubUrl: flags["hub-url"] || undefined,
      orgIdRequired: false,
    });
    hubUrlForWhoami = creds.hubUrl;
  } catch {
    // resolveCredentials throws AuthError if key is bad format — but we already
    // validated startsWith("arc_"), so this path is unlikely. Fallback to default.
    const { DEFAULT_HUB_URL } = await import("../hub-sync/auth.js");
    hubUrlForWhoami = flags["hub-url"] || process.env.ARCANON_HUB_URL || DEFAULT_HUB_URL;
  }

  // Call whoami — never echoes the full key.
  let keyInfo = null;
  let whoamiErr = null;
  let whoamiErrKind = null; // "auth" | "hub5xx" | "network"

  try {
    keyInfo = await getKeyInfo(apiKey, hubUrlForWhoami);
  } catch (err) {
    whoamiErr = err;
    if (err instanceof AuthError) {
      whoamiErrKind = "auth";
    } else if (err instanceof HubError) {
      // Distinguish network error (status===null, retriable) from hub 5xx.
      whoamiErrKind = (err.status === null && err.retriable) ? "network" : "hub5xx";
    } else {
      // Unexpected error — re-throw.
      throw err;
    }
  }

  // ---- Branch table ----

  // Case: AuthError (401/403) — key invalid or revoked. NEVER store.
  if (whoamiErrKind === "auth") {
    const msg = "error: hub rejected the API key during whoami — generate a new key at https://app.arcanon.dev/settings/api-keys";
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(msg + "\n");
    }
    process.exit(2);
  }

  // Case: HubError 5xx or network error.
  if (whoamiErrKind === "hub5xx" || whoamiErrKind === "network") {
    if (orgId) {
      // Store with warning — user explicitly supplied org id.
      const file = storeCredentials(apiKey, { hubUrl: flags["hub-url"], defaultOrgId: orgId });
      const warnMsg = whoamiErrKind === "network"
        ? "⚠ hub unreachable; grants could not be verified — credential stored, retry /arcanon:login when online"
        : `⚠ hub whoami returned ${whoamiErr.status}; grants could not be verified — credential stored, retry /arcanon:login later to verify`;
      process.stderr.write(warnMsg + "\n");
      if (flags.json) {
        process.stdout.write(JSON.stringify({
          ok: true, stored_at: file, hub_url: flags["hub-url"] || null,
          org_id: orgId, warning: warnMsg,
        }) + "\n");
      } else {
        process.stdout.write(`✓ credential stored to ${file}\n`);
      }
      process.exit(0);
    } else {
      // No org id — refuse to store.
      const msg = whoamiErrKind === "network"
        ? "error: hub unreachable and no --org-id provided — connect to the network and retry, or run /arcanon:login arc_… --org-id <uuid>"
        : `error: hub whoami unavailable (${whoamiErr.status}) and no --org-id provided — retry later, or run /arcanon:login arc_… --org-id <uuid> if you know the org id`;
      if (flags.json) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
      } else {
        process.stderr.write(msg + "\n");
      }
      process.exit(2);
    }
  }

  // Case: whoami success — keyInfo is populated.
  const grants = Array.isArray(keyInfo?.grants) ? keyInfo.grants : [];

  if (orgId) {
    // With --org-id: verify the supplied org appears in grants.
    const matchingGrant = grants.find((g) => g.org_id === orgId);
    const file = storeCredentials(apiKey, { hubUrl: flags["hub-url"], defaultOrgId: orgId });

    if (matchingGrant) {
      const slug = matchingGrant.org_name || matchingGrant.slug || orgId;
      const successMsg = `✓ verified: signed in to org ${slug} (${orgId}) as ${keyInfo.user_id}`;
      if (flags.json) {
        process.stdout.write(JSON.stringify({
          ok: true, stored_at: file, hub_url: flags["hub-url"] || null,
          org_id: orgId, org_slug: slug, source_branch: "verified",
        }) + "\n");
      } else {
        process.stdout.write(successMsg + "\n");
      }
    } else {
      // Mismatch — store anyway but warn loudly.
      const grantList = grants.map((g) => `${g.org_name || g.slug || g.org_id} (${g.org_id})`).join(", ");
      const warnMsg = `⚠ key is not authorized for org ${orgId} — server will reject uploads. Run /arcanon:login --org-id <uuid> with one of: ${grantList || "(no grants found)"}  to switch.`;
      process.stderr.write(warnMsg + "\n");
      if (flags.json) {
        process.stdout.write(JSON.stringify({
          ok: true, stored_at: file, hub_url: flags["hub-url"] || null,
          org_id: orgId, org_slug: null, source_branch: "mismatch", warning: warnMsg,
        }) + "\n");
      } else {
        process.stdout.write(`✓ credential stored to ${file}\n`);
      }
    }
    process.exit(0);
  }

  // Without --org-id: apply grant-count resolution.
  if (grants.length === 0) {
    const msg = "error: key has no org grants — ask your admin to grant the key access at https://app.arcanon.dev/settings/api-keys";
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(msg + "\n");
    }
    process.exit(2);
  }

  if (grants.length === 1) {
    const grant = grants[0];
    const chosenOrgId = grant.org_id;
    const slug = grant.org_name || grant.slug || chosenOrgId;
    const file = storeCredentials(apiKey, { hubUrl: flags["hub-url"], defaultOrgId: chosenOrgId });
    const successMsg = `✓ auto-selected org ${slug} (${chosenOrgId})`;
    if (flags.json) {
      process.stdout.write(JSON.stringify({
        ok: true, stored_at: file, hub_url: flags["hub-url"] || null,
        org_id: chosenOrgId, org_slug: slug, source_branch: "auto-selected",
      }) + "\n");
    } else {
      process.stdout.write(successMsg + "\n");
    }
    process.exit(0);
  }

  // N > 1 grants: emit sentinel for the markdown layer to handle via AskUserQuestion.
  // The slash-command markdown parses this sentinel, prompts the user, then re-invokes
  // cmdLogin with --org-id <chosen_uuid>.
  if (flags.json) {
    process.stdout.write(JSON.stringify({ action: "prompt_grants", grants }) + "\n");
  } else {
    process.stdout.write("__ARCANON_GRANT_PROMPT__\n");
    process.stdout.write(JSON.stringify(grants) + "\n");
  }
  process.exit(7);
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

  // Best-effort latest-scan freshness via the
  // /api/scan-freshness endpoint. Surfaces both the quality line ("Latest scan:
  // YYYY-MM-DD (NN% high-confidence)") and the per-repo drift line ("N repo(s)
  // have new commits since last scan: <name> (M new), ..."). The drift line is
  // suppressed when no repo has positive new_commits. Falls back silently to
  // null on any error — worker offline / unreachable / old build without the
  // endpoint. The /api/scan-quality route stays in place for back-compat but
  // is no longer consumed by /arcanon:status.
  const freshness = await _fetchScanFreshness(process.cwd());

  // Identity block.
  const identity = await _buildIdentityBlock(cfg);

  const report = {
    plugin_version: readPackageVersion(),
    data_dir: maskHome(resolveDataDir()),
    config_file: maskHome(resolveConfigPath(process.cwd())),
    project_slug: projectSlug,
    hub_auto_sync: hubAutoSync,
    credentials: hasCreds ? "present" : "missing",
    queue: stats,
    scan_freshness: freshness?.report ?? null,
    identity,
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
    `  queue:        ${stats.pending} pending, ${stats.dead} dead${typeof stats.held === "number" && stats.held > 0 ? `, ${stats.held} held` : ""}${stats.oldestPending ? `, oldest ${stats.oldestPending}` : ""}`,
    `  data dir:     ${report.data_dir}`,
  ];

  // Identity block (4 indented lines under "Identity:" header).
  // Rendered after data dir, before Latest scan freshness lines.
  lines.push(`  Identity:`);
  const idOrgId = identity.org_id || "(missing)";
  const idSource = identity.org_id_source || "—";
  lines.push(`    org id:        ${idOrgId}  (source: ${idSource})`);
  lines.push(`    key:           ${identity.key_preview || "(missing)"}`);
  if (identity.whoami_status === "ok") {
    lines.push(`    scopes:        ${identity.scopes.length > 0 ? identity.scopes.join(", ") : "(none)"}`);
    const slugs = identity.authorized_orgs.map((o) => o.slug || o.id).join(", ");
    lines.push(`    authorized:    ${slugs || "(none)"}`);
  } else {
    lines.push(`    scopes:        (unavailable: ${identity.whoami_status})`);
    lines.push(`    authorized:    (unavailable)`);
  }

  if (freshness?.qualityLine) {
    lines.push(`  ${freshness.qualityLine}`);
  }
  for (const line of freshness?.freshnessLines ?? []) {
    lines.push(`  ${line}`);
  }
  emit(report, flags, lines.join("\n"));
}

/**
 * Build the Identity block surfaced in /arcanon:status.
 *
 * Resolution:
 *   1. Try resolveCredentials({orgIdRequired:false}) — gives apiKey + hubUrl + best-effort orgId.
 *      If no creds at all → return all-null with whoami_status: "skipped".
 *   2. Build key_preview as `${apiKey.slice(0,8)}…${apiKey.slice(-4)}` (e.g. arc_xxxx…1234).
 *   3. Determine org_id_source by inspecting opts/env/repo-config/home-config in precedence order.
 *   4. If apiKey + hubUrl resolve, call getKeyInfo(apiKey, hubUrl) with a 4 s timeout.
 *      - On success → populate scopes, authorized_orgs, whoami_status:"ok".
 *      - On AuthError → whoami_status:"auth_error".
 *      - On HubError 5xx → whoami_status:"hub_error".
 *      - On HubError network (status:null + retriable) → whoami_status:"network_error".
 *
 * @param {object} cfg - Already-loaded project config (from readProjectConfig()).
 * @returns {Promise<{
 *   org_id: string|null,
 *   org_id_source: string|null,
 *   key_preview: string|null,
 *   scopes: string[],
 *   authorized_orgs: Array<{id: string, slug: string}>,
 *   whoami_status: "ok"|"auth_error"|"hub_error"|"network_error"|"skipped",
 * }>}
 */
async function _buildIdentityBlock(cfg) {
  const empty = {
    org_id: null,
    org_id_source: null,
    key_preview: null,
    scopes: [],
    authorized_orgs: [],
    whoami_status: "skipped",
  };

  // Determine org_id_source by inspecting precedence chain explicitly.
  // Order: per-repo hub.org_id → ARCANON_ORG_ID env → home-config default_org_id.
  const repoOrgId = cfg?.hub?.org_id || null;
  const envOrgId = process.env.ARCANON_ORG_ID || null;

  let creds;
  try {
    creds = resolveCredentials({
      orgId: repoOrgId || undefined,
      orgIdRequired: false,
    });
  } catch {
    return empty;
  }

  const { apiKey, hubUrl, orgId } = creds;
  const keyPreview = apiKey && apiKey.length >= 12
    ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`
    : (apiKey ? "arc_***" : null);

  // Compute org_id_source: which precedence tier produced the resolved orgId?
  let orgIdSource = null;
  if (orgId) {
    if (repoOrgId && orgId === repoOrgId) orgIdSource = "repo_config";
    else if (envOrgId && orgId === envOrgId) orgIdSource = "env";
    else orgIdSource = "config_default";
  }

  // Best-effort whoami call with 4-second timeout cap so /arcanon:status never hangs.
  let scopes = [];
  let authorizedOrgs = [];
  let whoamiStatus = "ok";
  try {
    const info = await getKeyInfo(apiKey, hubUrl, { timeoutMs: 4000 });
    scopes = Array.isArray(info?.scopes) ? info.scopes : [];
    const grants = Array.isArray(info?.grants) ? info.grants : [];
    authorizedOrgs = grants.map((g) => ({
      id: g.org_id,
      slug: g.org_name || g.slug || g.org_id,
    }));
  } catch (err) {
    if (err instanceof AuthError) {
      whoamiStatus = "auth_error";
    } else if (err instanceof HubError) {
      whoamiStatus = (err.status === null && err.retriable) ? "network_error" : "hub_error";
    } else {
      // Unexpected — treat as hub_error so /arcanon:status still renders cleanly.
      whoamiStatus = "hub_error";
    }
  }

  return {
    org_id: orgId || null,
    org_id_source: orgIdSource,
    key_preview: keyPreview,
    scopes,
    authorized_orgs: authorizedOrgs,
    whoami_status: whoamiStatus,
  };
}

/**
 * Fetches scan freshness data from the worker. Returns formatted
 * status output lines plus the raw report for --json mode. Best-effort:
 * returns null on any failure (worker offline, no scan data, network error,
 * old worker without the endpoint). Callers MUST tolerate a null return —
 * status output gracefully omits both freshness lines.
 *
 * Output:
 *   qualityLine     — "Latest scan: 2026-04-23 (87% high-confidence)" 
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

  // line: "Latest scan: 2026-04-23 (87% high-confidence)"
  const datePart = (body.last_scan_iso || "").slice(0, 10) || "unknown";
  const pctPart = body.scan_quality_pct === null || body.scan_quality_pct === undefined
    ? "n/a"
    : `${body.scan_quality_pct}% high-confidence`;
  const qualityLine = `Latest scan: ${datePart} (${pctPart})`;

  // line(s): "N repo(s) have new commits since last scan: <name> (M new), ..."
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

  // attach per-service deps. getDependenciesForService returns []
  // gracefully on pre-migration-010 DBs ( contract), so this is
  // safe to call unconditionally — the feature flag determines whether the
  // payload actually emits them.
  const services = servicesRaw.map((s) => ({
    ...s,
    dependencies: qe.getDependenciesForService(s.id),
  }));

  // also project c.evidence, c.confidence, c.source_file
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
  // hub.evidence_mode controls per-connection evidence
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
    libraryDepsEnabled,  // feature flag — gates v1.1 emission
    evidenceMode,        // — forwarded to buildScanPayload
    projectRoot: repoPath, // — for line-number derivation in hash-only mode
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
 * cmdVerify — Re-read cited source files and report per-connection verdicts.
 * Read-only; never writes to the scan database.
 *
 * Verdicts (exhaustive): ok | moved | missing | method_mismatch
 *
 * Flags:
 *   --connection <id>  Verify exactly one connection by integer ID
 *   --source <path>    Verify connections whose source_file matches
 *                      (basename match if no `/`, exact match otherwise)
 *   --json             Emit machine-readable JSON
 *   --repo <path>      Override project root (defaults to process.cwd())
 *
 * Exit codes :
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
  // else: implicit --all  — no further params

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

  // Truncated cap — .
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
 * cmdList — Concise read-only project overview (plan 114-01).
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

  // Project detection — silent no-op in non-Arcanon directories ( contract).
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
  // capture {name,label} per actor so the human formatter can render
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
      // structured per-actor array — {name, label} per row. label is
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
  // when actors are present, append a parenthetical inline label list.
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
 * cmdDoctor — 8-check diagnostic suite .
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
  // forward-compatible with  (017_scan_overrides.js) etc.; the
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
        // Check 8 only needs apiKey + hubUrl for the GET /api/version probe;
        // org_id is not part of that round-trip. Opt out of the  org-id
        // requirement so a "creds present but no org_id" config doesn't get
        // mis-classified as SKIP. (See doctor.bats  tests 9-10.)
        creds = resolveCredentials({ orgIdRequired: false });
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
 * cmdDiff — Compare two scan versions (plan 115-02).
 *
 * Read-only: opens the project DB via the sqlite adapter directly (no worker
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
 * cmdCorrect — Stage a scan-overrides row (plan 118-01).
 *
 * Inserts ONE row into the scan_overrides table per invocation. Does NOT
 * apply the override — 's `applyPendingOverrides` consumes the
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
 * Output ( emit pattern):
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

  // 5. Insert via QueryEngine ('s helper) -----
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
    // 's helper JSON-stringifies internally. Pass the object
    // when we have one; pass null/{} when the action carries no payload.
    payload: payload ?? {},
    created_by: "cli",
  });
  if (overrideId === null) {
    // Pre-mig-017 db. 's downgrade contract returns null when
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

const HANDLERS = {
  version: cmdVersion,
  login: cmdLogin,
  status: cmdStatus,
  upload: cmdUpload,
  sync: cmdSync,
  queue: cmdQueue,
  verify: cmdVerify,
  list: cmdList,
  doctor: cmdDoctor,
  diff: cmdDiff,
  correct: cmdCorrect, // stage path
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
// loadLatestFindings is exported so the  test can drive the SELECT
// extension (evidence/confidence/source_file) end-to-end without spawning
// the CLI subprocess.
export { _readHubAutoSync, cmdVerify, loadLatestFindings };
