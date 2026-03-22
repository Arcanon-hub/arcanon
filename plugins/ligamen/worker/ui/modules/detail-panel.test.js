/**
 * Verification tests for detail-panel.js.
 * Source-inspection tests for three-way panel routing, library/infra renderers,
 * and escapeHtml helper.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "detail-panel.js"), "utf8");

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

// ── PANEL-02: Three-way routing ────────────────────────────────────────────

// infra routing branch exists
check(
  src.includes("nodeType === 'infra'") || src.includes('nodeType === "infra"'),
  "PANEL-02: infra routing branch exists",
  "nodeType === 'infra'"
);

// renderInfraConnections function is defined
check(
  src.includes("renderInfraConnections"),
  "PANEL-02: renderInfraConnections function is defined",
  "renderInfraConnections"
);

// old two-way dispatch is gone (isLib boolean must not exist)
check(
  !src.includes("const isLib"),
  "PANEL-02: old isLib two-way dispatch is removed",
  null
);

// ── PANEL-03: Library panel with exports ──────────────────────────────────

// exports filtered by kind
check(
  src.includes("kind === 'export'") || src.includes('kind === "export"'),
  "PANEL-03: exports filtered by kind",
  "kind === 'export'"
);

// function vs type classification by parenthesis
check(
  src.includes(".includes('(')") || src.includes('.includes("(")') || src.includes("includes('(')"),
  "PANEL-03: function vs type classification by parenthesis",
  ".includes('(')"
);

// call site passes node as first argument
check(
  src.includes("renderLibraryConnections(node"),
  "PANEL-03: renderLibraryConnections call site passes node as first argument",
  "renderLibraryConnections(node"
);

// ── PANEL-04: Infra panel with resources ──────────────────────────────────

// resources filtered by kind
check(
  src.includes("kind === 'resource'") || src.includes('kind === "resource"'),
  "PANEL-04: resources filtered by kind",
  "kind === 'resource'"
);

// prefix extraction via split
check(
  src.includes(".split('/')[0]") || src.includes(".split('/')[0]"),
  "PANEL-04: prefix extraction via split('/')[0]",
  ".split('/')[0]"
);

// ── XSS safety ────────────────────────────────────────────────────────────

// escapeHtml helper is used
check(
  src.includes("escapeHtml"),
  "XSS: escapeHtml helper is used",
  "escapeHtml"
);

// escape function handles HTML entities
check(
  src.includes("&amp;") && src.includes("&lt;") && src.includes("&gt;"),
  "XSS: escape function handles &amp; &lt; &gt; entities",
  "&amp; &lt; &gt;"
);

// ── No connections guard ──────────────────────────────────────────────────

// guard accounts for exposes
check(
  src.includes("node.exposes") || src.includes("exposes"),
  "Guard: no-connections guard accounts for node.exposes",
  "node.exposes"
);

// ── NAV-04: Clickable connection targets ──────────────────────────────────

// data-node-id attribute emitted on .conn-target spans
check(
  src.includes("data-node-id"),
  "NAV-04: data-node-id attribute present on .conn-target spans",
  "data-node-id"
);

// selectAndPanToNode function defined
check(
  src.includes("selectAndPanToNode"),
  "NAV-04: selectAndPanToNode function defined",
  "selectAndPanToNode"
);

// event delegation on [data-node-id] wired in panel
check(
  src.includes("closest") && src.includes("data-node-id"),
  "NAV-04: event delegation via closest('[data-node-id]') wired",
  "closest + data-node-id"
);

// render() imported (needed for selectAndPanToNode to redraw)
check(
  src.includes('from "./renderer.js"') || src.includes("from './renderer.js'"),
  "NAV-04: render imported from renderer.js",
  'from "./renderer.js"'
);

// no-op guard for missing position
check(
  src.includes("state.positions[nodeId]") || src.includes("state.positions["),
  "NAV-04: no-op guard checks state.positions before pan",
  "state.positions[nodeId]"
);

// ── Phase 72: renderServiceMeta ────────────────────────────────────────────

// renderServiceMeta function is defined
check(
  src.includes("function renderServiceMeta"),
  "Phase72: renderServiceMeta function is defined",
  "function renderServiceMeta"
);

// renderServiceMeta is called from showDetailPanel (at least 2 occurrences total)
check(
  (src.match(/renderServiceMeta/g) || []).length >= 2,
  "Phase72: renderServiceMeta has definition + call site",
  "renderServiceMeta appears >= 2 times"
);

// Owner row always rendered
check(
  src.includes('"Owner"') || src.includes("'Owner'") || src.includes(">Owner<"),
  "Phase72: Owner row label present in renderServiceMeta",
  "'Owner'"
);

// Auth Mechanism row always rendered
check(
  src.includes("Auth Mechanism"),
  "Phase72: Auth Mechanism row label present in renderServiceMeta",
  "Auth Mechanism"
);

// Database row always rendered
check(
  src.includes('"Database"') || src.includes("'Database'") || src.includes(">Database<"),
  "Phase72: Database row label present in renderServiceMeta",
  "'Database'"
);

// Gray color #718096 used for unknown/null values
check(
  src.includes("#718096"),
  "Phase72: #718096 gray used for unknown values",
  "#718096"
);

// escapeHtml applied to owner value
check(
  src.includes("escapeHtml(node.owner)"),
  "Phase72 XSS: escapeHtml applied to node.owner",
  "escapeHtml(node.owner)"
);

// escapeHtml applied to auth_mechanism value
check(
  src.includes("escapeHtml(node.auth_mechanism)"),
  "Phase72 XSS: escapeHtml applied to node.auth_mechanism",
  "escapeHtml(node.auth_mechanism)"
);

// escapeHtml applied to db_backend value
check(
  src.includes("escapeHtml(node.db_backend)"),
  "Phase72 XSS: escapeHtml applied to node.db_backend",
  "escapeHtml(node.db_backend)"
);

// ── Phase 72: confidence badges ────────────────────────────────────────────

// confidenceColor variable defined
check(
  src.includes("confidenceColor"),
  "Phase72: confidenceColor variable defined in renderServiceConnections",
  "confidenceColor"
);

// confidenceBadge variable defined
check(
  src.includes("confidenceBadge"),
  "Phase72: confidenceBadge variable defined in renderServiceConnections",
  "confidenceBadge"
);

// Green color #48bb78 for high confidence
check(
  src.includes("#48bb78"),
  "Phase72: #48bb78 green color for high confidence",
  "#48bb78"
);

// Amber color #ed8936 for low confidence
check(
  src.includes("#ed8936"),
  "Phase72: #ed8936 amber color for low confidence",
  "#ed8936"
);

// ── SCHEMA-01: Connection schema rendering ─────────────────────────────────

// renderConnectionSchema function is defined
check(
  src.includes('renderConnectionSchema'),
  'SCHEMA-01: renderConnectionSchema function defined',
  'renderConnectionSchema'
);

// schema section label prefix
check(
  src.includes('Schema:'),
  'SCHEMA-01: schema section label contains "Schema:"',
  'Schema:'
);

// field table has Name/Type/Req header columns
check(
  src.includes('>Name<') && src.includes('>Type<') && src.includes('>Req<'),
  'SCHEMA-01: field table has Name, Type, Req column headers',
  '>Name< >Type< >Req<'
);

// escapeHtml applied to field name
check(
  src.includes('escapeHtml(f.name)'),
  'SCHEMA-01: escapeHtml applied to field.name (prevents <T> generics from being hidden)',
  'escapeHtml(f.name)'
);

// escapeHtml applied to field type
check(
  src.includes('escapeHtml(f.type)'),
  'SCHEMA-01: escapeHtml applied to field.type (prevents Array<T> from being invisible)',
  'escapeHtml(f.type)'
);

// required=true badge uses green color
check(
  src.includes('48bb78') || src.includes('#48bb78'),
  'SCHEMA-01: required=true badge uses green color #48bb78',
  '#48bb78'
);

// absent schema returns empty string (String(connectionId) conversion)
check(
  src.includes('String(connectionId)'),
  'SCHEMA-01: connectionId converted to string for map key lookup',
  'String(connectionId)'
);

// schema section wired into showBundlePanel
check(
  src.includes('renderConnectionSchema') && src.includes('showBundlePanel'),
  'SCHEMA-01: renderConnectionSchema called inside showBundlePanel',
  'renderConnectionSchema in showBundlePanel'
);

// ── UNK-01: Unknown state always visible ──────────────────────────────────

// renderServiceMeta function is defined (from Plan 01)
check(
  src.includes('renderServiceMeta'),
  'UNK-01: renderServiceMeta function defined',
  'renderServiceMeta'
);

// Owner row always present
check(
  src.includes('Owner'),
  'UNK-01: Owner row present in renderServiceMeta',
  'Owner'
);

// Auth Mechanism row always present
check(
  src.includes('Auth Mechanism'),
  'UNK-01: Auth Mechanism row present in renderServiceMeta',
  'Auth Mechanism'
);

// Database row always present
check(
  src.includes('Database'),
  'UNK-01: Database row present in renderServiceMeta',
  'Database'
);

// unknown fallback uses gray color
check(
  src.includes('718096') && src.includes('unknown'),
  'UNK-01: unknown fallback uses gray color #718096',
  '#718096 + unknown'
);

// ── CONF-03: Confidence badge ──────────────────────────────────────────────

// confidence badge defined in renderServiceConnections
check(
  src.includes('confidenceBadge') || (src.includes('confidenceColor') && src.includes('48bb78')),
  'CONF-03: confidence badge defined with color logic',
  'confidenceBadge or confidenceColor+48bb78'
);

// ── AGENT-03: source_file and target_file display ─────────────────────────

// Outgoing "Calls" section shows source_file when present
check(
  src.includes("e.source_file") &&
    (src.includes('conn-file') || src.includes("conn-file")),
  "AGENT-03: outgoing section has conn-file row for source_file",
  "e.source_file ... conn-file"
);

// Incoming "Called by" section shows target_file when present
check(
  src.includes("e.target_file"),
  "AGENT-03: incoming section has conn-file row for target_file",
  "e.target_file"
);

// Both use escapeHtml to prevent XSS
check(
  src.includes("escapeHtml(e.source_file)"),
  "AGENT-03: source_file is XSS-escaped via escapeHtml",
  "escapeHtml(e.source_file)"
);

check(
  src.includes("escapeHtml(e.target_file)"),
  "AGENT-03: target_file is XSS-escaped via escapeHtml",
  "escapeHtml(e.target_file)"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
