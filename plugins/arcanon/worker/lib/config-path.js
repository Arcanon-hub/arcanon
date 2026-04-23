import path from "node:path";

const CURRENT = "arcanon.config.json";

/**
 * Resolve the Arcanon config file path in `dir`.
 *
 * @param {string} [dir] defaults to process.cwd()
 * @returns {string} absolute path to arcanon.config.json (may or may not exist)
 */
export function resolveConfigPath(dir = process.cwd()) {
  return path.join(dir, CURRENT);
}

export const CONFIG_FILENAME = CURRENT;
