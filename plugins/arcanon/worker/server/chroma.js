/**
 * worker/chroma-sync.js — ChromaDB async sync module for Arcanon v2.0
 *
 * Provides optional ChromaDB vector search as a non-blocking enhancement
 * over the SQLite/FTS5 search stack. A ChromaDB outage never prevents
 * SQLite persistence — all sync is fire-and-forget.
 *
 * Exports:
 *   initChromaSync(settings, [mockClient]) — initialize and health-check
 *   syncFindings(findings, [enrichment], [context]) — async upsert, fire-and-forget safe
 *   syncFindingsToChroma(projectHash, repoId, findings, enrichment) — delete-then-upsert wrapper
 *   chromaSearch(query, limit, [options]) — semantic search, throws when unavailable
 *   deleteRepoRecords(projectHash, repoId) — delete all records for a project/repo
 *   isChromaAvailable()                   — returns current availability flag
 *   _resetForTest()                       — reset module state (tests only)
 *
 * Namespacing (INTG-03):
 *   Every Chroma record id is prefixed with {projectHash}:r{repoId}: so that
 *   identical service names across different projects never collide. Records
 *   also carry project_id and repo_id metadata fields for where-filter scoping.
 *
 *   projectHash = 12-char SHA256 prefix of the project DB directory path.
 *   When unavailable (in-memory DB or missing name), defaults to "unknown".
 *
 * Verified chromadb v3 where/delete filter syntax (Assumption A1 resolved):
 *   Single-field: { project_id: { $eq: projectHash } }
 *   Compound ($and): { $and: [{ project_id: { $eq: ph } }, { repo_id: { $eq: rid } }] }
 *   Both query() and delete() accept where?: Where with the same JSON shape.
 *
 * Key constraints:
 *   - ChromaClient constructor NEVER throws (chromadb v3) — errors surface on heartbeat()
 *   - syncFindings never rejects — callers use .catch() for logging only
 *   - chromaSearch throws when unavailable — caller triggers fallback to FTS5
 *   - chromaAvailable is set once at startup via heartbeat(), not per-query
 */

import { ChromaClient } from "chromadb";

const COLLECTION_NAME = "arcanon-impact";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {boolean} */
let _chromaAvailable = false;

/** @type {any | null} ChromaDB collection handle */
let _collection = null;

/** @type {object | null} Injected logger instance */
let _logger = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current ChromaDB availability flag.
 * Set once at startup via initChromaSync().
 *
 * @returns {boolean}
 */
export function isChromaAvailable() {
  return _chromaAvailable;
}

/**
 * Initialize ChromaDB connection and set availability flag.
 *
 * If ARCANON_CHROMA_MODE is empty/falsy, returns false immediately
 * without attempting any network connection.
 *
 * @param {object} settings - Settings object from worker config loader
 * @param {string} [settings.ARCANON_CHROMA_MODE] - 'local' or empty string
 * @param {string} [settings.ARCANON_CHROMA_HOST] - ChromaDB host (default: localhost)
 * @param {string} [settings.ARCANON_CHROMA_PORT] - ChromaDB port (default: 8000)
 * @param {string} [settings.ARCANON_CHROMA_SSL]  - 'true' to use HTTPS
 * @param {object} [mockClient] - Optional mock ChromaClient (for testing)
 * @returns {Promise<boolean>} true if ChromaDB is reachable and initialized
 */
export async function initChromaSync(settings = {}, mockClient = null, logger = null) {
  _logger = logger;
  // Guard: no ChromaDB configured → skip immediately, no connection attempt
  if (!settings.ARCANON_CHROMA_MODE) {
    _chromaAvailable = false;
    return false;
  }

  try {
    let client;
    if (mockClient) {
      client = mockClient;
    } else {
      const host = settings.ARCANON_CHROMA_HOST || "localhost";
      const port = parseInt(settings.ARCANON_CHROMA_PORT || "8000", 10);
      const ssl = settings.ARCANON_CHROMA_SSL === "true";
      const apiKey = settings.ARCANON_CHROMA_API_KEY || "";
      const tenant = settings.ARCANON_CHROMA_TENANT || "default_tenant";
      const database = settings.ARCANON_CHROMA_DATABASE || "default_database";

      const clientOpts = { host, port, ssl, tenant, database };
      if (apiKey) {
        clientOpts.headers = { Authorization: `Bearer ${apiKey}` };
      }

      // ChromaClient constructor never throws (chromadb v3) — errors surface on heartbeat()
      client = new ChromaClient(clientOpts);
    }

    // Probe connectivity — this is where connection errors surface
    await client.heartbeat();

    // Get or create the impact collection
    _collection = await client.getOrCreateCollection({ name: COLLECTION_NAME });
    _chromaAvailable = true;
    return true;
  } catch (err) {
    if (_logger) {
      _logger.error('chroma init failed', { error: err.message, stack: err.stack });
    } else {
      process.stderr.write('[chroma] init failed: ' + err.message + '\n');
    }
    _chromaAvailable = false;
    _collection = null;
    return false;
  }
}

/**
 * Async upsert findings to the ChromaDB collection.
 * Fire-and-forget safe — never rejects. Callers use .catch() for logging only.
 *
 * IDs are project+repo namespaced (INTG-03):
 *   service:  {projectHash}:r{repoId}:svc:{name}
 *   endpoint: {projectHash}:r{repoId}:ep:{svcName}:{epPath}
 *
 * @param {{ services: Array<{ name: string, endpoints?: Array<{ path: string }> }> }} findings
 * @param {{ boundaryMap?: Map<string,string>, actorMap?: Map<string,string[]> }} [enrichment]
 *   Optional enrichment context.
 * @param {{ projectHash?: string, repoId?: string|number }} [context]
 *   Optional project/repo context for namespacing. Defaults to "unknown" when absent.
 * @returns {Promise<void>}
 */
export async function syncFindings(findings, enrichment = {}, context = {}) {
  // Guard: skip silently when ChromaDB is not available
  if (!_chromaAvailable || !_collection) {
    return;
  }

  const boundaryMap = enrichment.boundaryMap || new Map();
  const actorMap = enrichment.actorMap || new Map();
  const projectHash = (context && context.projectHash) || "unknown";
  const repoId = (context && context.repoId !== undefined && context.repoId !== null)
    ? String(context.repoId)
    : "unknown";

  try {
    const services = findings.services || [];
    const ids = [];
    const documents = [];
    const metadatas = [];

    for (const svc of services) {
      // Project+repo namespaced service id (INTG-03)
      const svcId = `${projectHash}:r${repoId}:svc:${svc.name}`;
      ids.push(svcId);
      documents.push(svc.name);
      metadatas.push({
        type: "service",
        name: svc.name,
        boundary: boundaryMap.get(svc.name) || "",
        actors: (actorMap.get(svc.name) || []).join(","),
        project_id: projectHash,
        repo_id: repoId,
      });

      // Add each endpoint path as a separate document (no boundary/actor context)
      for (const endpoint of svc.endpoints || []) {
        const epId = `${projectHash}:r${repoId}:ep:${svc.name}:${endpoint.path}`;
        ids.push(epId);
        documents.push(`${svc.name} ${endpoint.path}`);
        metadatas.push({
          type: "endpoint",
          service: svc.name,
          path: endpoint.path,
          project_id: projectHash,
          repo_id: repoId,
        });
      }
    }

    if (ids.length > 0) {
      await _collection.upsert({ ids, documents, metadatas });
    }
  } catch (err) {
    // Log but never rethrow — fire-and-forget contract
    if (_logger) {
      _logger.error('chroma syncFindings error', { error: err.message, stack: err.stack });
    } else {
      process.stderr.write('[chroma] syncFindings error: ' + err.message + '\n');
    }
  }
}

/**
 * Semantic search against the ChromaDB collection.
 * Throws when ChromaDB is unavailable so the caller can trigger fallback.
 *
 * Verified chromadb v3 where filter shape: { project_id: { $eq: projectHash } }
 *
 * @param {string} query - Search query text
 * @param {number} limit - Maximum number of results to return
 * @param {{ where?: object }} [options] - Optional where clause for project scoping
 * @returns {Promise<Array<{ id: string, document: string, score: number, metadata: object }>>}
 * @throws {Error} 'ChromaDB not available' when isChromaAvailable() is false
 */
export async function chromaSearch(query, limit, options = {}) {
  // Intentionally throws — caller (query-engine.js) uses this to trigger FTS5 fallback
  if (!_chromaAvailable || !_collection) {
    throw new Error("ChromaDB not available");
  }

  const queryArgs = {
    queryTexts: [query],
    nResults: limit,
  };
  // Forward where clause when provided (INTG-03 project scoping)
  if (options && options.where) {
    queryArgs.where = options.where;
  }

  const response = await _collection.query(queryArgs);

  // Normalize chromadb v3 response shape to flat array
  const ids = response.ids[0] || [];
  const docs = response.documents[0] || [];
  const distances = response.distances[0] || [];
  const metas = response.metadatas[0] || [];

  return ids.map((id, i) => ({
    id,
    document: docs[i] || "",
    score: distances[i] ?? 0,
    metadata: metas[i] || {},
  }));
}

/**
 * Delete all Chroma records for a project+repo pair.
 * Used before syncFindings to ensure removed services/endpoints disappear.
 *
 * Verified chromadb v3 delete filter syntax (Assumption A1 resolved):
 *   where: { $and: [{ project_id: { $eq: ph } }, { repo_id: { $eq: rid } }] }
 * Both query() and delete() accept the same Where JSON shape.
 *
 * Silent no-op when Chroma is unavailable (consistent with syncFindings).
 *
 * @param {string} projectHash - 12-char SHA256 project identifier
 * @param {string|number} repoId - Repo row id (stringified for metadata)
 * @returns {Promise<void>}
 */
export async function deleteRepoRecords(projectHash, repoId) {
  if (!_chromaAvailable || !_collection) return;
  try {
    await _collection.delete({
      where: {
        $and: [
          { project_id: { $eq: projectHash } },
          { repo_id: { $eq: String(repoId) } },
        ],
      },
    });
  } catch (err) {
    // Log but never rethrow — delete is best-effort
    if (_logger) {
      _logger.error('chroma deleteRepoRecords error', { error: err.message });
    } else {
      process.stderr.write('[chroma] deleteRepoRecords error: ' + err.message + '\n');
    }
  }
}

/**
 * Delete-then-upsert wrapper: atomically replaces all Chroma records for a
 * project+repo pair. Runs ONCE per repo per scan in manager.js Phase B.
 *
 * Guards:
 *   - Returns immediately if isChromaAvailable() is false (scan continues)
 *   - Wraps delete + sync in try/catch so errors never propagate to the scan path
 *
 * @param {string} projectHash
 * @param {string|number} repoId
 * @param {{ services: Array }} findings
 * @param {{ boundaryMap?: Map, actorMap?: Map }} [enrichment]
 * @returns {Promise<void>}
 */
export async function syncFindingsToChroma(projectHash, repoId, findings, enrichment = {}) {
  if (!isChromaAvailable()) return;
  try {
    await deleteRepoRecords(projectHash, repoId);
    await syncFindings(findings, enrichment, { projectHash, repoId });
  } catch (err) {
    if (_logger) {
      _logger.error('chroma syncFindingsToChroma error', { error: err.message });
    } else {
      process.stderr.write('[chroma] syncFindingsToChroma error: ' + err.message + '\n');
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers (not exported in production use — only for unit tests)
// ---------------------------------------------------------------------------

/**
 * Reset all module state. Used by tests to isolate each test case.
 * NOT for production use.
 */
export function _resetForTest() {
  _chromaAvailable = false;
  _collection = null;
  _logger = null;
}
