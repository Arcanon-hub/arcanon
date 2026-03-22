/**
 * Tests for HiDPI canvas fix in worker/ui/modules/renderer.js
 * These are static source analysis tests — verify the fix is applied correctly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../plugins/ligamen/worker/ui/modules/renderer.js'), 'utf8');

test('render() reads devicePixelRatio with fallback to 1', () => {
  assert.ok(
    src.includes('window.devicePixelRatio || 1'),
    'MISSING: DPR must be read with fallback (window.devicePixelRatio || 1)'
  );
});

test('render() applies ctx.scale(dpr, dpr) for HiDPI scaling', () => {
  assert.ok(
    src.includes('ctx.scale(dpr, dpr)'),
    'MISSING: ctx.scale(dpr, dpr) not found in render()'
  );
});

test('ctx.scale(dpr, dpr) appears after ctx.save() and before ctx.translate()', () => {
  const saveIdx = src.indexOf('ctx.save()');
  const dprIdx = src.indexOf('ctx.scale(dpr, dpr)');
  const transIdx = src.indexOf('ctx.translate(state.transform');

  assert.ok(saveIdx >= 0, 'ctx.save() not found');
  assert.ok(dprIdx >= 0, 'ctx.scale(dpr, dpr) not found');
  assert.ok(transIdx >= 0, 'ctx.translate(state.transform) not found');
  assert.ok(
    dprIdx > saveIdx && dprIdx < transIdx,
    `ORDER WRONG: ctx.scale(dpr,dpr) must appear between ctx.save() and ctx.translate(). ` +
    `saveIdx=${saveIdx}, dprIdx=${dprIdx}, transIdx=${transIdx}`
  );
});

test('node label base font size bumped to 13px', () => {
  assert.ok(
    src.includes('Math.round(13 / state.transform.scale)'),
    'MISSING: label font size must be 13px base (was 11px)'
  );
});

test('type subtitle base font size bumped to 11px', () => {
  assert.ok(
    src.includes('Math.round(11 / state.transform.scale)'),
    'MISSING: subtitle font size must be 11px base (was 9px)'
  );
});

test('label font uses 13px and subtitle uses 11px (no old 9px or 11px-for-label pattern)', () => {
  // Verify 9px base is gone entirely
  assert.ok(
    !src.includes('Math.round(9 / state.transform.scale)'),
    'OLD CODE: 9px subtitle font still present — should be 11px after upgrade'
  );
  // Verify 13px exists (label) and 11px exists (subtitle) — both must be present
  assert.ok(
    src.includes('Math.round(13 / state.transform.scale)'),
    'MISSING: 13px label font not found'
  );
  assert.ok(
    src.includes('Math.round(11 / state.transform.scale)'),
    'MISSING: 11px subtitle font not found'
  );
});
