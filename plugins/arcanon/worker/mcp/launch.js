#!/usr/bin/env node
// Arcanon — worker/mcp/launch.js
// Resilient MCP launcher. Declared in .mcp.json as `node .../worker/mcp/launch.js`
// (node-direct: no bash, so no Windows file-association issue, #21847).
//
// Why a launcher at all: Claude Code does NOT wait for SessionStart hooks to
// finish before spawning plugin MCP servers, and stdio MCP servers never
// auto-reconnect. So if this process imported server.js while the install-deps
// hook was still populating node_modules, the import would throw and the tools
// would be dead for the entire session. This launcher imports ONLY node:
// builtins (so it always starts), then gates the real server import on a
// dependency-health probe — waiting out the concurrent pure-JS install.
//
// node:sqlite ExperimentalWarning suppression: node:sqlite emits an
// ExperimentalWarning to stderr on Node < 25.7. The MCP protocol is on stdout,
// so this is harmless, but it clutters logs. We suppress ONLY the
// ExperimentalWarning category (not all warnings) via
// --disable-warning=ExperimentalWarning on the spawned server child. For the
// fast-path in-process import, .mcp.json passes the same flag to this launcher
// process. This is valid from Node 16.19+ and available on 22.13+.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", ".."); // worker/mcp -> plugin root
const serverPath = path.join(here, "server.js");
// Dynamic import() requires a file:// URL, not a raw path — a bare Windows
// path (C:\...) throws ERR_UNSUPPORTED_ESM_URL_SCHEME. spawnSync takes the
// plain path (node accepts a path argv on every platform).
const serverUrl = pathToFileURL(serverPath).href;

// Total time to wait for the concurrent install-deps hook to populate
// node_modules with pure-JS deps. Overridable for tests. If Claude Code's own
// stdio handshake times out sooner, the wait is harmless — install-deps
// guarantees a healthy tree for next session.
const _wait = Number(process.env.ARCANON_MCP_WAIT_MS);
// Guard against a non-numeric override: NaN would make `now < now + NaN` false,
// skip the wait loop entirely, and give up instantly even when deps are fine.
const MAX_WAIT_MS = Number.isFinite(_wait) && _wait >= 0 ? _wait : 60000;
const INTERVAL_MS = 1500;

// Fresh-process probe: a new `node` gets a clean module cache, so this reflects
// current on-disk state (an in-process retry can't — ESM caches a failed module
// graph as errored and will not re-evaluate it). Healthy iff the MCP SDK module
// resolves (all pure-JS deps present).
const PROBE = "await import('@modelcontextprotocol/sdk/server/mcp.js');";

function depsHealthy() {
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", PROBE],
    { cwd: pluginRoot, stdio: "ignore", timeout: 15000 },
  );
  return r.status === 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fast path: deps already present — importing server.js boots and connects the
// stdio transport directly in this process (no extra child, no probe cost).
try {
  await import(serverUrl);
} catch {
  // Import failed ⇒ deps not ready yet. This process's module cache is now
  // poisoned, so we wait for health and hand off to a FRESH node process that
  // inherits our stdio (the MCP pipes) and speaks the protocol directly. We
  // gate on the probe so we never feed the client's `initialize` request to a
  // server that will crash — that would consume the request and fail the session.
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (depsHealthy()) {
      // Suppress only ExperimentalWarning (node:sqlite on Node < 25.7) on the
      // spawned child process. Other warnings (deprecation, etc.) still surface.
      const r = spawnSync(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", serverPath],
        { stdio: "inherit" },
      );
      process.exit(r.status ?? 0);
    }
    await sleep(INTERVAL_MS);
  }
  process.stderr.write(
    "[arcanon] MCP runtime dependencies are not ready (install-deps hook may " +
      "still be running or failed). Run /mcp to reconnect once installation completes.\n",
  );
  process.exit(1);
}
