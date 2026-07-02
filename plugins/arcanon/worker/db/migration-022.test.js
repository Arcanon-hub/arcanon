/**
 * Test suite for migration 022 — connections.source_symbol + connections.target_symbol.
 *
 * The contract (Phase 140) splits the combined "path:symbol" source_file value
 * into separate source_file (path only) and source_symbol (symbol name) fields.
 * Migration 022 adds both nullable TEXT columns to the connections table and
 * performs a one-time conservative colon-split on existing rows (CTR-03).
 *
 * Verifies:
 *   - version export === 22
 *   - source_symbol column exists (TEXT, nullable) after migration
 *   - target_symbol column exists (TEXT, nullable) after migration
 *   - Idempotency (PRAGMA-guarded ALTER — re-run is a no-op, each column once)
 *   - Legacy split: "src/auth.ts:validateToken" → source_file="src/auth.ts", source_symbol="validateToken"
 *   - Conservative guard: plain "src/auth.ts" (no colon) is unchanged, source_symbol stays NULL
 *   - Conservative guard: colon with slash after ("src/http:client/v2.ts") is NOT split
 *   - Conservative guard: no dot before colon ("nodotpath:fn") is NOT split
 *   - Symmetric split applied to target_file → target_symbol
 *   - Pre-existing rows with NULL source_file/target_file survive unchanged
 *   - No stale "better-sqlite3" wording in the migration source (node:sqlite codebase)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from './sqlite-adapter.js';
import { up as up001 } from './migrations/001_initial_schema.js';
import { version, up as up022 } from './migrations/022_connections_source_target_symbol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Returns a fresh in-memory db with the initial schema (001) applied but WITHOUT
 * migration 022, so each test applies 022 explicitly under controlled conditions.
 * The connections table is present from 001 with source_file and target_file TEXT
 * columns but without source_symbol or target_symbol.
 */
function freshDbPre022() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  return db;
}

/**
 * Seeds a repo + two services + a connection row into a pre-022 db.
 * Returns { repoId, svcAId, svcBId, insertConn } where insertConn(sourceFile, targetFile)
 * inserts a connections row and returns its rowid.
 */
function seedSetup(db) {
  const repoId = db
    .prepare('INSERT INTO repos(path, name, type) VALUES(?,?,?)')
    .run('/tmp/test-022', 'r', 'single').lastInsertRowid;
  const svcAId = db
    .prepare('INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)')
    .run(repoId, 'svc-a', '.', 'ts').lastInsertRowid;
  const svcBId = db
    .prepare('INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)')
    .run(repoId, 'svc-b', '.', 'ts').lastInsertRowid;
  const insertConn = (sourceFile, targetFile) =>
    db
      .prepare(
        'INSERT INTO connections(source_service_id, target_service_id, protocol, source_file, target_file) VALUES(?,?,?,?,?)',
      )
      .run(svcAId, svcBId, 'rest', sourceFile, targetFile).lastInsertRowid;
  return { repoId, svcAId, svcBId, insertConn };
}

describe('migration 022 — connections.source_symbol + target_symbol', () => {
  it('exports version === 22', () => {
    assert.equal(version, 22);
    assert.equal(typeof up022, 'function');
  });

  it('adds source_symbol column (TEXT, nullable) to the connections table', () => {
    const db = freshDbPre022();
    up022(db);

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const col = cols.find((c) => c.name === 'source_symbol');
    assert.ok(col, 'source_symbol column exists after migration 022');
    assert.equal(col.type, 'TEXT', 'source_symbol column is TEXT');
    assert.equal(col.notnull, 0, 'source_symbol column is nullable');
  });

  it('adds target_symbol column (TEXT, nullable) to the connections table', () => {
    const db = freshDbPre022();
    up022(db);

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const col = cols.find((c) => c.name === 'target_symbol');
    assert.ok(col, 'target_symbol column exists after migration 022');
    assert.equal(col.type, 'TEXT', 'target_symbol column is TEXT');
    assert.equal(col.notnull, 0, 'target_symbol column is nullable');
  });

  it('is idempotent — running up() twice does not throw and each column appears once', () => {
    const db = freshDbPre022();
    up022(db);
    assert.doesNotThrow(() => up022(db), 'second up() call does not throw');

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    const srcSymCols = cols.filter((c) => c.name === 'source_symbol');
    const tgtSymCols = cols.filter((c) => c.name === 'target_symbol');
    assert.equal(srcSymCols.length, 1, 'source_symbol column appears exactly once');
    assert.equal(tgtSymCols.length, 1, 'target_symbol column appears exactly once');
  });

  it('is a no-op when columns already exist (manual ADD COLUMN before migration)', () => {
    const db = freshDbPre022();
    db.exec('ALTER TABLE connections ADD COLUMN source_symbol TEXT');
    db.exec('ALTER TABLE connections ADD COLUMN target_symbol TEXT');
    assert.doesNotThrow(() => up022(db), 'up() does not throw when columns are pre-existing');

    const cols = db.prepare('PRAGMA table_info(connections)').all();
    assert.equal(cols.filter((c) => c.name === 'source_symbol').length, 1, 'source_symbol appears exactly once');
    assert.equal(cols.filter((c) => c.name === 'target_symbol').length, 1, 'target_symbol appears exactly once');
  });

  it('splits legacy combined source_file "src/auth.ts:validateToken" into path + symbol', () => {
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    const connId = insertConn('src/auth.ts:validateToken', null);

    up022(db);

    const row = db.prepare('SELECT source_file, source_symbol FROM connections WHERE id = ?').get(connId);
    assert.equal(row.source_file, 'src/auth.ts', 'source_file is path-only after split');
    assert.equal(row.source_symbol, 'validateToken', 'source_symbol contains the extracted symbol');
  });

  it('splits legacy combined target_file "src/billing/stripe.ts:createCharge" into path + symbol', () => {
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    const connId = insertConn(null, 'src/billing/stripe.ts:createCharge');

    up022(db);

    const row = db.prepare('SELECT target_file, target_symbol FROM connections WHERE id = ?').get(connId);
    assert.equal(row.target_file, 'src/billing/stripe.ts', 'target_file is path-only after split');
    assert.equal(row.target_symbol, 'createCharge', 'target_symbol contains the extracted symbol');
  });

  it('conservative guard: plain path without colon is unchanged, source_symbol stays NULL', () => {
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    const connId = insertConn('src/auth.ts', null);

    up022(db);

    const row = db.prepare('SELECT source_file, source_symbol FROM connections WHERE id = ?').get(connId);
    assert.equal(row.source_file, 'src/auth.ts', 'source_file unchanged (no colon)');
    assert.equal(row.source_symbol, null, 'source_symbol is NULL for a plain path');
  });

  it('conservative guard: colon with slash after it (path component) is NOT split', () => {
    // "src/http:client/v2.ts" — portion after colon has slash → not a symbol
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    const connId = insertConn('src/http:client/v2.ts', null);

    up022(db);

    const row = db.prepare('SELECT source_file, source_symbol FROM connections WHERE id = ?').get(connId);
    assert.equal(row.source_file, 'src/http:client/v2.ts', 'source_file unchanged when slash appears after colon');
    assert.equal(row.source_symbol, null, 'source_symbol is NULL when slash appears after colon');
  });

  it('conservative guard: no dot before colon (no file extension) is NOT split', () => {
    // "nodotpath:fn" — portion before colon has no dot → not a file extension → skip
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    const connId = insertConn('nodotpath:fn', null);

    up022(db);

    const row = db.prepare('SELECT source_file, source_symbol FROM connections WHERE id = ?').get(connId);
    assert.equal(row.source_file, 'nodotpath:fn', 'source_file unchanged when no dot before colon');
    assert.equal(row.source_symbol, null, 'source_symbol is NULL when no dot before colon');
  });

  it('preserves rows with NULL source_file and target_file (non-destructive)', () => {
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    const connId = insertConn(null, null);

    up022(db);

    const row = db.prepare('SELECT source_file, source_symbol, target_file, target_symbol FROM connections WHERE id = ?').get(connId);
    assert.equal(row.source_file, null, 'source_file stays NULL');
    assert.equal(row.source_symbol, null, 'source_symbol stays NULL');
    assert.equal(row.target_file, null, 'target_file stays NULL');
    assert.equal(row.target_symbol, null, 'target_symbol stays NULL');
  });

  it('idempotent second run matches no rows (already-split values contain no separator colon)', () => {
    const db = freshDbPre022();
    const { insertConn } = seedSetup(db);
    insertConn('src/auth.ts:validateToken', 'src/db/client.ts:query');

    up022(db);
    // Re-run: already-split rows have no colon, so UPDATE matches zero rows
    assert.doesNotThrow(() => up022(db), 'second run does not throw');

    const row = db.prepare('SELECT source_file, source_symbol, target_file, target_symbol FROM connections').get();
    assert.equal(row.source_file, 'src/auth.ts', 'source_file unchanged after second run');
    assert.equal(row.source_symbol, 'validateToken', 'source_symbol unchanged after second run');
    assert.equal(row.target_file, 'src/db/client.ts', 'target_file unchanged after second run');
    assert.equal(row.target_symbol, 'query', 'target_symbol unchanged after second run');
  });

  it('migration source carries NO stale better-sqlite3 wording', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'migrations', '022_connections_source_target_symbol.js'),
      'utf8',
    );
    assert.equal(
      /better-sqlite3/.test(src),
      false,
      'migration 022 must not reference better-sqlite3 (node:sqlite codebase)',
    );
  });
});
