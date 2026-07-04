import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHttpServer } from "./server/http.js";
import { getQueryEngine, closeAll as closeAllDbHandles } from "./db/pool.js";
import { initChromaSync } from "./server/chroma.js";
import { createLogger } from "./lib/logger.js";
import { setScanLogger } from "./scan/manager.js";
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
    // PERF-05: close every cached DB handle before exiting so no project
    // database file descriptor remains open after the worker process exits.
    // closeAll() is best-effort (per-handle try/catch in pool.js) — if a
    // handle's close() throws (e.g. SQLite WAL flush on an interrupted write),
    // the error is swallowed and the process still exits cleanly. SQLite WAL
    // mode is designed to survive unclean exits. See 143-RESEARCH.md Open Q3.
    closeAllDbHandles();
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
