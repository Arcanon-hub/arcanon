/**
 * Prompt-content tests for network backing-service client detection (#45, phase 133).
 *
 * These are DETERMINISTIC content assertions over the two agent prompts — they do
 * NOT execute the scanner, use fixtures, or touch the network. The live
 * `/arcanon:map` re-scan surfacing `arcanon -> chromadb` is MANUAL verification,
 * documented in 133-02-SUMMARY.md, not asserted here.
 *
 * Strengthened in 133-02 (closes the MEDIUM "tautological / whole-file token
 * presence" critique): service-side assertions run against the extracted
 * "Backing-service clients" SECTION (sliced on `##` heading boundaries) so a
 * token in an unrelated section cannot satisfy a backing-service rule. Adds the
 * non-entry-point reachability CONTRACT proving the candidate handoff path is
 * structurally present end-to-end in the prompts.
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

/**
 * Extract a markdown section by its `##` heading. Returns the substring from the
 * matched heading up to (but not including) the next `##` heading, or end of file.
 * Section-coherent assertions run against this slice so a token elsewhere in the
 * file cannot satisfy a rule that must live inside the target section.
 */
function section(md, headingText) {
  const lines = md.split("\n");
  const start = lines.findIndex(
    (l) => /^##\s/.test(l) && l.toLowerCase().includes(headingText.toLowerCase()),
  );
  assert.notEqual(start, -1, `section heading "${headingText}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// The backing-service section of the service prompt — all service-side
// backing-service assertions are scoped to this slice, not the whole file.
const backingSection = section(service, "Backing-service clients");

// ---------------------------------------------------------------------------
// Discovery prompt — candidate handoff field + kept heuristics
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

test("discovery: backing_service_deps candidate field present in BOTH prose and Output Format JSON", () => {
  // Field appears at least twice (prose instruction + JSON schema property).
  const count = (discovery.match(/backing_service_deps/g) || []).length;
  assert.ok(
    count >= 2,
    `backing_service_deps must appear in both prose and the Output Format JSON block (found ${count})`,
  );
  // Present inside the Output Format JSON block specifically.
  const jsonBlock = discovery.slice(discovery.indexOf("```json"));
  assert.match(
    jsonBlock,
    /"backing_service_deps"\s*:/,
    "backing_service_deps must be a property in the Output Format JSON block",
  );
});

test("discovery: backing_service_deps is manifest-derived candidate library NAMES (not paths)", () => {
  assert.match(
    discovery,
    /backing_service_deps[\s\S]{0,400}?manifest/i,
    "candidate field must be described as manifest-derived",
  );
  assert.match(
    discovery,
    /candidate/i,
    "candidate framing must be present",
  );
  assert.match(
    discovery,
    /not file paths/i,
    "backing_service_deps must be distinguished from client_files as NAMES not file paths",
  );
});

test("discovery: keeps existing client_files heuristics (field is additive)", () => {
  assert.match(
    discovery,
    /client_files/,
    "client_files heuristics must be kept alongside the new candidate field",
  );
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
// Service prompt — section-coherent backing-service rule assertions
// ---------------------------------------------------------------------------

test("service: backing-section references the candidate handoff and instructs locating call sites", () => {
  assert.match(
    backingSection,
    /backing_service_deps/,
    "backing-service section must reference the discovery candidate list",
  );
  assert.match(
    backingSection,
    /locate|call site/i,
    "backing-service section must instruct Stage-2 to locate each candidate's call site",
  );
});

test("service: emission is call-site-conditioned, NOT MUST-on-import", () => {
  assert.match(
    backingSection,
    /only when|prove[sd]? an outbound|construction.*proves/i,
    "emission must be conditioned on a real construction/use call site (HIGH-2)",
  );
  assert.doesNotMatch(
    backingSection,
    /for every file[\s\S]{0,80}?MUST emit/i,
    "blanket 'for every file ... MUST emit' import-triggered directive must be gone (HIGH-2)",
  );
});

test("service: no-edge cases for non-connecting imports are stated", () => {
  assert.match(
    backingSection,
    /unused import|type-only|re-export|never used/i,
    "no-edge cases (unused/type-only/re-export/un-used client) must be stated",
  );
});

test("service: genuinely-ambiguous protocol routes to other (NOT closest bucket)", () => {
  assert.match(
    backingSection,
    /ambiguous[^.]*\bother\b/i,
    "ambiguous protocol must route to `other` (HIGH-3)",
  );
  assert.doesNotMatch(
    service,
    /closest canonical bucket/i,
    "closest-canonical-bucket directive must be gone from the whole file (HIGH-3)",
  );
});

test("service: classifies from observed transport, not by blanket search-engine->rest rule", () => {
  // Confident classification mappings are present in the section.
  assert.match(backingSection, /datastore[\s\S]{0,40}?\bdb\b/i, "datastore -> db");
  assert.match(backingSection, /broker[\s\S]{0,40}?\bevents\b/i, "broker -> events");
  assert.match(backingSection, /\brest\b/i, "demonstrated HTTP -> rest");
  // No blanket "search-engine API -> rest" misbucketing rule (MEDIUM-4).
  assert.doesNotMatch(
    backingSection,
    /search.?engine[\s\S]{0,30}?->[\s\S]{0,10}?rest/i,
    "must not teach a blanket search-engine -> rest rule (MEDIUM-4)",
  );
});

test("service: still requires a call-site source_file as evidence", () => {
  assert.match(service, /source_file/);
  assert.match(
    backingSection,
    /source_file/,
    "backing-service section must keep source_file as call-site evidence",
  );
});

test("service: #42 canonical 'never dropped' fallback is preserved", () => {
  assert.match(
    service,
    /never dropped/i,
    "the #42 'unrecognized -> other, never dropped' fallback must remain",
  );
});

// ---------------------------------------------------------------------------
// CONTRACT — non-entry-point reachability via the candidate handoff
// ---------------------------------------------------------------------------

test("contract: a non-entry-point / non-name-matched importer is reachable via the candidate handoff", () => {
  // 1. Discovery states such a file may NOT appear in client_files...
  assert.match(
    discovery,
    /not (an? )?entry point|not name-matched|neither name-matched/i,
    "discovery must acknowledge non-entry-point / non-name-matched importers",
  );
  assert.match(
    discovery,
    /will not appear in `?client_files`?|NOT appear in `?client_files`?/i,
    "discovery must state such a file will NOT appear in client_files",
  );
  // 2. ...and that backing_service_deps carries the dependency name across the handoff.
  assert.match(
    discovery,
    /backing_service_deps[\s\S]{0,600}?(carries|across the handoff|Stage-2)/i,
    "discovery must state backing_service_deps carries the dependency to Stage-2",
  );
  // 3. The service prompt instructs resolving candidates to call sites.
  assert.match(
    backingSection,
    /backing_service_deps[\s\S]{0,400}?(locate|call site)/i,
    "service must instruct resolving each candidate to its call site",
  );
  // Together: the candidate-handoff path exists end-to-end in the prompts.
});
