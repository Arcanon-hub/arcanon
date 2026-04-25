import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "url";
import { listProjects, getQueryEngineByHash } from "../db/pool.js";
import { resolveConfigPath } from "../lib/config-path.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compute the verify verdict for a single connection (TRUST-01).
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

  // 5. Search for literal evidence substring anywhere in the file.
  const matchIdx = content.indexOf(evidence);
  if (matchIdx === -1) {
    return {
      ...base,
      verdict: "missing",
      message: "evidence snippet not found in file",
    };
  }

  // 6. Found — compute 1-indexed line_start by counting newlines before
  //    the match index, line_end by adding newlines inside the snippet.
  const lineStart = (content.slice(0, matchIdx).match(/\n/g) || []).length + 1;
  const newlinesInSnippet = (evidence.match(/\n/g) || []).length;
  const lineEnd = lineStart + newlinesInSnippet;
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
   * 1c. GET /api/scan-quality — Latest scan's quality breakdown (TRUST-05, D-05)
   *
   * Used by `/arcanon:status` (via worker/cli/hub.js cmdStatus) to surface the
   * "Latest scan: NN% high-confidence (S services, C connections)" line. The
   * /arcanon:map command does NOT use this endpoint — it calls
   * QueryEngine.getScanQualityBreakdown() directly via the inline-Node DB
   * handle in commands/map.md Step 5.
   *
   * Status codes (locked in CONTEXT D-05):
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
   *     prose_evidence_warnings: number,   // 0 today (D-01 placeholder)
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
   * GET /api/verify — Read-only verification of cited evidence (TRUST-01).
   *
   * Re-reads each cited source file and confirms the recorded evidence snippet
   * is still present. Returns a per-connection verdict so stale scan data is
   * detectable without running a full /arcanon:map.
   *
   * Verdicts (D-01, exhaustive — every connection gets exactly one):
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
   * Read-only contract (D-02): NO INSERT/UPDATE/DELETE in this code path.
   * The connections, scan_versions, and enrichment_log tables are byte-
   * identical before and after a verify call.
   *
   * Hard cap (D-03): when the un-scoped query would return more than 1000
   * connections, the response is `{ truncated: true, total: N, results: [],
   * message: "..." }`. Caller should scope with --connection or --source.
   *
   * Note on line_start/line_end: the schema (as of v0.1.2) has no line_start
   * column on connections; the agent emits `evidence` as a TEXT snippet, not
   * a line range. We therefore search for the literal substring anywhere in
   * the file and compute the matched line as a 1-indexed offset for display.
   * This degrades the original ±3-line semantics (TRUST-01) to "snippet
   * present anywhere in the file" until the schema gains line_start.
   *
   * Query params:
   *   project=<absolute-root>     required — resolves the per-project DB
   *   connection_id=<integer>     optional — single connection by ID
   *   source_file=<rel-path>      optional — basename match if no `/`,
   *                               exact match otherwise
   *   (neither set)               implicit --all (D-06)
   */
  fastify.get("/api/verify", async (request, reply) => {
    const projectRoot = request.query?.project;
    if (!projectRoot) {
      return reply.code(400).send({ error: "missing required param: project" });
    }

    const qe = getQE(request);
    if (!qe) {
      return reply.code(404).send({ error: `project not indexed: ${projectRoot}` });
    }

    // --- Resolve scope (D-06) -------------------------------------------------
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

    // D-03: 1000-connection cap, only for unscoped --all invocations.
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
      return reply.send(listProjects());
    } catch (err) {
      httpLog('ERROR', err.message, { route: '/projects', stack: err.stack });
      return reply.code(500).send({ error: err.message });
    }
  });

  // 3. GET /graph?project=/path — full service dependency graph
  fastify.get("/graph", async (request, reply) => {
    const qe = getQE(request);
    if (!qe) {
      return reply.code(503).send({
        error:
          "No map data yet. Pass ?project=/path/to/repo or run /arcanon:map first.",
      });
    }
    try {
      const graph = qe.getGraph();

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

      return reply.send({ ...graph, boundaries });
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
    try {
      const repoId = qe.upsertRepo({
        path: repo_path,
        name: repo_name || path.basename(repo_path),
        type: repo_type || "single",
      });
      const scanVersionId = qe.beginScan(repoId);
      try {
        qe.persistFindings(repoId, findings, commit || null, scanVersionId);
        qe.endScan(repoId, scanVersionId);
      } catch (innerErr) {
        // persistFindings failed — do NOT call endScan (bracket stays open / incomplete)
        // Re-throw so the outer catch logs and returns 500
        throw innerErr;
      }
      return reply.code(200).send({ status: "persisted", repo_id: repoId });
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
