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
 *   whoami    Validate the stored API key against the hub
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
  resolveCredentials,
  storeCredentials,
  AuthError,
} from "../hub-sync/index.js";
import { resolveConfigPath } from "../lib/config-path.js";
import { resolveDataDir } from "../lib/data-dir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function cmdWhoami(flags) {
  let creds;
  try {
    creds = resolveCredentials({ apiKey: flags["api-key"], hubUrl: flags["hub-url"] });
  } catch (err) {
    if (err instanceof AuthError) {
      emit({ ok: false, error: err.message }, flags, `✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const url = new URL("/api/v1/auth/whoami", creds.hubUrl).toString();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      emit(
        { ok: true, ...body },
        flags,
        `✓ authenticated (${body?.org_name || "org"}${body?.project_slug ? `/${body.project_slug}` : ""})`,
      );
      return;
    }
    emit(
      { ok: false, status: res.status, body },
      flags,
      `✗ hub returned ${res.status}: ${body?.detail || body?.title || "auth failed"}`,
    );
    process.exit(1);
  } catch (err) {
    emit(
      { ok: false, error: err.message },
      flags,
      `✗ hub unreachable: ${err.message}`,
    );
    process.exit(1);
  }
}

async function cmdStatus(flags) {
  const stats = queueStats();
  const cfg = readProjectConfig();
  const hubAutoUpload = Boolean(cfg?.hub?.["auto-upload"]);
  const projectSlug = cfg?.hub?.["project-slug"] || cfg?.["project-name"] || null;

  const hasCreds = (() => {
    try {
      resolveCredentials();
      return true;
    } catch {
      return false;
    }
  })();

  const report = {
    plugin_version: readPackageVersion(),
    data_dir: resolveDataDir(),
    config_file: resolveConfigPath(process.cwd()),
    project_slug: projectSlug,
    hub_auto_upload: hubAutoUpload,
    credentials: hasCreds ? "present" : "missing",
    queue: stats,
  };

  if (flags.json) {
    emit(report, flags);
    return;
  }
  const lines = [
    `Arcanon v${report.plugin_version}`,
    `  project:      ${report.project_slug || "(none — set project-name in arcanon.config.json)"}`,
    `  credentials:  ${report.credentials === "present" ? "✓ present" : "✗ missing (/arcanon:login)"}`,
    `  auto-upload:  ${hubAutoUpload ? "enabled" : "disabled"}`,
    `  queue:        ${stats.pending} pending, ${stats.dead} dead${stats.oldestPending ? `, oldest ${stats.oldestPending}` : ""}`,
    `  data dir:     ${report.data_dir}`,
  ];
  emit(report, flags, lines.join("\n"));
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

  const services = db
    .prepare(
      "SELECT name, root_path, language, type, boundary_entry FROM services WHERE repo_id = ?",
    )
    .all(repoRow.id);

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
  const report = await drainQueue({
    apiKey: flags["api-key"],
    hubUrl: flags["hub-url"],
    limit: Number(flags.limit) || 50,
  });
  if (flags.json) {
    emit(report, flags);
    return;
  }
  emit(
    report,
    flags,
    `drain: attempted=${report.attempted} succeeded=${report.succeeded} failed=${report.failed} dead=${report.dead} (pending=${report.stats.pending})`,
  );
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
  whoami: cmdWhoami,
  status: cmdStatus,
  upload: cmdUpload,
  sync: cmdSync,
  queue: cmdQueue,
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

main();
