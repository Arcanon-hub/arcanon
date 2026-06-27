/**
 * Tests for #42 protocol canonicalization in the persist + read layer.
 *
 * Covers:
 *   - persistFindings stores the canonical bucket in connections.protocol and
 *     the original token in connections.protocol_raw (kafka -> events, raw kafka;
 *     PostgreSQL -> db, raw PostgreSQL)
 *   - getGraph CONNECTIONS read-time: a directly-inserted raw "kafka" row reads
 *     back with protocol "events" (no re-scan) and exposes protocol_raw
 *   - persistFindings external edge: a "nats" actor edge stores + reads back as
 *     events in actors[].connected_services[]
 *   - getGraph ACTOR read-time (WARNING 1 — #42 headline repro): a directly-
 *     inserted raw "nats" actor_connections row reads back as "events" with no
 *     re-scan
 *
 * Uses a fresh in-memory DB with the FULL real migration chain (runMigrations)
 * applied per test — so migration 019 + actors/actor_connections are present and
 * each test is isolated (no module-level singleton).
 *
 * Run: node --test worker/db/query-engine-protocol.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "./sqlite-adapter.js";

/**
 * Build a fully-migrated in-memory DB + QueryEngine (migrations 001..019).
 * Returns { db, qe, repoId }.
 */
async function freshEngine() {
  const { runMigrations } = await import("./database.js");
  const { QueryEngine } = await import("./query-engine.js");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  const qe = new QueryEngine(db);
  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/test-repo", "test-repo", "single").lastInsertRowid;
  return { db, qe, repoId };
}

describe("#42 protocol canonicalization — persist + read", () => {
  it("migration 019 column protocol_raw is present in the openDb schema", async () => {
    const { db } = await freshEngine();
    const cols = db.prepare("PRAGMA table_info(connections)").all();
    assert.ok(
      cols.some((c) => c.name === "protocol_raw"),
      "connections.protocol_raw exists after openDb migration chain",
    );
    db.close();
  });

  it("persistFindings stores canonical bucket + raw token (kafka -> events)", async () => {
    const { db, qe, repoId } = await freshEngine();
    qe.persistFindings(repoId, {
      services: [
        { name: "producer", root_path: ".", language: "go", type: "service" },
        { name: "consumer", root_path: ".", language: "go", type: "service" },
      ],
      connections: [
        {
          source: "producer",
          target: "consumer",
          protocol: "kafka",
          method: "produce",
          path: "orders.topic",
          source_file: null,
          target_file: null,
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [],
    });

    const row = db
      .prepare("SELECT protocol, protocol_raw FROM connections LIMIT 1")
      .get();
    assert.equal(row.protocol, "events", "canonical bucket stored");
    assert.equal(row.protocol_raw, "kafka", "raw token preserved");
    db.close();
  });

  it("persistFindings preserves original casing in protocol_raw (PostgreSQL -> db)", async () => {
    const { db, qe, repoId } = await freshEngine();
    qe.persistFindings(repoId, {
      services: [
        { name: "api", root_path: ".", language: "ts", type: "service" },
        { name: "store", root_path: ".", language: "ts", type: "service" },
      ],
      connections: [
        {
          source: "api",
          target: "store",
          protocol: "PostgreSQL",
          method: "query",
          path: "users",
          source_file: null,
          target_file: null,
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [],
    });

    const row = db
      .prepare("SELECT protocol, protocol_raw FROM connections LIMIT 1")
      .get();
    assert.equal(row.protocol, "db");
    assert.equal(row.protocol_raw, "PostgreSQL", "raw preserves original casing");
    db.close();
  });

  it("getGraph CONNECTIONS read-time normalizes an already-stored raw kafka row (no re-scan)", async () => {
    const { db, qe, repoId } = await freshEngine();
    // Simulate pre-phase data: insert a raw "kafka" connection directly.
    const a = db
      .prepare("INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)")
      .run(repoId, "svc-a", "a/", "js").lastInsertRowid;
    const b = db
      .prepare("INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)")
      .run(repoId, "svc-b", "b/", "js").lastInsertRowid;
    db.prepare(
      "INSERT INTO connections(source_service_id,target_service_id,protocol,method,path) VALUES(?,?,?,?,?)",
    ).run(a, b, "kafka", "produce", "topic.x");

    const graph = qe.getGraph();
    const conn = graph.connections.find(
      (c) => c.source === "svc-a" && c.target === "svc-b",
    );
    assert.ok(conn, "connection present in graph");
    assert.equal(conn.protocol, "events", "raw kafka row reads back as events");
    assert.ok("protocol_raw" in conn, "protocol_raw field returned");
    db.close();
  });

  it("persistFindings external NATS edge stores protocol=events + protocol_raw=NATS (HIGH-1 E2E)", async () => {
    const { db, qe, repoId } = await freshEngine();
    qe.persistFindings(repoId, {
      services: [
        { name: "api-server", root_path: ".", language: "go", type: "service" },
      ],
      connections: [
        {
          source: "api-server",
          target: "graph-reconciler",
          protocol: "NATS",
          method: "publish",
          path: "events.subject",
          crossing: "external",
          source_file: null,
          target_file: null,
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [],
    });

    // The stored row carries the canonical bucket + the ORIGINAL casing.
    const stored = db
      .prepare(
        "SELECT protocol, protocol_raw FROM actor_connections ac JOIN actors a ON a.id = ac.actor_id WHERE a.name = ?",
      )
      .get("graph-reconciler");
    assert.equal(stored.protocol, "events", "stored actor protocol is the canonical bucket");
    assert.equal(stored.protocol_raw, "NATS", "stored actor protocol_raw preserves original casing");

    const graph = qe.getGraph();
    const actor = graph.actors.find((a) => a.name === "graph-reconciler");
    assert.ok(actor, "actor created for external NATS target");
    assert.ok(actor.connected_services.length >= 1, "actor has a connection");
    assert.equal(
      actor.connected_services[0].protocol,
      "events",
      "actor edge protocol stored + read as events",
    );
    assert.equal(
      actor.connected_services[0].protocol_raw,
      "NATS",
      "getGraph returns the ORIGINAL token NATS on the actor connected_service",
    );
    db.close();
  });

  it("WARNING 1: getGraph ACTOR read normalizes a legacy raw nats actor edge (protocol_raw NULL) and surfaces the raw", async () => {
    const { db, qe, repoId } = await freshEngine();
    // Simulate LEGACY pre-020 data: an actor_connections row stored with raw
    // "nats" in protocol and NO protocol_raw (NULL). Read-time must canonicalize
    // the bucket AND fall back to the stored raw protocol as the displayed raw.
    const svc = db
      .prepare("INSERT INTO services(repo_id,name,root_path,language) VALUES(?,?,?,?)")
      .run(repoId, "api-server", ".", "go").lastInsertRowid;
    const actorId = db
      .prepare(
        "INSERT INTO actors(name,kind,direction,source) VALUES(?,'system','outbound','scan')",
      )
      .run("graph-reconciler").lastInsertRowid;
    // protocol_raw left NULL (column exists post-020 but legacy rows have no value).
    db.prepare(
      "INSERT INTO actor_connections(actor_id,service_id,direction,protocol,path) VALUES(?,?,?,?,?)",
    ).run(actorId, svc, "outbound", "nats", "events.subject");

    const graph = qe.getGraph();
    const actor = graph.actors.find((a) => a.name === "graph-reconciler");
    assert.ok(actor, "actor present in graph");
    assert.equal(
      actor.connected_services[0].protocol,
      "events",
      "stored raw nats actor edge reads back as events without a re-scan",
    );
    // Legacy fallback: protocol_raw is NULL → surface the stored raw protocol.
    assert.ok(
      actor.connected_services[0].protocol_raw,
      "displayed raw token is non-empty for a legacy row",
    );
    assert.equal(
      actor.connected_services[0].protocol_raw,
      "nats",
      "legacy row surfaces the stored raw protocol as the displayed raw token",
    );
    // Other fields preserved
    assert.equal(actor.connected_services[0].path, "events.subject");
    assert.equal(actor.connected_services[0].service_name, "api-server");
    db.close();
  });
});
