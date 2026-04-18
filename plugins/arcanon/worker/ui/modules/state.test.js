/**
 * Verification tests for state.js isolation fields.
 * Source inspection: isolatedNodeId and isolationDepth on state object.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "state.js"), "utf8");

let passed = 0;
let failed = 0;

function check(condition, description, pattern) {
  if (condition) {
    console.log(`OK: ${description}`);
    passed++;
  } else {
    console.error(`FAIL: ${description}${pattern ? ` (missing: ${pattern})` : ""}`);
    failed++;
  }
}

// ── Check 1: isolatedNodeId field exists with null default ─────────────────

check(
  src.includes("isolatedNodeId: null"),
  "state.isolatedNodeId is present with null default",
  "isolatedNodeId: null"
);

// ── Check 2: isolationDepth field exists with 1 default ───────────────────

check(
  src.includes("isolationDepth: 1"),
  "state.isolationDepth is present with 1 default",
  "isolationDepth: 1"
);

// ── Check 3: both fields appear inside the state object ───────────────────

const stateObjStart = src.indexOf("export const state = {");
const stateObjEnd = src.indexOf("};", stateObjStart);
const stateBody = src.slice(stateObjStart, stateObjEnd);

check(
  stateBody.includes("isolatedNodeId"),
  "isolatedNodeId appears inside the state object literal",
  "isolatedNodeId in state body"
);

check(
  stateBody.includes("isolationDepth"),
  "isolationDepth appears inside the state object literal",
  "isolationDepth in state body"
);

// ── Check 4: blastCache still exists (no removals) ────────────────────────

check(
  src.includes("blastCache: {}"),
  "blastCache field still present (no regressions)",
  "blastCache: {}"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
