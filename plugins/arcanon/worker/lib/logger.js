import fs from "node:fs";
import path from "node:path";

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * rotateIfNeeded — renames log files to implement size-based rotation.
 * Keeps at most 3 rotated files (.1, .2, .3); deletes .4 on the next rotation.
 *
 * @param {string} logPath - Absolute path to the active log file
 */
function rotateIfNeeded(logPath) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    // File does not exist yet — treat as 0 bytes, no rotation needed
    return;
  }
  if (size < MAX_LOG_BYTES) return;

  // Delete the oldest rotated file to keep at most 3 rotated files (.1, .2, .3)
  try { fs.rmSync(`${logPath}.3`, { force: true }); } catch { /* ignore */ }
  // Rename chain: .2 → .3, .1 → .2, active → .1
  try { fs.renameSync(`${logPath}.2`, `${logPath}.3`); } catch { /* ignore ENOENT */ }
  try { fs.renameSync(`${logPath}.1`, `${logPath}.2`); } catch { /* ignore ENOENT */ }
  try { fs.renameSync(logPath, `${logPath}.1`); } catch { /* ignore ENOENT */ }
}

/**
 * createLogger — returns a structured logger bound to a component tag.
 *
 * @param {object} opts
 * @param {string} opts.dataDir   - Base data directory (logs go to {dataDir}/logs/worker.log)
 * @param {number} [opts.port]    - Worker port; omitted from line when undefined or null
 * @param {string} [opts.logLevel="INFO"] - Minimum level to emit (DEBUG|INFO|WARN|ERROR)
 * @param {string} opts.component - Component tag included on every log line
 * @returns {{ log, info, warn, error, debug }}
 */
export function createLogger({ dataDir, port, logLevel = "INFO", component }) {
  function log(level, msg, extra = {}) {
    if (LEVELS[level] < LEVELS[logLevel]) return;

    const lineObj = {
      ts: new Date().toISOString(),
      level,
      msg,
      pid: process.pid,
    };

    if (port !== undefined && port !== null) {
      lineObj.port = port;
    }

    lineObj.component = component;

    // Merge any extra fields last so they don't override core fields accidentally
    Object.assign(lineObj, extra);

    const line = JSON.stringify(lineObj);
    const logPath = path.join(dataDir, "logs", "worker.log");
    rotateIfNeeded(logPath);
    fs.appendFileSync(logPath, line + "\n");
    if (process.stderr.isTTY) {
      process.stderr.write(line + "\n");
    }
  }

  return {
    log,
    info(msg, extra = {}) {
      log("INFO", msg, extra);
    },
    warn(msg, extra = {}) {
      log("WARN", msg, extra);
    },
    error(msg, extra = {}) {
      log("ERROR", msg, extra);
    },
    debug(msg, extra = {}) {
      log("DEBUG", msg, extra);
    },
  };
}
