/**
 * worker/scan-manager.js — Scan orchestration for AllClear v2.0 agent scanning.
 *
 * Exports:
 *   getChangedFiles(repoPath, sinceCommit)       - Git diff wrapper
 *   buildScanContext(repoPath, repoId, qe, opts) - Determines scan mode
 *   scanRepos(repoPaths, options, queryEngine)   - Main scan entry point
 *   setAgentRunner(fn)                           - Inject agent invoker (test + MCP server use)
 *
 * Agent invocation uses an injected runner to decouple from Claude's Task tool.
 * Background subagents cannot access MCP tools (Claude Code issue #13254) — all
 * agent invocations run in the foreground via the MCP server's agentRunner.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAgentOutput } from "./findings.js";

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
      output = execSync(`git -C ${JSON.stringify(repoPath)} ls-files`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const files = output.trim().split("\n").filter(Boolean);
      return { modified: files, deleted: [], renamed: [] };
    }

    // Incremental — diff since the given commit
    output = execSync(
      `git -C ${JSON.stringify(repoPath)} diff --name-status ${sinceCommit} HEAD`,
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
  return execSync(`git -C ${JSON.stringify(repoPath)} rev-parse HEAD`, {
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

  // First scan — no repo_state entry → always full (SCAN-06)
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
// scanRepos
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   repoPath: string,
 *   mode: 'full'|'incremental'|'skip',
 *   findings: import('./findings-schema.js').Findings | null,
 *   error?: string
 * }} ScanResult
 */

/**
 * Scan one or more repos by dispatching agents sequentially in the foreground.
 * Background agents cannot access MCP tools (Claude Code issue #13254) — foreground only.
 *
 * @param {string[]} repoPaths - Absolute paths to repos to scan
 * @param {{ full?: boolean }} [options]
 * @param {{
 *   upsertRepo: (repoData: object) => { id: number },
 *   getRepoState: (id: number) => object|null,
 *   setRepoState: (id: number, commit: string) => void,
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

  // Load the agent prompt template once
  const promptTemplatePath = join(__dirname, "agent-prompt-deep.md");
  const promptTemplate = readFileSync(promptTemplatePath, "utf8");

  /** @type {ScanResult[]} */
  const results = [];

  // Sequential — for...of (never Promise.all — foreground-only requirement)
  for (const repoPath of repoPaths) {
    // 1. Ensure repo row exists
    const repo = queryEngine.upsertRepo({
      path: repoPath,
      name: basename(repoPath),
      type: "single",
    });

    // 2. Determine scan mode
    const ctx = buildScanContext(repoPath, repo.id, queryEngine, options);

    // 3. Skip — no scan needed
    if (ctx.mode === "skip") {
      slog('DEBUG', 'scan skipped — no changes', { repoPath });
      results.push({ repoPath, mode: "skip", findings: null });
      continue;
    }

    // 4. Interpolate prompt
    const serviceHint = basename(repoPath);
    const interpolatedPrompt = promptTemplate
      .replaceAll("{{REPO_PATH}}", repoPath)
      .replaceAll("{{SERVICE_HINT}}", serviceHint);

    // 5. Invoke agent (foreground — agentRunner injected by MCP server or test)
    slog('INFO', 'scan started', { repoPath, mode: ctx.mode });
    const rawResponse = await agentRunner(interpolatedPrompt, repoPath);

    // 6. Parse and validate agent output
    const result = parseAgentOutput(rawResponse);

    if (result.valid === false) {
      slog('ERROR', 'agent output invalid', { repoPath, error: result.error });
      // Error per repo — one bad agent result does not stop other repos
      results.push({
        repoPath,
        mode: ctx.mode,
        findings: null,
        error: result.error,
      });
      continue;
    }

    // 7. Update repo state on success
    const currentHead = getCurrentHead(repoPath);
    queryEngine.setRepoState(repo.id, currentHead);

    slog('INFO', 'scan complete', { repoPath, mode: ctx.mode });
    results.push({ repoPath, mode: ctx.mode, findings: result.findings });
  }

  return results;
}
