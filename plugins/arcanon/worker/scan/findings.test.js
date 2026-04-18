/**
 * worker/findings-schema.test.js
 *
 * Unit tests for validateFindings() and parseAgentOutput() using Node.js
 * built-in node:test. Zero external dependencies.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFindings, parseAgentOutput, VALID_SERVICE_TYPES } from "./findings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid findings object */
function minimalValid() {
  return {
    service_name: "test-svc",
    confidence: "high",
    services: [
      {
        name: "test-svc",
        root_path: "src/",
        language: "typescript",
        confidence: "high",
      },
    ],
    connections: [],
    schemas: [],
  };
}

/** A valid connection */
function validConnection(overrides = {}) {
  return {
    source: "svc-a",
    target: "svc-b",
    protocol: "rest",
    method: "GET",
    path: "/health",
    source_file: "src/client.ts:callHealth",
    confidence: "high",
    evidence: "await fetch('/health')",
    ...overrides,
  };
}

/** A valid schema */
function validSchema(overrides = {}) {
  return {
    name: "UserRequest",
    role: "request",
    file: "src/types/user.ts",
    fields: [{ name: "email", type: "string", required: true }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateFindings — top-level structure
// ---------------------------------------------------------------------------

test("validateFindings returns valid:false with error for null input", () => {
  const result = validateFindings(null);
  assert.equal(result.valid, false);
  assert.equal(result.error, "findings must be an object");
});

test("validateFindings returns valid:false for non-object (string)", () => {
  const result = validateFindings("hello");
  assert.equal(result.valid, false);
  assert.equal(result.error, "findings must be an object");
});

test("validateFindings returns valid:false for non-object (number)", () => {
  const result = validateFindings(42);
  assert.equal(result.valid, false);
  assert.equal(result.error, "findings must be an object");
});

test("validateFindings returns valid:false for empty object (missing connections)", () => {
  const result = validateFindings({});
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("connections"),
    `Expected error about 'connections', got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when service_name is missing", () => {
  const obj = minimalValid();
  delete obj.service_name;
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("service_name"));
});

test("validateFindings returns valid:false when confidence field is missing", () => {
  const obj = minimalValid();
  delete obj.confidence;
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when confidence is invalid value", () => {
  const obj = minimalValid();
  obj.confidence = "medium";
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("high") || result.error.includes("low"),
    `Expected error about confidence values, got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when services is not an array", () => {
  const obj = minimalValid();
  obj.services = "not-an-array";
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when connections is not an array", () => {
  const obj = minimalValid();
  obj.connections = {};
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when schemas is not an array", () => {
  const obj = minimalValid();
  obj.schemas = null;
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// validateFindings — connection validation
// ---------------------------------------------------------------------------

test("validateFindings returns valid:false for unknown protocol", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ protocol: "websocket" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("connection[0].protocol must be one of:"),
    `Expected protocol error, got: ${result.error}`,
  );
  assert.ok(result.error.includes("rest"));
  assert.ok(result.error.includes("grpc"));
  assert.ok(result.error.includes("kafka"));
  assert.ok(result.error.includes("rabbitmq"));
  assert.ok(result.error.includes("internal"));
  assert.ok(result.error.includes("sdk"));
});

test("validateFindings returns valid:false for invalid connection confidence", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ confidence: "medium" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("confidence") ||
      result.error.includes("high") ||
      result.error.includes("low"),
    `Expected confidence error, got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when connection source is missing", () => {
  const obj = minimalValid();
  const conn = validConnection();
  delete conn.source;
  obj.connections = [conn];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("source"));
});

test("validateFindings returns valid:false when connection target is missing", () => {
  const obj = minimalValid();
  const conn = validConnection();
  delete conn.target;
  obj.connections = [conn];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings returns valid:false when connection evidence is missing", () => {
  const obj = minimalValid();
  const conn = validConnection();
  delete conn.evidence;
  obj.connections = [conn];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("evidence"));
});

test("validateFindings accepts connection with target_file as null (optional)", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ target_file: null })];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
});

test("validateFindings accepts all valid protocols", () => {
  const protocols = ["rest", "grpc", "kafka", "rabbitmq", "internal", "sdk"];
  for (const protocol of protocols) {
    const obj = minimalValid();
    obj.connections = [validConnection({ protocol })];
    const result = validateFindings(obj);
    assert.equal(result.valid, true, `Protocol '${protocol}' should be valid`);
  }
});

// ---------------------------------------------------------------------------
// validateFindings — schema and field validation
// ---------------------------------------------------------------------------

test("validateFindings returns valid:false for invalid schema role", () => {
  const obj = minimalValid();
  obj.schemas = [validSchema({ role: "body" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("role") ||
      result.error.includes("request") ||
      result.error.includes("event_payload"),
    `Expected role error, got: ${result.error}`,
  );
});

test("validateFindings returns valid:false when field required is not boolean", () => {
  const obj = minimalValid();
  obj.schemas = [
    validSchema({
      fields: [{ name: "email", type: "string", required: "true" }],
    }),
  ];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("required"));
});

test("validateFindings returns valid:false when schema fields is not an array", () => {
  const obj = minimalValid();
  obj.schemas = [validSchema({ fields: null })];
  const result = validateFindings(obj);
  assert.equal(result.valid, false);
});

test("validateFindings accepts valid minimal input (no schemas, empty arrays)", () => {
  const obj = minimalValid();
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, obj);
});

test("validateFindings accepts valid input with connections and schemas", () => {
  const obj = minimalValid();
  obj.connections = [validConnection()];
  obj.schemas = [validSchema()];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, obj);
});

test("validateFindings accepts all valid schema roles", () => {
  const roles = ["request", "response", "event_payload"];
  for (const role of roles) {
    const obj = minimalValid();
    obj.schemas = [validSchema({ role })];
    const result = validateFindings(obj);
    assert.equal(result.valid, true, `Role '${role}' should be valid`);
  }
});

// ---------------------------------------------------------------------------
// parseAgentOutput
// ---------------------------------------------------------------------------

test("parseAgentOutput extracts valid JSON from fenced block", () => {
  const findings = minimalValid();
  const raw = `Here is my analysis:\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\``;
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, findings);
});

test("parseAgentOutput returns valid:false with error when no JSON block found", () => {
  const result = parseAgentOutput(
    "I found some services but here is prose only.",
  );
  assert.equal(result.valid, false);
  // After multi-strategy, the error message includes a preview when all strategies fail
  assert.ok(
    result.error.includes("no parseable JSON") || result.error.includes("no JSON block"),
    `Expected no-JSON error, got: ${result.error}`,
  );
});

test("parseAgentOutput returns valid:false with JSON parse error for malformed JSON", () => {
  const raw = "```json\n{ invalid json here }\n```";
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, false);
  assert.ok(
    result.error.startsWith("JSON parse error:"),
    `Expected JSON parse error, got: ${result.error}`,
  );
});

test("parseAgentOutput handles leading and trailing prose", () => {
  const findings = minimalValid();
  const raw = [
    "Scanning complete. I found the following service connections:",
    "",
    "```json",
    JSON.stringify(findings),
    "```",
    "",
    "Let me know if you need more details.",
  ].join("\n");
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, findings);
});

test("parseAgentOutput validates the extracted JSON against the schema", () => {
  const raw = '```json\n{"service_name":"x"}\n```';
  const result = parseAgentOutput(raw);
  assert.equal(result.valid, false);
  // Should fail schema validation, not JSON parse
  assert.ok(
    !result.error.startsWith("JSON parse error:"),
    `Should fail schema validation, got: ${result.error}`,
  );
});

test("parseAgentOutput with empty string returns no JSON block error", () => {
  const result = parseAgentOutput("");
  assert.equal(result.valid, false);
  assert.ok(
    result.error.includes("no parseable JSON") || result.error.includes("no JSON block"),
    `Expected no-JSON error, got: ${result.error}`,
  );
});

// ---------------------------------------------------------------------------
// parseAgentOutput multi-strategy fallback chain
// ---------------------------------------------------------------------------

describe("parseAgentOutput multi-strategy", () => {
  test("fenced code block with extra whitespace/newlines returns valid findings", () => {
    const findings = minimalValid();
    // Extra blank lines around JSON inside fenced block
    const raw = "```json\n\n" + JSON.stringify(findings) + "\n\n```";
    const result = parseAgentOutput(raw);
    assert.equal(result.valid, true, `Expected valid, got error: ${result.error}`);
    assert.deepEqual(result.findings, findings);
  });

  test("raw JSON string with no fencing returns valid findings", () => {
    const findings = minimalValid();
    const raw = JSON.stringify(findings);
    const result = parseAgentOutput(raw);
    assert.equal(result.valid, true, `Expected valid from raw JSON, got: ${result.error}`);
    assert.deepEqual(result.findings, findings);
  });

  test("JSON embedded after prose text (no fencing) returns valid findings via substring strategy", () => {
    const findings = minimalValid();
    const raw = "Here is the analysis result:\n" + JSON.stringify(findings) + "\nEnd of output.";
    const result = parseAgentOutput(raw);
    assert.equal(result.valid, true, `Expected valid from prose-wrapped JSON, got: ${result.error}`);
    assert.deepEqual(result.findings, findings);
  });

  test("completely malformed text returns valid:false with truncated preview", () => {
    const malformed = "This is completely malformed text with no JSON at all.";
    const result = parseAgentOutput(malformed);
    assert.equal(result.valid, false);
    assert.ok(
      result.error.includes("preview:"),
      `Expected truncated preview in error, got: ${result.error}`,
    );
    // Preview should be the first 200 chars of the input
    assert.ok(
      result.error.includes(malformed.slice(0, 10)),
      `Expected preview to contain beginning of input, got: ${result.error}`,
    );
  });

  test("non-string input returns valid:false", () => {
    const result = parseAgentOutput(42);
    assert.equal(result.valid, false);
  });

  test("JSON inside fenced block where JSON itself is invalid returns valid:false with parse error", () => {
    const raw = "```json\n{ not valid json: oops }\n```";
    const result = parseAgentOutput(raw);
    assert.equal(result.valid, false);
    assert.ok(
      result.error.length > 0,
      `Expected a non-empty error, got: ${result.error}`,
    );
  });

  test("long malformed text preview is truncated to 200 chars", () => {
    const longMalformed = "x".repeat(500);
    const result = parseAgentOutput(longMalformed);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes("preview:"), `Expected preview in error`);
    // The preview part should not exceed 200 chars of the original text
    const previewStart = result.error.indexOf("preview: ") + "preview: ".length;
    const previewContent = result.error.slice(previewStart);
    // Should contain the first 200 chars of rawText plus "..."
    assert.ok(previewContent.startsWith("x".repeat(200)), "Preview should start with 200 x's");
  });
});

// ---------------------------------------------------------------------------
// validateFindings — source_file null warnings
// ---------------------------------------------------------------------------

test("warns when connection has source_file: null", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ source_file: null })];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.ok(Array.isArray(result.warnings), "warnings should be an array");
  assert.equal(result.warnings.length, 1);
  assert.ok(
    result.warnings[0].includes("connection[0].source_file is null"),
    `Expected warning about null source_file, got: ${result.warnings[0]}`,
  );
});

test("warns for each null source_file", () => {
  const obj = minimalValid();
  obj.connections = [
    validConnection({ source_file: null }),
    validConnection({ source_file: null }),
  ];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings[0].includes("connection[0].source_file is null"));
  assert.ok(result.warnings[1].includes("connection[1].source_file is null"));
});

test("no warnings when source_file is non-null", () => {
  const obj = minimalValid();
  obj.connections = [validConnection({ source_file: "src/api.ts:callTarget" })];
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.ok(Array.isArray(result.warnings), "warnings should be an array");
  assert.equal(result.warnings.length, 0);
});

// ---------------------------------------------------------------------------
// validateFindings — service field validation (SVAL-01)
// ---------------------------------------------------------------------------

import { describe } from "node:test";

describe("validateFindings — service field validation (SVAL-01)", () => {
  test("skips service with invalid type enum value", () => {
    const obj = minimalValid();
    obj.services = [
      { name: "bad-svc", root_path: "src/", language: "go", confidence: "high", type: "microservice" },
    ];
    const result = validateFindings(obj);
    assert.equal(result.valid, true);
    assert.equal(result.findings.services.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(
      result.warnings[0].includes("microservice"),
      `Expected warning to include 'microservice', got: ${result.warnings[0]}`,
    );
  });

  test("skips service with empty root_path", () => {
    const obj = minimalValid();
    obj.services = [
      { name: "bad-svc", root_path: "", language: "go", confidence: "high" },
    ];
    const result = validateFindings(obj);
    assert.equal(result.valid, true);
    assert.equal(result.findings.services.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(
      result.warnings[0].includes("root_path"),
      `Expected warning to include 'root_path', got: ${result.warnings[0]}`,
    );
  });

  test("skips service with empty language", () => {
    const obj = minimalValid();
    obj.services = [
      { name: "bad-svc", root_path: "src/", language: "", confidence: "high" },
    ];
    const result = validateFindings(obj);
    assert.equal(result.valid, true);
    assert.equal(result.findings.services.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(
      result.warnings[0].includes("language"),
      `Expected warning to include 'language', got: ${result.warnings[0]}`,
    );
  });

  test("accepts service without type field (absent type is OK)", () => {
    const obj = minimalValid();
    // minimalValid() already has a service with no type field
    const result = validateFindings(obj);
    assert.equal(result.valid, true);
    assert.equal(result.findings.services.length, 1);
    assert.equal(result.warnings.length, 0);
  });

  test("filters invalid services while keeping valid ones", () => {
    const obj = minimalValid();
    obj.services = [
      { name: "good-svc", root_path: "src/", language: "go", confidence: "high" },
      { name: "bad-type-svc", root_path: "src/", language: "go", confidence: "high", type: "widget" },
      { name: "bad-path-svc", root_path: "", language: "go", confidence: "high" },
    ];
    const result = validateFindings(obj);
    assert.equal(result.valid, true);
    assert.equal(result.findings.services.length, 1);
    assert.equal(result.findings.services[0].name, "good-svc");
    assert.equal(result.warnings.length, 2);
  });

  test("VALID_SERVICE_TYPES contains expected values", () => {
    assert.deepEqual(VALID_SERVICE_TYPES, ["service", "library", "sdk", "infra"]);
  });
});
