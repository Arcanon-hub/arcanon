/**
 * worker/scan/findings-base-path.test.js — Phase 110 (TRUST-04, TRUST-12)
 *
 * Verifies the read path for services.base_path:
 *   - Validator accepts base_path as optional string field (D-01 backwards-compat)
 *   - Validator handles single-segment, multi-segment (D-03), and null values
 *   - Validator warns + skips on bad type (mirrors root_path / language pattern)
 *   - agent-prompt-service.md instructs base_path emission
 *   - agent-schema.json declares the field
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFindings } from "./findings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal valid findings object — base_path absent by default */
function minimalValid(svcOverrides = {}) {
  return {
    service_name: "test-svc",
    confidence: "high",
    services: [
      {
        name: "test-svc",
        root_path: "src/",
        language: "typescript",
        confidence: "high",
        ...svcOverrides,
      },
    ],
    connections: [],
    schemas: [],
  };
}

// ---------------------------------------------------------------------------
// Test A: validator accepts base_path string (single segment)
// ---------------------------------------------------------------------------
test("validateFindings accepts base_path = '/api' and preserves it on the service", () => {
  const obj = minimalValid({ base_path: "/api" });
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.equal(result.findings.services.length, 1);
  assert.equal(result.findings.services[0].base_path, "/api");
});

// ---------------------------------------------------------------------------
// Test B: backwards compat — missing base_path is fine (D-01)
// ---------------------------------------------------------------------------
test("validateFindings accepts services with NO base_path field (D-01 backwards-compat)", () => {
  const obj = minimalValid();
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.equal(result.findings.services.length, 1);
  assert.equal("base_path" in result.findings.services[0], false);
});

// ---------------------------------------------------------------------------
// Test C: explicit null is accepted without warnings
// ---------------------------------------------------------------------------
test("validateFindings accepts base_path = null without warnings", () => {
  const obj = minimalValid({ base_path: null });
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.equal(result.findings.services.length, 1);
  assert.equal(result.findings.services[0].base_path, null);
  // No base_path-specific warnings
  const bpWarnings = result.warnings.filter((w) => w.includes("base_path"));
  assert.equal(bpWarnings.length, 0);
});

// ---------------------------------------------------------------------------
// Test D: bad type produces a warning and skips the service
// ---------------------------------------------------------------------------
test("validateFindings warns + skips when base_path is not a string or null", () => {
  const obj = minimalValid({ base_path: 42 });
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  // Service should be skipped (warn-and-skip pattern, mirrors root_path)
  assert.equal(result.findings.services.length, 0);
  const bpWarnings = result.warnings.filter((w) => w.includes("base_path"));
  assert.equal(bpWarnings.length, 1);
  assert.match(bpWarnings[0], /base_path/);
});

// ---------------------------------------------------------------------------
// Test E: multi-segment base_path is accepted (D-03)
// ---------------------------------------------------------------------------
test("validateFindings accepts multi-segment base_path = '/api/v1' (D-03)", () => {
  const obj = minimalValid({ base_path: "/api/v1" });
  const result = validateFindings(obj);
  assert.equal(result.valid, true);
  assert.equal(result.findings.services[0].base_path, "/api/v1");
});

// ---------------------------------------------------------------------------
// Test F: agent-prompt-service.md instructs base_path emission
// ---------------------------------------------------------------------------
test("agent-prompt-service.md contains base_path in instructional prose AND example", () => {
  const promptPath = path.join(__dirname, "agent-prompt-service.md");
  const content = fs.readFileSync(promptPath, "utf8");
  // Must appear at least twice — once in instructions, once in the JSON example
  const occurrences = (content.match(/base_path/g) || []).length;
  assert.ok(
    occurrences >= 2,
    `base_path should appear in both instructions and example (found ${occurrences})`,
  );
  // Specifically, must contain a section header or instructional sentence
  assert.match(
    content,
    /base_path/i,
    "base_path mentioned in prompt",
  );
  // And in the example JSON
  assert.match(
    content,
    /"base_path"\s*:\s*"\/api/,
    "example uses base_path with concrete /api value",
  );
});

// ---------------------------------------------------------------------------
// Test G: agent-schema.json declares base_path on services.items
// ---------------------------------------------------------------------------
test("agent-schema.json declares base_path on services.items (optional string|null)", () => {
  const schemaPath = path.join(__dirname, "agent-schema.json");
  const raw = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(raw); // must parse
  assert.ok(schema.properties, "schema has properties");
  assert.ok(schema.properties.services, "schema declares services");
  assert.ok(schema.properties.services.items, "services has items");
  assert.ok(
    "base_path" in schema.properties.services.items,
    "services.items declares base_path",
  );
});
