import fs from "node:fs";
import path from "node:path";

const CURRENT = "arcanon.config.json";
const LEGACY = "ligamen.config.json";

/**
 * Resolve the Arcanon config file path in `dir`, with legacy back-compat.
 *
 * Preference order: arcanon.config.json → ligamen.config.json (legacy) → arcanon.config.json (default when neither exists).
 *
 * @param {string} [dir] defaults to process.cwd()
 * @returns {string} absolute path
 */
export function resolveConfigPath(dir = process.cwd()) {
  const current = path.join(dir, CURRENT);
  if (fs.existsSync(current)) return current;
  const legacy = path.join(dir, LEGACY);
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

export const CONFIG_FILENAME = CURRENT;
export const LEGACY_CONFIG_FILENAME = LEGACY;
