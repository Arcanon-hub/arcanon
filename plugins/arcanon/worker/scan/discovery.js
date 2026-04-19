/**
 * worker/repo-discovery.js — Repo discovery module for Ligamen v2.0
 *
 * Provides the complete discovery-to-confirmation lifecycle for the linked
 * repo list used by /ligamen:map. Pure module — no side effects at load time.
 *
 * Exports:
 *   loadFromConfig(projectRoot)            — load repos from arcanon.config.json
 *   discoverNew(projectRoot, existingPaths) — scan parent dir for new repos
 *   deduplicateRepos(repos)                — normalize and deduplicate by path
 *   saveConfirmed(projectRoot, paths)      — persist confirmed list to config
 *   isViewOnlyMode(args)                   — detect --view flag
 *   formatRepoList(repos)                  — format repo list for CLI output
 */

import fs from "node:fs";
import path from "node:path";
import { resolveConfigPath, CONFIG_FILENAME } from "../lib/config-path.js";

// ---------------------------------------------------------------------------
// Manifest files that identify a directory as a project repo
// ---------------------------------------------------------------------------
const MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
];

// ---------------------------------------------------------------------------
// loadFromConfig(projectRoot)
//
// Reads arcanon.config.json from projectRoot. Returns [] when the file is
// absent or does not contain a linked-repos key. Resolves each path in
// linked-repos relative to projectRoot.
// ---------------------------------------------------------------------------
export function loadFromConfig(projectRoot) {
  const configPath = resolveConfigPath(projectRoot);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }

  const linkedRepos = config["linked-repos"];
  if (!Array.isArray(linkedRepos) || linkedRepos.length === 0) {
    return [];
  }

  return linkedRepos.map((p) => {
    const resolved = path.resolve(projectRoot, p);
    return {
      path: resolved,
      name: path.basename(resolved),
      source: "config",
      isNew: false,
    };
  });
}

// ---------------------------------------------------------------------------
// discoverNew(projectRoot, existingPaths)
//
// Scans the parent directory of projectRoot for subdirectories containing a
// recognized project manifest file. Excludes:
//   - projectRoot itself
//   - any path already in existingPaths (normalized to absolute)
//
// Returns repos with source: "discovered", isNew: true.
// ---------------------------------------------------------------------------
export function discoverNew(projectRoot, existingPaths) {
  const resolvedProject = path.resolve(projectRoot);
  const parentDir = path.join(resolvedProject, "..");

  // Build exclusion set (normalized absolute paths)
  const excluded = new Set([
    resolvedProject,
    ...existingPaths.map((p) => path.resolve(p)),
  ]);

  let entries;
  try {
    entries = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const discovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const absPath = path.resolve(parentDir, entry.name);
    if (excluded.has(absPath)) continue;

    // Check if any manifest file exists in this directory
    const hasManifest = MANIFESTS.some((manifest) =>
      fs.existsSync(path.join(absPath, manifest)),
    );

    if (hasManifest) {
      discovered.push({
        path: absPath,
        name: path.basename(absPath),
        source: "discovered",
        isNew: true,
      });
    }
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// deduplicateRepos(repos)
//
// Normalizes all paths via path.resolve, deduplicates by path. When the same
// path appears with both "config" and "discovered" sources, the config entry
// wins (config repos are already confirmed by the user).
// ---------------------------------------------------------------------------
export function deduplicateRepos(repos) {
  // Map keyed by resolved absolute path
  const map = new Map();

  for (const repo of repos) {
    const key = path.resolve(repo.path);
    if (!map.has(key)) {
      map.set(key, repo);
    } else {
      // config always beats discovered for the same path
      const existing = map.get(key);
      if (existing.source !== "config" && repo.source === "config") {
        map.set(key, repo);
      }
    }
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// saveConfirmed(projectRoot, confirmedPaths)
//
// Writes confirmedPaths (array of strings) to arcanon.config.json under the
// linked-repos key. Merges with the existing config — preserves impact-map and
// all other keys. Creates the file if absent.
// ---------------------------------------------------------------------------
export function saveConfirmed(projectRoot, confirmedPaths) {
  // Read from either name (legacy supported) but always write to the current name.
  const readPath = resolveConfigPath(projectRoot);
  const writePath = path.join(projectRoot, CONFIG_FILENAME);
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(readPath, "utf8"));
  } catch {
    // File absent or unreadable — start with empty config
  }

  config["linked-repos"] = confirmedPaths;
  fs.writeFileSync(writePath, JSON.stringify(config, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// isViewOnlyMode(args)
//
// Returns true if the args array contains "--view", false otherwise.
// ---------------------------------------------------------------------------
export function isViewOnlyMode(args) {
  return args.includes("--view");
}

// ---------------------------------------------------------------------------
// formatRepoList(repos)
//
// Returns a formatted multi-line string suitable for printing in the Claude
// prompt output. Distinguishes confirmed (config) repos from newly-discovered
// ones with a [NEW] marker.
// ---------------------------------------------------------------------------
export function formatRepoList(repos) {
  const newCount = repos.filter((r) => r.isNew).length;
  const lines = [];

  lines.push(`Found ${repos.length} repos (${newCount} new)`);

  for (const repo of repos) {
    if (repo.isNew) {
      lines.push(`  [NEW] ${repo.path} (${repo.name})  <-- newly discovered`);
    } else {
      lines.push(`  [confirmed] ${repo.path} (${repo.name})`);
    }
  }

  lines.push("Confirm this list, or tell me which repos to add or remove.");

  return lines.join("\n");
}
