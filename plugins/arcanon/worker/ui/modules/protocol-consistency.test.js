/**
 * protocol-consistency.test.js — DRIFT GUARD.
 *
 * The original #42 bug was three layers (schema, persist, UI) each defining
 * their own protocol vocabulary with nothing reconciling them, so an edge
 * stored as `kafka` was silently dropped by a UI that only knew `events`.
 *
 * This test locks the UI render layer to the single source of truth
 * (worker/ui/modules/protocol.js). It iterates the ENTIRE CANONICAL_PROTOCOLS
 * set (NOT a hardcoded subset — a subset cannot catch a canonical protocol that
 * is silently unrenderable, which was codex's exact point) and asserts that
 * EVERY canonical protocol is EITHER default-on in state.activeProtocols with a
 * resolvable color, OR listed in the explicitly documented DOCUMENTED_NON_RENDER
 * allowlist. A checkbox-coverage test parses index.html so every toggleable
 * canonical render bucket has a [data-protocol] checkbox and no checkbox is
 * orphaned.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_PROTOCOLS } from "./protocol.js";
import { state, PROTOCOL_COLORS } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A canonical protocol may be intentionally NON-RENDERED only if it is listed
 * here WITH a justification comment. Today it is EMPTY — every canonical
 * protocol is renderable (default-on + colored). The structure exists so a
 * future canonical addition that is silently unrenderable FAILS the drift test
 * instead of slipping through (which is what institutionalized the #42 divergence).
 *
 * @type {Set<string>}
 */
const DOCUMENTED_NON_RENDER = new Set([
  // (empty) — no canonical protocol is intentionally non-rendered.
]);

/**
 * A canonical protocol resolves to a color when it has a non-empty
 * PROTOCOL_COLORS entry. refreshColors() is not called in the Node test runtime
 * (no document), so PROTOCOL_COLORS holds the DEFAULTS.protocol fallbacks.
 */
function resolvableColor(p) {
  return typeof PROTOCOL_COLORS[p] === "string" && PROTOCOL_COLORS[p].length > 0;
}

test("EVERY canonical protocol is renderable (default-on + colored) or documented non-render", () => {
  for (const p of [...CANONICAL_PROTOCOLS]) {
    const renderable = state.activeProtocols.has(p) && resolvableColor(p);
    assert.ok(
      DOCUMENTED_NON_RENDER.has(p) || renderable,
      `canonical protocol "${p}" is neither renderable (default-on in ` +
        `activeProtocols with a resolvable color) nor in DOCUMENTED_NON_RENDER — ` +
        `it would be silently dropped by the renderer's activeProtocols.has() gate (#42 drift)`,
    );
  }
});

test("DOCUMENTED_NON_RENDER only contains members of CANONICAL_PROTOCOLS", () => {
  for (const p of DOCUMENTED_NON_RENDER) {
    assert.ok(
      CANONICAL_PROTOCOLS.has(p),
      `DOCUMENTED_NON_RENDER member "${p}" is not a canonical protocol — stale allowlist entry`,
    );
  }
});

test("db and other are default-on (never silently dropped)", () => {
  assert.ok(state.activeProtocols.has("db"), "db bucket must be default-on");
  assert.ok(state.activeProtocols.has("other"), "other catch-all must be default-on");
});

test("checkbox-coverage: every toggleable canonical render bucket has a [data-protocol] checkbox and no checkbox is orphaned", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8",
  );
  const checkboxValues = new Set();
  const re = /data-protocol="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    checkboxValues.add(m[1]);
  }

  assert.ok(checkboxValues.size > 0, "index.html exposes [data-protocol] checkboxes");

  // Every default-on canonical render bucket must have a matching checkbox so it
  // is user-toggleable (DOCUMENTED_NON_RENDER buckets, being unrendered, need none).
  for (const p of [...CANONICAL_PROTOCOLS]) {
    if (DOCUMENTED_NON_RENDER.has(p)) continue;
    if (!state.activeProtocols.has(p)) continue;
    assert.ok(
      checkboxValues.has(p),
      `canonical render bucket "${p}" has no [data-protocol="${p}"] checkbox in index.html`,
    );
  }

  // Conversely, no checkbox may reference a value outside CANONICAL_PROTOCOLS.
  for (const v of checkboxValues) {
    assert.ok(
      CANONICAL_PROTOCOLS.has(v),
      `orphan checkbox: data-protocol="${v}" is not a member of CANONICAL_PROTOCOLS`,
    );
  }
});
