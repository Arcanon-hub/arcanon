import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHttpServer } from "./server/http.js";
import { getQueryEngine } from "./db/pool.js";
import { initChromaSync } from "./server/chroma.js";
import { createLogger } from "./lib/logger.js";
import { setScanLogger, setAgentRunner } from "./scan/manager.js";
import { setExtractorLogger } from "./scan/enrichment/auth-db-extractor.js";
import { resolveDataDir } from "./lib/data-dir.js";

// ---------------------------------------------------------------------------
// 1. Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let port = 37888;
let dataDir = resolveDataDir();

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") port = parseInt(args[i + 1], 10);
  if (args[i] === "--data-dir") dataDir = args[i + 1];
}

// ---------------------------------------------------------------------------
// 2. Read settings.json for ARCANON_LOG_LEVEL and port override
// ---------------------------------------------------------------------------
let logLevel = "INFO";
let allSettings = {};
try {
  allSettings = JSON.parse(
    fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"),
  );
  if (allSettings.ARCANON_LOG_LEVEL) logLevel = allSettings.ARCANON_LOG_LEVEL;
  if (allSettings.ARCANON_WORKER_PORT)
    port = parseInt(allSettings.ARCANON_WORKER_PORT, 10);
} catch {
  // Settings file absent or unreadable — use defaults
}

// ---------------------------------------------------------------------------
// 3. Create data dir and logs dir
// ---------------------------------------------------------------------------
fs.mkdirSync(path.join(dataDir, "logs"), { recursive: true });

// ---------------------------------------------------------------------------
// 4. Write PID file immediately
// ---------------------------------------------------------------------------
const PID_FILE = path.join(dataDir, "worker.pid");
const PORT_FILE = path.join(dataDir, "worker.port");
fs.writeFileSync(PID_FILE, String(process.pid));

// ---------------------------------------------------------------------------
// 5. Structured logger
// ---------------------------------------------------------------------------
const logger = createLogger({ dataDir, port, logLevel, component: 'worker' });
setScanLogger(logger);
setExtractorLogger(logger);

// ---------------------------------------------------------------------------
// 5b. Test-only agentRunner stub (Plan 118-02 / CORRECT-04)
// ---------------------------------------------------------------------------
// Production scans are orchestrated from the host (Claude Code Task tool) and
// then POSTed to /scan; the worker process never invokes the agent itself.
// However, /api/rescan needs scanRepos to actually run end-to-end inside the
// worker for the rescan trigger to be testable. When ARCANON_TEST_AGENT_RUNNER
// is truthy, install a minimal stub that returns valid empty scan output so
// tests can drive /api/rescan without a real Claude agent.
//
// The stub is gated by env var — production worker startups never wire it.
if (process.env.ARCANON_TEST_AGENT_RUNNER) {
  setAgentRunner(async (_prompt, _repoPath) => {
    // Stub returns the minimal-valid agent output: a fenced ```json block
    // wrapping an object with empty services/connections arrays. Both the
    // discovery pass and the deep scan share the same runner; both accept
    // this shape (parseAgentOutput tolerates empty arrays).
    return [
      "```json",
      JSON.stringify({
        languages: [],
        frameworks: [],
        service_hints: [],
        services: [],
        connections: [],
      }),
      "```",
    ].join("\n");
  });
  logger.log("INFO", "test agent runner installed (ARCANON_TEST_AGENT_RUNNER=1)");
}

// ---------------------------------------------------------------------------
// 6. Initialize ChromaDB (optional — non-blocking)
// ---------------------------------------------------------------------------
if (allSettings.ARCANON_CHROMA_MODE) {
  initChromaSync(allSettings, null, logger).then((ok) => {
    logger.log(
      "INFO",
      ok ? "ChromaDB connected" : "ChromaDB unavailable — using FTS5 fallback",
    );
  });
}

// ---------------------------------------------------------------------------
// 7. Create HTTP server — DB resolved per-request, not at startup
// ---------------------------------------------------------------------------
// Pass null as queryEngine — the HTTP server resolves it per-request
// using the ?project= query param and getQueryEngine()
const app = await createHttpServer(null, {
  port,
  resolveQueryEngine: getQueryEngine,
  logger,
  dataDir,
});
fs.writeFileSync(PORT_FILE, String(port));
logger.log("INFO", "worker started", { port });

// ---------------------------------------------------------------------------
// 7. Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  logger.log("INFO", `received ${signal}, shutting down`);
  app.close(() => {
    try {
      fs.rmSync(PID_FILE, { force: true });
    } catch {}
    try {
      fs.rmSync(PORT_FILE, { force: true });
    } catch {}
    logger.log("INFO", "worker stopped");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
