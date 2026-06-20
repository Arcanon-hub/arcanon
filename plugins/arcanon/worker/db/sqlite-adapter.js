/**
 * worker/db/sqlite-adapter.js
 *
 * Single boundary module for node:sqlite. This is the ONLY file that imports
 * from node:sqlite; every other file in the worker changes only its import
 * (swapping "better-sqlite3" → "./sqlite-adapter.js"). Approach locked in
 * Phase 128 CONTEXT decision: one thin adapter, zero call-site changes to
 * the database API shape.
 *
 * Exposes a default-export `Database` class that re-implements the
 * better-sqlite3 surface used by the Arcanon worker:
 *
 *   new Database(path, { readonly, fileMustExist })
 *   db.prepare(sql)  → StatementWrapper
 *   db.exec(sql)
 *   db.pragma(source, { simple })
 *   db.transaction(fn)  → callable (with SAVEPOINT nesting)
 *   db.close()
 *   db.name            → the path string
 *
 *   StatementWrapper methods:
 *   stmt.run(...params)     → { changes, lastInsertRowid }
 *   stmt.get(...params)     → row object (or first-column value when plucked)
 *   stmt.all(...params)     → array of rows (or first-column values)
 *   stmt.iterate(...params) → iterator
 *   stmt.pluck(enabled?)    → this (chainable)
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Statement wrapper
// ---------------------------------------------------------------------------

class StatementWrapper {
  /**
   * @param {import('node:sqlite').StatementSync} stmt
   */
  constructor(stmt) {
    this._stmt = stmt;
    this._pluck = false;
  }

  /**
   * Enable (or disable) pluck mode: subsequent .get()/.all() return only
   * the first column value rather than the full row object.
   * Mirrors better-sqlite3 stmt.pluck() semantics.
   * @param {boolean} [enabled=true]
   * @returns {this}
   */
  pluck(enabled = true) {
    this._pluck = enabled;
    return this;
  }

  /**
   * Execute the statement and return result metadata.
   * @param {...*} params
   * @returns {{ changes: number, lastInsertRowid: number|bigint }}
   */
  run(...params) {
    return this._stmt.run(...params);
  }

  /**
   * Return the first matching row (or undefined if none).
   * When pluck is enabled, returns the first column value of that row.
   * @param {...*} params
   * @returns {*}
   */
  get(...params) {
    const row = this._stmt.get(...params);
    if (row === undefined || row === null) return undefined;
    if (this._pluck) return Object.values(row)[0];
    return row;
  }

  /**
   * Return all matching rows.
   * When pluck is enabled, returns an array of first-column values.
   * @param {...*} params
   * @returns {Array}
   */
  all(...params) {
    const rows = this._stmt.all(...params);
    if (this._pluck) return rows.map((r) => Object.values(r)[0]);
    return rows;
  }

  /**
   * Return an iterator over all matching rows.
   * @param {...*} params
   * @returns {Iterator}
   */
  iterate(...params) {
    // node:sqlite StatementSync has an iterate() method returning a JS Iterator.
    return this._stmt.iterate(...params);
  }
}

// ---------------------------------------------------------------------------
// Database adapter
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for better-sqlite3's Database over node:sqlite
 * DatabaseSync.  Only the API surface the Arcanon worker uses is implemented;
 * unsupported better-sqlite3 features (loadExtension, user-defined functions,
 * aggregate functions) are not present — verify via DEPS-NATIVE-SURFACE.md
 * that none are used.
 */
export default class Database {
  /**
   * @param {string} path - Path to the SQLite database file, or ':memory:'.
   * @param {{ readonly?: boolean, fileMustExist?: boolean }} [options]
   */
  constructor(path, options = {}) {
    const { readonly = false, fileMustExist = false } = options;

    // fileMustExist: throw if the file does not already exist on disk.
    // Mirrors better-sqlite3's fileMustExist option.
    if (fileMustExist && path !== ":memory:" && !existsSync(path)) {
      const err = new Error(`SQLITE_CANTOPEN: unable to open database file: ${path}`);
      err.code = "SQLITE_CANTOPEN";
      throw err;
    }

    // node:sqlite uses camelCase readOnly (better-sqlite3 uses lowercase readonly).
    this._db = new DatabaseSync(path, { readOnly: readonly });
    this._name = path;
    this._txDepth = 0; // nesting counter for SAVEPOINT support
  }

  // ---------------------------------------------------------------------------
  // .name accessor — better-sqlite3 exposes this; node:sqlite DatabaseSync
  // does not.  Used by query-engine.js (this._db.name) and pool.js.
  // ---------------------------------------------------------------------------

  /** @returns {string} */
  get name() {
    return this._name;
  }

  // .open accessor — better-sqlite3 exposes a boolean `.open`; node:sqlite's
  // DatabaseSync exposes a boolean `.isOpen` getter instead (its `.open` is the
  // open() method). Map to it so callers checking handle liveness work unchanged.
  /** @returns {boolean} */
  get open() {
    return this._db.isOpen;
  }

  // ---------------------------------------------------------------------------
  // Core statement methods
  // ---------------------------------------------------------------------------

  /**
   * Prepare a SQL statement and return a StatementWrapper.
   *
   * Two compatibility flags are set on every statement to match better-sqlite3
   * behaviour:
   *   - setAllowUnknownNamedParameters(true): node:sqlite throws ERR_INVALID_STATE
   *     when the parameter object passed to run/get/all contains keys that are not
   *     referenced in the SQL. better-sqlite3 silently ignores extra keys, so the
   *     worker's upsert helpers (which pass full-row objects to narrow-column SQL)
   *     would otherwise fail. Enabling this flag restores the expected behaviour.
   *   - setAllowBareNamedParameters(true): lets callers pass { name: value }
   *     objects for SQL that uses :name or @name parameters without requiring the
   *     caller to prefix the key. The worker uses @name-form SQL exclusively, but
   *     this flag costs nothing and prevents surprises in test utilities that use
   *     :name SQL with bare-key objects.
   *
   * @param {string} sql
   * @returns {StatementWrapper}
   */
  prepare(sql) {
    const stmt = this._db.prepare(sql);
    stmt.setAllowUnknownNamedParameters(true);
    stmt.setAllowBareNamedParameters(true);
    return new StatementWrapper(stmt);
  }

  /**
   * Execute one or more SQL statements (no parameters).
   * @param {string} sql
   */
  exec(sql) {
    this._db.exec(sql);
  }

  /** Close the database connection. */
  close() {
    this._db.close();
  }

  // ---------------------------------------------------------------------------
  // pragma() — node:sqlite has no .pragma() method; implement it here.
  // ---------------------------------------------------------------------------

  /**
   * Read or write a SQLite PRAGMA.
   *
   * Setter form: source contains '=' (e.g. 'journal_mode = WAL')
   *   → runs PRAGMA via exec(); returns undefined.
   *
   * Getter form: source is the pragma name (e.g. 'journal_mode')
   *   → prepares and runs 'PRAGMA <source>'; returns:
   *     - with opts.simple=true : the first column value of the single result row
   *     - otherwise             : array of result row objects (better-sqlite3 default)
   *
   * Security note: pragma() is only ever called with hardcoded string literals
   * from database.js and pool.js; no user input reaches it.
   *
   * @param {string} source  - Pragma name or "name = value" setter expression.
   * @param {{ simple?: boolean }} [opts]
   * @returns {*}
   */
  pragma(source, opts = {}) {
    const trimmed = source.trim();

    if (trimmed.includes("=")) {
      // Setter: run the pragma as a statement (exec does not return rows).
      this._db.exec(`PRAGMA ${trimmed}`);
      return undefined;
    }

    // Getter: read the pragma value.
    const stmt = this._db.prepare(`PRAGMA ${trimmed}`);
    if (opts.simple) {
      const row = stmt.get();
      if (row === undefined || row === null) return undefined;
      return Object.values(row)[0];
    }
    return stmt.all();
  }

  // ---------------------------------------------------------------------------
  // transaction() — node:sqlite has no .transaction() method; implement via
  // BEGIN/COMMIT/ROLLBACK with SAVEPOINT support for nested calls.
  // ---------------------------------------------------------------------------

  /**
   * Wrap a function in a database transaction.
   *
   * Returns a callable that, when invoked with any arguments, runs fn inside a
   * transaction:
   *   - Top-level call: uses BEGIN / COMMIT / ROLLBACK.
   *   - Nested call (inside another transaction from this same Database
   *     instance): uses SAVEPOINT / RELEASE / ROLLBACK TO to avoid SQLite's
   *     "cannot start a transaction within a transaction" error.
   *
   * On any throw, ROLLBACK (or ROLLBACK TO savepoint) fires before rethrowing.
   *
   * @param {Function} fn - Function to run inside the transaction.
   * @returns {Function} A callable that executes fn transactionally.
   */
  transaction(fn) {
    return (...args) => {
      const isNested = this._txDepth > 0;
      const savepointName = isNested ? `sp_${this._txDepth}` : null;

      if (isNested) {
        this._db.exec(`SAVEPOINT ${savepointName}`);
      } else {
        this._db.exec("BEGIN");
      }

      this._txDepth++;
      try {
        const result = fn(...args);
        if (isNested) {
          this._db.exec(`RELEASE ${savepointName}`);
        } else {
          this._db.exec("COMMIT");
        }
        return result;
      } catch (err) {
        try {
          if (isNested) {
            this._db.exec(`ROLLBACK TO ${savepointName}`);
            this._db.exec(`RELEASE ${savepointName}`);
          } else {
            this._db.exec("ROLLBACK");
          }
        } catch {
          // ROLLBACK can fail if the connection is already in an error state;
          // swallow so we rethrow the original error.
        }
        throw err;
      } finally {
        this._txDepth--;
      }
    };
  }
}
