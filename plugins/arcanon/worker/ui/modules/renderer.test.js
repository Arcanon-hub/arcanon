/**
 * Verification tests for renderer.js.
 * Source inspection: boundary box rendering, node shape correctness.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'renderer.js'), 'utf8');

let passed = 0;
let failed = 0;

function check(condition, description, pattern) {
  if (condition) {
    console.log(`OK: ${description}`);
    passed++;
  } else {
    console.error(`FAIL: ${description}${pattern ? ` (missing: ${pattern})` : ''}`);
    failed++;
  }
}

// ── LAYOUT-05: Boundary box rendering ─────────────────────────────────────

check(
  src.includes('boundaryBoxes'),
  "LAYOUT-05 — boundary box rendering present",
  "boundaryBoxes"
);

check(
  src.includes('setLineDash'),
  "LAYOUT-05 — dashed line style used",
  "setLineDash"
);

check(
  src.includes('roundRect'),
  "LAYOUT-05 — rounded rectangle used",
  "roundRect"
);

check(
  src.includes('setLineDash([])'),
  "LAYOUT-05 — dash pattern reset after dashed drawing",
  "setLineDash([])"
);

check(
  src.includes('box.label'),
  "LAYOUT-05 — boundary box label rendered",
  "box.label"
);

check(
  src.includes('globalAlpha'),
  "LAYOUT-05 — semi-transparent fill using globalAlpha",
  "globalAlpha"
);

// ── NODE-01: Services use circle ──────────────────────────────────────────

check(
  src.includes('ctx.arc(pos.x, pos.y, NODE_RADIUS'),
  "NODE-01 — services use ctx.arc (circle shape)",
  "ctx.arc(pos.x, pos.y, NODE_RADIUS"
);

// ── NODE-02: Libraries use outline diamond ────────────────────────────────

// Diamond path must use 4 moveTo/lineTo points
const libDiamondPattern = /nodeType === ["']library["'].*?ctx\.moveTo/s;
check(
  src.includes("nodeType === \"library\" || nodeType === \"sdk\"") &&
  src.includes('ctx.moveTo(pos.x, pos.y - r)'),
  "NODE-02 — library/SDK uses diamond path (moveTo/lineTo 4 points)",
  "diamond path for library/sdk"
);

// Library branch must call ctx.stroke() for outline
check(
  src.includes('ctx.stroke()'),
  "NODE-02 — library/SDK shape uses ctx.stroke() for outline",
  "ctx.stroke()"
);

// Library branch must NOT use hexagon loop (hexagons are for actors only)
const libBranchIdx = src.indexOf('nodeType === "library" || nodeType === "sdk"');
const libSection = libBranchIdx !== -1 ? src.slice(libBranchIdx, libBranchIdx + 500) : '';
check(
  !libSection.match(/for\s*\(\s*let i\s*=\s*0\s*;.*i\s*<\s*6/),
  "NODE-02 — library branch has no hexagon loop (diamonds only)",
  null
);

// Actor branch SHOULD use hexagon loop (NODE-04)
check(
  src.includes('nodeType === "actor"') &&
  src.match(/nodeType === "actor"[\s\S]*?for\s*\(\s*let i\s*=\s*0\s*;.*i\s*<\s*6/),
  "NODE-04 — actor branch uses hexagon loop (for i < 6)",
  "hexagon loop in actor branch"
);

// ── NODE-03: Infra uses filled diamond ────────────────────────────────────

const infraFillIdx = src.indexOf("nodeType === \"infra\"");
const infraSection = infraFillIdx !== -1 ? src.slice(infraFillIdx, infraFillIdx + 400) : '';
check(
  infraSection.includes('ctx.fill()'),
  "NODE-03 — infra branch calls ctx.fill() with nodeColor",
  "ctx.fill() in infra branch"
);

// ── CTRL-02/03/04/05/06: New filter logic ─────────────────────────────────

check(
  src.includes('activeLayers'),
  "CTRL-03/04 — activeLayers filter referenced in renderer",
  "activeLayers"
);

check(
  src.includes('mismatchesOnly'),
  "CTRL-05 — mismatchesOnly filter referenced in renderer",
  "mismatchesOnly"
);

check(
  src.includes('hideIsolated'),
  "CTRL-06 — hideIsolated filter referenced in renderer",
  "hideIsolated"
);

check(
  src.includes('languageFilter'),
  "CTRL-07 — languageFilter referenced in renderer",
  "languageFilter"
);

check(
  src.includes('boundaryFilter'),
  "CTRL-02 — boundaryFilter referenced in renderer",
  "boundaryFilter"
);

check(
  src.includes('nodeLayer'),
  "CTRL-03/04 — nodeLayer helper function defined",
  "nodeLayer"
);

check(
  src.includes('connectedIds'),
  "CTRL-06 — hide-isolated connectedIds logic present",
  "connectedIds"
);

// nodeLayer helper should return correct layer strings
check(
  src.includes('"libraries"') && src.includes('"infra"') && src.includes('"external"') && src.includes('"services"'),
  "CTRL-03/04 — nodeLayer helper returns all 4 layer strings",
  "all 4 layer string constants"
);

// Mismatch filter in edge loop (after protocol filter)
check(
  src.includes('state.mismatchesOnly && !edge.mismatch'),
  "CTRL-05 — mismatch edge filter guard in edge loop",
  "state.mismatchesOnly && !edge.mismatch"
);

// Layer filter uses activeLayers.has()
check(
  src.includes('state.activeLayers.has(nodeLayer(n))') || src.includes('activeLayers.has(nodeLayer('),
  "CTRL-03/04 — layer filter uses activeLayers.has(nodeLayer(n))",
  "activeLayers.has(nodeLayer("
);

// Language filter checks node.language
check(
  src.includes('n.language !== state.languageFilter') || src.includes('node.language !== state.languageFilter'),
  "CTRL-07 — language filter guards node.language",
  "n.language !== state.languageFilter"
);

// Boundary filter checks node.boundary
check(
  src.includes('n.boundary !== state.boundaryFilter') || src.includes('node.boundary !== state.boundaryFilter'),
  "CTRL-02 — boundary filter guards node.boundary",
  "n.boundary !== state.boundaryFilter"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
