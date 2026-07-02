/**
 * worker/scan/findings.pii06.test.js —  (X2 mitigation).
 *
 * Pins the parseAgentOutput / validateFindings contract: when the scanning
 * agent regresses and emits an absolute `source_file` (e.g. "/Users/me/foo.ts"),
 * the field is dropped with a WARN whose value is masked via maskHome, the rest
 * of the connection persists, and the scan does NOT fail.
 *
 * Set HOME to a fixture BEFORE importing path-mask.js (transitively imported
 * by findings.js) so the module-load `process.env.HOME` read sees a stable
 * value rather than the developer's actual home directory.
 *
 * Cases (4):
 *   1 — absolute source_file → field dropped, warning emitted with masked path,
 *       valid: true, connection persists with all other fields intact
 *   2 — relative source_file → passes through unchanged, no rejection warning
 *   3 — null source_file → passes through unchanged, no rejection warning
 *   4 — scan does NOT fail when an absolute source_file appears alongside a
 *       valid connection: both connections persist (the absolute one with
 *       source_file=null, the relative one untouched)
 */

process.env.HOME = '/Users/me';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseAgentOutput } = await import('./findings.js');

/**
 * Helper — wraps a connections array in a minimally-valid findings shell so
 * parseAgentOutput / validateFindings will accept it.
 */
function makeAgentJson(connections) {
  const obj = {
    service_name: 'svc',
    confidence: 'high',
    services: [
      {
        name: 'svc',
        root_path: 'src/',
        language: 'javascript',
        confidence: 'high',
      },
    ],
    connections,
    schemas: [],
  };
  return '```json\n' + JSON.stringify(obj) + '\n```';
}

test('absolute source_file is dropped with masked WARN, connection persists', () => {
  const result = parseAgentOutput(
    makeAgentJson([
      {
        source: 'svc',
        target: 'other',
        protocol: 'rest',
        method: 'GET',
        path: '/api/foo',
        source_file: '/Users/me/proj/src/auth.ts:42',
        confidence: 'high',
        evidence: 'inline call site',
      },
    ]),
  );

  assert.equal(result.valid, true, 'scan must NOT fail on absolute source_file');
  assert.equal(result.findings.connections.length, 1);
  assert.equal(
    result.findings.connections[0].source_file,
    null,
    'absolute source_file should be dropped to null',
  );
  // Other connection fields survive the rejection.
  assert.equal(result.findings.connections[0].source, 'svc');
  assert.equal(result.findings.connections[0].target, 'other');
  assert.equal(result.findings.connections[0].protocol, 'rest');
  assert.equal(result.findings.connections[0].method, 'GET');
  assert.equal(result.findings.connections[0].path, '/api/foo');
  assert.equal(result.findings.connections[0].evidence, 'inline call site');
  assert.equal(result.findings.connections[0].confidence, 'high');

  // CTR-03: the colon-split fires first, extracting the symbol suffix "42" and
  // leaving source_file = "/Users/me/proj/src/auth.ts". The absolute-path guard
  // then fires on the cleaned path, so the masked rejection warning shows the
  // path WITHOUT the ":42" suffix.
  // HOME = "/Users/me", so /Users/me/proj/src/auth.ts → ~/proj/src/auth.ts
  const rejectionWarn = result.warnings.find((w) =>
    /source_file is absolute.*dropping/.test(w),
  );
  assert.ok(rejectionWarn, 'expected a rejection warning matching the rejection contract');
  assert.match(rejectionWarn, /~\/proj\/src\/auth\.ts/);
  assert.doesNotMatch(
    rejectionWarn,
    /\/Users\/me\//,
    'warning must NOT contain the unmasked absolute path',
  );
});

test('relative source_file passes through unchanged, no rejection warning', () => {
  const result = parseAgentOutput(
    makeAgentJson([
      {
        source: 'svc',
        target: 'other',
        protocol: 'rest',
        method: 'GET',
        path: '/api/foo',
        source_file: 'src/auth.ts:42',
        confidence: 'high',
        evidence: 'inline call site',
      },
    ]),
  );

  assert.equal(result.valid, true);
  // CTR-03: "src/auth.ts:42" is split — source_file = path only, source_symbol = "42"
  assert.equal(result.findings.connections[0].source_file, 'src/auth.ts');
  assert.equal(result.findings.connections[0].source_symbol, '42');
  // No REJECTION warning fires for relative paths (split warning is distinct).
  const rejectionWarn = result.warnings.find((w) =>
    /source_file is absolute.*dropping/.test(w),
  );
  assert.equal(rejectionWarn, undefined, 'relative paths must not trigger rejection');
});

test('null source_file passes through unchanged, no rejection warning', () => {
  const result = parseAgentOutput(
    makeAgentJson([
      {
        source: 'svc',
        target: 'other',
        protocol: 'rest',
        method: 'GET',
        path: '/api/foo',
        source_file: null,
        confidence: 'high',
        evidence: 'inline call site',
      },
    ]),
  );

  assert.equal(result.valid, true);
  assert.equal(result.findings.connections[0].source_file, null);
  const rejectionWarn = result.warnings.find((w) =>
    /source_file is absolute.*dropping/.test(w),
  );
  assert.equal(rejectionWarn, undefined, 'null source_file must not trigger rejection');
  // The pre-existing null-source_file informational warning may still fire.
});

test('scan does NOT fail; mixed connections persist (absolute dropped, relative kept)', () => {
  const result = parseAgentOutput(
    makeAgentJson([
      {
        source: 'a',
        target: 'b',
        protocol: 'rest',
        method: 'GET',
        path: '/x',
        source_file: '/Users/me/work/a.ts:1',
        confidence: 'high',
        evidence: 'a',
      },
      {
        source: 'a',
        target: 'b',
        protocol: 'rest',
        method: 'POST',
        path: '/y',
        source_file: 'src/b.ts:2',
        confidence: 'high',
        evidence: 'b',
      },
    ]),
  );

  assert.equal(result.valid, true, 'mixed connections must not fail the scan');
  assert.equal(result.findings.connections.length, 2);
  // First connection: absolute → source_file dropped, rest intact.
  assert.equal(result.findings.connections[0].source_file, null);
  assert.equal(result.findings.connections[0].path, '/x');
  // Second connection: relative "src/b.ts:2" → CTR-03 splits into path + symbol.
  assert.equal(result.findings.connections[1].source_file, 'src/b.ts');
  assert.equal(result.findings.connections[1].source_symbol, '2');
  assert.equal(result.findings.connections[1].path, '/y');
});
