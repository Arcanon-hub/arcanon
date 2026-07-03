/**
 * worker/scan-manager.js — Scan orchestration for Arcanon v2.0 agent scanning.
 *
 * Exports:
 *   getChangedFiles(repoPath, sinceCommit)       - Git diff wrapper
 *   buildScanContext(repoPath, repoId, qe, opts) - Determines scan mode
 *   scanRepos(repoPaths, options, queryEngine)   - Main scan entry point
 *   setAgentRunner(fn)                           - Inject agent invoker (test + MCP server use)
 *   runDiscoveryPass(repoPath, template, runner, slog) - Discovery agent 
 *
 * Agent invocation uses an injected runner to decouple from Claude's Task tool.
 * Background subagents cannot access MCP tools (Claude Code issue #13254) — all
 * agent invocations run in the foreground via the MCP server's agentRunner.
 *
 * Incremental scan constraint injection
 *   When buildScanContext returns mode='incremental', a hard constraint block
 *   (INCREMENTAL_CONSTRAINT) listing only the changed files is appended to the
 *   prompt before it is passed to agentRunner. This ensures the agent focuses
 *   exclusively on the diff rather than re-scanning the full repo.
 *
 *   When the incremental diff is empty (modified.length === 0), agentRunner is
 *   NOT called and beginScan is NOT called. The result is pushed with
 *   mode="incremental-noop" and findings=null.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import os from "node:os";

import { parseAgentOutput } from "./findings.js";
import { registerEnricher, runEnrichmentPass } from "./enrichment.js";
import { collectDependencies } from "./enrichment/dep-collector.js";
import { createCodeownersEnricher } from "./codeowners.js";
import { resolveDataDir } from "../lib/data-dir.js";
import { resolveConfigPath } from "../lib/config-path.js";
import { readHubAutoSync as _readHubAutoSync } from "../lib/hub-config.js";
import { extractAuthAndDb } from "./enrichment/auth-db-extractor.js";
import { persistScanResult } from './scan-service.js';
import { syncFindings, hasCredentials } from "../hub-sync/index.js";
import { createSnapshot } from "../db/database.js";
import { syncFindingsToChroma } from "../server/chroma.js";
// externals catalog + user merge + per-repo actor labeling
import { loadMergedCatalog } from "./enrichment/externals-catalog.js";
import { runActorLabeling } from "./enrichment/actor-labeler.js";

// Register CODEOWNERS enricher once at module load.
// Module-level registration runs before the first scan.
registerEnricher("codeowners", createCodeownersEnricher());

/**
 * Read hub config from arcanon.config.json.
 * @returns {{
 *   hubAutoSync: boolean,
 *   hubUrl: string|undefined,
 *   projectSlug: string|undefined,
 *   libraryDepsEnabled: boolean,
 *   orgId: string|undefined,
 * }}
 */
function _readHubConfig() {
  try {
    const cfgPath = resolveConfigPath(process.cwd());
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    return {
      hubAutoSync: _readHubAutoSync(cfg?.hub),
      hubUrl: cfg?.hub?.url,
      projectSlug: cfg?.hub?.["project-slug"] || cfg?.["project-name"],
      libraryDepsEnabled: Boolean(cfg?.hub?.beta_features?.library_deps),
      // per-repo org_id override. Threaded into syncFindings
      // and ultimately resolveCredentials({orgId}) where it beats env + default.
      orgId: cfg?.hub?.org_id,
    };
  } catch {
    return {
      hubAutoSync: false,
      hubUrl: undefined,
      projectSlug: undefined,
      libraryDepsEnabled: false,
      orgId: undefined,
    };
  }
}

// Register auth/DB extractor enricher .
registerEnricher("auth-db", extractAuthAndDb);

// ---------------------------------------------------------------------------
// Logger injection
// ---------------------------------------------------------------------------

/** @type {{ log: Function, info: Function, warn: Function, error: Function, debug: Function } | null} */
let _logger = null;

/**
 * Inject the structured logger. Call from worker/index.js or tests.
 * When not set, scan lifecycle events are silently dropped (safe for tests without logging setup).
 *
 * @param {{ log: Function, info: Function, warn: Function, error: Function, debug: Function } | null} logger
 */
export function setScanLogger(logger) {
  _logger = logger;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Repo type detection
// ---------------------------------------------------------------------------

/**
 * Check if a repo has any service entry-point indicator.
 * Used to exempt docker-compose repos from infra classification.
 * @param {string} repoPath
 * @returns {boolean}
 */
function _hasServiceEntryPoint(repoPath) {
  // Node.js: package.json with start or serve script
  try {
    const pkgPath = join(repoPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.scripts && (pkg.scripts.start || pkg.scripts.serve)) return true;
    }
  } catch { /* ignore */ }
  // Python
  if (existsSync(join(repoPath, "main.py")) || existsSync(join(repoPath, "app.py"))) return true;
  // Go
  if (existsSync(join(repoPath, "main.go"))) return true;
  try {
    if (existsSync(join(repoPath, "cmd"))) return true;
  } catch { /* ignore */ }
  // Java
  try {
    if (existsSync(join(repoPath, "src", "main", "java"))) return true;
  } catch { /* ignore */ }
  // Makefile with server/run targets
  try {
    const makefile = join(repoPath, "Makefile");
    if (existsSync(makefile)) {
      const content = readFileSync(makefile, "utf8");
      if (/^(run|serve|server|start):/m.test(content)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Recursively search for Application.java or *Main.java in a directory (max depth 5).
 * @param {string} dir
 * @param {number} depth
 * @returns {boolean}
 */
function _findJavaEntryPoint(dir, depth = 0) {
  if (depth > 5) return false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name === "Application.java" || entry.name.endsWith("Main.java"))) {
        return true;
      }
      if (entry.isDirectory() && depth < 5) {
        if (_findJavaEntryPoint(join(dir, entry.name), depth + 1)) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Detect whether a repo is a service, library, or infra project.
 * Checks for presence of indicator files — first match wins.
 *
 * @param {string} repoPath
 * @returns {"service" | "library" | "infra"}
 */
export function detectRepoType(repoPath) {
  // Hard infra indicators — always infra, no exemption needed
  const hardInfraIndicators = [
    "kustomization.yaml", "Chart.yaml", "helmfile.yaml",
  ];
  for (const f of hardInfraIndicators) {
    if (existsSync(join(repoPath, f))) return "infra";
  }
  // Check for terraform files
  try {
    const files = readdirSync(repoPath);
    if (files.some((f) => f.endsWith(".tf"))) return "infra";
  } catch { /* ignore */ }
  // Check for overlays/ or terraform/ directories
  if (existsSync(join(repoPath, "overlays")) || existsSync(join(repoPath, "terraform"))) {
    return "infra";
  }

  // docker-compose is infra ONLY when no service entry-point exists
  const hasDockerCompose = existsSync(join(repoPath, "docker-compose.yml"))
    || existsSync(join(repoPath, "docker-compose.yaml"));
  if (hasDockerCompose) {
    const hasServiceEntryPoint = _hasServiceEntryPoint(repoPath);
    if (!hasServiceEntryPoint) return "infra";
    // else: docker-compose is for local dev, continue to library/service detection
  }

  // Library indicators — no server entry point, has package exports
  // Check if package.json has a "main" or "exports" but no "start" script
  try {
    const pkgPath = join(repoPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const hasStart = pkg.scripts && (pkg.scripts.start || pkg.scripts.serve);
      const hasExports = pkg.main || pkg.exports || pkg.types;
      if (!hasStart && hasExports) return "library";
    }
  } catch { /* ignore */ }

  // Python: if pyproject.toml has [project] but no [project.scripts] entry point
  try {
    const pyproj = join(repoPath, "pyproject.toml");
    if (existsSync(pyproj)) {
      const content = readFileSync(pyproj, "utf8");
      if (content.includes("[project]") && !content.includes("[project.scripts]")) {
        return "library";
      }
    }
  } catch { /* ignore */ }

  // Rust: if Cargo.toml has [lib] but no [[bin]]
  try {
    const cargo = join(repoPath, "Cargo.toml");
    if (existsSync(cargo)) {
      const content = readFileSync(cargo, "utf8");
      if (content.includes("[lib]") && !content.includes("[[bin]]")) {
        return "library";
      }
    }
  } catch { /* ignore */ }

  // Go: go.mod present, no main.go in root, no cmd/ directory → library
  try {
    if (existsSync(join(repoPath, "go.mod"))) {
      const hasMainGo = existsSync(join(repoPath, "main.go"));
      const hasCmdDir = existsSync(join(repoPath, "cmd"));
      if (!hasMainGo && !hasCmdDir) return "library";
    }
  } catch { /* ignore */ }

  // Java: pom.xml or build.gradle present, no Application.java or *Main.java in src/main/java → library
  try {
    const hasPom = existsSync(join(repoPath, "pom.xml"));
    const hasGradle = existsSync(join(repoPath, "build.gradle")) || existsSync(join(repoPath, "build.gradle.kts"));
    if (hasPom || hasGradle) {
      const javaMainDir = join(repoPath, "src", "main", "java");
      if (!existsSync(javaMainDir)) {
        return "library";
      }
      // Check for Application.java or *Main.java — search recursively in src/main/java tree
      const hasAppClass = _findJavaEntryPoint(javaMainDir);
      if (!hasAppClass) return "library";
    }
  } catch { /* ignore */ }

  // Poetry: pyproject.toml with [tool.poetry] but no [tool.poetry.scripts] → library
  try {
    const pyproj = join(repoPath, "pyproject.toml");
    if (existsSync(pyproj)) {
      const content = readFileSync(pyproj, "utf8");
      if (content.includes("[tool.poetry]") && !content.includes("[tool.poetry.scripts]")) {
        return "library";
      }
    }
  } catch { /* ignore */ }

  // Default: service
  return "service";
}

// ---------------------------------------------------------------------------
// Agent runner injection
// ---------------------------------------------------------------------------

/** @type {((prompt: string, repoPath: string) => Promise<string>) | null} */
let agentRunner = null;

/**
 * Inject the agent invoker. Must be called before scanRepos is used in production.
 * Tests inject a mock; MCP server injects the real Claude Task invoker.
 *
 * @param {((prompt: string, repoPath: string) => Promise<string>) | null} fn
 */
export function setAgentRunner(fn) {
  agentRunner = fn;
}

// ---------------------------------------------------------------------------
// getChangedFiles
// ---------------------------------------------------------------------------

/**
 * Get changed files in a repo since a given commit.
 * Uses --name-status (not --name-only) to detect deletions and renames (pitfall 7).
 *
 * @param {string} repoPath - Absolute path to the git repository root
 * @param {string|null} sinceCommit - Base commit hash, or null for full listing
 * @returns {{ modified: string[], deleted: string[], renamed: Array<{from: string, to: string}> }
 *          | { error: string }}
 */
export function getChangedFiles(repoPath, sinceCommit) {
  try {
    let output;

    if (sinceCommit === null) {
      // Full scan — return all tracked files as "modified"
      output = execFileSync("git", ["-C", repoPath, "ls-files"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const files = output.trim().split("\n").filter(Boolean);
      return { modified: files, deleted: [], renamed: [] };
    }

    // Incremental — diff since the given commit
    output = execFileSync(
      "git", ["-C", repoPath, "diff", "--name-status", sinceCommit, "HEAD"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );

    const modified = [];
    const deleted = [];
    const renamed = [];

    for (const line of output.trim().split("\n").filter(Boolean)) {
      if (line.startsWith("D\t")) {
        deleted.push(line.slice(2));
      } else if (line.match(/^R\d*\t/)) {
        // Rename: "R100\told/path\tnew/path"
        const parts = line.split("\t");
        if (parts.length >= 3) {
          renamed.push({ from: parts[1], to: parts[2] });
        }
      } else {
        // M (modified), A (added), C (copied), T (type change), U (unmerged), X (unknown)
        const parts = line.split("\t");
        if (parts.length >= 2) {
          modified.push(parts[1]);
        }
      }
    }

    return { modified, deleted, renamed };
  } catch (_err) {
    return { error: "not a git repo" };
  }
}

// ---------------------------------------------------------------------------
// getCurrentHead
// ---------------------------------------------------------------------------

/**
 * Returns the current HEAD commit hash for a repo.
 * @param {string} repoPath
 * @returns {string}
 */
function getCurrentHead(repoPath) {
  return execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

// ---------------------------------------------------------------------------
// buildScanContext
// ---------------------------------------------------------------------------

/**
 * Determine scan mode for a repo given its stored repo_state and current options.
 *
 * @param {string} repoPath - Absolute path to the repo
 * @param {number} repoId - DB row id from repos table
 * @param {{ getRepoState: (id: number) => ({ last_scanned_commit: string|null, last_scanned_at: string|null } | null) }} queryEngine
 * @param {{ full?: boolean }} [options]
 * @returns {{ mode: 'full'|'incremental'|'skip', files: null | { modified: string[], deleted: string[], renamed: Array<{from:string,to:string}> } }}
 */
export function buildScanContext(repoPath, repoId, queryEngine, options = {}) {
  // Explicit full-scan override
  if (options.full === true) {
    return { mode: "full", files: null };
  }

  // First scan — no repo_state entry → always full
  const repoState = queryEngine.getRepoState(repoId);
  if (repoState === null) {
    return { mode: "full", files: null };
  }

  // Compare stored commit with current HEAD
  const currentHead = getCurrentHead(repoPath);
  if (repoState.last_scanned_commit === currentHead) {
    return { mode: "skip", files: null };
  }

  // Incremental scan — diff since last scanned commit
  const files = getChangedFiles(repoPath, repoState.last_scanned_commit);
  return { mode: "incremental", files };
}

// ---------------------------------------------------------------------------
// buildIncrementalConstraint 
// ---------------------------------------------------------------------------

/**
 * Builds the INCREMENTAL_CONSTRAINT block appended to the agent prompt for
 * incremental scans. Exported as a named constant for testability.
 *
 * @param {string[]} changedFiles - List of modified file paths
 * @returns {string} Constraint text to append to the interpolated prompt
 */
export function buildIncrementalConstraint(changedFiles) {
  const fileList = changedFiles.map((f) => `  - ${f}`).join("\n");
  return [
    "",
    "---",
    "## INCREMENTAL SCAN — CHANGED FILES ONLY",
    "",
    "This is an incremental scan. You MUST only examine the following changed files.",
    "Do NOT read, analyze, or report connections from unchanged files.",
    "Scanning unchanged files wastes time and produces stale duplicate findings.",
    "",
    "EXCEPTION — backing-service clients (#45): you MAY still locate and read the",
    "import / construction call site of any `backing_service_deps` candidate from",
    "the discovery context, even in an unchanged file. A backing-service dependency",
    "edge for an unchanged importer would otherwise be lost on every incremental",
    "scan. This exception is ONLY for resolving those candidate call sites — all",
    "other unchanged files remain off-limits.",
    "",
    "Changed files:",
    fileList,
    "---",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// runDiscoveryPass
// ---------------------------------------------------------------------------

/**
 * Run the discovery agent for a single repo ( of two-phase scan).
 * Interpolates {{REPO_PATH}}, calls agentRunner, extracts fenced JSON block.
 * Returns parsed discovery JSON on success, or {} on failure/no-JSON.
 * Discovery output is ephemeral — never persisted to DB.
 *
 * @param {string} repoPath - Absolute path to the repo
 * @param {string} discoveryPromptTemplate - Raw file contents of agent-prompt-discovery.md
 * @param {(prompt: string, repoPath: string) => Promise<string>} agentRunner
 * @param {Function} slog - Scan-local log helper (no-ops silently when logger not injected)
 * @returns {Promise<object>} Parsed discovery JSON, or {} on failure
 */
export async function runDiscoveryPass(repoPath, discoveryPromptTemplate, agentRunner, slog) {
  const prompt = discoveryPromptTemplate.replaceAll("{{REPO_PATH}}", repoPath);
  try {
    const raw = await agentRunner(prompt, repoPath);
    const match = raw.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!match) {
      slog('WARN', 'discovery: no JSON block — using empty context', { repoPath });
      return {};
    }
    const parsed = JSON.parse(match[1].trim());
    slog('INFO', 'discovery pass complete', {
      repoPath,
      languages: Array.isArray(parsed.languages) ? parsed.languages : [],
      frameworks: parsed.frameworks ?? [],
      service_hints: (parsed.service_hints ?? []).length,
    });
    return parsed;
  } catch (err) {
    slog('WARN', 'discovery pass failed — using empty context', { repoPath, error: err.message });
    return {};
  }
}

// ---------------------------------------------------------------------------
// scanRepos
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   repoPath: string,
 *   mode: 'full'|'incremental'|'incremental-noop'|'skip',
 *   findings: import('./findings-schema.js').Findings | null,
 *   error?: string
 * }} ScanResult
 */

// ---------------------------------------------------------------------------
// Scan lock helpers — prevent concurrent scan corruption
// ---------------------------------------------------------------------------

const LOCK_DIR = resolveDataDir();

/**
 * Compute a short hash for lock file naming.
 * Uses sorted repo paths as project identifier.
 * @param {string[]} repoPaths
 * @returns {string} 12-char hex hash
 */
export function scanLockHash(repoPaths) {
  const key = repoPaths.slice().sort().join('\n');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Check if a PID is still running.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a filesystem lock for a scan. Rejects if another scan is active.
 * Cleans up stale locks (dead PID).
 * @param {string[]} repoPaths
 * @param {Function} slog - scan logger
 * @returns {string} lockPath - caller must release via releaseScanLock
 */
export function acquireScanLock(repoPaths, slog) {
  const hash = scanLockHash(repoPaths);
  const lockDir = resolveDataDir();
  const lockPath = join(lockDir, `scan-${hash}.lock`);

  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lock.pid && isProcessRunning(lock.pid)) {
        throw new Error(
          `Scan already in progress for this project (PID ${lock.pid}, started ${lock.startedAt}). ` +
          'Wait for the current scan to finish or remove the lock file: ' + lockPath
        );
      }
      // Stale lock — PID is gone
      slog('WARN', 'removing stale scan lock', { lockPath, stalePid: lock.pid });
      unlinkSync(lockPath);
    } catch (err) {
      if (err.message.startsWith('Scan already in progress')) throw err;
      // Corrupted lock file — remove it
      slog('WARN', 'removing corrupted scan lock', { lockPath });
      try { unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }

  writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    repoPaths,
  }));

  return lockPath;
}

/**
 * Release a scan lock file.
 * @param {string} lockPath
 */
export function releaseScanLock(lockPath) {
  try { unlinkSync(lockPath); } catch { /* already gone */ }
}

/**
 * Scan one or more repos by dispatching agents in parallel via Promise.allSettled,
 * with retry-once on agentRunner throw. DB writes remain sequential after all
 * agent calls resolve.
 *
 * Each non-skip, non-noop repo runs its entire write phase inside a single
 * db.transaction() per repo (ISO-03):
 *   Phase A: captures scanStartedAt + changedFiles before agent invocation.
 *   Phase B: delegates to persistScanResult() (PIPE-01, 141-02) which wraps
 *     beginScan(), _restampExistingRows (PIPE-04 incremental), persistFindings(),
 *     applyPendingOverridesSync(), and endScan() in one transaction.
 *   beginScan is INSIDE the transaction — a rollback removes the scan_versions
 *     row so no orphaned bracket can exist (ISO-10).
 *   On parse failure, the write transaction is never opened — prior data is intact.
 *   On agentRunner throw (after retry), same — no bracket opened in Phase A.
 *
 * Incremental scans inject a changed-files constraint into the prompt.
 *   When modified.length === 0, the scan is a no-op (no agent, no bracket).
 *
 * @param {string[]} repoPaths - Absolute paths to repos to scan
 * @param {{ full?: boolean }} [options]
 * @param {{
 *   upsertRepo: (repoData: object) => number,
 *   getRepoState: (id: number) => object|null,
 *   beginScan: (repoId: number, startedAt?: string) => number,
 *   persistFindings: (repoId: number, findings: object, commit: string, scanVersionId: number) => void,
 *   endScan: (repoId: number, scanVersionId: number) => void,
 *   _db: { transaction: (fn: Function) => Function },
 * }} queryEngine
 * @returns {Promise<ScanResult[]>}
 */
export async function scanRepos(repoPaths, options = {}, queryEngine) {
  if (agentRunner === null) {
    throw new Error("agentRunner not initialized — call setAgentRunner first");
  }

  // Scan-local log helper — no-ops silently when logger not injected
  function slog(level, msg, extra = {}) {
    if (_logger) _logger.log(level, msg, extra);
  }

  // Acquire per-project filesystem lock — rejects concurrent scans
  const lockPath = acquireScanLock(repoPaths, slog);

  try {

  // Record start time and emit BEGIN event
  const scanStart = Date.now();
  const scanMode = options.full === true ? 'full' : 'incremental';
  slog('INFO', 'scan BEGIN', { repoCount: repoPaths.length, mode: scanMode });

  // Load the merged externals catalog ONCE per scanRepos
  // invocation. The merge is shipped catalog + user's arcanon.config.json
  // external_labels (user wins on collision). The shipped YAML file is never
  // mutated — merge is in-memory only. Worker is per-project so process.cwd()
  // is the project root for the user-config lookup. The shipped portion is
  // module-cached; the user portion is re-read each scan so config edits land
  // on the next /arcanon:map without a worker restart.
  const _externalsCatalog = loadMergedCatalog(process.cwd(), _logger);

  // Load shared prompt components once
  const commonRules = readFileSync(join(__dirname, "agent-prompt-common.md"), "utf8");
  const schemaJson = readFileSync(join(__dirname, "agent-schema.json"), "utf8");
  const promptService = readFileSync(join(__dirname, "agent-prompt-service.md"), "utf8");
  const promptLibrary = readFileSync(join(__dirname, "agent-prompt-library.md"), "utf8");
  const promptInfra = readFileSync(join(__dirname, "agent-prompt-infra.md"), "utf8");
  // Discovery prompt for structure analysis
  const promptDiscovery = readFileSync(join(__dirname, "agent-prompt-discovery.md"), "utf8");

  const promptComponents = { commonRules, schemaJson, promptService, promptLibrary, promptInfra, promptDiscovery };

  /**
   * Scan a single repo: discovery pass + deep agent invocation with retry-once.
   * Returns a result object carrying DB-write data on success, or a skip/error result.
   * Internal _writeDb flag signals Phase B to perform DB writes for this result.
   *
   * @param {string} repoPath
   * @returns {Promise<object>} Internal result object (cleaned before output)
   */
  async function scanOneRepo(repoPath) {
    // 1. Ensure repo row exists
    const repoId = queryEngine.upsertRepo({
      path: repoPath,
      name: basename(repoPath),
      type: "single",
    });

    // 2. Determine scan mode
    const ctx = buildScanContext(repoPath, repoId, queryEngine, options);

    // 3. Skip — no scan needed (no bracket for no-op scans)
    if (ctx.mode === "skip") {
      slog('DEBUG', 'scan skipped — no changes', { repoPath });
      return { repoPath, mode: "skip", findings: null };
    }

    // 3b. Incremental no-op — diff returned empty modified list 
    //     Check BEFORE beginScan — no bracket should be opened for a no-op.
    if (ctx.mode === "incremental" && ctx.files !== null && ctx.files.modified.length === 0) {
      slog('DEBUG', 'incremental-noop — no changed files', { repoPath });
      return { repoPath, mode: "incremental-noop", findings: null };
    }

    // 4. Discovery pass: structure analysis
    // Runs BEFORE beginScan — does not open a scan bracket.
    const discoveryContext = await runDiscoveryPass(repoPath, promptComponents.promptDiscovery, agentRunner, slog);

    // Log discovery done with detected languages/frameworks
    slog('INFO', 'discovery done', {
      repoPath,
      languages: Array.isArray(discoveryContext.languages) ? discoveryContext.languages : [],
      frameworks: Array.isArray(discoveryContext.frameworks) ? discoveryContext.frameworks : [],
    });

    // 6. Detect repo type and select type-specific prompt
    const repoType = detectRepoType(repoPath);
    slog('DEBUG', 'repo type detected', { repoPath, repoType });

    // Deep scan: use type-specific prompt with discovery context
    const discoveryJson = JSON.stringify(discoveryContext, null, 2);
    const typePrompt = repoType === "library" ? promptComponents.promptLibrary
      : repoType === "infra" ? promptComponents.promptInfra
      : promptComponents.promptService;
    const interpolatedPrompt = typePrompt
      .replaceAll("{{REPO_PATH}}", repoPath)
      .replaceAll("{{DISCOVERY_JSON}}", discoveryJson)
      .replaceAll("{{SERVICE_HINT}}", basename(repoPath))
      .replaceAll("{{COMMON_RULES}}", promptComponents.commonRules.replaceAll("{{REPO_PATH}}", repoPath))
      .replaceAll("{{SCHEMA_JSON}}", promptComponents.schemaJson);

    // 7. Inject changed-files constraint for incremental scans 
    //     The constraint is a hard directive — "You MUST only examine" — not advisory.
    let finalPrompt = interpolatedPrompt;
    if (ctx.mode === "incremental" && ctx.files !== null) {
      finalPrompt = interpolatedPrompt + buildIncrementalConstraint(ctx.files.modified);
    }

    // 8. Invoke agent — with retry-once on agentRunner throw
    // Capture scan start timestamp here (Phase A) so beginScan can record the
    // precise moment Phase A began. beginScan itself runs inside the Phase B
    // write transaction (ISO-10: a rolled-back write removes the bracket too).
    const scanStartedAt = new Date().toISOString();
    slog('INFO', 'scan started', { repoPath, mode: ctx.mode });
    let rawResponse;
    try {
      rawResponse = await agentRunner(finalPrompt, repoPath);
    } catch (_firstErr) {
      // First attempt threw — retry once with same arguments
      try {
        rawResponse = await agentRunner(finalPrompt, repoPath);
      } catch (retryErr) {
        // Second attempt also threw — skip repo with WARN, prior data preserved.
        // No scan bracket was opened in Phase A (beginScan is inside Phase B transaction).
        slog('WARN', 'scan failed after retry — repo skipped', {
          repoPath,
          repoName: basename(repoPath),
          error: retryErr.message,
        });
        return { repoPath, mode: ctx.mode, findings: null, error: retryErr.message, skipped: true };
      }
    }

    // 9. Parse and validate agent output
    const result = parseAgentOutput(rawResponse);

    if (result.valid === false) {
      slog('WARN', 'scan failed — preserving prior data', { repoPath, error: result.error });
      // endScan is NOT called — prior scan data remains intact
      // No retry for parse failures — only agentRunner throws trigger retry
      return {
        repoPath,
        mode: ctx.mode,
        findings: null,
        error: result.error,
      };
    }

    // Log deep scan done with service/connection counts
    slog('INFO', 'deep scan done', {
      repoPath,
      services: Array.isArray(result.findings?.services) ? result.findings.services.length : 0,
      connections: Array.isArray(result.findings?.connections) ? result.findings.connections.length : 0,
    });

    // 9b. Log validation warnings (e.g., skipped services)
    for (const w of result.warnings) {
      slog('WARN', 'findings validation warning', { repoPath, warning: w });
    }

    // Return all data needed for Phase B (sequential DB writes).
    // scanStartedAt (not scanVersionId) is returned here — beginScan runs inside
    // the Phase B write transaction so the scan_versions row is atomic with the
    // rest of the write (ISO-10). scanVersionId is the transaction return value.
    return {
      repoPath,
      mode: ctx.mode,
      findings: result.findings,
      repoId,
      scanStartedAt,
      changedFiles: ctx.files,
      currentHead: getCurrentHead(repoPath),
      _writeDb: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase A — Parallel agent invocation via Promise.allSettled fan-out
  // ---------------------------------------------------------------------------
  const settled = await Promise.allSettled(repoPaths.map((rp) => scanOneRepo(rp)));

  // Collect results — rejected promises become skip results (scanOneRepo catches
  // all throws internally, but handle defensively in case of unexpected rejection)
  const agentResults = settled.map((s) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      repoPath: 'unknown',
      mode: 'full',
      findings: null,
      error: String(s.reason),
      skipped: true,
    };
  });

  // ---------------------------------------------------------------------------
  // Phase B — Sequential DB writes and enrichment
  // DB writes are sequential — SQLite/better-sqlite3 gets SQLITE_BUSY if parallelized.
  // Enrichment is sequential — uses the same DB handle.
  // ---------------------------------------------------------------------------

  // Build boundaryMap ONCE per scanRepos() invocation for the Chroma sync (INTG-02).
  // Reads arcanon.config.json boundaries; gracefully skips when absent.
  const _chromaBoundaryMap = new Map();
  try {
    const _cfgPath = resolveConfigPath(process.cwd());
    const _cfg = JSON.parse(readFileSync(_cfgPath, "utf8"));
    const _boundaries = _cfg.boundaries || {};
    for (const [boundaryName, members] of Object.entries(_boundaries)) {
      for (const memberName of members) {
        _chromaBoundaryMap.set(memberName, boundaryName);
      }
    }
  } catch { /* config absent or no boundaries key — map stays empty */ }

  /** @type {ScanResult[]} */
  const results = [];

  for (const r of agentResults) {
    if (!r._writeDb) {
      // Skip/noop/error result — push as-is (remove internal flag if present)
      const { _writeDb: _ignored, ...output } = r;
      results.push(output);
      continue;
    }

    // 10. Write phase — delegates to persistScanResult (PIPE-01, 141-02).
    //
    //   persistScanResult wraps the full write sequence inside one
    //   queryEngine._db.transaction() call (ISO-03):
    //     beginScan (ISO-10), _restampExistingRows (PIPE-04 incremental),
    //     persistFindings, applyPendingOverridesSync (PIPE-03),
    //     endScan (ISO-04 completed_at stamp + stale delete).
    //
    //   changedFiles (ctx.files) and scanStartedAt from Phase A are threaded
    //   through r.changedFiles and r.scanStartedAt (PIPE-04).
    //
    //   agentRunner, discovery, enrichment, dep-collect, and Hub sync
    //   remain OUTSIDE this call (async / best-effort).
    let scanVersionId;
    try {
      ({ scanVersionId } = persistScanResult(
        r.repoId, r.repoPath, r.findings, r.currentHead,
        { mode: r.mode, changedFiles: r.changedFiles, startedAt: r.scanStartedAt },
        queryEngine,
        slog,
      ));
    } catch (txErr) {
      // persistScanResult threw — SQLite adapter has already issued ROLLBACK.
      // beginScan's scan_versions INSERT is rolled back too (ISO-10).
      // Log, push an error result, and continue so sibling repos still
      // commit (§Q7 Pitfall 6 / ISO-03 per-repo isolation).
      slog('ERROR', 'scan write transaction failed — rolled back', {
        repoPath: r.repoPath,
        error: txErr.message,
      });
      results.push({ repoPath: r.repoPath, mode: r.mode, findings: null, error: txErr.message });
      continue;
    }

    // 10a. Back-fill DB ids onto r.findings.services so the hub auto-sync
    // loop (step ) can call getDependenciesForService(svc.id).
    // persistFindings builds a name→id map internally but does not write ids
    // back onto the findings objects. We resolve them here via a single SELECT.
    if (Array.isArray(r.findings?.services) && r.findings.services.length > 0) {
      const dbServices = queryEngine._db
        .prepare('SELECT id, name FROM services WHERE repo_id = ?')
        .all(r.repoId);
      const nameToId = new Map(dbServices.map((s) => [s.name, s.id]));
      for (const svc of r.findings.services) {
        if (svc.name && nameToId.has(svc.name)) {
          svc.id = nameToId.get(svc.name);
        }
      }
    }

    // 11. Run enrichment pass per service — post-scan, after bracket closes
    // Enrichment runs after core scan. Bracket is already closed above.
    // Enrichment MUST NOT call beginScan/endScan — never opens a new bracket.
    try {
      const services = queryEngine._db
        .prepare('SELECT id, root_path, language, boundary_entry FROM services WHERE repo_id = ?')
        .all(r.repoId);
      let totalDeps = 0;
      const ecosystemsSeen = new Set();

      // ISO-08 (D-09 deviation): pre-wipe node_metadata for this repo before
      // the enrichment loop so stale keys from prior scans don't persist.
      // node_metadata has no scan_version_id — pre-wipe + full re-write by
      // enrichers is the only clean staleness signal. Post-bracket by design
      // (enrichment is architecturally outside the scan transaction). Best-effort
      // try/catch so a pre-migration-008 DB or transient error never fails the scan.
      try {
        queryEngine._db
          .prepare(
            'DELETE FROM node_metadata WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)',
          )
          .run(r.repoId);
      } catch (err) {
        slog('WARN', 'node-metadata pre-wipe failed (pre-mig-008?)', {
          repoPath: r.repoPath,
          error: err.message,
        });
      }

      for (const service of services) {
        await runEnrichmentPass(service, queryEngine._db, _logger, r.repoPath);

        // collect library deps after enrichment — MUST NOT touch scan bracket.
        // Runs AFTER endScan() has closed the bracket (line ~766 above). Stale
        // cleanup for dep rows is handled by ON DELETE CASCADE from services(id)
        // when the NEXT scan's endScan() removes a stale service.
        try {
          const { rows, ecosystems_scanned } = await collectDependencies({
            repoPath: r.repoPath,
            rootPath: service.root_path,
            logger: _logger,
          });
          for (const row of rows) {
            try {
              queryEngine.upsertDependency({
                ...row,
                service_id: service.id,
                scan_version_id: scanVersionId,
              });
              totalDeps++;
            } catch (err) {
              slog('WARN', 'dep-scan: upsert failed', {
                repoPath: r.repoPath,
                service: service.id,
                package: row.package_name,
                error: err.message,
              });
            }
          }
          for (const eco of ecosystems_scanned) ecosystemsSeen.add(eco);
        } catch (err) {
          // any throw from the collector is swallowed — the scan completes
          slog('WARN', 'dep-scan: collector error', {
            repoPath: r.repoPath,
            service: service.id,
            error: err.message,
          });
        }
      }

      // ISO-08 (D-09 deviation): stale sweep for service_dependencies for this
      // repo. Dep rows from the current scan have scan_version_id = scanVersionId;
      // any row from a prior scan still carries the old id and is now stale.
      // Post-bracket by design (dep collection is architecturally outside the
      // scan transaction). Best-effort try/catch so a pre-migration-010 DB or
      // transient error never fails the scan.
      try {
        queryEngine._db
          .prepare(
            'DELETE FROM service_dependencies WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?) AND (scan_version_id != ? OR scan_version_id IS NULL)',
          )
          .run(r.repoId, scanVersionId);
      } catch (err) {
        slog('WARN', 'service-dependencies stale sweep failed (pre-mig-010?)', {
          repoPath: r.repoPath,
          error: err.message,
        });
      }

      // per-repo actor labeling pass.
      // Runs after the per-service enrichment loop (so any future per-service
      // enrichers that touch actors have already done so) and BEFORE the
      // 'enrichment done' log line so the labels are observable as part of
      // the same scan completion. Defense-in-depth try/catch — actor-labeler
      // already swallows its own errors.
      try {
        const { matched, considered } = await runActorLabeling(
          r.repoId,
          queryEngine._db,
          _logger,
          _externalsCatalog,
        );
        slog('INFO', 'actor-labeling done', {
          repoPath: r.repoPath,
          matched,
          considered,
        });
      } catch (err) {
        slog('WARN', 'actor-labeling pass error', {
          repoPath: r.repoPath,
          error: err.message,
        });
      }

      // Log enrichment done with number of services enriched
      slog('INFO', 'enrichment done', { repoPath: r.repoPath, enricherCount: services.length });
      // Log dep-scan coverage — ecosystems_scanned makes gaps visible
      slog('INFO', 'dep-scan done', {
        repoPath: r.repoPath,
        serviceCount: services.length,
        totalDeps,
        ecosystemsSeen: [...ecosystemsSeen].sort(),
      });
    } catch (err) {
      slog('WARN', 'enrichment pass error', { repoPath: r.repoPath, error: err.message });
    }

    // Chroma sync (INTG-02): delete-then-upsert after actor labeling so actor
    // metadata is present in the DB when we build actorMap. Runs ONCE per repo
    // per scan — hooked ONLY here in manager.js Phase B. syncFindingsToChroma
    // guards internally with isChromaAvailable() so this is a no-op when Chroma
    // is absent; a Chroma error must never fail the scan (try/catch + WARN).
    try {
      // Derive projectHash from the DB file path (matches query-engine.js search()).
      // Guard the :memory: / missing-name case — in-memory test DBs must never
      // mint records under "." or an empty prefix (142-RESEARCH §Q2, INTG-03).
      const _dbName = queryEngine._db?.name || "";
      const _projectHash = (_dbName === ":memory:" || !_dbName)
        ? "unknown"
        : (basename(dirname(_dbName)) || "unknown");

      // Build actorMap from actor_connections (written by runActorLabeling above).
      // Tolerate missing actors table (pre-migration-008 DB).
      const _actorMap = new Map();
      try {
        const _actorRows = queryEngine._db.prepare(`
          SELECT s.name AS service_name, a.name AS actor_name
          FROM actor_connections ac
          JOIN actors a ON a.id = ac.actor_id
          JOIN services s ON s.id = ac.service_id
          WHERE s.repo_id = ?
        `).all(r.repoId);
        for (const _row of _actorRows) {
          if (!_actorMap.has(_row.service_name)) _actorMap.set(_row.service_name, []);
          _actorMap.get(_row.service_name).push(_row.actor_name);
        }
      } catch { /* actors table absent (pre-migration-008) */ }

      await syncFindingsToChroma(
        _projectHash,
        r.repoId,
        r.findings,
        { boundaryMap: _chromaBoundaryMap, actorMap: _actorMap },
      );
    } catch (err) {
      slog('WARN', 'chroma sync error', { repoPath: r.repoPath, error: err.message });
    }

    slog('INFO', 'scan complete', { repoPath: r.repoPath, mode: r.mode });
    // _scanVersionId is internal — underscore-prefixed per the _writeDb convention.
    // Consumed by the post-hub-sync snapshot call (D-06, ISO-09) to populate repos_json.
    results.push({ repoPath: r.repoPath, mode: r.mode, findings: r.findings, _scanVersionId: scanVersionId });
  }

  // Callers that suppress upload of synthetic / sandboxed scan data set
  // options.skipHubSync=true. Default behaviour for live scans (no flag) is
  // unchanged.
  // Optional Arcanon Hub sync — opt-in via ARCANON_API_KEY or config.hub.auto-sync.
  // Runs per-repo, fire-and-log — a hub failure never fails the scan.
  if (options.skipHubSync) {
    slog('INFO', 'hub auto-sync skipped — caller requested skipHubSync');
  } else {
  try {
    const { hubAutoSync, hubUrl, projectSlug, libraryDepsEnabled, orgId } = _readHubConfig();
    // Credential check spans env vars AND ~/.arcanon/config.json so that
    // users who ran /arcanon:login (without exporting an env var) still
    // get auto-sync.
    if (hubAutoSync && !hasCredentials()) {
      // User opted in but never set up credentials — surface a nudge so the
      // setting isn't silently ignored. The first scan log surfaces this;
      // subsequent scans repeat it so missing creds stay visible.
      slog('WARN', 'hub auto-sync skipped — no api_token configured', {
        next_step: 'Get a key at https://app.arcanon.dev/settings/api-keys, then /arcanon:login',
      });
    }
    if (hasCredentials() && hubAutoSync) {
      for (const r of results) {
        if (!r.findings) continue;
        // when the feature flag is on, attach per-service deps
        // fetched from the local DB. When the flag is off, skip the DB read entirely
        // and let buildFindingsBlock emit v1.0 unchanged.
        if (libraryDepsEnabled && Array.isArray(r.findings.services)) {
          for (const svc of r.findings.services) {
            if (typeof svc.id === 'number') {
              svc.dependencies = queryEngine.getDependenciesForService(svc.id);
            }
          }
        }
        try {
          const outcome = await syncFindings({
            findings: r.findings,
            repoPath: r.repoPath,
            projectSlug,
            hubUrl,
            // per-repo override into the precedence chain
            // (opts.orgId beats ARCANON_ORG_ID env beats ~/.arcanon/config.json
            // default_org_id). When undefined here, the resolver falls through
            // to env / home-config; if all three are missing, resolveCredentials
            // throws AuthError and the outcome.error.message lands in the WARN
            // log below — surfacing the actionable remediation to the user
            // .
            orgId,
            scanMode: r.mode,
            libraryDepsEnabled,   // feature flag — gates v1.1 emission
            log: (level, msg, data) => slog(level, `hub-sync: ${msg}`, data),
          });
          if (outcome.ok) {
            slog('INFO', 'hub upload accepted', {
              repoPath: r.repoPath,
              scan_upload_id: outcome.result?.scan_upload_id,
            });
          } else if (outcome.enqueuedId) {
            slog('INFO', 'hub upload enqueued', {
              repoPath: r.repoPath,
              queueId: outcome.enqueuedId,
            });
          } else {
            slog('WARN', 'hub upload failed', {
              repoPath: r.repoPath,
              error: outcome.error?.message,
            });
          }
          for (const w of outcome.warnings || []) {
            slog('WARN', 'hub-sync payload warning', { repoPath: r.repoPath, warning: w });
          }
        } catch (err) {
          slog('ERROR', 'hub sync threw', { repoPath: r.repoPath, error: err.message });
        }
      }
    }
  } catch (err) {
    slog('WARN', 'hub sync skipped', { error: err.message });
  }
  } // end else (options.skipHubSync) —

  // ---------------------------------------------------------------------------
  // Once-per-run immutable snapshot (D-06, ISO-06, ISO-09)
  //
  // Fires AFTER ALL Phase B writes commit AND after hub sync, while still
  // inside the try { } finally { releaseScanLock } block (Pitfall 6 — the
  // scan lock prevents a concurrent VACUUM INTO race for the same project).
  //
  // Guard (Pitfall 3): skip if every repo failed — no new data was written.
  // A partial-failure run (≥1 repo succeeded) DOES snapshot so the partial
  // result is preserved in the diff history.
  //
  // D-03 hard constraint (VACUUM INTO cannot run inside a transaction): this
  // site is structurally outside all db.transaction() calls — the Phase B
  // writeTx per repo has already committed before this line executes.
  // ---------------------------------------------------------------------------
  if (results.some(r => r.findings !== null)) {
    try {
      const kind = repoPaths.length === 1 ? 'rescan' : 'map';
      const coveredRepos = results
        .filter(r => r.findings !== null)
        .map(r => ({ path: r.repoPath, scan_version_id: r._scanVersionId }));
      createSnapshot(queryEngine._db, `${kind} ${new Date().toISOString()}`, kind, coveredRepos);
      slog('INFO', 'snapshot created', { kind, repoCount: coveredRepos.length });
    } catch (err) {
      // Snapshot failures are non-fatal — scan results are already committed.
      // Log prominently so the ops team can investigate disk/permission issues.
      slog('WARN', 'snapshot creation failed — scan results committed but no history entry', {
        error: err.message,
      });
    }
  }

  // Emit END event with totals and wall-clock duration
  const totalServices = results.reduce((n, r) => n + (Array.isArray(r.findings?.services) ? r.findings.services.length : 0), 0);
  const totalConnections = results.reduce((n, r) => n + (Array.isArray(r.findings?.connections) ? r.findings.connections.length : 0), 0);
  slog('INFO', 'scan END', { totalServices, totalConnections, durationMs: Date.now() - scanStart });

  return results;

  } finally {
    releaseScanLock(lockPath);
  }
}

// Exported for test access only (_-prefixed = internal helper, not public surface).
export { _readHubAutoSync, _readHubConfig };
