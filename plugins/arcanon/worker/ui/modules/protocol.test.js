/**
 * Tests for worker/ui/modules/protocol.js — the single source of truth for the
 * canonical protocol vocabulary (issue #42). Pure ESM, node:test + assert.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_PROTOCOLS,
  PROTOCOL_ALIASES,
  canonicalProtocol,
} from "./protocol.js";

test("first-class buckets pass through unchanged", () => {
  assert.equal(canonicalProtocol("rest"), "rest");
  assert.equal(canonicalProtocol("grpc"), "grpc");
  assert.equal(canonicalProtocol("internal"), "internal");
  assert.equal(canonicalProtocol("sdk"), "sdk");
  assert.equal(canonicalProtocol("events"), "events");
  assert.equal(canonicalProtocol("db"), "db");
});

test("existing infra/import protocols are preserved, NOT folded to other", () => {
  assert.equal(canonicalProtocol("k8s"), "k8s");
  assert.equal(canonicalProtocol("tf"), "tf");
  assert.equal(canonicalProtocol("helm"), "helm");
  assert.equal(canonicalProtocol("import"), "import");
});

test("pub/sub + streaming protocols fold to events", () => {
  assert.equal(canonicalProtocol("kafka"), "events");
  assert.equal(canonicalProtocol("rabbitmq"), "events");
  assert.equal(canonicalProtocol("nats"), "events");
  assert.equal(canonicalProtocol("sqs"), "events");
  assert.equal(canonicalProtocol("pubsub"), "events");
  assert.equal(canonicalProtocol("sse"), "events");
});

test("datastore protocols fold to db (including redis)", () => {
  assert.equal(canonicalProtocol("postgres"), "db");
  assert.equal(canonicalProtocol("postgresql"), "db");
  assert.equal(canonicalProtocol("mysql"), "db");
  assert.equal(canonicalProtocol("mongodb"), "db");
  assert.equal(canonicalProtocol("redis"), "db");
  assert.equal(canonicalProtocol("sql"), "db");
});

test("graphql + http fold to rest", () => {
  assert.equal(canonicalProtocol("graphql"), "rest");
  assert.equal(canonicalProtocol("http"), "rest");
});

test("unknown token resolves to other (returns a string, never throws)", () => {
  assert.doesNotThrow(() => canonicalProtocol("zzz-unknown"));
  assert.equal(canonicalProtocol("zzz-unknown"), "other");
  assert.equal(canonicalProtocol("totally-made-up"), "other");
});

test("case + whitespace tolerance", () => {
  assert.equal(canonicalProtocol("NATS"), "events");
  assert.equal(canonicalProtocol(" PostgreSQL "), "db");
  assert.equal(canonicalProtocol("  REST  "), "rest");
  assert.equal(canonicalProtocol("KAFKA"), "events");
});

test("non-string / null / undefined input returns other without throwing", () => {
  assert.doesNotThrow(() => canonicalProtocol(null));
  assert.doesNotThrow(() => canonicalProtocol(undefined));
  assert.doesNotThrow(() => canonicalProtocol(42));
  assert.doesNotThrow(() => canonicalProtocol({}));
  assert.doesNotThrow(() => canonicalProtocol([]));
  assert.equal(canonicalProtocol(null), "other");
  assert.equal(canonicalProtocol(undefined), "other");
  assert.equal(canonicalProtocol(42), "other");
  assert.equal(canonicalProtocol({}), "other");
});

test("CANONICAL_PROTOCOLS is a Set containing every returnable bucket plus other", () => {
  assert.ok(CANONICAL_PROTOCOLS instanceof Set);
  for (const bucket of [
    "rest",
    "grpc",
    "events",
    "db",
    "internal",
    "sdk",
    "k8s",
    "tf",
    "helm",
    "import",
    "other",
  ]) {
    assert.ok(
      CANONICAL_PROTOCOLS.has(bucket),
      `CANONICAL_PROTOCOLS missing bucket: ${bucket}`,
    );
  }
});

test("every PROTOCOL_ALIASES target is a canonical bucket", () => {
  for (const [raw, target] of Object.entries(PROTOCOL_ALIASES)) {
    assert.ok(
      CANONICAL_PROTOCOLS.has(target),
      `alias ${raw} -> ${target} not a canonical bucket`,
    );
  }
});

test("PROTOCOL_ALIASES is frozen (immutable single source of truth)", () => {
  assert.ok(Object.isFrozen(PROTOCOL_ALIASES));
});
