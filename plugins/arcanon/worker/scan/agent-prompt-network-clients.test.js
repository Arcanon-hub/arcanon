/**
 * Prompt-content tests for network backing-service client detection (#45, phase 133).
 *
 * These are DETERMINISTIC content assertions over the two agent prompts — they do
 * NOT execute the scanner, use fixtures, or touch the network. The live
 * `/arcanon:map` re-scan surfacing `arcanon -> chromadb` is MANUAL verification,
 * documented in 133-01-SUMMARY.md, not asserted here.
 *
 * Run: node --test worker/scan/agent-prompt-network-clients.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const discovery = readFileSync(
  join(__dirname, "agent-prompt-discovery.md"),
  "utf8",
);
const service = readFileSync(
  join(__dirname, "agent-prompt-service.md"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Discovery prompt — generalized reasoning-based item 8
// ---------------------------------------------------------------------------

test("discovery: names backing-service categories + non-exhaustive/any-language clause", () => {
  assert.match(
    discovery,
    /datastore|message broker|search engine|cache|vector/i,
    "discovery prompt must name backing-service categories",
  );
  assert.match(
    discovery,
    /not limited to|not listed|any language|equivalent/i,
    "discovery prompt must present examples as non-exhaustive / any-language",
  );
});

test("discovery: includes the motivating chromadb example", () => {
  assert.match(discovery, /chromadb/i);
});

test("discovery: does NOT phrase examples as a gating allowlist", () => {
  assert.doesNotMatch(
    discovery,
    /only (these|the following) librar|must be one of/i,
    "discovery prompt must not phrase the examples as an exhaustive allowlist (#42 anti-pattern)",
  );
});

test("discovery: does NOT add embedded file DBs (out of scope)", () => {
  assert.doesNotMatch(
    discovery,
    /better-sqlite3|node:sqlite/i,
    "embedded file DBs are in-process local state, not network edges",
  );
});

// ---------------------------------------------------------------------------
// Service prompt — emit external connections for backing-service clients
// ---------------------------------------------------------------------------

test("service: instructs emitting external connections for backing-service clients into canonical buckets", () => {
  assert.match(service, /external/i, "service prompt must mention external crossing");
  assert.match(
    service,
    /backing.service|datastore|broker|vector/i,
    "service prompt must reference backing-service clients",
  );
  // Protocol classification folds into existing canonical buckets.
  assert.match(service, /\bdb\b/, "must map datastore -> db");
  assert.match(service, /\bevents\b/, "must map broker -> events");
  assert.match(service, /\brest\b/i, "must map REST/search -> rest");
});

test("service: still requires a call-site source_file as evidence", () => {
  assert.match(service, /source_file/);
});
