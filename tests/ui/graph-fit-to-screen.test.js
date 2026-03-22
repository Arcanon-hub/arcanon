/**
 * Tests for fitToScreen() function in worker/ui/graph.js
 * These are static source analysis tests — verify the implementation is correct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../plugins/ligamen/worker/ui/graph.js'), 'utf8');

test('fitToScreen() function is defined', () => {
  assert.ok(
    src.includes('function fitToScreen()'),
    'MISSING: fitToScreen function not defined in graph.js'
  );
});

test('fitToScreen() uses state.positions to get node positions', () => {
  assert.ok(
    src.includes('Object.values(state.positions)'),
    'MISSING: fitToScreen must read Object.values(state.positions)'
  );
});

test('fitToScreen() uses container.clientWidth for CSS canvas width', () => {
  assert.ok(
    src.includes('container.clientWidth'),
    'MISSING: fitToScreen must use container.clientWidth for CSS width'
  );
});

test('fitToScreen() uses container.clientHeight for CSS canvas height', () => {
  assert.ok(
    src.includes('container.clientHeight'),
    'MISSING: fitToScreen must use container.clientHeight for CSS height'
  );
});

test('fitToScreen() calls render() after updating transform', () => {
  // Ensure render() is called inside fitToScreen (after the transform update)
  const fitStart = src.indexOf('function fitToScreen()');
  assert.ok(fitStart !== -1, 'fitToScreen function not found');
  // Find the matching closing brace by tracking brace depth
  let depth = 0;
  let fitEnd = -1;
  for (let i = fitStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { fitEnd = i; break; }
    }
  }
  assert.ok(fitEnd !== -1, 'Could not find end of fitToScreen function');
  const body = src.slice(fitStart, fitEnd + 1);
  assert.ok(
    body.includes('render()'),
    'MISSING: fitToScreen must call render() after updating transform'
  );
});

test('#fit-btn click event wires to fitToScreen', () => {
  assert.ok(
    src.includes('fit-btn'),
    'MISSING: fit-btn click event wiring not found in graph.js'
  );
});
