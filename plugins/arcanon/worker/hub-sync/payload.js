/**
 * worker/hub-sync/payload.js — Transform internal findings → ScanPayloadV1.
 *
 * The Arcanon Hub server (arcanon-hub/packages/api-server) accepts scans in
 * the `ScanPayloadV1` envelope. This module adapts the plugin's internal
 * findings shape (produced by worker/scan/findings.js) to that envelope.
 *
 * Hub contract reference:
 *   POST https://api.arcanon.dev/api/v1/scans/upload
 *   - version: "1.0" (exact literal)
 *   - metadata.tool ∈ {claude-code, copilot, cursor, cli, unknown} — we send "claude-code"
 *   - metadata.repo_name, metadata.commit_sha are required
 *   - metadata.project_slug is required for org-scoped API keys
 *   - findings.services is required and must have ≥ 1 entry
 *   - All connection.source fields must reference a known service name
 *
 * Required fields missing → throw PayloadError (caller should surface to user).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Server-side enum. Keep in sync with arcanon-hub scan_payload.py KNOWN_TOOLS. */
export const KNOWN_TOOLS = Object.freeze([
  "claude-code",
  "copilot",
  "cursor",
  "cli",
  "unknown",
]);

/** Raised when a payload cannot be built from the findings. */
export class PayloadError extends Error {
  constructor(message, { field } = {}) {
    super(message);
    this.name = "PayloadError";
    this.field = field;
  }
}

function readPluginVersion() {
  try {
    const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function gitSafe(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Derive git metadata for a repo path.
 * Returns best-effort values — every field is nullable.
 *
 * @param {string} repoPath absolute path to a git repo
 * @returns {{ repo_url: string|null, branch: string|null, commit_sha: string|null }}
 */
export function deriveGitMetadata(repoPath) {
  return {
    repo_url: gitSafe(["remote", "get-url", "origin"], repoPath),
    branch: gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], repoPath),
    commit_sha: gitSafe(["rev-parse", "HEAD"], repoPath),
  };
}

/**
 * Build the `findings` section of ScanPayloadV1 from a plugin scan result.
 *
 * Reconciles `connection.source` to `service.name` — connections that reference
 * services not in the `services` array are dropped with a warning. The hub's
 * Pydantic validator 422s on orphan connections, so we filter proactively.
 *
 * @param {{ services: Array, connections?: Array, schemas?: Array }} findings
 * @returns {{ services: Array, connections: Array, schemas: Array, actors: Array, warnings: string[] }}
 */
export function buildFindingsBlock(findings) {
  const services = Array.isArray(findings?.services) ? findings.services : [];
  const connections = Array.isArray(findings?.connections) ? findings.connections : [];
  const schemas = Array.isArray(findings?.schemas) ? findings.schemas : [];

  const serviceNames = new Set(services.map((s) => s.name).filter(Boolean));
  const warnings = [];

  const validConnections = connections.filter((c) => {
    if (!c.source || !serviceNames.has(c.source)) {
      warnings.push(`dropped connection with unknown source "${c.source}" → "${c.target}"`);
      return false;
    }
    return true;
  });

  return {
    services: services.map((s) => ({
      name: s.name,
      root_path: s.root_path || ".",
      language: s.language || "unknown",
      type: s.type || "service",
      ...(s.boundary_entry ? { boundary_entry: s.boundary_entry } : {}),
      ...(s.confidence ? { confidence: s.confidence } : {}),
      exposes: Array.isArray(s.exposes) ? s.exposes : [],
    })),
    connections: validConnections.map((c) => ({
      source: c.source,
      target: c.target,
      protocol: c.protocol || "unknown",
      ...(c.method ? { method: c.method } : {}),
      ...(c.path ? { path: c.path } : {}),
      ...(c.crossing ? { crossing: c.crossing } : {}),
      ...(c.confidence ? { confidence: c.confidence } : {}),
      ...(c.evidence ? { evidence: c.evidence } : {}),
    })),
    schemas,
    actors: Array.isArray(findings?.actors) ? findings.actors : [],
    warnings,
  };
}

/**
 * Build a ScanPayloadV1 envelope ready to POST to /api/v1/scans/upload.
 *
 * @param {object} opts
 * @param {{ services, connections?, schemas? }} opts.findings — plugin findings
 * @param {string} opts.repoPath — absolute path to the repo being reported
 * @param {string} [opts.repoName] — overrides `basename(repoPath)`
 * @param {string} [opts.commitSha] — overrides derived git commit_sha
 * @param {string} [opts.branch] — overrides derived branch
 * @param {string} [opts.projectSlug] — required for org-scoped keys
 * @param {string} [opts.tool="claude-code"] — must be in KNOWN_TOOLS
 * @param {string} [opts.scanMode="full"] — "full" or "incremental"
 * @param {Date|string} [opts.startedAt] — ISO 8601 timestamp, defaults to now
 * @param {Date|string} [opts.completedAt] — ISO 8601 timestamp, defaults to now
 * @param {number} [opts.filesScanned]
 * @returns {{payload: object, warnings: string[]}}
 * @throws {PayloadError} if required fields cannot be derived
 */
export function buildScanPayload(opts) {
  const {
    findings,
    repoPath,
    repoName,
    commitSha,
    branch,
    projectSlug,
    tool = "claude-code",
    scanMode = "full",
    startedAt,
    completedAt,
    filesScanned,
  } = opts || {};

  if (!findings || typeof findings !== "object") {
    throw new PayloadError("findings is required", { field: "findings" });
  }
  if (!repoPath) {
    throw new PayloadError("repoPath is required", { field: "repoPath" });
  }
  if (!KNOWN_TOOLS.includes(tool)) {
    throw new PayloadError(`tool "${tool}" is not in KNOWN_TOOLS`, { field: "tool" });
  }

  const gitMeta = deriveGitMetadata(repoPath);
  const finalCommit = commitSha || gitMeta.commit_sha;
  if (!finalCommit) {
    throw new PayloadError(
      "commit_sha could not be derived (not a git repo and no commitSha passed)",
      { field: "commit_sha" },
    );
  }

  const finalRepoName = repoName || path.basename(path.resolve(repoPath));
  if (!finalRepoName) {
    throw new PayloadError("repo_name could not be derived", { field: "repo_name" });
  }

  const findingsBlock = buildFindingsBlock(findings);
  if (findingsBlock.services.length === 0) {
    throw new PayloadError("findings.services must contain at least one entry", {
      field: "findings.services",
    });
  }

  const toIso = (v) => (v instanceof Date ? v.toISOString() : v || new Date().toISOString());

  const payload = {
    version: "1.0",
    metadata: {
      tool,
      tool_version: readPluginVersion(),
      scan_mode: scanMode,
      ...(gitMeta.repo_url ? { repo_url: gitMeta.repo_url } : {}),
      repo_name: finalRepoName,
      ...(branch || gitMeta.branch ? { branch: branch || gitMeta.branch } : {}),
      commit_sha: finalCommit,
      started_at: toIso(startedAt),
      completed_at: toIso(completedAt),
      ...(typeof filesScanned === "number" ? { files_scanned: filesScanned } : {}),
      ...(projectSlug ? { project_slug: projectSlug } : {}),
    },
    findings: {
      services: findingsBlock.services,
      connections: findingsBlock.connections,
      schemas: findingsBlock.schemas,
      actors: findingsBlock.actors,
    },
  };

  return { payload, warnings: findingsBlock.warnings };
}

/** Hard server-side limit. Payloads above this size will 413. */
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/**
 * JSON-stringify a payload and reject if it exceeds the hub's 10 MB limit.
 * Returns the serialized body and byte length.
 *
 * @param {object} payload
 * @returns {{ body: string, bytes: number }}
 */
export function serializePayload(payload) {
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new PayloadError(
      `payload is ${bytes} bytes, exceeds hub limit of ${MAX_PAYLOAD_BYTES} bytes`,
      { field: "payload_size" },
    );
  }
  return { body, bytes };
}
