/**
 * protocol-consistency.test.js — DRIFT GUARD.
 *
 * The original #42 bug was three layers (schema, persist, UI) each defining
 * their own protocol vocabulary with nothing reconciling them, so an edge
 * stored as `kafka` was silently dropped by a UI that only knew `events`.
 *
 * This test locks the UI render layer to the single source of truth
 * (worker/ui/modules/protocol.js). It asserts that EVERY canonical render
 * bucket is default-on in state.activeProtocols and has a defined color, so
 * the schema/persist/UI layers can never silently diverge again.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CANONICAL_PROTOCOLS } from "./protocol.js";
import { state, PROTOCOL_COLORS } from "./state.js";

// The render buckets the UI is expected to draw + toggle by default. This is
// the CONTEXT canonical set (rest·grpc·events·db·internal·sdk) plus the
// "other" greyed catch-all that must never be dropped. k8s/tf/helm/import are
// pre-existing infra buckets that are NOT part of the default-on UI render set
// here (they are not protocol filter checkboxes), so they are excluded from
// this default-on assertion.
const RENDER_BUCKETS = ["rest", "grpc", "events", "db", "internal", "sdk", "other"];

test("every canonical render bucket is in the shared CANONICAL_PROTOCOLS set", () => {
  for (const bucket of RENDER_BUCKETS) {
    assert.ok(
      CANONICAL_PROTOCOLS.has(bucket),
      `RENDER_BUCKETS member "${bucket}" must be a member of the shared CANONICAL_PROTOCOLS set`,
    );
  }
});

test("every canonical render bucket is default-on in state.activeProtocols", () => {
  for (const bucket of RENDER_BUCKETS) {
    assert.ok(
      state.activeProtocols.has(bucket),
      `default activeProtocols is missing render bucket "${bucket}" — schema/persist/UI drift (the #42 bug)`,
    );
  }
});

test("db and other are default-on (never silently dropped)", () => {
  assert.ok(state.activeProtocols.has("db"), 'db bucket must be default-on');
  assert.ok(state.activeProtocols.has("other"), 'other catch-all must be default-on');
});

test("every render bucket has a defined PROTOCOL_COLORS entry", () => {
  // refreshColors() is not called in the Node test runtime (no document), so
  // PROTOCOL_COLORS holds the DEFAULTS.protocol fallbacks. Each render bucket
  // must resolve to a color — either a DEFAULTS entry or the edge.default
  // grey fallback that renderer.js applies. We assert the buckets that own a
  // distinct color (everything except the catch-all "other", which is allowed
  // to fall through to the greyed edge.default per CONTEXT) have an entry.
  const COLORED = ["rest", "grpc", "events", "db", "internal", "sdk"];
  for (const bucket of COLORED) {
    assert.ok(
      typeof PROTOCOL_COLORS[bucket] === "string" && PROTOCOL_COLORS[bucket].length > 0,
      `PROTOCOL_COLORS is missing a color for render bucket "${bucket}"`,
    );
  }
});

test("other resolves to a color (own entry or documented grey fallback)", () => {
  // "other" may either carry its own muted token or fall through to
  // COLORS.edge.default in renderer.js. We require an explicit entry so the
  // greyed bucket is visually intentional, not accidental.
  assert.ok(
    typeof PROTOCOL_COLORS.other === "string" && PROTOCOL_COLORS.other.length > 0,
    'PROTOCOL_COLORS.other must define the greyed catch-all color',
  );
});
