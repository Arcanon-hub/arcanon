/**
 * worker/scan/enrichment/externals-catalog.js — Phase 121 / INT-06.
 *
 * Loads the shipped externals catalog (data/known-externals.yaml) and exposes
 * a pure matchActor(actorName, catalog) function used by the per-repo actor
 * labeling pass.
 *
 * Loader contract:
 *   loadShippedCatalog(explicitPath?, logger?) -> NormalizedCatalog
 *     - Returns { entries: Map<slug, { label, hosts[], ports[] }> }
 *     - Module-cached by absolute path; restart worker to pick up file changes.
 *     - Tolerates missing file, malformed YAML, malformed entries — logs WARN
 *       and returns the best-effort result; never throws.
 *
 * Match contract:
 *   matchActor(actorName, catalog) -> string | null
 *     - Pure function; no I/O. Returns the friendly label of the first
 *       matching catalog entry, or null when nothing matches / input invalid.
 *
 * Catalog shape adaptation:
 *   The shipped Phase 120 file uses top-level `externals:` (a list with each
 *   entry carrying a `name` field). The plan-assumed shape was top-level
 *   `entries:` (a map keyed by slug, OR a list with `id` field). The
 *   normalizer accepts BOTH top-level keys and BOTH shapes — the loader is
 *   the single point of adaptation per the plan's <assumptions_about_phase_120>.
 *
 * Wildcard semantics:
 *   `*.foo.com`        — one or more leading subdomain labels (a.foo.com, a.b.foo.com)
 *                        but NOT the bare `foo.com`.
 *   `lambda.*.amazonaws.com` — middle `*` matches one DNS label
 *                              (lambda.us-east-1.amazonaws.com).
 *   `s3.*.amazonaws.com`     — same.
 *   Each `*` matches one or more DNS labels at its position; matching is
 *   case-insensitive. The leading-`*.` form additionally requires at least
 *   one preceding label (excludes the bare suffix).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { resolveConfigPath } from '../../lib/config-path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Module-level cache keyed by absolute file path. Cleared via _clearCatalogCache.
const _cache = new Map();

/**
 * Resolve the default shipped path. The catalog lives at
 *   plugins/arcanon/data/known-externals.yaml
 * This module sits at
 *   plugins/arcanon/worker/scan/enrichment/externals-catalog.js
 * so the relative offset is `../../../data/known-externals.yaml`.
 */
function defaultShippedPath() {
  return path.resolve(__dirname, '..', '..', '..', 'data', 'known-externals.yaml');
}

/**
 * @typedef {{ label: string, hosts: string[], ports: number[] }} CatalogEntry
 * @typedef {{ entries: Map<string, CatalogEntry> }} NormalizedCatalog
 */

/**
 * Load and normalize the shipped catalog. Idempotent and cached per-path.
 *
 * @param {string} [explicitPath] - Override (test-only). Defaults to the
 *   plugin-relative `data/known-externals.yaml`.
 * @param {{ warn?: Function } | null} [logger]
 * @returns {NormalizedCatalog}
 */
export function loadShippedCatalog(explicitPath, logger = null) {
  const absPath = path.resolve(explicitPath || defaultShippedPath());
  if (_cache.has(absPath)) return _cache.get(absPath);

  if (!fs.existsSync(absPath)) {
    logger?.warn?.(
      `externals-catalog: file not found at ${absPath} — no labels will be assigned`,
    );
    const empty = { entries: new Map() };
    _cache.set(absPath, empty);
    return empty;
  }

  let raw;
  try {
    const text = fs.readFileSync(absPath, 'utf8');
    raw = yaml.load(text);
  } catch (err) {
    logger?.warn?.(`externals-catalog: parse error at ${absPath}: ${err.message}`);
    const empty = { entries: new Map() };
    _cache.set(absPath, empty);
    return empty;
  }

  const normalized = normalizeCatalog(raw, logger);
  _cache.set(absPath, normalized);
  return normalized;
}

/**
 * Test-only — clear the module cache so successive loads in tests see fresh
 * file contents.
 */
export function _clearCatalogCache() {
  _cache.clear();
}

/**
 * Normalize a parsed YAML root to NormalizedCatalog.
 * Accepts both `entries:` and `externals:` top-level keys, and both map and
 * list forms (list items may carry `id` or `name`).
 *
 * @param {unknown} raw
 * @param {{ warn?: Function } | null} logger
 * @returns {NormalizedCatalog}
 */
function normalizeCatalog(raw, logger) {
  const entries = new Map();
  if (!raw || typeof raw !== 'object') return { entries };

  // Phase 120 ships `externals:`; the plan assumed `entries:`. Accept both.
  const rawEntries = raw.entries ?? raw.externals;
  if (!rawEntries) return { entries };

  let pairs;
  if (Array.isArray(rawEntries)) {
    pairs = rawEntries
      .filter((e) => e && typeof e === 'object')
      .map((e) => {
        const slug = typeof e.id === 'string' ? e.id : typeof e.name === 'string' ? e.name : null;
        return [slug, e];
      })
      .filter(([slug]) => typeof slug === 'string' && slug.length > 0);
  } else if (typeof rawEntries === 'object') {
    pairs = Object.entries(rawEntries);
  } else {
    return { entries };
  }

  for (const [slug, entry] of pairs) {
    if (!entry || typeof entry !== 'object') {
      logger?.warn?.(`externals-catalog: skipping non-object entry "${slug}"`);
      continue;
    }
    const label = entry.label;
    if (typeof label !== 'string' || label.trim() === '') {
      logger?.warn?.(`externals-catalog: skipping entry "${slug}" — missing or empty label`);
      continue;
    }
    const hosts = Array.isArray(entry.hosts)
      ? entry.hosts.filter((h) => typeof h === 'string' && h.length > 0)
      : [];
    const ports = Array.isArray(entry.ports)
      ? entry.ports.filter((p) => Number.isInteger(p) && p > 0 && p <= 65535)
      : [];
    if (hosts.length === 0 && ports.length === 0) {
      logger?.warn?.(`externals-catalog: skipping entry "${slug}" — no hosts or ports`);
      continue;
    }
    entries.set(slug, { label: label.trim(), hosts, ports });
  }

  return { entries };
}

/**
 * Match an actor name against catalog entries. First matching entry wins.
 * Pure function — no I/O. Safe on any input type.
 *
 * @param {unknown} actorName - Raw actor.name from the actors table.
 * @param {NormalizedCatalog} catalog
 * @returns {string | null} The matched label, or null.
 */
export function matchActor(actorName, catalog) {
  if (typeof actorName !== 'string' || actorName.length === 0) return null;
  if (!catalog || !(catalog.entries instanceof Map) || catalog.entries.size === 0) return null;

  // 1. Extract hostname
  let hostname = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(actorName)) {
    try {
      hostname = new URL(actorName).hostname.toLowerCase();
    } catch {
      // Malformed URL — fall back to bare-name parsing below
    }
  }
  if (hostname === null) {
    // Bare hostname or hostname:port[/path] — strip path then port
    const noPath = actorName.split('/')[0];
    const noPort = noPath.split(':')[0];
    if (noPort.length > 0) hostname = noPort.toLowerCase();
  }

  if (hostname) {
    for (const entry of catalog.entries.values()) {
      for (const pattern of entry.hosts) {
        if (matchHost(hostname, pattern)) return entry.label;
      }
    }
  }

  // 2. Port match (looks for `:NNNN` or `:NNNN/...` or `:NNNN` at end)
  const portMatch = actorName.match(/:(\d{1,5})(?:\/|$)/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (Number.isFinite(port) && port > 0 && port <= 65535) {
      for (const entry of catalog.entries.values()) {
        if (entry.ports.includes(port)) return entry.label;
      }
    }
  }

  return null;
}

/**
 * Match a hostname against a glob pattern. `*` matches one DNS label (one or
 * more characters that are NOT a dot). The leading `*.` form additionally
 * forbids matching the bare suffix.
 *
 * Examples:
 *   matchHost('a.foo.com',     '*.foo.com')           -> true
 *   matchHost('a.b.foo.com',   '*.foo.com')           -> true
 *   matchHost('foo.com',       '*.foo.com')           -> false  (bare excluded)
 *   matchHost('foo.com',       'foo.com')             -> true   (exact)
 *   matchHost('lambda.us-east-1.amazonaws.com',
 *             'lambda.*.amazonaws.com')               -> true
 *
 * @param {string} hostname - Lowercase hostname.
 * @param {string} pattern  - Glob pattern from catalog.entries[*].hosts.
 * @returns {boolean}
 */
function matchHost(hostname, pattern) {
  const p = pattern.toLowerCase();
  if (!p.includes('*')) return hostname === p;

  // Token-by-token translation:
  //   - Leading `*.` -> `[^.]+(?:\.[^.]+)*\.`  (one OR MORE leading DNS labels;
  //     plan test 2.9 expects both `a.foo.com` and `a.b.foo.com` to match
  //     `*.foo.com`, but bare `foo.com` must NOT match).
  //   - Any other `*` -> `[^.]+`               (exactly one DNS label, e.g.
  //     `lambda.*.amazonaws.com` matches `lambda.us-east-1.amazonaws.com`).
  // Every other regex meta-char is escaped.
  let body;
  if (p.startsWith('*.')) {
    const tail = p.slice(2); // pattern after the leading `*.`
    const tailRe = tail
      .split('*')
      .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^.]+');
    body = '[^.]+(?:\\.[^.]+)*\\.' + tailRe;
  } else {
    body = p
      .split('*')
      .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^.]+');
  }
  return new RegExp('^' + body + '$').test(hostname);
}

// ---------------------------------------------------------------------------
// Phase 121 / INT-07 — User extension via arcanon.config.json#external_labels
// ---------------------------------------------------------------------------

/**
 * Load user-defined external_labels from $projectRoot/arcanon.config.json.
 *
 * Returns an empty NormalizedCatalog when:
 *   - the config file does not exist
 *   - the file exists but is invalid JSON (logs WARN; never throws)
 *   - the file exists but has no `external_labels` key
 *
 * Valid entries are normalized via the same `normalizeCatalog` pipeline used
 * for the shipped YAML — so user entries get the same shape, the same label
 * validation, and the same hosts/ports type-checks. Malformed entries are
 * skipped with a WARN log; valid entries still load.
 *
 * @param {string} projectRoot
 * @param {{ warn?: Function } | null} [logger]
 * @returns {NormalizedCatalog}
 */
export function loadUserExtensions(projectRoot, logger = null) {
  const configPath = resolveConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) return { entries: new Map() };

  let cfg;
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    cfg = JSON.parse(text);
  } catch (err) {
    logger?.warn?.(
      `externals-catalog: arcanon.config.json parse error: ${err.message}`,
    );
    return { entries: new Map() };
  }

  const externalLabels =
    cfg && typeof cfg === 'object' ? cfg.external_labels : null;
  if (!externalLabels || typeof externalLabels !== 'object') {
    return { entries: new Map() };
  }

  // Reuse normalizeCatalog by wrapping the user map under the `entries` key
  // (the normalizer accepts both `entries` and `externals` top-level keys).
  return normalizeCatalog({ entries: externalLabels }, logger);
}

/**
 * Load the shipped catalog and merge user external_labels on top.
 * User keys override shipped keys on collision. The shipped YAML file is
 * NEVER mutated — the merge is in-memory only (Map.set on a fresh Map).
 *
 * @param {string} projectRoot
 * @param {{ warn?: Function } | null} [logger]
 * @returns {NormalizedCatalog}
 */
export function loadMergedCatalog(projectRoot, logger = null) {
  const shipped = loadShippedCatalog(undefined, logger);
  const user = loadUserExtensions(projectRoot, logger);

  // Build a fresh Map so we never touch the cached shipped Map.
  const merged = new Map(shipped.entries);
  for (const [slug, entry] of user.entries) {
    merged.set(slug, entry); // user wins on collision
  }
  return { entries: merged };
}
