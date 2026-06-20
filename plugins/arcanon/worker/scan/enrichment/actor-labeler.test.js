/**
 * worker/scan/enrichment/actor-labeler.test.js —  / .
 *
 * Tests for runActorLabeling(repoId, db, logger, catalog) — the per-repo
 * actor enrichment pass that stamps actors.label using the catalog.
 *
 * Test scenarios:
 *   3.1 happy path — 3 actors in repo, 2 match catalog, 1 no-match
 *   3.2 idempotent re-run preserves labels
 *   3.3 self-healing: a previously-labeled actor reverts to NULL when its
 *       catalog entry disappears
 *   3.4 repo scoping: actors connected only to OTHER repos are untouched
 *   3.5 no actors for repo — returns {matched:0, considered:0}
 *   3.6 empty catalog — returns {matched:0, considered:N}, no labels written
 *   3.7 failure isolation — SELECT throws -> returns {0,0}, logger.warn called
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from '../../db/sqlite-adapter.js';
import { up as up001 } from '../../db/migrations/001_initial_schema.js';
import { up as up008 } from '../../db/migrations/008_actors_metadata.js';
import { up as up018 } from '../../db/migrations/018_actors_label.js';
import { runActorLabeling } from './actor-labeler.js';

/**
 * Build a fully migrated in-memory DB with actors.label support.
 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up001(db);
  up008(db);
  up018(db);
  return db;
}

/**
 * Insert a repo + service + return ids.
 */
function seedRepoService(db, repoName, serviceName) {
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, 'single')")
    .run(`/tmp/${repoName}`, repoName).lastInsertRowid;
  const serviceId = db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, '.', 'typescript')",
    )
    .run(repoId, serviceName).lastInsertRowid;
  return { repoId, serviceId };
}

/**
 * Insert an actor and link it to a service.
 */
function seedActor(db, name, serviceId) {
  const actorId = db
    .prepare(
      "INSERT INTO actors (name, kind, direction, source) VALUES (?, 'system', 'outbound', 'scan')",
    )
    .run(name).lastInsertRowid;
  db.prepare(
    "INSERT INTO actor_connections (actor_id, service_id, direction) VALUES (?, ?, 'outbound')",
  ).run(actorId, serviceId);
  return actorId;
}

/**
 * Build a catalog matching the in-test fixtures.
 */
function fixtureCatalog() {
  return {
    entries: new Map([
      ['stripe', { label: 'Stripe API', hosts: ['api.stripe.com'], ports: [] }],
      ['slack', { label: 'Slack', hosts: ['hooks.slack.com'], ports: [] }],
      ['github', { label: 'GitHub API', hosts: ['api.github.com'], ports: [] }],
    ]),
  };
}

function loggerSpy() {
  const calls = [];
  return { warn: (m) => calls.push(m), _calls: calls };
}

describe('runActorLabeling', () => {
  let db;
  beforeEach(() => {
    db = freshDb();
  });

  it('3.1 happy path — labels matching actors and leaves non-matches NULL', async () => {
    const { serviceId } = seedRepoService(db, 'repo-a', 'svc-a');
    seedActor(db, 'api.stripe.com', serviceId);
    seedActor(db, 'hooks.slack.com', serviceId);
    seedActor(db, 'internal.example.com', serviceId);

    const result = await runActorLabeling(1, db, loggerSpy(), fixtureCatalog());
    assert.deepEqual(result, { matched: 2, considered: 3 });

    const rows = db.prepare('SELECT name, label FROM actors ORDER BY name').all();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.label]));
    assert.equal(byName['api.stripe.com'], 'Stripe API');
    assert.equal(byName['hooks.slack.com'], 'Slack');
    assert.equal(byName['internal.example.com'], null);
  });

  it('3.2 idempotent re-run — labels unchanged on second pass', async () => {
    const { serviceId } = seedRepoService(db, 'repo-a', 'svc-a');
    seedActor(db, 'api.stripe.com', serviceId);
    seedActor(db, 'hooks.slack.com', serviceId);
    seedActor(db, 'internal.example.com', serviceId);
    await runActorLabeling(1, db, loggerSpy(), fixtureCatalog());

    const second = await runActorLabeling(1, db, loggerSpy(), fixtureCatalog());
    assert.deepEqual(second, { matched: 2, considered: 3 });

    const stripeLabel = db
      .prepare("SELECT label FROM actors WHERE name = 'api.stripe.com'")
      .get().label;
    assert.equal(stripeLabel, 'Stripe API', 'label preserved across re-runs');
  });

  it('3.3 self-healing — removing a catalog entry clears its stale label', async () => {
    const { serviceId } = seedRepoService(db, 'repo-a', 'svc-a');
    seedActor(db, 'api.stripe.com', serviceId);
    seedActor(db, 'hooks.slack.com', serviceId);
    await runActorLabeling(1, db, loggerSpy(), fixtureCatalog());
    // Both labeled.

    // Now run with a catalog that has only Stripe.
    const trimmed = {
      entries: new Map([
        ['stripe', { label: 'Stripe API', hosts: ['api.stripe.com'], ports: [] }],
      ]),
    };
    const result = await runActorLabeling(1, db, loggerSpy(), trimmed);
    assert.deepEqual(result, { matched: 1, considered: 2 });

    const slackLabel = db
      .prepare("SELECT label FROM actors WHERE name = 'hooks.slack.com'")
      .get().label;
    assert.equal(slackLabel, null, 'stale Slack label cleared by re-labeling pass');

    const stripeLabel = db
      .prepare("SELECT label FROM actors WHERE name = 'api.stripe.com'")
      .get().label;
    assert.equal(stripeLabel, 'Stripe API', 'still-matching label preserved');
  });

  it('3.4 repo scoping — only labels actors connected to services in the given repo', async () => {
    const { repoId: repoA, serviceId: svcA } = seedRepoService(db, 'repo-a', 'svc-a');
    const { serviceId: svcB } = seedRepoService(db, 'repo-b', 'svc-b');
    seedActor(db, 'api.stripe.com', svcA); // belongs to repo-a
    seedActor(db, 'api.github.com', svcB); // belongs to repo-b

    const result = await runActorLabeling(repoA, db, loggerSpy(), fixtureCatalog());
    assert.deepEqual(result, { matched: 1, considered: 1 });

    const stripeLabel = db
      .prepare("SELECT label FROM actors WHERE name = 'api.stripe.com'")
      .get().label;
    const githubLabel = db
      .prepare("SELECT label FROM actors WHERE name = 'api.github.com'")
      .get().label;
    assert.equal(stripeLabel, 'Stripe API');
    assert.equal(githubLabel, null, 'github actor (other repo) was NOT labeled');
  });

  it('3.5 no actors for repo — returns {matched:0, considered:0}', async () => {
    const { repoId } = seedRepoService(db, 'repo-a', 'svc-a');
    // No actors inserted.
    const result = await runActorLabeling(repoId, db, loggerSpy(), fixtureCatalog());
    assert.deepEqual(result, { matched: 0, considered: 0 });
  });

  it('3.6 empty catalog — clears every actor label, no matches', async () => {
    const { repoId, serviceId } = seedRepoService(db, 'repo-a', 'svc-a');
    seedActor(db, 'api.stripe.com', serviceId);
    seedActor(db, 'api.github.com', serviceId);

    const result = await runActorLabeling(repoId, db, loggerSpy(), {
      entries: new Map(),
    });
    assert.deepEqual(result, { matched: 0, considered: 2 });

    const labels = db
      .prepare('SELECT label FROM actors')
      .all()
      .map((r) => r.label);
    assert.deepEqual(labels, [null, null], 'every actor label is null after empty-catalog pass');
  });

  it('3.7 failure isolation — SELECT throws, returns {0,0}, logger.warn called', async () => {
    const fakeDb = {
      prepare() {
        throw new Error('boom — db unavailable');
      },
    };
    const logger = loggerSpy();
    const result = await runActorLabeling(1, fakeDb, logger, fixtureCatalog());
    assert.deepEqual(result, { matched: 0, considered: 0 });
    assert.ok(
      logger._calls.some((m) => m.includes('boom') || m.includes('actor-labeling')),
      'logger.warn called with the failure',
    );
  });
});
