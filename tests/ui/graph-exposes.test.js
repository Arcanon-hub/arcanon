/**
 * tests/ui/graph-exposes.test.js
 *
 * Source-analysis tests verifying that loadProject() in worker/ui/graph.js
 * maps the `exposes` field from the API response into state.graphData.nodes.
 *
 * Follows the static source analysis pattern from graph-fit-to-screen.test.js.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../../worker/ui/graph.js"), "utf8");

test("graph.js loadProject maps exposes from API response", () => {
  assert.ok(
    src.includes("s.exposes"),
    "MISSING: loadProject node mapping must include s.exposes to forward API exposes to state nodes",
  );
});

test("graph.js loadProject defaults exposes to empty array", () => {
  // The || [] guard must appear near the exposes property to ensure nodes always
  // have exposes:[] rather than undefined when the API returns no exposes field.
  const exposesIdx = src.indexOf("s.exposes");
  assert.ok(exposesIdx !== -1, "s.exposes not found in graph.js");

  // Search within 50 chars of s.exposes for the || [] guard
  const nearby = src.slice(exposesIdx, exposesIdx + 50);
  assert.ok(
    nearby.includes("|| []"),
    "MISSING: exposes property must have || [] default guard near s.exposes in graph.js",
  );
});
