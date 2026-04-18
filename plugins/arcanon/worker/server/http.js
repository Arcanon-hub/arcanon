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
          "No map data yet. Pass ?project=/path/to/repo or run /ligamen:map first.",
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
        .send({ error: "No map data yet — run /ligamen:map first" });
    }
    if (!repo_path || !findings) {
      return reply
        .code(400)
        .send({ error: "Missing repo_path or findings in request body" });
    }
    try {
      const repo = qe.upsertRepo({
        path: repo_path,
        name: repo_name || path.basename(repo_path),
        type: repo_type || "single",
      });
      const repoId = repo.id;
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

export { createHttpServer };
