/**
 * worker/db/query-engine-actors-label.test.js —  / .
 *
 * Verifies that getGraph() returns the new actors[].label field after
 * migration 018, and falls back gracefully (label: null per row) on a
 * pre-migration-018 DB.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import Database from './sqlite-adapter.js';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up002 } from './migrations/002_service_type.js';
import { up as up003 } from './migrations/003_exposed_endpoints.js';
import { up as up004 } from './migrations/004_dedup_constraints.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up006 } from './migrations/006_dedup_repos.js';
import { up as up007 } from './migrations/007_expose_kind.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { up as up018 } from './migrations/018_actors_label.js';
import { QueryEngine } from './query-engine.js';

function applyCore(db) {
  up001(db);
  up002(db);
  up003(db);
  up004(db);
  up005(db);
  up006(db);
  up007(db);
  up008(db);
  up009(db);
}

function dbWith018() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyCore(db);
  up018(db);
  return db;
}

function dbPre018() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyCore(db);
  return db;
}

function seedRepoServiceActor(db, actorName, label = null) {
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const svcId = db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, 'svc', '.', 'typescript')",
    )
    .run(repoId).lastInsertRowid;

  if (label !== null) {
    db.prepare(
      "INSERT INTO actors (name, kind, direction, source, label) VALUES (?, 'system', 'outbound', 'scan', ?)",
    ).run(actorName, label);
  } else {
    db.prepare(
      "INSERT INTO actors (name, kind, direction, source) VALUES (?, 'system', 'outbound', 'scan')",
    ).run(actorName);
  }
  const actorId = db.prepare('SELECT id FROM actors WHERE name = ?').get(actorName).id;
  db.prepare(
    "INSERT INTO actor_connections (actor_id, service_id, direction) VALUES (?, ?, 'outbound')",
  ).run(actorId, svcId);

  return { repoId, svcId, actorId };
}

describe('getGraph() — actors.label exposure', () => {
  test('returns label string when actor row has a label set', () => {
    const db = dbWith018();
    seedRepoServiceActor(db, 'api.stripe.com', 'Stripe API');

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    assert.equal(graph.actors.length, 1);
    assert.equal(graph.actors[0].name, 'api.stripe.com');
    assert.equal(graph.actors[0].label, 'Stripe API');

    db.close();
  });

  test('returns label = null when actor row has no label assigned', () => {
    const db = dbWith018();
    seedRepoServiceActor(db, 'unknown.example.com');

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    assert.equal(graph.actors.length, 1);
    assert.equal(graph.actors[0].label, null);

    db.close();
  });

  test('falls back to label: null per row on a pre-018 DB (no label column)', () => {
    const db = dbPre018();
    seedRepoServiceActor(db, 'api.stripe.com');

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    assert.equal(graph.actors.length, 1);
    assert.equal(graph.actors[0].name, 'api.stripe.com');
    assert.equal(graph.actors[0].label, null, 'label synthesized as null when column absent');

    db.close();
  });
});
