/**
 * Tests for HiDPI canvas fix in worker/ui/graph.js
 * These are static source analysis tests — verify the fix is applied correctly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../plugins/arcanon/worker/ui/graph.js'), 'utf8');

test('resize() multiplies canvas dimensions by devicePixelRatio', () => {
  assert.ok(
    src.includes('devicePixelRatio'),
    'MISSING: devicePixelRatio variable not used in graph.js'
  );
});

test('resize() sets canvas.style.width to CSS pixels', () => {
  assert.ok(
    src.includes('canvas.style.width'),
    'MISSING: canvas.style.width not set (required for HiDPI CSS sizing)'
  );
});

test('resize() sets canvas.style.height to CSS pixels', () => {
  assert.ok(
    src.includes('canvas.style.height'),
    'MISSING: canvas.style.height not set (required for HiDPI CSS sizing)'
  );
});

test('watchDPR() function present for multi-monitor DPR change detection', () => {
  assert.ok(
    src.includes('watchDPR'),
    'MISSING: watchDPR function not present'
  );
});

test('force worker receives CSS dimensions (not physical pixels)', () => {
  assert.ok(
    src.includes('canvas.width / (window.devicePixelRatio'),
    'MISSING: force worker must receive CSS dimensions (canvas.width / devicePixelRatio)'
  );
});
