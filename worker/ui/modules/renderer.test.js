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

// Hexagon loop must be removed
check(
  !src.match(/for\s*\(\s*let i\s*=\s*0\s*;.*i\s*<\s*6/),
  "NODE-02 — hexagon loop removed (no for i < 6)",
  null
);

// ── NODE-03: Infra uses filled diamond ────────────────────────────────────

const infraFillIdx = src.indexOf("nodeType === \"infra\"");
const infraSection = infraFillIdx !== -1 ? src.slice(infraFillIdx, infraFillIdx + 400) : '';
check(
  infraSection.includes('ctx.fill()'),
  "NODE-03 — infra branch calls ctx.fill() with nodeColor",
  "ctx.fill() in infra branch"
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
