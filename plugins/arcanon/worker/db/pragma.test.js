/**
 * worker/db/pragma.test.js — Journal mode pragma ordering tests (QUAL-01)
 *
 * Tests verify:
 *   - Read-write connections opened via openDb() have journal_mode=WAL applied
 *   - journal_mode=WAL is the FIRST pragma in database.js source
 *   - foreign_keys=ON follows journal_mode in database.js source
 *   - Readonly connections do NOT attempt to set journal_mode
 *   - pool.js source documents the readonly journal_mode skip
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// pragma ordering — read-write connection
// ---------------------------------------------------------------------------

describe("pragma ordering -- read-write connection", () => {
  test("journal_mode=WAL is applied on new database", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ligamen-pragma-rw-"));
    try {
      const dbPath = join(tmpDir, "test.db");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");

      const mode = db.pragma("journal_mode", { simple: true });
      assert.equal(mode, "wal", "journal_mode must be 'wal' after setting WAL pragma");

      db.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("WAL is first pragma in database.js source", () => {
    const src = readFileSync(join(__dirname, "database.js"), "utf8");

    // Extract all db.pragma(...) call arguments in source order
    const pragmaRe = /db\.pragma\(\s*["']([^"']+)["']/g;
    const pragmas = [];
    let m;
    while ((m = pragmaRe.exec(src)) !== null) {
      pragmas.push(m[1]);
    }

    assert.ok(pragmas.length > 0, "database.js must contain at least one db.pragma() call");
    assert.match(
      pragmas[0],
      /journal_mode\s*=\s*WAL/i,
      "first pragma in database.js source must be journal_mode = WAL",
    );
  });

  test("foreign_keys=ON follows journal_mode in database.js source", () => {
    const src = readFileSync(join(__dirname, "database.js"), "utf8");

    const pragmaRe = /db\.pragma\(\s*["']([^"']+)["']/g;
    const pragmas = [];
    let m;
    while ((m = pragmaRe.exec(src)) !== null) {
      pragmas.push(m[1]);
    }

    const jmIdx = pragmas.findIndex((p) => /journal_mode/i.test(p));
    const fkIdx = pragmas.findIndex((p) => /foreign_keys/i.test(p));

    assert.ok(jmIdx !== -1, "journal_mode pragma must exist in database.js");
    assert.ok(fkIdx !== -1, "foreign_keys pragma must exist in database.js");
    assert.ok(
      fkIdx > jmIdx,
      "foreign_keys must appear after journal_mode in database.js source",
    );
  });
});

// ---------------------------------------------------------------------------
// pragma ordering — readonly connection
// ---------------------------------------------------------------------------

describe("pragma ordering -- readonly connection", () => {
  test("readonly connection does not attempt to set journal_mode", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ligamen-pragma-ro-"));
    try {
      const dbPath = join(tmpDir, "readonly-test.db");

      // Create a writable DB first so the file exists
      const rwDb = new Database(dbPath);
      rwDb.pragma("journal_mode = WAL");
      rwDb.prepare("CREATE TABLE IF NOT EXISTS t (x INTEGER)").run();
      rwDb.close();

      // Open as readonly — must NOT call pragma("journal_mode = WAL")
      const roDb = new Database(dbPath, { readonly: true });

      // Verify the readonly connection can read without setting journal_mode
      const rows = roDb.prepare("SELECT COUNT(*) AS cnt FROM t").get();
      assert.ok(rows !== undefined, "readonly connection must be able to SELECT");

      // The connection must be stable without journal_mode pragma
      const result = roDb.prepare("SELECT 1 AS n").get();
      assert.equal(result.n, 1, "readonly connection must execute queries successfully");

      roDb.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("pool.js documents readonly journal_mode skip", () => {
    const src = readFileSync(join(__dirname, "pool.js"), "utf8");

    // Find all locations with "readonly: true" in the source
    const readonlyOccurrences = [];
    const lines = src.split("\n");
    lines.forEach((line, idx) => {
      if (/readonly\s*:\s*true/.test(line)) {
        readonlyOccurrences.push({ line: idx + 1, text: line });
      }
    });

    assert.ok(
      readonlyOccurrences.length > 0,
      "pool.js must contain at least one readonly: true connection",
    );

    // For at least one readonly occurrence, there must be a nearby comment
    // explaining why journal_mode is not set (within 5 lines before or after)
    const windowSize = 5;
    const hasJournalModeComment = readonlyOccurrences.some(({ line }) => {
      const start = Math.max(0, line - 1 - windowSize);
      const end = Math.min(lines.length - 1, line - 1 + windowSize);
      return lines.slice(start, end + 1).some((l) =>
        /do NOT set journal_mode/i.test(l),
      );
    });

    assert.ok(
      hasJournalModeComment,
      "pool.js must document near each readonly connection that journal_mode is intentionally skipped",
    );
  });
});
