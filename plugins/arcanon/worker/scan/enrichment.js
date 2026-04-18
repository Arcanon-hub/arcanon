/**
 * worker/scan/enrichment.js — Enrichment pass framework for post-scan metadata.
 *
 * ENRICH-01: runEnrichmentPass runs all registered enrichers after core scan.
 * ENRICH-02: Each enricher writes to node_metadata with a distinct view key.
 * ENRICH-03: Enricher failures are caught, logged as warn, and skipped — never abort scan.
 */

/** @type {Array<{ name: string, fn: Function }>} */
const enrichers = [];

/**
 * Register an enricher function.
 * @param {string} name - Enricher name (used in error logging)
 * @param {(ctx: EnricherCtx) => Promise<Record<string, string|null>>} fn
 */
export function registerEnricher(name, fn) {
  enrichers.push({ name, fn });
}

/** Clear all registered enrichers — for test isolation only. */
export function clearEnrichers() {
  enrichers.length = 0;
}

/**
 * Run all registered enrichers for a single service.
 * Each enricher receives ctx and returns key->value pairs written to node_metadata.
 * Failures are caught and logged — never propagated.
 *
 * @param {{ id: number, root_path: string, language: string|null, boundary_entry: string|null }} service
 * @param {import('better-sqlite3').Database} db
 * @param {{ warn?: Function, info?: Function, debug?: Function } | null} logger
 * @param {string|null} [repoAbsPath] - Absolute path to repo root (SBUG-03: for file system probing in enrichers)
 */
export async function runEnrichmentPass(service, db, logger, repoAbsPath) {
  const ctx = {
    serviceId: service.id,
    repoPath: service.root_path,
    repoAbsPath: repoAbsPath ?? null,  // SBUG-03: absolute repo root for file system probing
    language: service.language ?? null,
    entryFile: service.boundary_entry ?? null,
    db,
    logger,
  };

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO node_metadata (service_id, view, key, value, source, updated_at)
     VALUES (?, 'enrichment', ?, ?, 'enricher', datetime('now'))`
  );

  for (const { name, fn } of enrichers) {
    try {
      const result = await fn(ctx);
      if (result && typeof result === 'object') {
        for (const [key, value] of Object.entries(result)) {
          stmt.run(service.id, key, value);
        }
      }
    } catch (err) {
      logger?.warn?.(`Enricher ${name} failed: ${err.message}`);
    }
  }
}
