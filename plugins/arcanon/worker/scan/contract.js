/**
 * worker/scan/contract.js — Canonical executable findings contract for Arcanon.
 *
 * This is the SINGLE SOURCE OF TRUTH for all finding validation rules, enum
 * values, and normalization logic. Every persistence path (scan pipeline via
 * manager.js and HTTP POST /scan via http.js) must pass findings through
 * validateFindings() exported from this module before any DB write.
 *
 * worker/scan/findings.js is a backward-compat re-export shim that points here;
 * all existing importers (manager.js, query-engine.js, tests, etc.) continue to
 * resolve unchanged.
 *
 * Contract fixes in this module (Phase 140):
 *   CTR-01a  VALID_CROSSINGS extended with "cross-service" — agent-emitted
 *            cross-service connections are now valid; reconciliation can still
 *            promote external→cross-service post-validation unchanged.
 *   CTR-02   Schema objects require a numeric connection_index in [0, N).
 *            Missing/non-integer/out-of-bounds → warn-and-skip (matching the
 *            warn-and-skip pattern used for services with invalid type/root_path).
 *            Only schemas with a valid connection_index are returned in
 *            result.findings.schemas.
 *   CTR-03   source_file and source_symbol are separate fields. A legacy combined
 *            "path:symbol" value is split by a colon heuristic: if the portion
 *            after the LAST colon contains no '/' (looks like a symbol, not a
 *            path component), the suffix is extracted as source_symbol and the
 *            prefix becomes source_file. The same split is applied to target_file
 *            → target_symbol for symmetry. The split runs BEFORE the absolute-path
 *            guard so the guard still sees a clean filesystem path.
 *
 * Protocol vocabulary (no change — already canonical via #42):
 *   #42 FALLBACK-NOT-REJECT is preserved verbatim. VALID_PROTOCOLS is exported for
 *   backward compat but is NOT used as an enforcement gate. Unknown protocol tokens
 *   are warned and kept, never rejected.
 *
 * Exports:
 *   validateFindings(obj)    — Validates an agent findings object
 *   parseAgentOutput(text)   — Extracts fenced JSON block and validates it
 *   VALID_CROSSINGS          — Canonical crossing enum (4 values incl. cross-service)
 *   VALID_PROTOCOLS          — Legacy export; NOT an enforcement gate
 *   VALID_CONFIDENCE         — "high" | "low"
 *   VALID_ROLES              — "request" | "response" | "event_payload"
 *   VALID_SERVICE_TYPES      — "service" | "library" | "sdk" | "infra"
 *
 * Zero external dependencies — uses only Node.js builtins.
 *
 * @typedef {{ name: string, type: string, required: boolean }} Field
 * @typedef {{ name: string, role: string, file: string, fields: Field[], connection_index?: number }} Schema
 * @typedef {{
 *   source: string,
 *   target: string,
 *   protocol: string,
 *   method: string,
 *   path: string,
 *   source_file: string|null,
 *   source_symbol?: string|null,
 *   target_file?: string|null,
 *   target_symbol?: string|null,
 *   confidence: string,
 *   evidence: string,
 *   crossing?: string|null
 * }} Connection
 * @typedef {{
 *   service_name: string,
 *   confidence: string,
 *   services: Array<{name: string, root_path: string, language: string, confidence: string}>,
 *   connections: Connection[],
 *   schemas: Schema[]
 * }} Findings
 * @typedef {{ valid: true, findings: Findings, warnings: string[] } | { valid: false, error: string }} FindingsResult
 */

import { maskHome } from "../lib/path-mask.js";
import { canonicalProtocol } from "../ui/modules/protocol.js";

/**
 * Legacy export retained for backward-compat with any importer. It is NO LONGER
 * an input gate: the canonical vocabulary in worker/ui/modules/protocol.js is
 * now authoritative, and validateFindings normalizes-and-keeps unknown
 * protocols (fallback, not reject) per #42. Do not reintroduce an allowlist
 * reject against this list.
 * @type {string[]}
 */
export const VALID_PROTOCOLS = [
  "rest",
  "grpc",
  "kafka",
  "rabbitmq",
  "internal",
  "sdk",
  "k8s",
  "tf",
  "helm",
];

/** @type {string[]} */
export const VALID_CONFIDENCE = ["high", "low"];

/** @type {string[]} */
export const VALID_ROLES = ["request", "response", "event_payload"];

/** @type {string[]} */
export const VALID_SERVICE_TYPES = ["service", "library", "sdk", "infra"];

/**
 * Canonical crossing values. CTR-01a adds "cross-service" as a fourth member:
 * agents may now emit it directly and reconciliation can still promote
 * external→cross-service post-validation without change.
 * @type {string[]}
 */
export const VALID_CROSSINGS = ["external", "sdk", "internal", "cross-service"];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns an error result.
 * @param {string} error
 * @returns {{ valid: false, error: string }}
 */
function err(error) {
  return { valid: false, error };
}

/**
 * Returns a success result.
 * @param {Findings} findings
 * @param {string[]} [warnings]
 * @returns {{ valid: true, findings: Findings, warnings: string[] }}
 */
function ok(findings, warnings = []) {
  return { valid: true, findings, warnings };
}

// ---------------------------------------------------------------------------
// validateFindings
// ---------------------------------------------------------------------------

/**
 * Validates an agent findings object against the Arcanon findings contract.
 *
 * @param {unknown} obj - The object to validate
 * @returns {FindingsResult}
 */
export function validateFindings(obj) {
  // Top-level type check
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return err("findings must be an object");
  }

  // Required array fields checked first so that validateFindings({}) yields
  // the most actionable error ("missing required field: connections") per spec.
  if (!Array.isArray(obj.connections)) {
    return err("missing required field: connections (must be an array)");
  }

  if (!Array.isArray(obj.services)) {
    return err("missing required field: services (must be an array)");
  }

  if (!Array.isArray(obj.schemas)) {
    return err("missing required field: schemas (must be an array)");
  }

  // Required top-level string fields
  if (typeof obj.service_name !== "string" || obj.service_name === "") {
    return err(
      "missing required field: service_name (must be a non-empty string)",
    );
  }

  if (!VALID_CONFIDENCE.includes(obj.confidence)) {
    return err(`confidence must be one of: ${VALID_CONFIDENCE.join(", ")}`);
  }

  // Collect warnings — initialized here so loops can push warn-and-skip messages
  const warnings = [];

  // Validate services — hard-fail on structural issues, warn-and-skip on semantic issues
  const validServices = [];
  for (let i = 0; i < obj.services.length; i++) {
    const svc = obj.services[i];
    if (typeof svc !== "object" || svc === null) {
      return err(`services[${i}] must be an object`);
    }
    if (typeof svc.name !== "string") {
      return err(`services[${i}].name must be a string`);
    }
    if (!VALID_CONFIDENCE.includes(svc.confidence)) {
      return err(
        `services[${i}].confidence must be one of: ${VALID_CONFIDENCE.join(", ")}`,
      );
    }
    // Warn-and-skip: type present but not a valid enum value
    if ("type" in svc && !VALID_SERVICE_TYPES.includes(svc.type)) {
      warnings.push(
        `services[${i}].type "${svc.type}" is not a valid service type (${VALID_SERVICE_TYPES.join(", ")}) — skipping`,
      );
      continue;
    }
    // Warn-and-skip: root_path missing or empty
    if (typeof svc.root_path !== "string" || svc.root_path === "") {
      warnings.push(
        `services[${i}].root_path must be a non-empty string — skipping`,
      );
      continue;
    }
    // Warn-and-skip: language missing or empty
    if (typeof svc.language !== "string" || svc.language === "") {
      warnings.push(
        `services[${i}].language must be a non-empty string — skipping`,
      );
      continue;
    }
    // base_path is optional; when present, must be string or null (multi-segment OK)
    if ("base_path" in svc && svc.base_path !== null && typeof svc.base_path !== "string") {
      warnings.push(
        `services[${i}].base_path must be a string or null — skipping`,
      );
      continue;
    }
    validServices.push(svc);
  }

  // Validate connections
  for (let i = 0; i < obj.connections.length; i++) {
    const conn = obj.connections[i];
    if (typeof conn !== "object" || conn === null) {
      return err(`connection[${i}] must be an object`);
    }
    if (typeof conn.source !== "string") {
      return err(`connection[${i}].source must be a string`);
    }
    if (typeof conn.target !== "string") {
      return err(`connection[${i}].target must be a string`);
    }
    // #42 FALLBACK-NOT-REJECT: protocol must be a string (a non-string is a
    // structural error), but an unrecognized token must NOT fail the parse.
    // Previously this branch rejected the ENTIRE repo's findings on any unknown
    // protocol. Now the connection is kept and canonicalized at persist-time;
    // validation only warns when the token does not map to a known bucket. The
    // raw conn.protocol is left untouched here — persist-time normalization
    // (query-engine) owns the canonical write and preserves the raw token.
    if (typeof conn.protocol !== "string") {
      return err(`connection[${i}].protocol must be a string`);
    }
    // Warn only for a GENUINELY unrecognized token that FALLS BACK to "other" —
    // NOT when the agent emits the literal canonical "other" (which canonicalizes
    // to "other" legitimately, not via the unknown-token fallback). Distinguish
    // them by the normalized raw token: a literal "other" is intentional, not drift.
    const rawToken = conn.protocol.trim().toLowerCase();
    if (canonicalProtocol(conn.protocol) === "other" && rawToken !== "other") {
      warnings.push(
        `connection[${i}].protocol "${conn.protocol}" is not a known protocol — kept and normalized to "other"`,
      );
    }
    if (typeof conn.method !== "string") {
      return err(`connection[${i}].method must be a string`);
    }
    if (typeof conn.path !== "string") {
      return err(`connection[${i}].path must be a string`);
    }
    // source_file must be string or null
    if (conn.source_file !== null && typeof conn.source_file !== "string") {
      return err(`connection[${i}].source_file must be a string or null`);
    }
    // CTR-03: split legacy combined "path:symbol" source_file format.
    // Run BEFORE the absolute-path guard so the guard sees the clean path.
    // Heuristic: split on the LAST colon only when the suffix after it
    // contains no '/' (looks like a symbol name, not a path component).
    if (typeof conn.source_file === "string" && conn.source_file.includes(":")) {
      const colonIdx = conn.source_file.lastIndexOf(":");
      const afterColon = conn.source_file.slice(colonIdx + 1);
      if (!afterColon.includes("/")) {
        warnings.push(
          `connection[${i}].source_file contains symbol suffix "${afterColon}" — splitting into source_symbol`,
        );
        conn.source_symbol = afterColon;
        conn.source_file = conn.source_file.slice(0, colonIdx);
      }
    }
    // The agent contract mandates RELATIVE source_file paths
    // (worker/scan/agent-prompt-service.md). If the agent regresses
    // and emits an absolute path, drop the offending field with a WARN and
    // KEEP the rest of the connection — do NOT fail the scan. The WARN value
    // itself is masked via maskHome so the rejection message can't leak the
    // path. Defense in depth: warnings flow through the logger seam,
    // which masks them again at log-write time.
    if (typeof conn.source_file === "string" && conn.source_file.startsWith("/")) {
      warnings.push(
        `connection[${i}].source_file is absolute ("${maskHome(conn.source_file)}") — agent contract requires relative paths; dropping field`,
      );
      conn.source_file = null;
    }
    // source_symbol is optional: string | null (set by the colon-split above, or
    // provided directly by a conforming agent)
    if ("source_symbol" in conn && conn.source_symbol !== null && typeof conn.source_symbol !== "string") {
      return err(`connection[${i}].source_symbol must be a string or null`);
    }
    // target_file is optional — but if present must be string or null
    if (
      "target_file" in conn &&
      conn.target_file !== null &&
      typeof conn.target_file !== "string"
    ) {
      return err(`connection[${i}].target_file must be a string or null`);
    }
    // CTR-03: split legacy combined "path:symbol" target_file format (symmetric with source_file).
    if (typeof conn.target_file === "string" && conn.target_file.includes(":")) {
      const colonIdx = conn.target_file.lastIndexOf(":");
      const afterColon = conn.target_file.slice(colonIdx + 1);
      if (!afterColon.includes("/")) {
        warnings.push(
          `connection[${i}].target_file contains symbol suffix "${afterColon}" — splitting into target_symbol`,
        );
        conn.target_symbol = afterColon;
        conn.target_file = conn.target_file.slice(0, colonIdx);
      }
    }
    // target_symbol is optional: string | null
    if ("target_symbol" in conn && conn.target_symbol !== null && typeof conn.target_symbol !== "string") {
      return err(`connection[${i}].target_symbol must be a string or null`);
    }
    if (!VALID_CONFIDENCE.includes(conn.confidence)) {
      return err(
        `connection[${i}].confidence must be one of: ${VALID_CONFIDENCE.join(", ")}`,
      );
    }
    if (typeof conn.evidence !== "string") {
      return err(`connection[${i}].evidence must be a string`);
    }
    // crossing is optional — but if present must be a valid value (CTR-01a: cross-service added)
    if (
      "crossing" in conn &&
      conn.crossing !== null &&
      !VALID_CROSSINGS.includes(conn.crossing)
    ) {
      return err(
        `connection[${i}].crossing must be one of: ${VALID_CROSSINGS.join(", ")} (or absent/null)`,
      );
    }
  }

  // Validate schemas — hard-fail on structural issues; warn-and-skip when
  // connection_index is absent or out of bounds (CTR-02).
  const validSchemas = [];
  for (let i = 0; i < obj.schemas.length; i++) {
    const schema = obj.schemas[i];
    if (typeof schema !== "object" || schema === null) {
      return err(`schema[${i}] must be an object`);
    }
    if (typeof schema.name !== "string") {
      return err(`schema[${i}].name must be a string`);
    }
    if (!VALID_ROLES.includes(schema.role)) {
      return err(`schema[${i}].role must be one of: ${VALID_ROLES.join(", ")}`);
    }
    if (typeof schema.file !== "string") {
      return err(`schema[${i}].file must be a string`);
    }
    if (!Array.isArray(schema.fields)) {
      return err(`schema[${i}].fields must be an array`);
    }
    for (let j = 0; j < schema.fields.length; j++) {
      const field = schema.fields[j];
      if (typeof field !== "object" || field === null) {
        return err(`schema[${i}].fields[${j}] must be an object`);
      }
      if (typeof field.name !== "string") {
        return err(`schema[${i}].fields[${j}].name must be a string`);
      }
      if (typeof field.type !== "string") {
        return err(`schema[${i}].fields[${j}].type must be a string`);
      }
      if (typeof field.required !== "boolean") {
        return err(`schema[${i}].fields[${j}].required must be a boolean`);
      }
    }
    // CTR-02: connection_index must be a non-negative integer within [0, connections.length).
    // Missing or non-integer connection_index → warn-and-skip (schema excluded from result).
    if (
      typeof schema.connection_index !== "number" ||
      !Number.isInteger(schema.connection_index)
    ) {
      warnings.push(
        `schema[${i}].connection_index missing or non-integer — skipping schema`,
      );
      continue;
    }
    if (
      schema.connection_index < 0 ||
      schema.connection_index >= obj.connections.length
    ) {
      warnings.push(
        `schema[${i}].connection_index ${schema.connection_index} out of bounds [0, ${obj.connections.length}) — skipping schema`,
      );
      continue;
    }
    validSchemas.push(schema);
  }

  // Collect source_file warnings — null is valid but undesirable
  for (let i = 0; i < obj.connections.length; i++) {
    if (obj.connections[i].source_file === null) {
      warnings.push(
        `connection[${i}].source_file is null — agent did not identify call site`,
      );
    }
  }

  return ok(
    /** @type {Findings} */ ({ ...obj, services: validServices, schemas: validSchemas }),
    warnings,
  );
}

// ---------------------------------------------------------------------------
// parseAgentOutput
// ---------------------------------------------------------------------------

/** Regex to match a fenced ```json ... ``` block */
const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n```/;

/**
 * Extracts JSON from raw agent output using a 3-strategy fallback chain and
 * validates the parsed object against the findings contract.
 *
 * Strategy 1 — Fenced code block: Try regex `/```json\s*\n([\s\S]*?)\n```/`.
 * Strategy 2 — Raw JSON.parse: Try JSON.parse(rawText.trim()).
 * Strategy 3 — JSON substring extraction: Find first `{` and last `}`, parse substring.
 *
 * If ALL strategies fail, returns an error with a truncated preview of the input.
 *
 * @param {string} rawText - Raw agent output (may contain leading/trailing prose)
 * @returns {FindingsResult}
 */
export function parseAgentOutput(rawText) {
  if (typeof rawText !== "string") {
    return err("no JSON block found in agent output");
  }

  // Strategy 1 — Fenced code block
  const match = rawText.match(JSON_BLOCK_RE);
  if (match) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      return validateFindings(parsed);
    } catch (e) {
      return err(`JSON parse error: ${e.message}`);
    }
  }

  // Strategy 2 — Raw JSON.parse (handles pure JSON with no markdown)
  try {
    const parsed = JSON.parse(rawText.trim());
    return validateFindings(parsed);
  } catch {
    // fall through to Strategy 3
  }

  // Strategy 3 — JSON substring extraction (handles prose-wrapped JSON)
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonSubstr = rawText.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonSubstr);
      return validateFindings(parsed);
    } catch {
      // fall through to all-fail error
    }
  }

  // All strategies failed — return truncated preview
  return err(
    `no parseable JSON in agent output (preview: ${rawText.slice(0, 200)}...)`,
  );
}
