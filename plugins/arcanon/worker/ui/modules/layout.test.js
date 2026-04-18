/**
 * Behavioral tests for layout.js.
 *
 * Tests: layer ordering, determinism, grid spacing, boundary boxes,
 * boundary-aware grouping, empty input, frontend classification,
 * and actor-column reservation.
 *
 * Runs with: node --test worker/ui/modules/layout.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// layout.js imports from state.js (for NODE_RADIUS) and utils.js (for getNodeType).
// Both are plain ES modules with no browser/DOM dependencies — safe to import in Node.
import { computeLayout, ACTOR_COLUMN_RESERVE_RATIO } from './layout.js';

// ── LAYOUT-01: Layer ordering ─────────────────────────────────────────────────
describe('LAYOUT-01 — layer ordering', () => {
  it('places service node above library, library above infra (lower Y = higher on screen)', () => {
    const nodes = [
      { id: 1, name: 'svc-a',  type: 'service' },
      { id: 2, name: 'lib-b',  type: 'library' },
      { id: 3, name: 'db',     type: 'infra'   },
    ];
    const { positions } = computeLayout(nodes, [], 800, 600);
    assert.ok(positions[1].y < positions[2].y, 'service Y < library Y');
    assert.ok(positions[2].y < positions[3].y, 'library Y < infra Y');
  });

  it('places frontend nodes in the service layer (same Y band as services)', () => {
    const nodes = [
      { id: 1, name: 'svc-a',   type: 'service'  },
      { id: 2, name: 'ui-app',  type: 'frontend' },
    ];
    const { positions } = computeLayout(nodes, [], 800, 600);
    assert.strictEqual(positions[1].y, positions[2].y, 'frontend Y equals service Y');
  });
});

// ── LAYOUT-02: Determinism ────────────────────────────────────────────────────
describe('LAYOUT-02 — deterministic positions', () => {
  it('produces identical positions on two consecutive calls with the same input', () => {
    const nodes = [
      { id: 1, name: 'svc-a', type: 'service' },
      { id: 2, name: 'lib-b', type: 'library' },
      { id: 3, name: 'infra', type: 'infra'   },
    ];
    const r1 = computeLayout(nodes, [], 1000, 800);
    const r2 = computeLayout(nodes, [], 1000, 800);
    assert.strictEqual(
      JSON.stringify(r1),
      JSON.stringify(r2),
      'two calls produce identical JSON output'
    );
  });
});

// ── LAYOUT-03: Grid spacing ───────────────────────────────────────────────────
describe('LAYOUT-03 — grid spacing', () => {
  it('assigns unique X positions to each service node', () => {
    const nodes = [
      { id: 1, name: 'svc-a', type: 'service' },
      { id: 2, name: 'svc-b', type: 'service' },
      { id: 3, name: 'svc-c', type: 'service' },
      { id: 4, name: 'svc-d', type: 'service' },
    ];
    const { positions } = computeLayout(nodes, [], 800, 600);
    const xs = [positions[1].x, positions[2].x, positions[3].x, positions[4].x];
    const unique = new Set(xs);
    assert.strictEqual(unique.size, 4, 'all 4 service nodes have unique X positions');
  });

  it('spaces service nodes evenly (consecutive differences equal within 1px tolerance)', () => {
    const nodes = [
      { id: 1, name: 'svc-a', type: 'service' },
      { id: 2, name: 'svc-b', type: 'service' },
      { id: 3, name: 'svc-c', type: 'service' },
      { id: 4, name: 'svc-d', type: 'service' },
    ];
    const { positions } = computeLayout(nodes, [], 800, 600);
    const sortedX = [positions[1].x, positions[2].x, positions[3].x, positions[4].x].sort((a, b) => a - b);
    const diffs = [];
    for (let i = 1; i < sortedX.length; i++) {
      diffs.push(sortedX[i] - sortedX[i - 1]);
    }
    const minDiff = Math.min(...diffs);
    const maxDiff = Math.max(...diffs);
    assert.ok(
      maxDiff - minDiff <= 1,
      `spacing differences should be within 1px (min=${minDiff.toFixed(2)}, max=${maxDiff.toFixed(2)})`
    );
  });
});

// ── LAYOUT-04: Boundary boxes ─────────────────────────────────────────────────
describe('LAYOUT-04 — boundary boxes', () => {
  it('produces one boundary box for a single boundary definition', () => {
    const nodes = [
      { id: 1, name: 'svc-a', type: 'service' },
      { id: 2, name: 'svc-b', type: 'service' },
      { id: 3, name: 'svc-c', type: 'service' },
    ];
    const boundaries = [
      { name: 'pay', label: 'Payments', services: ['svc-a', 'svc-b'] },
    ];
    const { positions, boundaryBoxes } = computeLayout(nodes, boundaries, 800, 600);
    assert.strictEqual(boundaryBoxes.length, 1, 'exactly one boundary box');
    const box = boundaryBoxes[0];
    assert.strictEqual(box.label, 'Payments', 'box label matches boundary label');
    assert.ok(typeof box.x === 'number', 'box.x is a number');
    assert.ok(typeof box.y === 'number', 'box.y is a number');
    assert.ok(typeof box.w === 'number', 'box.w is a number');
    assert.ok(typeof box.h === 'number', 'box.h is a number');

    // Box must enclose both member nodes (member X within box X bounds)
    const memberXs = ['svc-a', 'svc-b'].map(name => {
      const node = nodes.find(n => n.name === name);
      return positions[node.id].x;
    });
    for (const mx of memberXs) {
      assert.ok(mx >= box.x, `member x (${mx}) >= box.x (${box.x})`);
      assert.ok(mx <= box.x + box.w, `member x (${mx}) <= box.x + box.w (${box.x + box.w})`);
    }
  });

  it('enforces minimum box height for single-row boundaries (Pitfall 4)', () => {
    const nodes = [
      { id: 1, name: 'svc-a', type: 'service' },
      { id: 2, name: 'svc-b', type: 'service' },
    ];
    const boundaries = [{ name: 'b', label: 'B', services: ['svc-a', 'svc-b'] }];
    const { boundaryBoxes } = computeLayout(nodes, boundaries, 800, 600);
    assert.strictEqual(boundaryBoxes.length, 1);
    // Minimum height: NODE_RADIUS (18) * 2 + BOX_PAD (28) * 2 = 92
    assert.ok(boundaryBoxes[0].h >= 92, `box height (${boundaryBoxes[0].h}) >= minimum 92`);
  });
});

// ── Boundary-aware grouping ───────────────────────────────────────────────────
describe('Boundary-aware grouping', () => {
  it('places boundary member nodes in adjacent columns (no un-boundaried node between them)', () => {
    const nodes = [
      { id: 1, name: 'svc-a', type: 'service' },  // in boundary
      { id: 2, name: 'svc-b', type: 'service' },  // NOT in boundary
      { id: 3, name: 'svc-c', type: 'service' },  // in boundary
      { id: 4, name: 'svc-d', type: 'service' },  // NOT in boundary
    ];
    const boundaries = [{ name: 'grp', label: 'Group', services: ['svc-a', 'svc-c'] }];
    const { positions } = computeLayout(nodes, boundaries, 800, 600);

    // Sort all nodes by X position
    const byX = [1, 2, 3, 4].sort((a, b) => positions[a].x - positions[b].x);

    // Member nodes (1 and 3) must be adjacent — their indices in byX must differ by 1
    const indexA = byX.indexOf(1);
    const indexC = byX.indexOf(3);
    assert.ok(Math.abs(indexA - indexC) === 1, 'boundary member nodes are adjacent in X ordering');
  });
});

// ── Empty input ───────────────────────────────────────────────────────────────
describe('Empty input', () => {
  it('returns empty positions and empty boundaryBoxes for no nodes', () => {
    const { positions, boundaryBoxes } = computeLayout([], [], 800, 600);
    assert.deepStrictEqual(positions, {});
    assert.deepStrictEqual(boundaryBoxes, []);
  });
});

// ── Actor column reservation ──────────────────────────────────────────────────
describe('Actor column reservation', () => {
  it('places a single service node within the non-reserved area (left of actor column)', () => {
    const nodes = [{ id: 1, name: 'svc-a', type: 'service' }];
    const { positions } = computeLayout(nodes, [], 1000, 600);
    // Node X must be < canvasW * (1 - ACTOR_COLUMN_RESERVE_RATIO) = 1000 * 0.82 = 820
    const maxX = 1000 * (1 - ACTOR_COLUMN_RESERVE_RATIO);
    assert.ok(positions[1].x < maxX, `node X (${positions[1].x}) is within non-reserved area (< ${maxX})`);
  });
});
