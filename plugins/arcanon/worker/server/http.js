import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "url";
import { listProjects, getQueryEngineByHash, closeAll as closeAllDbHandles } from "../db/pool.js";
import { resolveConfigPath } from "../lib/config-path.js";
import { getCommitsSince } from "../scan/git-state.js";
import { extractEvidenceLocation } from "../hub-sync/evidence-location.js";
import { maskHomeDeep } from "../lib/path-mask.js";
import { validateFindings } from "../scan/contract.js";
import { persistScanResult } from "../scan/scan-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compute the verify verdict for a single connection .
 *
 * Pure function — no side effects, no DB access, no network. Reads the
 * cited source_file from disk and inspects the literal `evidence` snippet.
 *
 * @param {object} conn - Row with { connection_id, source_file, method, path, evidence }
 * @param {string} projectRoot - Absolute path to the project root (used to
 *                               resolve relative source_file paths)
 * @returns {{
 *   connection_id: number,
 *   verdict: 'ok'|'moved'|'missing'|'method_mismatch',
 *   source_file: string|null,
 *   line_start: number|null,
 *   line_end: number|null,
 *   evidence_present: boolean,
 *   snippet: string|null,
 *   message: string|null,
 *   method: string|null
 * }}
 */
function computeVerdict(conn, projectRoot) {
  const base = {
    connection_id: conn.connection_id,
    source_file: conn.source_file || null,
    line_start: null,
    line_end: null,
    evidence_present: false,
    snippet: null,
    message: null,
    method: conn.method || null,
  };

  // 1. Missing source_file column → treat as moved (cannot verify).
  if (!conn.source_file) {
    return {
      ...base,
      verdict: "moved",
      message: "no source_file recorded on connection",
    };
  }

  const absPath = path.resolve(projectRoot, conn.source_file);

  // 2. File does not exist → moved.
  if (!fs.existsSync(absPath)) {
    return {
      ...base,
      verdict: "moved",
      message: "source_file not found at recorded path",
    };
  }

  // 3. File exists — read it. Permission errors are reported as moved
  //    (same user remedy: rescan / fix the path).
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    return {
      ...base,
      verdict: "moved",
      message: `cannot read source_file: ${err.message}`,
    };
  }

  // 4. No evidence recorded — pre-Phase-109 connection. Degraded but not
  //    a failure: verdict ok with evidence_present=false.
  const evidence =
    typeof conn.evidence === "string" ? conn.evidence.trim() : "";
  if (!evidence) {
    return {
      ...base,
      verdict: "ok",
      message: "no-evidence-recorded",
    };
  }

  // 5/6. Delegate hash + line-range derivation to the shared helper
  //      — single source of truth for evidence-line semantics. The helper
  //      does its own file-read; we accept the small redundancy (one extra
  //      readFileSync per verify call) in exchange for
  //      keeping the moved-vs-missing distinction the verify command needs:
  //      the helper conflates "file unreadable" and "snippet not in file"
  //      as evidence_present=false, so we keep the existsSync/readFileSync
  //      blocks above to surface the moved verdict separately.
  const loc = extractEvidenceLocation(evidence, conn.source_file, projectRoot);
  if (!loc.evidence_present) {
    return {
      ...base,
      verdict: "missing",
      message: "evidence snippet not found in file",
    };
  }
  const lineStart = loc.start_line;
  const lineEnd = loc.end_line;
  const truncatedSnippet =
    evidence.length > 80 ? evidence.slice(0, 80) + "…" : evidence;

  // 7. If method recorded, check it appears as a whole word in the snippet.
  if (conn.method && String(conn.method).trim().length > 0) {
    const methodEsc = String(conn.method).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const methodRe = new RegExp(`\\b${methodEsc}\\b`, "i");
    if (!methodRe.test(evidence)) {
      return {
        ...base,
        verdict: "method_mismatch",
        line_start: lineStart,
        line_end: lineEnd,
        evidence_present: true,
        snippet: truncatedSnippet,
        message: `method '${conn.method}' not found in evidence`,
      };
    }
  }

  return {
    ...base,
    verdict: "ok",
    line_start: lineStart,
    line_end: lineEnd,
    evidence_present: true,
    snippet: truncatedSnippet,
  };
}

/**
 * Create and start a Fastify HTTP server exposing the query engine over REST.
 *
 * The worker is project-agnostic. Each request includes a `?project=` query
 * parameter (absolute path to project root). The server resolves the correct
 * per-project DB via options.resolveQueryEngine(projectRoot).
 *
 * @param {object|null} queryEngine - Static query engine (for tests). Null in production.
 * @param {object} options - Server options
 * @param {number} [options.port=37888] - Port to bind (use 0 for inject-only testing)
 * @param {Function} [options.resolveQueryEngine] - (projectRoot) => QueryEngine|null
 * @returns {Promise<FastifyInstance>}
 */
async function createHttpServer(queryEngine, options = {}) {
  const fastify = Fastify({ logger: false });
  const resolve = options.resolveQueryEngine || (() => queryEngine);
  const log = options.logger || null;

  function httpLog(level, msg, extra = {}) {
    if (log) log.log(level, msg, { component: 'http', ...extra });
  }

  /**
   * Resolve query engine from request.
   * Checks ?project= query param, falls back to static queryEngine (tests).
   */
  function getQE(request) {
    const project = request.query?.project;
    if (project) return resolve(project);
    const hash = request.query?.hash;
    if (hash) return getQueryEngineByHash(hash);
    return queryEngine; // fallback for tests or when no project specified
  }

  // Register CORS for localhost dev
  await fastify.register(fastifyCors, {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ],
  });

  // Register static file serving from worker/ui/
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, "..", "ui"),
    prefix: "/",
    decorateReply: false,
  });

  // -----------------------------------------------------------------------
  // PERF-06: Per-route response-time logging + DB handle lifecycle hooks
  // -----------------------------------------------------------------------

  // Stamp request start time so onResponse can compute elapsed ms.
  // performance is a Node 16+ global (guaranteed on Node >=22.13).
  fastify.addHook('onRequest', (request, _reply, done) => {
    request._startMs = performance.now();
    done();
  });

  // Log every response through httpLog so slow routes are observable.
  // This is a no-op when no logger is configured (log === null).
  fastify.addHook('onResponse', (request, reply, done) => {
    const elapsed = request._startMs != null
      ? performance.now() - request._startMs
      : -1;
    httpLog('INFO', `${request.method} ${request.routeOptions?.url ?? request.url} ${reply.statusCode} ${elapsed.toFixed(1)}ms`, {
      route: request.routeOptions?.url ?? request.url,
      method: request.method,
      status: reply.statusCode,
      elapsed_ms: elapsed,
    });
    done();
  });

  // Belt-and-suspenders DB handle release on server teardown.
  // Primary signal path is SIGTERM/SIGINT in worker/index.js (143-03).
  fastify.addHook('onClose', async (_instance) => {
    closeAllDbHandles();
  });

  // -----------------------------------------------------------------------
  // Routes — readiness MUST be first
  // -----------------------------------------------------------------------

  // 1. GET /api/readiness — always 200
  fastify.get("/api/readiness", async (_request, reply) => {
    return reply.send({ status: "ok" });
  });

  // 1b. GET /api/version — returns running worker version (for auto-restart on update)
  fastify.get("/api/version", async (_request, reply) => {
    try {
      const pkgPath = path.join(__dirname, "..", "..", "package.json");
      const pkg = JSON.parse(
        (await import("fs")).default.readFileSync(pkgPath, "utf8"),
      );
      return reply.send({ version: pkg.version });
    } catch {
      return reply.send({ version: "unknown" });
    }
  });

  /**
   * 1c. GET /api/scan-quality — Latest scan's quality breakdown 
   *
   * Used by `/arcanon:status` (via worker/cli/hub.js cmdStatus) to surface the
   * "Latest scan: NN% high-confidence (S services, C connections)" line. The
   * /arcanon:map command does NOT use this endpoint — it calls
   * QueryEngine.getScanQualityBreakdown() directly via the inline-Node DB
   * handle in commands/map.md Step 5.
   *
   * Status codes (locked in CONTEXT ):
   *   200 — body matches the documented shape (see schema below)
   *   503 — { error: "no_scan_data" } when the resolver returned a QE but no
   *         scan_versions row has a non-null completed_at
   *   404 — { error: "project_not_found" } when the caller passed ?project=
   *         and resolveQueryEngine returned null
   *
   * Response 200 shape:
   *   {
   *     scan_version_id: number,
   *     completed_at: string,
   *     quality_score: number | null,
   *     total_connections: number,
   *     high_confidence: number,
   *     low_confidence: number,
   *     null_confidence: number,
   *     prose_evidence_warnings: number,   // 0 today ( placeholder)
   *     service_count: number,
   *   }
   *
   * Query params:
   *   project=<absolute-root>   optional — selects the per-project DB. When
   *                              omitted, falls back to the static queryEngine
   *                              (test-only path).
   */
  fastify.get("/api/scan-quality", async (request, reply) => {
    const project = request.query?.project;
    const qe = getQE(request);
    if (!qe) {
      // Distinguish 404 (caller asked for a specific project that does not
      // resolve) from 503 (no project arg AND no static QE — server has no
      // data). The /api/scan-quality contract maps these to project_not_found
      // and no_scan_data respectively.
      if (project) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      return reply.code(503).send({ error: "no_scan_data" });
    }
    try {
      const latest = qe._db
        .prepare(
          `SELECT id FROM scan_versions
            WHERE completed_at IS NOT NULL
            ORDER BY completed_at DESC, id DESC
            LIMIT 1`,
        )
        .get();
      if (!latest) {
        return reply.code(503).send({ error: "no_scan_data" });
      }
      const breakdown = qe.getScanQualityBreakdown(latest.id);
      if (!breakdown) {
        // Pre-migration-015 db (column absent) — treat as no_scan_data so the
        // status line degrades cleanly without leaking schema details.
        return reply.code(503).send({ error: "no_scan_data" });
      }
      return reply.send({
        scan_version_id: breakdown.scan_version_id,
        completed_at: breakdown.completed_at,
        quality_score: breakdown.quality_score,
        total_connections: breakdown.total,
        high_confidence: breakdown.high,
        low_confidence: breakdown.low,
        null_confidence: breakdown.null_count,
        prose_evidence_warnings: breakdown.prose_evidence_warnings,
        service_count: breakdown.service_count,
      });
    } catch (err) {
      httpLog("ERROR", err.message, {
        route: "/api/scan-quality",
        stack: err.stack,
      });
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * 1d. GET /api/scan-freshness — Latest scan freshness signal .
   *
   * Strict superset of /api/scan-quality. Used by /arcanon:status to surface
   *   "Latest scan: <date> (NN% high-confidence)"
   *   "N repos have new commits since last scan: <name> (M new), ..."
   *
   * The /api/scan-quality route stays unchanged for back-compat (v0.1.3 → v0.1.4
   * audit pre-flight constraint).
   *
   * Status codes:
   *   200 — body matches the documented shape
   *   404 — { error: "project_not_found" } when ?project= is set but resolver returned null
   *   503 — { error: "no_scan_data" } when no completed scan exists
   *   500 — { error: <message> } on uncaught exception
   *
   * Response 200 shape :
   *   {
   *     last_scan_iso: string,            // ISO-8601 UTC of MAX(completed_at)
   *     last_scan_age_seconds: number,    // (Date.now() - parse(last_scan_iso)) / 1000
   *     scan_quality_pct: number | null,  // round(quality_score * 100); null if no quality data
   *     repos: Array<{
   *       name: string,
   *       path: string,
   *       last_scanned_sha: string | null,
   *       new_commits: number | null,     // null when can't be determined (see git-state.js)
   *     }>
   *   }
   */
  // PERF-06 (known synchronous route): performs synchronous SQLite reads + one
  // execFileSync("git rev-list --count") per repo. getCommitsSince has a 30s TTL
  // cache (143-05) so repeated UI polls do not spawn one subprocess per repo.
  // Latency budget: <100ms for ≤10 repos when cached; <500ms on first call.
  // Async offload explicitly deferred (node:sqlite DatabaseSync is sync by design).
  fastify.get("/api/scan-freshness", async (request, reply) => {
    const project = request.query?.project;
    const qe = getQE(request);
    if (!qe) {
      if (project) return reply.code(404).send({ error: "project_not_found" });
      return reply.code(503).send({ error: "no_scan_data" });
    }
    try {
      const latest = qe._db
        .prepare(
          `SELECT id, completed_at FROM scan_versions
            WHERE completed_at IS NOT NULL
            ORDER BY completed_at DESC, id DESC
            LIMIT 1`,
        )
        .get();
      if (!latest) {
        return reply.code(503).send({ error: "no_scan_data" });
      }
      const breakdown = qe.getScanQualityBreakdown(latest.id);
      const qualityPct = breakdown && breakdown.quality_score !== null && breakdown.quality_score !== undefined
        ? Math.round(breakdown.quality_score * 100)
        : null;

      // Compute age. completed_at is stored as 'YYYY-MM-DD HH:MM:SS' in UTC by
      // SQLite's datetime('now') — append 'Z' to make it ISO-8601 explicit.
      const completedIso = latest.completed_at.includes("T")
        ? latest.completed_at
        : latest.completed_at.replace(" ", "T") + "Z";
      const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(completedIso)) / 1000));

      // Per-repo: name, path, last_scanned_commit (from repo_state), new_commits via git.
      const repoRows = qe._db
        .prepare(
          `SELECT r.name AS name, r.path AS path, rs.last_scanned_commit AS sha
             FROM repos r
             LEFT JOIN repo_state rs ON rs.repo_id = r.id
             ORDER BY r.id ASC`,
        )
        .all();

      const repos = repoRows.map((row) => ({
        name: row.name,
        path: row.path,
        last_scanned_sha: row.sha || null,
        new_commits: getCommitsSince(row.path, row.sha),
      }));

      // mask absolute repo paths before egress (S2 mitigation —
      // repos[].path is the documented surface that S2 calls out).
      return reply.send(maskHomeDeep({
        last_scan_iso: completedIso,
        last_scan_age_seconds: ageSeconds,
        scan_quality_pct: qualityPct,
        repos,
      }));
    } catch (err) {
      httpLog("ERROR", err.message, {
        route: "/api/scan-freshness",
        stack: err.stack,
      });
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/verify — Read-only verification of cited evidence .
   *
   * Re-reads each cited source file and confirms the recorded evidence snippet
   * is still present. Returns a per-connection verdict so stale scan data is
   * detectable without running a full /arcanon:map.
   *
   * Verdicts (exhaustive — every connection gets exactly one):
   *   - ok              : file exists, evidence snippet present (and method
   *                       matches if recorded). Pre-Phase-109 connections with
   *                       no evidence are also returned as `ok` with
   *                       evidence_present=false and message="no-evidence-recorded".
   *   - moved           : file at recorded source_file does NOT exist on disk
   *                       (or cannot be read).
   *   - missing         : file exists but the literal evidence substring was
   *                       not found anywhere in the file.
   *   - method_mismatch : evidence found, but the recorded HTTP method does
   *                       not appear (whole-word, case-insensitive) in the
   *                       matched snippet.
   *
   * Read-only contract : NO INSERT/UPDATE/DELETE in this code path.
   * The connections, scan_versions, and enrichment_log tables are byte-
   * identical before and after a verify call.
   *
   * Hard cap : when the un-scoped query would return more than 1000
   * connections, the response is `{ truncated: true, total: N, results: [],
   * message: "..." }`. Caller should scope with --connection or --source.
   *
   * Note on line_start/line_end: the schema (as of v0.1.2) has no line_start
   * column on connections; the agent emits `evidence` as a TEXT snippet, not
   * a line range. We therefore search for the literal substring anywhere in
   * the file and compute the matched line as a 1-indexed offset for display.
   * This degrades the original ±3-line semantics  to "snippet
   * present anywhere in the file" until the schema gains line_start.
   *
   * Query params:
   *   project=<absolute-root>     required — resolves the per-project DB
   *   connection_id=<integer>     optional — single connection by ID
   *   source_file=<rel-path>      optional — basename match if no `/`,
   *                               exact match otherwise
   *   (neither set)               implicit --all 
   */
  // PERF-06 (known synchronous route): reads up to 1000 cited source files via
  // readFileSync. The 1000-connection hard cap (below) bounds the worst case.
  // Async offload explicitly deferred (node:sqlite DatabaseSync is sync by design).
  // Latency budget: <2s for ≤1000 connections (local filesystem, cached OS pages).
  fastify.get("/api/verify", async (request, reply) => {
    const projectRoot = request.query?.project;
    if (!projectRoot) {
      return reply.code(400).send({ error: "missing required param: project" });
    }

    const qe = getQE(request);
    if (!qe) {
      return reply.code(404).send({ error: `project not indexed: ${projectRoot}` });
    }

    // Resolve scope  -------------------------------------------------
    let scope; // "connection" | "source" | "all"
    let rows;
    try {
      if (request.query?.connection_id !== undefined) {
        const idStr = String(request.query.connection_id);
        if (!/^\d+$/.test(idStr) || Number(idStr) <= 0) {
          return reply.code(400).send({ error: "invalid connection_id" });
        }
        scope = "connection";
        rows = qe._db
          .prepare(
            `SELECT id AS connection_id, source_file, method, path, evidence
               FROM connections
              WHERE id = ?`,
          )
          .all(Number(idStr));
        if (rows.length === 0) {
          return reply
            .code(404)
            .send({ error: `no connection with id ${idStr}` });
        }
      } else if (request.query?.source_file) {
        scope = "source";
        const value = String(request.query.source_file);
        const isExactPath = value.includes("/");
        if (isExactPath) {
          rows = qe._db
            .prepare(
              `SELECT id AS connection_id, source_file, method, path, evidence
                 FROM connections
                WHERE source_file = ?
                  AND scan_version_id = (
                    SELECT MAX(scan_version_id) FROM connections
                     WHERE scan_version_id IS NOT NULL
                  )`,
            )
            .all(value);
        } else {
          // Basename match — fetch latest-scan rows then filter in JS.
          const all = qe._db
            .prepare(
              `SELECT id AS connection_id, source_file, method, path, evidence
                 FROM connections
                WHERE source_file IS NOT NULL
                  AND scan_version_id = (
                    SELECT MAX(scan_version_id) FROM connections
                     WHERE scan_version_id IS NOT NULL
                  )`,
            )
            .all();
          rows = all.filter((r) => path.basename(r.source_file) === value);
        }
      } else {
        scope = "all";
        rows = qe._db
          .prepare(
            `SELECT id AS connection_id, source_file, method, path, evidence
               FROM connections
              WHERE scan_version_id = (
                SELECT MAX(scan_version_id) FROM connections
                 WHERE scan_version_id IS NOT NULL
              )
              AND source_file IS NOT NULL`,
          )
          .all();
      }
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/api/verify', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }

    const total = rows.length;

    // 1000-connection cap, only for unscoped --all invocations.
    if (scope === "all" && total > 1000) {
      return reply.send({
        results: [],
        total,
        truncated: true,
        scope,
        message: `too many connections (${total} > 1000) — scope with --source <path> or --connection <id>`,
      });
    }

    const results = rows.map((conn) => computeVerdict(conn, projectRoot));

    return reply.send({
      results,
      total,
      truncated: false,
      scope,
    });
  });

  // 2. GET /projects — list all projects with DBs
  fastify.get("/projects", async (_request, reply) => {
    try {
      // mask absolute project paths before egress.
      return reply.send(maskHomeDeep(listProjects()));
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/projects', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 3. GET /graph?project=/path[&limit=N&offset=M&summary=1] — service dependency graph
  //
  // PERF-06 (known synchronous route): getGraph() performs synchronous SQLite reads via
  // node:sqlite DatabaseSync. Async offload is explicitly deferred (see 143-RESEARCH.md
  // §PERF-06). Latency budget: <50ms for ≤50 services, <200ms for ≤200 services at
  // developer-tool scale. Use ?summary=1 for status pings (<5ms, count-only).
  //
  // Pagination params (T-143-05-01/02: coerced + clamped before reaching SQL):
  //   ?limit=N  — max services per page (positive integer; clamped to GRAPH_MAX_LIMIT)
  //   ?offset=M — pagination offset (non-negative integer; invalid → 0)
  //   ?summary=1 — return only counts (no service/connection arrays)
  fastify.get("/graph", async (request, reply) => {
    const qe = getQE(request);
    if (!qe) {
      return reply.code(503).send({
        error:
          "No map data yet. Pass ?project=/path/to/repo or run /arcanon:map first.",
      });
    }
    try {
      // PERF-01: parse and validate pagination/summary query params.
      // All coercion happens here — no unvalidated params reach getGraph/SQL.
      const GRAPH_MAX_LIMIT = 5000; // documented maximum; prevents unbounded allocation
      const rawLimit = request.query?.limit;
      const rawOffset = request.query?.offset;
      const rawSummary = request.query?.summary;

      let graphLimit = null;
      if (rawLimit !== undefined && rawLimit !== '') {
        const n = Number(rawLimit);
        // Must be a positive finite integer; NaN/0/negative/non-integer → default (full graph)
        if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
          graphLimit = Math.min(n, GRAPH_MAX_LIMIT);
        }
      }

      let graphOffset = 0;
      if (rawOffset !== undefined && rawOffset !== '') {
        const n = Number(rawOffset);
        // Must be a non-negative finite integer; invalid → 0
        if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
          graphOffset = n;
        }
      }

      const graphSummary = rawSummary === '1' || rawSummary === 'true';

      const graph = qe.getGraph({ limit: graphLimit, offset: graphOffset, summary: graphSummary });

      // Read boundaries from arcanon.config.json in the project root.
      // Always returns boundaries: [] when config is missing or has no boundaries key.
      let boundaries = [];
      try {
        // Resolve project root: explicit ?project= param, or first repo path from DB
        let projectRoot = request.query?.project || null;
        if (!projectRoot) {
          try {
            const repos = qe._db.prepare("SELECT path FROM repos LIMIT 1").all();
            if (repos.length > 0) projectRoot = repos[0].path;
          } catch { /* pre-migration DB or no repos */ }
        }
        if (projectRoot) {
          const cfgPath = resolveConfigPath(projectRoot);
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          boundaries = Array.isArray(cfg.boundaries) ? cfg.boundaries : [];
        }
      } catch { /* no config file or no boundaries key — return empty array */ }

      // mask repo_path / root_path / repo_name absolute prefixes
      // (services[].root_path, services[].repo_path from query-engine.js:1591).
      return reply.send(maskHomeDeep({ ...graph, boundaries }));
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/graph', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 4. GET /impact?project=/path&change=endpoint — impacted services
  fastify.get("/impact", async (request, reply) => {
    const qe = getQE(request);
    if (!qe) {
      return reply.code(503).send({ error: "No map data yet" });
    }
    const change = request.query.change;
    if (!change) {
      return reply.code(400).send({ error: "change param required" });
    }
    try {
      return reply.send(qe.getImpact(change));
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/impact', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 5. GET /service/:name?project=/path — service details
  fastify.get("/service/:name", async (request, reply) => {
    const qe = getQE(request);
    if (!qe) {
      return reply.code(503).send({ error: "No map data yet" });
    }
    try {
      const result = qe.getService(request.params.name);
      if (result === null || result === undefined) {
        return reply.code(404).send({ error: "Service not found" });
      }
      return reply.send(result);
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/service/:name', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 6. POST /scan — persist scan findings for a project
  fastify.post("/scan", async (request, reply) => {
    const { repo_path, repo_name, repo_type, findings, commit, project } =
      request.body || {};
    const projectRoot = project || request.query?.project;
    const qe = projectRoot ? resolve(projectRoot) : queryEngine;

    if (!qe) {
      return reply
        .code(503)
        .send({ error: "No map data yet — run /arcanon:map first" });
    }
    if (!repo_path || !findings) {
      return reply
        .code(400)
        .send({ error: "Missing repo_path or findings in request body" });
    }
    // CTR-04: validate findings against the canonical contract before any DB write.
    // An invalid payload returns 400 immediately — upsertRepo/beginScan/persistFindings
    // are never called, so no scan bracket is opened on bad input.
    const validation = validateFindings(findings);
    if (!validation.valid) {
      return reply
        .code(400)
        .send({ error: `Invalid findings: ${validation.error}` });
    }
    try {
      const repoId = qe.upsertRepo({
        path: repo_path,
        name: repo_name || path.basename(repo_path),
        type: repo_type || "single",
      });
      // PIPE-01: delegate the full write sequence to persistScanResult (scan-service.js).
      // The inline beginScan + persistFindings + endScan has been replaced by this single
      // call so the HTTP transport uses the same atomic pipeline as map.md, rescan.md, and
      // manager.js. The Phase 140 validateFindings gate above already validated findings;
      // we pass validation.findings (normalised) to avoid double-validation inside the pipeline.
      const { scanVersionId } = persistScanResult(
        repoId, repo_path, validation.findings, commit || null,
        { mode: 'full' }, qe, httpLog,
      );
      return reply.code(200).send({ status: "persisted", repo_id: repoId, scan_version_id: scanVersionId });
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/scan', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 7. GET /versions?project=/path — map version history
  fastify.get("/versions", async (request, reply) => {
    const qe = getQE(request);
    if (!qe) {
      return reply.code(503).send({ error: "No map data yet" });
    }
    try {
      return reply.send(qe.getVersions());
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/versions', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 8. GET /api/logs — return filtered log lines for UI polling
  // PERF-06 (known synchronous route): reads the worker log file via readFileSync.
  // The log file is local; reads are typically <5ms. No async offload needed at this scale.
  // Latency budget: <50ms for ≤10k log lines.
  fastify.get("/api/logs", async (request, reply) => {
    const logDir = options.dataDir;
    if (!logDir) {
      return reply.send({ lines: [] });
    }
    const logPath = path.join(logDir, "logs", "worker.log");
    let raw;
    try {
      raw = fs.readFileSync(logPath, "utf8");
    } catch {
      // File does not exist yet — return empty
      return reply.send({ lines: [] });
    }

    // Tail: take only the last 500 non-empty lines
    const MAX = 500;
    const allLines = raw.split("\n").filter((l) => l.trim().length > 0);
    const tail = allLines.length > MAX ? allLines.slice(-MAX) : allLines;

    // Parse each line; skip corrupt entries silently
    const parsed = [];
    for (const line of tail) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip non-JSON lines
      }
    }

    // Apply ?component= filter
    const component = request.query.component;
    const since = request.query.since;
    let results = parsed;

    if (component) {
      results = results.filter((l) => l.component === component);
    }

    // Apply ?since= filter (ISO 8601 timestamp string comparison is safe for ISO dates)
    if (since) {
      results = results.filter((l) => l.ts > since);
    }

    return reply.send({ lines: results });
  });

  // Start listening on 127.0.0.1 only
  const port = options.port !== undefined ? options.port : 37888;

  if (port !== 0) {
    await fastify.listen({ port, host: "127.0.0.1" });
  } else {
    await fastify.ready();
  }

  httpLog('INFO', 'http server listening', { port: options.port });

  return fastify;
}

export { createHttpServer, computeVerdict };
