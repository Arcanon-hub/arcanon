/**
 * query-engine-batch.test.js — PERF-02 query-count spy tests (143-04)
 *
 * Proves that after the batch fix:
 *   - detectMismatches issues exactly ONE exposed_endpoints .all() execution
 *     for a fixture where multiple connections share the same target service,
 *     and ZERO .all() executions when there are no REST/gRPC candidates.
 *   - The mismatch output for a known fixture is identical to the expected set.
 *   - getGraph's actor block issues exactly ONE actor_connections .all()
 *     execution for a multi-actor fixture (batch load, not per-actor N+1).
 *   - The connected_services output shape (protocol + protocol_raw
 *     normalization) is unchanged from the pre-batch implementation.
 *
 * Spy design: SpyDatabase subclasses Database and wraps prepare() to shadow
 * .all() on targeted statements, counting executions without touching any
 * other call path.  Only statements whose SQL matches one of two predicates
 * are wrapped:
 *   exposed_ep:    FROM exposed_endpoints (NOT embedded in a FROM connections query)
 *   actor_conn:    actor_connections + JOIN services
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine-batch.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "./sqlite-adapter.js";
import { runMigrations } from "./database.js";
import { QueryEngine } from "./query-engine.js";

// ---------------------------------------------------------------------------
// SpyDatabase — counts .all() executions on targeted SQL patterns
// ---------------------------------------------------------------------------

class SpyDatabase extends Database {
  constructor(...args) {
    super(...args);
    this._exposedEpAllCount = 0;  // executions of direct exposed_endpoints SELECTs
    this._actorConnAllCount = 0;  // executions of actor_connections JOIN services SELECTs
  }

  resetCounts() {
    this._exposedEpAllCount = 0;
    this._actorConnAllCount = 0;
  }

  prepare(sql) {
    const stmt = super.prepare(sql);

    // A "direct" exposed_endpoints query is one whose primary FROM clause is
    // exposed_endpoints — NOT the EXISTS subquery embedded inside the candidate
    // rows query (which has `FROM connections c JOIN services ...`).
    // The filter `!sql.includes('FROM connections')` excludes the latter.
    const isDirectExposedEp =
      sql.includes("FROM exposed_endpoints") &&
      !sql.includes("FROM connections");

    // The actor batch query joins actor_connections to services without a
    // per-actor WHERE clause; per-actor queries share the same pattern so the
    // spy counts ALL executions — 1 for the new batch, N for the old N+1.
    const isActorConnJoin =
      sql.includes("actor_connections") && sql.includes("JOIN services");

    if (isDirectExposedEp || isActorConnJoin) {
      const origAll = stmt.all.bind(stmt);
      const self = this;
      stmt.all = function (...args) {
        if (isDirectExposedEp) self._exposedEpAllCount++;
        if (isActorConnJoin) self._actorConnAllCount++;
        return origAll(...args);
      };
    }

    return stmt;
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function freshDb() {
  const db = new SpyDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  const repoId = db
    .prepare(
      "INSERT INTO repos (path, name, type) VALUES ('/r', 'r', 'single')"
    )
    .run().lastInsertRowid;
  return { db, repoId };
}

function insertService(db, repoId, name, basePath = null) {
  return db
    .prepare(
      `INSERT INTO services (repo_id, name, root_path, language, type, base_path)
       VALUES (?, ?, '/', 'js', 'service', ?)`
    )
    .run(repoId, name, basePath).lastInsertRowid;
}

function insertExposedEndpoint(db, serviceId, method, pathStr) {
  return db
    .prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path) VALUES (?, ?, ?)"
    )
    .run(serviceId, method, pathStr).lastInsertRowid;
}

function insertRestConnection(db, sourceId, targetId, method, pathStr) {
  return db
    .prepare(
      `INSERT INTO connections
         (source_service_id, target_service_id, protocol, method, path)
       VALUES (?, ?, 'rest', ?, ?)`
    )
    .run(sourceId, targetId, method, pathStr).lastInsertRowid;
}

function insertActor(db, name, kind = "external") {
  return db
    .prepare(
      `INSERT OR REPLACE INTO actors (name, kind, direction, source)
       VALUES (?, ?, 'outbound', 'agent')`
    )
    .run(name, kind).lastInsertRowid;
}

function insertActorConnection(
  db,
  actorId,
  serviceId,
  protocol,
  protocolRaw = null,
  pathStr = null
) {
  return db
    .prepare(
      `INSERT OR REPLACE INTO actor_connections
         (actor_id, service_id, direction, protocol, protocol_raw, path)
       VALUES (?, ?, 'outbound', ?, ?, ?)`
    )
    .run(actorId, serviceId, protocol, protocolRaw, pathStr).lastInsertRowid;
}

// ---------------------------------------------------------------------------
// Task 1: detectMismatches batching — spy-count proofs
// ---------------------------------------------------------------------------

describe("PERF-02: detectMismatches batches exposed_endpoints load (143-04)", () => {
  it("issues exactly ONE exposed_endpoints .all() for many connections to one target", () => {
    const { db, repoId } = freshDb();

    const srcId = insertService(db, repoId, "svc-caller");
    const tgtId = insertService(db, repoId, "svc-api");

    // Target exposes GET /users/{id} only
    insertExposedEndpoint(db, tgtId, "GET", "/users/{id}");

    // Three connections all pointing to the SAME target → 1 unique target
    insertRestConnection(db, srcId, tgtId, "GET", "/users/{_}");    // matches → no mismatch
    insertRestConnection(db, srcId, tgtId, "POST", "/users/{_}");   // mismatch
    insertRestConnection(db, srcId, tgtId, "DELETE", "/users/{_}"); // mismatch

    const qe = new QueryEngine(db);
    db.resetCounts();
    const mismatches = qe.detectMismatches();

    assert.strictEqual(
      db._exposedEpAllCount,
      1,
      `Expected exactly 1 exposed_endpoints .all() execution but got ${db._exposedEpAllCount} (N+1 not fixed)`
    );
    assert.strictEqual(
      mismatches.length,
      2,
      "Expected 2 mismatches (POST and DELETE are not exposed)"
    );
  });

  it("issues ZERO exposed_endpoints queries when no REST/gRPC candidates exist", () => {
    const { db, repoId } = freshDb();

    const srcId = insertService(db, repoId, "svc-a");
    const tgtId = insertService(db, repoId, "svc-b");

    // Internal connection — excluded by protocol IN ('rest','grpc') filter
    db.prepare(
      `INSERT INTO connections
         (source_service_id, target_service_id, protocol, method, path)
       VALUES (?, ?, 'internal', null, null)`
    ).run(srcId, tgtId);

    const qe = new QueryEngine(db);
    db.resetCounts();
    const mismatches = qe.detectMismatches();

    assert.strictEqual(
      db._exposedEpAllCount,
      0,
      "Expected zero exposed_endpoints queries when no REST/gRPC candidates"
    );
    assert.deepEqual(mismatches, []);
  });

  it("mismatch output is identical to expected for a known fixture (equivalence)", () => {
    const { db, repoId } = freshDb();

    const srcId = insertService(db, repoId, "frontend");
    const tgtId = insertService(db, repoId, "backend");

    // backend exposes GET /items and POST /items
    insertExposedEndpoint(db, tgtId, "GET", "/items");
    insertExposedEndpoint(db, tgtId, "POST", "/items");

    // frontend calls GET /items (match → no mismatch) and DELETE /items (not exposed → mismatch)
    insertRestConnection(db, srcId, tgtId, "GET", "/items");
    insertRestConnection(db, srcId, tgtId, "DELETE", "/items");

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();

    assert.strictEqual(mismatches.length, 1, "Expected exactly 1 mismatch");
    const [m] = mismatches;
    assert.strictEqual(m.type, "endpoint_not_exposed");
    assert.strictEqual(m.source, "frontend");
    assert.strictEqual(m.target, "backend");
    assert.ok(
      m.detail.includes("DELETE"),
      `Mismatch detail should mention DELETE method: ${m.detail}`
    );
    assert.ok(typeof m.connection_id === "number", "connection_id should be a number");
  });

  it("handles multiple distinct targets correctly (K unique targets → 1 query covering all K)", () => {
    const { db, repoId } = freshDb();

    const srcId = insertService(db, repoId, "caller");
    const tgt1Id = insertService(db, repoId, "svc-alpha");
    const tgt2Id = insertService(db, repoId, "svc-beta");

    insertExposedEndpoint(db, tgt1Id, "GET", "/alpha");
    insertExposedEndpoint(db, tgt2Id, "GET", "/beta");

    // 2 connections to tgt1, 2 to tgt2 → 2 unique targets, still 1 batch query
    insertRestConnection(db, srcId, tgt1Id, "GET", "/alpha");
    insertRestConnection(db, srcId, tgt1Id, "DELETE", "/alpha"); // mismatch on tgt1
    insertRestConnection(db, srcId, tgt2Id, "GET", "/beta");
    insertRestConnection(db, srcId, tgt2Id, "PATCH", "/beta");   // mismatch on tgt2

    const qe = new QueryEngine(db);
    db.resetCounts();
    const mismatches = qe.detectMismatches();

    assert.strictEqual(
      db._exposedEpAllCount,
      1,
      `Expected 1 batch query for 2 unique targets, got ${db._exposedEpAllCount}`
    );
    assert.strictEqual(mismatches.length, 2, "Expected 2 mismatches (one per target)");
  });
});

// ---------------------------------------------------------------------------
// Task 2: actor-connection batch load — spy-count proofs
// ---------------------------------------------------------------------------

describe("PERF-02: getGraph batches actor_connections load (143-04)", () => {
  it("issues exactly ONE actor_connections .all() for a multi-actor fixture", () => {
    const { db, repoId } = freshDb();

    const svcId = insertService(db, repoId, "api");
    const stripeId = insertActor(db, "stripe");
    const sgId = insertActor(db, "sendgrid");

    insertActorConnection(db, stripeId, svcId, "rest", "HTTPS", "/charge");
    insertActorConnection(db, sgId, svcId, "rest", "HTTPS", "/send");

    const qe = new QueryEngine(db);
    db.resetCounts();
    const graph = qe.getGraph();

    assert.strictEqual(
      db._actorConnAllCount,
      1,
      `Expected exactly 1 actor_connections .all() execution but got ${db._actorConnAllCount} (N+1 not fixed)`
    );
    assert.ok(Array.isArray(graph.actors), "graph.actors should be an array");
    assert.strictEqual(graph.actors.length, 2, "Expected 2 actors");
    for (const actor of graph.actors) {
      assert.ok(
        Array.isArray(actor.connected_services),
        "each actor should have connected_services array"
      );
      assert.strictEqual(
        actor.connected_services.length,
        1,
        `Actor ${actor.name} should have 1 connected_service`
      );
    }
  });

  it("connected_services output shape is correct: protocol canonicalized, protocol_raw preserved", () => {
    const { db, repoId } = freshDb();

    const svcId = insertService(db, repoId, "api");
    const kafkaId = insertActor(db, "kafka-bus");

    // Store canonical protocol 'events' with raw token 'NATS' — mirrors production
    insertActorConnection(db, kafkaId, svcId, "events", "NATS", "/topic/orders");

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    const actor = graph.actors.find((a) => a.name === "kafka-bus");
    assert.ok(actor, "kafka-bus actor should be present in graph.actors");
    assert.strictEqual(actor.connected_services.length, 1);
    const cs = actor.connected_services[0];

    // protocol → canonicalProtocol('events') = 'events' (unchanged)
    assert.strictEqual(cs.protocol, "events");
    // protocol_raw → displayedRaw = 'NATS' (from stored protocol_raw column)
    assert.strictEqual(cs.protocol_raw, "NATS");
    assert.strictEqual(cs.service_name, "api");
    assert.ok(typeof cs.service_id === "number", "service_id should be a number");
  });

  it("actor with no connections returns empty connected_services array", () => {
    const { db, repoId } = freshDb();

    insertService(db, repoId, "api");
    insertActor(db, "lonely-actor");
    // No actor_connections inserted

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    const actor = graph.actors.find((a) => a.name === "lonely-actor");
    assert.ok(actor, "lonely-actor should appear in graph.actors");
    assert.deepEqual(
      actor.connected_services,
      [],
      "actor with no connections should have empty connected_services"
    );
  });
});
