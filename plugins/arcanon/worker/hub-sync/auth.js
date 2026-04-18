/**
 * worker/hub-sync/auth.js — Resolve Arcanon Hub credentials.
 *
 * Credential precedence (first hit wins):
 *   1. opts.apiKey (explicit argument — used by /arcanon:login test flows)
 *   2. process.env.ARCANON_API_KEY
 *   3. ~/.arcanon/config.json  { "api_key": "arc_..." }
 *   4. ~/.ligamen/config.json  (legacy)
 *
 * Hub URL precedence:
 *   1. opts.hubUrl
 *   2. process.env.ARCANON_HUB_URL
 *   3. ~/.arcanon/config.json  { "hub_url": "..." }
 *   4. Default: https://api.arcanon.dev
 *
 * The plugin's `userConfig.api_token` (declared in .claude-plugin/plugin.json)
 * is read by Claude Code from its own secrets store; at runtime it's injected
 * as ARCANON_API_TOKEN. We accept both ARCANON_API_KEY and ARCANON_API_TOKEN
 * as env var names for forgiving operator UX.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_HUB_URL = "https://api.arcanon.dev";
export const API_KEY_PREFIX = "arc_";

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readHomeConfig() {
  const home = os.homedir();
  const current = path.join(home, ".arcanon", "config.json");
  const legacy = path.join(home, ".ligamen", "config.json");
  return readJsonSafe(current) || readJsonSafe(legacy) || {};
}

/**
 * Resolve credentials. Returns { apiKey, hubUrl, source } on success.
 * `source` is one of "explicit" | "env" | "home-config" | null.
 *
 * Throws AuthError when no apiKey can be found.
 *
 * @param {{ apiKey?: string, hubUrl?: string }} [opts]
 * @returns {{ apiKey: string, hubUrl: string, source: string }}
 */
export function resolveCredentials(opts = {}) {
  const homeCfg = readHomeConfig();

  let apiKey = null;
  let source = null;

  if (opts.apiKey) {
    apiKey = opts.apiKey;
    source = "explicit";
  } else if (process.env.ARCANON_API_KEY) {
    apiKey = process.env.ARCANON_API_KEY;
    source = "env";
  } else if (process.env.ARCANON_API_TOKEN) {
    apiKey = process.env.ARCANON_API_TOKEN;
    source = "env";
  } else if (homeCfg.api_key) {
    apiKey = homeCfg.api_key;
    source = "home-config";
  }

  if (!apiKey) {
    throw new AuthError(
      "Arcanon API key not found. Set ARCANON_API_KEY, run /arcanon:login, or add api_key to ~/.arcanon/config.json.",
    );
  }
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    throw new AuthError(
      `API key must start with "${API_KEY_PREFIX}" (hub rejects JWT tokens on /api/v1/scans/upload).`,
    );
  }

  const hubUrl =
    opts.hubUrl ||
    process.env.ARCANON_HUB_URL ||
    homeCfg.hub_url ||
    DEFAULT_HUB_URL;

  return { apiKey, hubUrl, source };
}

/**
 * Persist the api_key to ~/.arcanon/config.json with 0600 perms.
 * Creates the directory if missing.
 *
 * @param {string} apiKey — must start with arc_
 * @param {{ hubUrl?: string }} [opts]
 * @returns {string} path to the config file written
 */
/**
 * Non-throwing credential presence check.
 * True iff resolveCredentials() would succeed right now.
 *
 * Used by the scan manager's auto-upload gate so that users who ran
 * /arcanon:login but never set ARCANON_API_KEY still get auto-uploads.
 *
 * @returns {boolean}
 */
export function hasCredentials() {
  try {
    resolveCredentials();
    return true;
  } catch {
    return false;
  }
}

export function storeCredentials(apiKey, opts = {}) {
  if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
    throw new AuthError(`api_key must start with "${API_KEY_PREFIX}"`);
  }
  const dir = path.join(os.homedir(), ".arcanon");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "config.json");
  const existing = readJsonSafe(file) || {};
  const next = { ...existing, api_key: apiKey };
  if (opts.hubUrl) next.hub_url = opts.hubUrl;
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Non-POSIX FS (e.g. Windows) — ignore.
  }
  return file;
}
