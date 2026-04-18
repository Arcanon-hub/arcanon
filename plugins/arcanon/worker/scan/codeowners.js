/**
 * worker/scan/codeowners.js — CODEOWNERS file parser and enricher.
 *
 * OWN-01: CODEOWNERS parsed and team ownership stored in node_metadata.
 *
 * Implements:
 *   parseCODEOWNERS(repoPath) — locate and parse CODEOWNERS file into entries
 *   findOwners(entries, filePath) — last-match-wins lookup
 *   createCodeownersEnricher() — factory for the enrichment-pass enricher function
 *
 * picomatch is imported via createRequire — it ships CJS only (no ESM export).
 * Locked decision: import { createRequire } from 'node:module' pattern (STATE.md).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const picomatch = require('picomatch');

// CODEOWNERS probe order per GitHub spec
const PROBE_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

/**
 * @typedef {{ pattern: string, owners: string[] }} CODEOWNERSEntry
 */

/**
 * Locate and parse CODEOWNERS file in a repo.
 * Probes .github/CODEOWNERS -> CODEOWNERS -> docs/CODEOWNERS.
 *
 * @param {string} repoPath - Absolute path to repo root
 * @returns {CODEOWNERSEntry[]}
 */
export function parseCODEOWNERS(repoPath) {
  for (const probe of PROBE_PATHS) {
    const fullPath = join(repoPath, probe);
    if (existsSync(fullPath)) {
      const lines = readFileSync(fullPath, 'utf8').split('\n');
      const entries = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue; // pattern with no owners — skip
        entries.push({ pattern: parts[0], owners: parts.slice(1) });
      }
      return entries;
    }
  }
  return [];
}

/**
 * Check if a file path matches a CODEOWNERS pattern using picomatch.
 *
 * Pattern rules:
 *   - No '/' in pattern -> matchBase:true (matches in any directory)
 *   - Starts with '/' -> anchored to repo root (strip leading slash)
 *   - Trailing '/' -> treat as directory glob (append '**')
 *
 * @param {string} filePath - Relative path to match (e.g. "src/api/index.js")
 * @param {string} pattern - Raw CODEOWNERS pattern
 * @returns {boolean}
 */
function matchesPattern(filePath, pattern) {
  let normalized = pattern;
  let opts = { dot: true };

  // Trailing slash -> match directory contents
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1) + '/**';
  }

  if (normalized.startsWith('/')) {
    // Anchored to repo root — strip the leading slash
    normalized = normalized.slice(1);
    opts.matchBase = false;
  } else if (!normalized.includes('/')) {
    // No directory separator — match in any directory
    opts.matchBase = true;
  }

  return picomatch(normalized, opts)(filePath);
}

/**
 * Find owners for a file path using last-match-wins semantics.
 *
 * @param {CODEOWNERSEntry[]} entries
 * @param {string} filePath - Relative path (e.g. service root_path relative to repo)
 * @returns {string[]} Array of owner strings (e.g. ["@org/team"]), empty if no match
 */
export function findOwners(entries, filePath) {
  // Iterate in reverse — last match wins per GitHub spec
  for (let i = entries.length - 1; i >= 0; i--) {
    if (matchesPattern(filePath, entries[i].pattern)) {
      return entries[i].owners;
    }
  }
  return [];
}

/**
 * Create the CODEOWNERS enricher function for registration with enrichment.js.
 *
 * The enricher uses ctx.repoPath as the repo root to locate CODEOWNERS,
 * then matches ctx.repoPath against entries to find the owning team.
 *
 * Writes:
 *   - view='ownership', key='owners', value=JSON.stringify(owners) — primary ownership data
 *   - Returns { owner: owners[0] | null } to the enrichment runner (written under view='enrichment')
 *
 * @returns {(ctx: import('./enrichment.js').EnricherCtx) => Promise<Record<string, string|null>>}
 */
export function createCodeownersEnricher() {
  return async function codeownersEnricher(ctx) {
    // SBUG-03: use repoAbsPath for file system probe (absolute repo root for .github/CODEOWNERS)
    // Fall back to ctx.repoPath for backward compatibility with test contexts that lack repoAbsPath.
    const entries = parseCODEOWNERS(ctx.repoAbsPath ?? ctx.repoPath);
    if (entries.length === 0) return {};

    // SBUG-03: use ctx.repoPath (relative service root_path) for pattern matching
    const owners = findOwners(entries, ctx.repoPath);
    const owner = owners.length > 0 ? owners[0] : null;

    // Write ownership view directly with correct view key (ENRICH-02: distinct view)
    ctx.db.prepare(
      `INSERT OR REPLACE INTO node_metadata (service_id, view, key, value, source, updated_at)
       VALUES (?, 'ownership', ?, ?, 'codeowners', datetime('now'))`
    ).run(ctx.serviceId, 'owners', JSON.stringify(owners));

    // Return the denormalized single-owner for the enrichment.js runner to write
    // under view='enrichment', key='owner'
    return { owner };
  };
}
