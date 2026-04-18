/**
 * tests/ui/graph-actor-dedup.test.js
 *
 * Source-analysis tests verifying that loadProject() in worker/ui/graph.js
 * filters actors whose name matches a known service before creating
 * synthetic actor nodes — defense in depth for stale actor data (SREL-02).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../../plugins/arcanon/worker/ui/graph.js"), "utf8");

test("graph.js filters actors whose name matches a known service", () => {
  assert.ok(
    src.includes(".filter("),
    "MISSING: loadProject must filter actors before synthetic node creation — use .filter() on actors array",
  );
});

test("graph.js filter uses serviceNameToId for known-service lookup", () => {
  // The filter must reference serviceNameToId to check actor names against known services
  const filterIdx = src.indexOf(".filter(");
  assert.ok(filterIdx !== -1, ".filter( not found in graph.js");
  // serviceNameToId must appear after the filter call (within the filter callback)
  const afterFilter = src.slice(filterIdx, filterIdx + 200);
  assert.ok(
    afterFilter.includes("serviceNameToId"),
    "MISSING: actor filter must check actor.name against serviceNameToId map",
  );
});

test("graph.js assigns filtered actors to state.graphData.actors", () => {
  // After filtering, the result must be assigned back to state.graphData.actors
  // so the synthetic node loop iterates only non-duplicate actors
  assert.ok(
    src.includes("state.graphData.actors = ") && src.split("state.graphData.actors = ").length > 2,
    "MISSING: state.graphData.actors must be reassigned after filtering (should appear twice: once for raw assignment, once for filtered)",
  );
});

test("graph.js synthetic node loop iterates state.graphData.actors", () => {
  // The existing for...of loop must use state.graphData.actors (post-filter)
  assert.ok(
    src.includes("for (const actor of state.graphData.actors)"),
    "MISSING: synthetic node loop must iterate state.graphData.actors",
  );
});
