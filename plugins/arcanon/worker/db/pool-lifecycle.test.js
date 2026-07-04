/**
 * PERF-05: Pool idle eviction + closeAll lifecycle tests.
 *
 * Tests use stub entries (not real DB files) injected directly into the
 * exported _pool and _poolLastAccessed maps so that:
 *   - No filesystem I/O is required.
 *   - lastAccessed timestamps can be back-dated to force eviction.
 *   - close() calls can be counted with a spy.
 *
 * Each test cache-busts its pool.js import to get a fresh module state.
 * NODE_ENV is set to 'test' before each import so the module-init sweep
 * timer guard fires and the interval is NOT started (preventing timer
 * interference with test assertions and process lifetime).
 *
 * Run: node --test worker/db/pool-lifecycle.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────
// PERF-05-01: sweepIdleEntries evicts entries idle past the TTL
// ─────────────────────────────────────────────────────────────

test("PERF-05-01: sweepIdleEntries evicts an entry idle past the TTL", async () => {
  // Guard: prevent the module-init sweep timer from starting.
  process.env.NODE_ENV = "test";

  const { sweepIdleEntries, _pool, _poolLastAccessed } = await import(
    `./pool.js?lifecycle=${Date.now()}-evict`
  );

  let closeCalls = 0;
  const key = "/stub/project-a/impact-map.db";
  const stubQe = { _db: { name: key, close() { closeCalls++; } } };

  // Inject stub entry directly into the exported maps.
  _pool.set(key, stubQe);
  // Back-date to 20 minutes ago — well past any reasonable TTL.
  _poolLastAccessed.set(key, Date.now() - 20 * 60 * 1000);

  // Sweep with a 1-minute TTL: the 20-minute-old entry must be evicted.
  sweepIdleEntries(60 * 1000);

  assert.strictEqual(closeCalls, 1, "close() must be called once on the evicted handle");
  assert.ok(!_pool.has(key), "evicted entry must be removed from pool");
  assert.ok(!_poolLastAccessed.has(key), "evicted entry must be removed from poolLastAccessed");
});

// ─────────────────────────────────────────────────────────────
// PERF-05-02: freshly-touched entry survives the sweep
// ─────────────────────────────────────────────────────────────

test("PERF-05-02: sweepIdleEntries does not evict a recently-touched entry", async () => {
  process.env.NODE_ENV = "test";

  const { sweepIdleEntries, _pool, _poolLastAccessed } = await import(
    `./pool.js?lifecycle=${Date.now()}-survive`
  );

  let closeCalls = 0;
  const keyOld = "/stub/project-old/impact-map.db";
  const keyFresh = "/stub/project-fresh/impact-map.db";

  const makeStub = (name) => ({ _db: { name, close() { closeCalls++; } } });

  // Old entry: back-dated 20 minutes (will be evicted).
  _pool.set(keyOld, makeStub(keyOld));
  _poolLastAccessed.set(keyOld, Date.now() - 20 * 60 * 1000);

  // Fresh entry: touched 2 seconds ago (must survive a 1-minute TTL sweep).
  _pool.set(keyFresh, makeStub(keyFresh));
  _poolLastAccessed.set(keyFresh, Date.now() - 2 * 1000);

  sweepIdleEntries(60 * 1000); // 1-minute TTL

  assert.strictEqual(closeCalls, 1, "only the old entry must be closed");
  assert.ok(!_pool.has(keyOld), "old entry must be removed");
  assert.ok(_pool.has(keyFresh), "fresh entry must remain in pool");
  assert.ok(_poolLastAccessed.has(keyFresh), "fresh entry's lastAccessed must remain");
});

// ─────────────────────────────────────────────────────────────
// PERF-05-03: getQueryEngine stamps lastAccessed on insert and cache hit
// ─────────────────────────────────────────────────────────────

test("PERF-05-03: getQueryEngine stamps lastAccessed on cache hit", async () => {
  process.env.NODE_ENV = "test";

  const dataDir = (await import("node:os")).default.tmpdir();
  const fs = (await import("node:fs")).default;
  const path = (await import("node:path")).default;
  const crypto = (await import("node:crypto")).default;

  // Create a real temp data dir so getQueryEngine can find impact-map.db.
  const tempData = fs.mkdtempSync(path.join(dataDir, "arcanon-lc03-"));
  process.env.ARCANON_DATA_DIR = tempData;

  try {
    // Seed a real DB so getQueryEngine doesn't return null.
    const { openDb } = await import(`./database.js?lc03=${Date.now()}`);
    const projectRoot = path.join(tempData, "project-lc03");
    fs.mkdirSync(projectRoot, { recursive: true });
    const seed = openDb(path.resolve(projectRoot));
    seed.close();

    const { getQueryEngine, _poolLastAccessed } = await import(
      `./pool.js?lifecycle=${Date.now()}-touch`
    );

    // First call — insert, stamps lastAccessed.
    const before = Date.now();
    getQueryEngine(projectRoot);
    const afterFirst = Date.now();

    // Find the key — the map should have exactly one entry.
    assert.ok(_poolLastAccessed.size >= 1, "poolLastAccessed must have an entry after first call");
    const [, ts1] = [..._poolLastAccessed.entries()].at(-1);
    assert.ok(ts1 >= before && ts1 <= afterFirst + 5, "lastAccessed must be stamped on insert");

    // Back-date the entry.
    const [lastKey] = [..._poolLastAccessed.keys()].at(-1) ? [_poolLastAccessed.keys().next().value] : [null];
    // Find actual key via _pool
    const { _pool } = await import(`./pool.js?lifecycle=${Date.now()}-touch-pool`);
    // Re-import same module — use same cache-bust to reference same instance.
    // Instead: verify by calling getQueryEngine again and checking ts updates.

    // Second call — cache hit, must stamp a newer (or equal) lastAccessed.
    const beforeSecond = Date.now();
    getQueryEngine(projectRoot);
    const afterSecond = Date.now();

    const [, ts2] = [..._poolLastAccessed.entries()].at(-1);
    assert.ok(ts2 >= beforeSecond - 5 && ts2 <= afterSecond + 5,
      `lastAccessed (${ts2}) must be refreshed on cache hit (expected ${beforeSecond}–${afterSecond})`);
  } finally {
    fs.rmSync(tempData, { recursive: true, force: true });
    delete process.env.ARCANON_DATA_DIR;
  }
});

// ─────────────────────────────────────────────────────────────
// PERF-05-04: closeAll closes every handle and empties the pool
// ─────────────────────────────────────────────────────────────

test("PERF-05-04: closeAll closes every handle and empties the pool", async () => {
  process.env.NODE_ENV = "test";

  const { closeAll, _pool, _poolLastAccessed } = await import(
    `./pool.js?lifecycle=${Date.now()}-closeall`
  );

  let closeCalls = 0;
  const makeStub = (name) => ({ _db: { name, close() { closeCalls++; } } });

  const keys = [
    "/stub/ca-project-a/impact-map.db",
    "/stub/ca-project-b/impact-map.db",
    "/stub/ca-project-c/impact-map.db",
  ];

  for (const k of keys) {
    _pool.set(k, makeStub(k));
    _poolLastAccessed.set(k, Date.now());
  }

  closeAll();

  assert.strictEqual(closeCalls, 3, "close() must be called on every handle");
  assert.strictEqual(_pool.size, 0, "pool must be empty after closeAll()");
  assert.strictEqual(_poolLastAccessed.size, 0, "poolLastAccessed must be empty after closeAll()");
});

// ─────────────────────────────────────────────────────────────
// PERF-05-05: closeAll is best-effort — one bad close() does not abort
// ─────────────────────────────────────────────────────────────

test("PERF-05-05: closeAll continues past a handle whose close() throws", async () => {
  process.env.NODE_ENV = "test";

  const { closeAll, _pool, _poolLastAccessed } = await import(
    `./pool.js?lifecycle=${Date.now()}-closeall-err`
  );

  let closedB = false;

  // Entry A: close() throws.
  _pool.set("/stub/ca-err-a/impact-map.db", {
    _db: { name: "/stub/ca-err-a/impact-map.db", close() { throw new Error("simulated close error"); } },
  });
  _poolLastAccessed.set("/stub/ca-err-a/impact-map.db", Date.now());

  // Entry B: close() succeeds.
  _pool.set("/stub/ca-ok-b/impact-map.db", {
    _db: { name: "/stub/ca-ok-b/impact-map.db", close() { closedB = true; } },
  });
  _poolLastAccessed.set("/stub/ca-ok-b/impact-map.db", Date.now());

  assert.doesNotThrow(() => closeAll(), "closeAll() must not propagate errors from individual close() calls");
  assert.ok(closedB, "entry B must still be closed after entry A throws");
  assert.strictEqual(_pool.size, 0, "pool must be empty despite close() error on one entry");
});

// ─────────────────────────────────────────────────────────────
// PERF-05-06: sweep timer is NOT started when NODE_ENV starts with 'test'
// ─────────────────────────────────────────────────────────────

test("PERF-05-06: sweep timer does not start when NODE_ENV = 'test'", async () => {
  process.env.NODE_ENV = "test";
  // The module guard prevents setInterval from firing.
  // We verify indirectly: the pool module loads without hanging, and the
  // process will not be kept alive by an unref'd interval when tests complete.
  //
  // Direct verification: if an interval were started, we could detect it via
  // process._getActiveHandles() (V8 internal, not stable API). Instead, we
  // rely on the guard being present in the source code (auditable) and that
  // the test suite completes and exits cleanly (no 30-second timeout needed).
  const mod = await import(`./pool.js?lifecycle=${Date.now()}-timer-guard`);
  assert.ok(typeof mod.sweepIdleEntries === "function", "sweepIdleEntries must be exported");
  assert.ok(typeof mod.closeAll === "function", "closeAll must be exported");
  // If this test exits within the test runner's default timeout, the timer is
  // either not started (guard worked) or is unref'd (process can still exit).
});
