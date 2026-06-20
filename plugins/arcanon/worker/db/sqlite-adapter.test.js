/**
 * worker/db/sqlite-adapter.test.js
 *
 * Parity + held-out property tests for the node:sqlite adapter.
 * Covers every behaviour item required by Plan 128-01:
 *
 *   - prepare / run / get / all / exec basics
 *   - pragma setter + getter (journal_mode=WAL → 'wal', foreign_keys=ON → 1)
 *   - transaction commit (N rows survive)
 *   - transaction rollback (insert-then-throw leaves ZERO rows) [held-out property]
 *   - transaction nesting via SAVEPOINT (inner throw rolls back only inner work)
 *   - pluck round-trip property (randomised integer array, order preserved)
 *   - readonly: SELECT succeeds, INSERT throws
 *   - FTS5 MATCH: virtual table created + MATCH returns matching rows
 *   - db.name equals the path passed to the constructor
 *
 * Style mirrors pragma.test.js: node:test + node:assert/strict, tmpdir + rmSync
 * cleanup in every on-disk test.  Zero external dependencies.
 *
 * Run: node --test worker/db/sqlite-adapter.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "./sqlite-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a throwaway temp directory and return its path. */
function makeTmp() {
  return mkdtempSync(join(tmpdir(), "arcanon-adapter-"));
}

/** Deterministic-ish pseudo-random integers for property checks (no deps). */
function randomInts(seed, count) {
  const results = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    results.push(Math.abs(s) % 100000);
  }
  return results;
}

// ---------------------------------------------------------------------------
// prepare / run / get / all / exec basics
// ---------------------------------------------------------------------------

describe("basics — prepare/run/get/all/exec", () => {
  test("exec creates a table and prepare/run inserts rows", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, val TEXT)");
      const ins = db.prepare("INSERT INTO things (val) VALUES (?)");
      const r1 = ins.run("hello");
      assert.ok(r1.changes >= 0, "run() returns { changes }");
      assert.ok("lastInsertRowid" in r1, "run() returns { lastInsertRowid }");

      const row = db.prepare("SELECT val FROM things WHERE id = ?").get(r1.lastInsertRowid);
      assert.equal(row.val, "hello", "get() returns the inserted row");

      ins.run("world");
      const all = db.prepare("SELECT val FROM things ORDER BY id").all();
      assert.equal(all.length, 2, "all() returns all rows");
      assert.equal(all[0].val, "hello");
      assert.equal(all[1].val, "world");
    } finally {
      db.close();
    }
  });

  test("get() returns undefined when no row matches", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE empty (x INTEGER)");
      const row = db.prepare("SELECT x FROM empty").get();
      assert.equal(row, undefined, "get() on empty table returns undefined");
    } finally {
      db.close();
    }
  });

  test("run() returns correct changes count for UPDATE", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE nums (n INTEGER)");
      db.prepare("INSERT INTO nums VALUES (?)").run(1);
      db.prepare("INSERT INTO nums VALUES (?)").run(2);
      const r = db.prepare("UPDATE nums SET n = n + 10").run();
      assert.equal(r.changes, 2, "UPDATE changes must equal affected rows");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// pragma setter + getter
// ---------------------------------------------------------------------------

describe("pragma setter + getter", () => {
  test("journal_mode=WAL setter + getter (simple:true) returns 'wal'", () => {
    const tmp = makeTmp();
    try {
      const db = new Database(join(tmp, "p.db"));
      db.pragma("journal_mode = WAL");
      const mode = db.pragma("journal_mode", { simple: true });
      assert.equal(mode, "wal", "pragma getter {simple:true} must return string 'wal'");
      db.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("foreign_keys=ON setter + getter (simple:true) returns integer 1", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      const fk = db.pragma("foreign_keys", { simple: true });
      assert.equal(fk, 1, "foreign_keys getter {simple:true} must return integer 1");
    } finally {
      db.close();
    }
  });

  test("pragma getter without simple returns array of row objects", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      const rows = db.pragma("foreign_keys");
      assert.ok(Array.isArray(rows), "pragma getter without simple returns an array");
      assert.ok(rows.length > 0, "array must have at least one row");
      assert.equal(typeof rows[0], "object", "each element is a row object");
    } finally {
      db.close();
    }
  });

  test("busy_timeout, cache_size, synchronous setters do not throw", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("busy_timeout = 5000");
      db.pragma("cache_size = -64000");
      db.pragma("synchronous = NORMAL");
      // If we get here, all three setters ran without error.
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// transaction — commit
// ---------------------------------------------------------------------------

describe("transaction — commit", () => {
  test("transaction that completes inserts all rows", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE items (v INTEGER)");
      const N = 5;
      const ins = db.prepare("INSERT INTO items VALUES (?)");
      const tx = db.transaction(() => {
        for (let i = 0; i < N; i++) ins.run(i);
      });
      tx();
      const count = db.prepare("SELECT COUNT(*) AS c FROM items").get().c;
      assert.equal(count, N, "all N rows survive after a committed transaction");
    } finally {
      db.close();
    }
  });

  test("transaction passes arguments through and returns fn result", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE vals (v INTEGER)");
      const ins = db.prepare("INSERT INTO vals VALUES (?)");
      const tx = db.transaction((a, b) => {
        ins.run(a);
        ins.run(b);
        return a + b;
      });
      const result = tx(3, 4);
      assert.equal(result, 7, "transaction returns the function's return value");
      const count = db.prepare("SELECT COUNT(*) AS c FROM vals").get().c;
      assert.equal(count, 2);
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// transaction — rollback (held-out property check)
// ---------------------------------------------------------------------------

describe("transaction — rollback [held-out property]", () => {
  test("insert-then-throw leaves exactly zero rows and rethrows the error", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE data (v INTEGER)");
      const ins = db.prepare("INSERT INTO data VALUES (?)");
      const sentinel = new Error("deliberate-rollback-sentinel");

      const tx = db.transaction((values) => {
        for (const v of values) ins.run(v);
        throw sentinel;
      });

      // Use a randomised set so this is a property check, not a single example.
      const vals = randomInts(0xdeadbeef, 7);
      let thrown;
      try {
        tx(vals);
      } catch (e) {
        thrown = e;
      }

      assert.equal(thrown, sentinel, "original error must propagate out of transaction()");
      const count = db.prepare("SELECT COUNT(*) AS c FROM data").get().c;
      assert.equal(count, 0, "ROLLBACK must leave exactly zero rows after a throwing transaction");
    } finally {
      db.close();
    }
  });

  test("rollback after partial inserts leaves no partial state", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE partial (v INTEGER)");
      const ins = db.prepare("INSERT INTO partial VALUES (?)");

      // Insert 3 rows then throw — all 3 must be rolled back.
      const tx = db.transaction(() => {
        ins.run(10);
        ins.run(20);
        ins.run(30);
        throw new Error("abort");
      });

      try { tx(); } catch { /* expected */ }

      const rows = db.prepare("SELECT v FROM partial ORDER BY v").all();
      assert.deepEqual(rows, [], "no partial rows must survive a rolled-back transaction");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// transaction — SAVEPOINT nesting
// ---------------------------------------------------------------------------

describe("transaction — SAVEPOINT nesting", () => {
  test("nested transaction that throws rolls back inner work only", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE nested (v INTEGER)");
      const ins = db.prepare("INSERT INTO nested VALUES (?)");

      const inner = db.transaction(() => {
        ins.run(999);
        throw new Error("inner-abort");
      });

      const outer = db.transaction(() => {
        ins.run(1);
        // inner throws — should only roll back savepoint, not the whole outer tx
        try { inner(); } catch { /* expected */ }
        ins.run(2);
      });

      outer();

      const rows = db.prepare("SELECT v FROM nested ORDER BY v").all().map((r) => r.v);
      assert.deepEqual(rows, [1, 2], "outer rows survive; inner row rolled back via SAVEPOINT");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// pluck round-trip (held-out property check)
// ---------------------------------------------------------------------------

describe("pluck round-trip [held-out property]", () => {
  test("pluck().all() round-trips a randomised integer array in insert order", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE nums (x INTEGER)");
      const ins = db.prepare("INSERT INTO nums VALUES (?)");

      // Randomised input — different length and values each conceptual run
      const input = randomInts(0xcafebabe, 13);
      for (const n of input) ins.run(n);

      // pluck().all() must return the same values as .all().map(r => r.x)
      const viaPluck = db.prepare("SELECT x FROM nums ORDER BY rowid").pluck().all();
      const viaMap = db.prepare("SELECT x FROM nums ORDER BY rowid").all().map((r) => r.x);

      assert.deepEqual(viaPluck, input, "pluck().all() must reproduce the original array");
      assert.deepEqual(viaPluck, viaMap, "pluck().all() must equal .all().map(r=>r.x)");
    } finally {
      db.close();
    }
  });

  test("pluck().get() returns first column value of the first row", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE single (n INTEGER)");
      db.prepare("INSERT INTO single VALUES (?)").run(42);
      const val = db.prepare("SELECT n FROM single").pluck().get();
      assert.equal(val, 42, "pluck().get() returns the scalar value, not a row object");
    } finally {
      db.close();
    }
  });

  test("pluck().get() returns undefined when no row matches", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE emp (n INTEGER)");
      const val = db.prepare("SELECT n FROM emp").pluck().get();
      assert.equal(val, undefined, "pluck().get() on empty table returns undefined");
    } finally {
      db.close();
    }
  });

  test("pluck is chainable and can be disabled (enabled=false)", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE chain (a INTEGER, b TEXT)");
      db.prepare("INSERT INTO chain VALUES (?, ?)").run(7, "x");

      const stmt = db.prepare("SELECT a, b FROM chain");
      stmt.pluck(true);
      const plucked = stmt.get();
      assert.equal(plucked, 7, "pluck enabled: first column value returned");

      stmt.pluck(false);
      const full = stmt.get();
      assert.equal(typeof full, "object", "pluck disabled: full row object returned");
      assert.equal(full.a, 7);
      assert.equal(full.b, "x");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// readonly
// ---------------------------------------------------------------------------

describe("readonly connections", () => {
  test("{ readonly: true } allows SELECT but rejects INSERT", () => {
    const tmp = makeTmp();
    try {
      const dbPath = join(tmp, "ro.db");

      // Seed database with a table
      const rw = new Database(dbPath);
      rw.exec("CREATE TABLE t (v INTEGER)");
      rw.prepare("INSERT INTO t VALUES (?)").run(1);
      rw.close();

      const ro = new Database(dbPath, { readonly: true });
      try {
        const row = ro.prepare("SELECT v FROM t").get();
        assert.equal(row.v, 1, "readonly SELECT must work");

        assert.throws(
          () => ro.prepare("INSERT INTO t VALUES (?)").run(2),
          (e) => e instanceof Error,
          "INSERT on readonly connection must throw",
        );
      } finally {
        ro.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("{ fileMustExist: true } throws when the file does not exist", () => {
    const tmp = makeTmp();
    try {
      assert.throws(
        () => new Database(join(tmp, "nonexistent.db"), { fileMustExist: true }),
        (e) => e instanceof Error && e.message.includes("SQLITE_CANTOPEN"),
        "fileMustExist on missing file must throw SQLITE_CANTOPEN",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("{ fileMustExist: true } succeeds when the file exists", () => {
    const tmp = makeTmp();
    try {
      const dbPath = join(tmp, "existing.db");
      const rw = new Database(dbPath);
      rw.exec("CREATE TABLE x (n INTEGER)");
      rw.close();

      const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
      const row = ro.prepare("SELECT COUNT(*) AS c FROM x").get();
      assert.equal(row.c, 0, "fileMustExist on existing file opens successfully");
      ro.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// db.name
// ---------------------------------------------------------------------------

describe("db.name", () => {
  test("name equals :memory: for in-memory databases", () => {
    const db = new Database(":memory:");
    try {
      assert.equal(db.name, ":memory:");
    } finally {
      db.close();
    }
  });

  test("name equals the on-disk path passed to the constructor", () => {
    const tmp = makeTmp();
    try {
      const dbPath = join(tmp, "named.db");
      const db = new Database(dbPath);
      try {
        assert.equal(db.name, dbPath, "db.name must equal the constructor path argument");
      } finally {
        db.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("name is preserved on readonly connection", () => {
    const tmp = makeTmp();
    try {
      const dbPath = join(tmp, "named-ro.db");
      const rw = new Database(dbPath);
      rw.exec("CREATE TABLE x (n INTEGER)");
      rw.close();

      const ro = new Database(dbPath, { readonly: true });
      try {
        assert.equal(ro.name, dbPath, "db.name preserved on readonly connection");
      } finally {
        ro.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FTS5 MATCH
// ---------------------------------------------------------------------------

describe("FTS5 MATCH", () => {
  test("CREATE VIRTUAL TABLE USING fts5 + MATCH returns matching rows", () => {
    const tmp = makeTmp();
    try {
      const db = new Database(join(tmp, "fts5.db"));
      try {
        db.exec(`
          CREATE VIRTUAL TABLE docs USING fts5(title, body)
        `);

        const ins = db.prepare("INSERT INTO docs (title, body) VALUES (?, ?)");
        ins.run("Hello World", "The quick brown fox");
        ins.run("SQLite FTS5", "Full text search with node sqlite");
        ins.run("Unrelated", "Something completely different");

        const rows = db.prepare("SELECT title FROM docs WHERE docs MATCH ?").all("sqlite");
        assert.equal(rows.length, 1, "FTS5 MATCH must return exactly the matching row");
        assert.equal(rows[0].title, "SQLite FTS5", "Matched row must be 'SQLite FTS5'");
      } finally {
        db.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("FTS5 MATCH with multiple terms returns rows containing any term", () => {
    const tmp = makeTmp();
    try {
      const db = new Database(join(tmp, "fts5-multi.db"));
      try {
        db.exec("CREATE VIRTUAL TABLE notes USING fts5(content)");

        const ins = db.prepare("INSERT INTO notes (content) VALUES (?)");
        ins.run("arcanon impact map analysis");
        ins.run("code review findings");
        ins.run("unrelated document");

        // Match documents containing "arcanon" OR "review"
        const rows = db.prepare(
          "SELECT content FROM notes WHERE notes MATCH ? ORDER BY rank",
        ).all("arcanon OR review");

        assert.ok(rows.length >= 2, "FTS5 OR match should return at least 2 rows");
        const contents = rows.map((r) => r.content);
        assert.ok(contents.includes("arcanon impact map analysis"), "first doc matched");
        assert.ok(contents.includes("code review findings"), "second doc matched");
      } finally {
        db.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
