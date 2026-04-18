import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CURRENT_DIR = ".arcanon";
const LEGACY_DIR = ".ligamen";

/**
 * Resolve the Arcanon data directory.
 *
 * Preference order:
 *   1. $ARCANON_DATA_DIR (explicit override — current name)
 *   2. $LIGAMEN_DATA_DIR (explicit override — legacy name, deprecated)
 *   3. ~/.arcanon  if it exists
 *   4. ~/.ligamen  if it exists and ~/.arcanon does not (legacy fallback)
 *   5. ~/.arcanon  (default — will be created lazily by callers)
 *
 * Callers own directory creation (we don't mkdir here to keep this a pure resolver).
 *
 * @returns {string}
 */
export function resolveDataDir() {
  if (process.env.ARCANON_DATA_DIR) return process.env.ARCANON_DATA_DIR;
  if (process.env.LIGAMEN_DATA_DIR) return process.env.LIGAMEN_DATA_DIR;

  const home = os.homedir();
  const current = path.join(home, CURRENT_DIR);
  if (fs.existsSync(current)) return current;

  const legacy = path.join(home, LEGACY_DIR);
  if (fs.existsSync(legacy)) return legacy;

  return current;
}

export const DATA_DIR_NAME = CURRENT_DIR;
