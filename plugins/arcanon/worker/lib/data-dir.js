import os from "node:os";
import path from "node:path";

const CURRENT_DIR = ".arcanon";

/**
 * Resolve the Arcanon data directory.
 *
 * Preference order:
 *   1. $ARCANON_DATA_DIR (explicit override)
 *   2. ~/.arcanon (default — will be created lazily by callers)
 *
 * Callers own directory creation (we don't mkdir here to keep this a pure resolver).
 *
 * @returns {string}
 */
export function resolveDataDir() {
  if (process.env.ARCANON_DATA_DIR) return process.env.ARCANON_DATA_DIR;
  return path.join(os.homedir(), CURRENT_DIR);
}

export const DATA_DIR_NAME = CURRENT_DIR;
