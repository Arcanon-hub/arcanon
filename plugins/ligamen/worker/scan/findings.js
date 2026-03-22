/**
 * worker/findings-schema.js — Findings schema validator for Ligamen v2.0
 *
 * Exports:
 *   validateFindings(obj)    - Validates an agent findings object
 *   parseAgentOutput(text)   - Extracts fenced JSON block and validates it
 *
 * Zero external dependencies — uses only Node.js builtins.
 *
 * @typedef {{ name: string, type: string, required: boolean }} Field
 * @typedef {{ name: string, role: string, file: string, fields: Field[] }} Schema
 * @typedef {{
 *   source: string,
 *   target: string,
 *   protocol: string,
 *   method: string,
 *   path: string,
 *   source_file: string|null,
 *   target_file?: string|null,
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

/** @type {string[]} */
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
 * Validates an agent findings object against the Ligamen findings schema.
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

  // Validate services
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
    if (!VALID_PROTOCOLS.includes(conn.protocol)) {
      return err(
        `connection[${i}].protocol must be one of: ${VALID_PROTOCOLS.join(", ")}`,
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
    // target_file is optional — but if present must be string or null
    if (
      "target_file" in conn &&
      conn.target_file !== null &&
      typeof conn.target_file !== "string"
    ) {
      return err(`connection[${i}].target_file must be a string or null`);
    }
    if (!VALID_CONFIDENCE.includes(conn.confidence)) {
      return err(
        `connection[${i}].confidence must be one of: ${VALID_CONFIDENCE.join(", ")}`,
      );
    }
    if (typeof conn.evidence !== "string") {
      return err(`connection[${i}].evidence must be a string`);
    }
    // crossing is optional — but if present must be a valid value
    const VALID_CROSSINGS = ["external", "sdk", "internal"];
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

  // Validate schemas
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
  }

  // Collect source_file warnings — null is valid but undesirable (AGENT-02 / THE-942)
  const warnings = [];
  for (let i = 0; i < obj.connections.length; i++) {
    if (obj.connections[i].source_file === null) {
      warnings.push(
        `connection[${i}].source_file is null — agent did not identify call site`,
      );
    }
  }
  return ok(/** @type {Findings} */ (obj), warnings);
}

// ---------------------------------------------------------------------------
// parseAgentOutput
// ---------------------------------------------------------------------------

/** Regex to match a fenced ```json ... ``` block */
const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n```/;

/**
 * Extracts the first fenced ```json block from raw agent output text and
 * validates the parsed object against the findings schema.
 *
 * @param {string} rawText - Raw agent output (may contain leading/trailing prose)
 * @returns {FindingsResult}
 */
export function parseAgentOutput(rawText) {
  if (typeof rawText !== "string") {
    return err("no JSON block found in agent output");
  }

  const match = rawText.match(JSON_BLOCK_RE);
  if (!match) {
    return err("no JSON block found in agent output");
  }

  const jsonStr = match[1].trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return err(`JSON parse error: ${e.message}`);
  }

  return validateFindings(parsed);
}
