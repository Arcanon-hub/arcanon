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

// ── Check 5: activeProtocols seeded from the shared canonical set ──────────
// (#42 protocol-vocabulary fix — state must import CANONICAL_PROTOCOLS rather
// than redefine its own bucket literal.)

check(
  src.includes('import { CANONICAL_PROTOCOLS } from "./protocol.js"'),
  "state.js imports CANONICAL_PROTOCOLS from the shared protocol module",
  'import { CANONICAL_PROTOCOLS } from "./protocol.js"'
);

check(
  !/activeProtocols: new Set\(\["rest"/.test(src),
  "activeProtocols is NOT a hardcoded literal bucket list",
  "no hand-written activeProtocols literal"
);

// ── Check 6: db + other are default-on render buckets (behavioral) ─────────

const mod = await import("./state.js");

for (const bucket of ["rest", "grpc", "events", "db", "internal", "sdk", "other"]) {
  check(
    mod.state.activeProtocols.has(bucket),
    `default activeProtocols includes "${bucket}"`,
    `activeProtocols.has("${bucket}")`
  );
}

// ── Check 7: PROTOCOL_COLORS has db + other entries ───────────────────────

check(
  typeof mod.PROTOCOL_COLORS.db === "string" && mod.PROTOCOL_COLORS.db.length > 0,
  "PROTOCOL_COLORS.db is defined",
  "PROTOCOL_COLORS.db"
);

check(
  typeof mod.PROTOCOL_COLORS.other === "string" && mod.PROTOCOL_COLORS.other.length > 0,
  "PROTOCOL_COLORS.other is defined",
  "PROTOCOL_COLORS.other"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
