/**
 * worker/chroma-sync.test.js — Unit tests for chroma-sync.js
 *
 * Tests for:
 *   - initChromaSync(settings) with no config → returns false immediately, no connection
 *   - initChromaSync(settings) with config → calls heartbeat, sets availability flag
 *   - syncFindings(findings) → skips silently when unavailable; never throws
 *   - chromaSearch(query, limit) → throws Error when unavailable (triggers fallback)
 *   - isChromaAvailable() → returns current flag state
 *   [INTG-03] Namespace + where-filter + deleteRepoRecords (142-02):
 *   - syncFindings ids are project+repo prefixed
 *   - two different projectHash values yield distinct ids for same service name
 *   - metadata carries project_id and repo_id
 *   - chromaSearch forwards where clause to collection.query
 *   - deleteRepoRecords issues $and filter and no-ops when unavailable
 *   [INTG-02] syncFindingsToChroma delete-then-upsert (142-02 Task 3):
 *   - delete precedes upsert in mock call sequence
 *   - syncFindingsToChroma is a no-op (no delete, no upsert, no throw) when unavailable
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 * ChromaDB network calls are mocked via module-level injection (setChromaClient).
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  initChromaSync,
  syncFindings,
  syncFindingsToChroma,
  chromaSearch,
  deleteRepoRecords,
  isChromaAvailable,
  _resetForTest,
} from "./chroma.js";

// ---------------------------------------------------------------------------
// Helper: reset module state between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetForTest();
});

// ---------------------------------------------------------------------------
// initChromaSync — no config
// ---------------------------------------------------------------------------

describe("initChromaSync — no config", () => {
  test("returns false when ARCANON_CHROMA_MODE is empty string", async () => {
    const result = await initChromaSync({ ARCANON_CHROMA_MODE: "" });
    assert.equal(result, false);
  });

  test("returns false when ARCANON_CHROMA_MODE is absent (undefined)", async () => {
    const result = await initChromaSync({});
    assert.equal(result, false);
  });

  test("isChromaAvailable() is false after no-config init", async () => {
    await initChromaSync({});
    assert.equal(isChromaAvailable(), false);
  });

  test("does not attempt any network connection without mode", async () => {
    // If this test times out, it means a network connection was attempted
    const result = await initChromaSync({});
    assert.equal(
      result,
      false,
      "must return false immediately without attempting connection",
    );
  });
});

// ---------------------------------------------------------------------------
// initChromaSync — with config, mocked ChromaClient
// ---------------------------------------------------------------------------

describe("initChromaSync — with config (mock)", () => {
  test("returns false and sets isChromaAvailable=false when heartbeat throws", async () => {
    const settings = {
      ARCANON_CHROMA_MODE: "local",
      ARCANON_CHROMA_HOST: "localhost",
      ARCANON_CHROMA_PORT: "8000",
    };

    // Inject a mock client that always fails heartbeat
    const mockClient = {
      heartbeat: async () => {
        throw new Error("ECONNREFUSED");
      },
      getOrCreateCollection: async () => ({}),
    };

    const result = await initChromaSync(settings, mockClient);
    assert.equal(result, false);
    assert.equal(isChromaAvailable(), false);
  });

  test("returns true and sets isChromaAvailable=true when heartbeat succeeds", async () => {
    const settings = {
      ARCANON_CHROMA_MODE: "local",
      ARCANON_CHROMA_HOST: "localhost",
      ARCANON_CHROMA_PORT: "8000",
    };

    const mockCollection = {
      upsert: async () => {},
      query: async () => ({
        ids: [[]],
        documents: [[]],
        distances: [[]],
        metadatas: [[]],
      }),
    };
    const mockClient = {
      heartbeat: async () => ({ nanosecondHeartbeat: 1000 }),
      getOrCreateCollection: async () => mockCollection,
    };

    const result = await initChromaSync(settings, mockClient);
    assert.equal(result, true);
    assert.equal(isChromaAvailable(), true);
  });
});

// ---------------------------------------------------------------------------
// syncFindings — fire-and-forget safety
// ---------------------------------------------------------------------------

describe("syncFindings", () => {
  test("resolves without throwing when chromaAvailable=false", async () => {
    // isChromaAvailable() is false (reset in beforeEach)
    // syncFindings must not throw
    await assert.doesNotReject(async () => {
      await syncFindings({ services: [] });
    });
  });

  test("resolves without throwing when findings has empty services", async () => {
    await assert.doesNotReject(async () => {
      await syncFindings({ services: [] });
    });
  });

  test("skips silently when unavailable — does not call collection.upsert", async () => {
    let upsertCalled = false;
    const mockCollection = {
      upsert: async () => {
        upsertCalled = true;
      },
      query: async () => ({
        ids: [[]],
        documents: [[]],
        distances: [[]],
        metadatas: [[]],
      }),
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };

    // Do NOT call initChromaSync — chroma is unavailable
    await syncFindings({ services: [{ name: "svc-a", endpoints: [] }] });
    assert.equal(
      upsertCalled,
      false,
      "upsert must not be called when unavailable",
    );
  });

  test("calls collection.upsert when chromaAvailable=true", async () => {
    let upsertCalledWith = null;
    const mockCollection = {
      upsert: async (args) => {
        upsertCalledWith = args;
      },
      query: async () => ({
        ids: [[]],
        documents: [[]],
        distances: [[]],
        metadatas: [[]],
      }),
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };

    const settings = { ARCANON_CHROMA_MODE: "local" };
    await initChromaSync(settings, mockClient);

    const findings = {
      services: [
        { name: "svc-a", endpoints: [{ path: "/api/health" }] },
        { name: "svc-b", endpoints: [] },
      ],
    };
    await syncFindings(findings);
    assert.ok(upsertCalledWith !== null, "upsert should have been called");
    assert.ok(
      Array.isArray(upsertCalledWith.ids),
      "upsert called with ids array",
    );
    assert.ok(
      Array.isArray(upsertCalledWith.documents),
      "upsert called with documents array",
    );
  });

  test("never rejects even when collection.upsert throws", async () => {
    const mockCollection = {
      upsert: async () => {
        throw new Error("Chroma write error");
      },
      query: async () => ({
        ids: [[]],
        documents: [[]],
        distances: [[]],
        metadatas: [[]],
      }),
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };

    const settings = { ARCANON_CHROMA_MODE: "local" };
    await initChromaSync(settings, mockClient);

    await assert.doesNotReject(async () => {
      await syncFindings({ services: [{ name: "svc-a", endpoints: [] }] });
    }, "syncFindings must not rethrow even when upsert fails");
  });
});

// ---------------------------------------------------------------------------
// syncFindings — enrichment context (boundary + actors)
// ---------------------------------------------------------------------------

describe("syncFindings — enrichment context", () => {
  async function setupMockCollection() {
    let upsertCalledWith = null;
    const mockCollection = {
      upsert: async (args) => {
        upsertCalledWith = args;
      },
      query: async () => ({
        ids: [[]],
        documents: [[]],
        distances: [[]],
        metadatas: [[]],
      }),
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };
    await initChromaSync({ ARCANON_CHROMA_MODE: "local" }, mockClient);
    return { mockCollection, get upsertCalledWith() { return upsertCalledWith; } };
  }

  test("service document includes boundary and actors when enrichment provided", async () => {
    const ctx = await setupMockCollection();

    const boundaryMap = new Map([["payments-api", "payments"]]);
    const actorMap = new Map([["payments-api", ["stripe"]]]);
    const findings = {
      services: [{ name: "payments-api", endpoints: [] }],
    };

    await syncFindings(findings, { boundaryMap, actorMap });

    const metadatas = ctx.upsertCalledWith.metadatas;
    assert.ok(metadatas, "upsert must have been called");
    const svcMeta = metadatas.find((m) => m.type === "service" && m.name === "payments-api");
    assert.ok(svcMeta, "service metadata must exist");
    assert.equal(svcMeta.boundary, "payments", "boundary field must be set from boundaryMap");
    assert.equal(svcMeta.actors, "stripe", "actors field must be comma-separated from actorMap");
  });

  test("service document has boundary='' and actors='' when no enrichment provided", async () => {
    const ctx = await setupMockCollection();

    const findings = {
      services: [{ name: "payments-api", endpoints: [] }],
    };

    await syncFindings(findings);

    const metadatas = ctx.upsertCalledWith.metadatas;
    assert.ok(metadatas, "upsert must have been called");
    const svcMeta = metadatas.find((m) => m.type === "service" && m.name === "payments-api");
    assert.ok(svcMeta, "service metadata must exist");
    assert.equal(svcMeta.boundary, "", "boundary must be empty string when no enrichment");
    assert.equal(svcMeta.actors, "", "actors must be empty string when no enrichment");
  });

  test("partial enrichment — only boundaryMap — sets boundary but actors=''", async () => {
    const ctx = await setupMockCollection();

    const boundaryMap = new Map([["billing-service", "payments"]]);
    const findings = {
      services: [{ name: "billing-service", endpoints: [] }],
    };

    await syncFindings(findings, { boundaryMap });

    const metadatas = ctx.upsertCalledWith.metadatas;
    assert.ok(metadatas, "upsert must have been called");
    const svcMeta = metadatas.find((m) => m.type === "service" && m.name === "billing-service");
    assert.ok(svcMeta, "service metadata must exist");
    assert.equal(svcMeta.boundary, "payments", "boundary must be set from boundaryMap");
    assert.equal(svcMeta.actors, "", "actors must be empty string when actorMap absent");
  });

  test("endpoint documents are NOT given boundary or actors fields", async () => {
    const ctx = await setupMockCollection();

    const boundaryMap = new Map([["payments-api", "payments"]]);
    const actorMap = new Map([["payments-api", ["stripe"]]]);
    const findings = {
      services: [{ name: "payments-api", endpoints: [{ path: "/api/charge" }] }],
    };

    await syncFindings(findings, { boundaryMap, actorMap });

    const metadatas = ctx.upsertCalledWith.metadatas;
    const epMeta = metadatas.find((m) => m.type === "endpoint");
    assert.ok(epMeta, "endpoint metadata must exist");
    assert.equal(epMeta.boundary, undefined, "endpoints must not have boundary field");
    assert.equal(epMeta.actors, undefined, "endpoints must not have actors field");
  });
});

// ---------------------------------------------------------------------------
// chromaSearch — throws when unavailable (triggers fallback in query-engine)
// ---------------------------------------------------------------------------

describe("chromaSearch", () => {
  test("throws Error when chromaAvailable=false", async () => {
    // isChromaAvailable() is false (reset in beforeEach)
    await assert.rejects(
      async () => chromaSearch("test", 10),
      /ChromaDB not available/,
    );
  });

  test("returns normalized array when chromaAvailable=true", async () => {
    const mockCollection = {
      upsert: async () => {},
      query: async () => ({
        ids: [["id-1", "id-2"]],
        documents: [["doc one", "doc two"]],
        distances: [[0.1, 0.3]],
        metadatas: [[{ type: "service" }, { type: "endpoint" }]],
      }),
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };

    await initChromaSync({ ARCANON_CHROMA_MODE: "local" }, mockClient);
    const results = await chromaSearch("test", 10);

    assert.ok(Array.isArray(results), "must return array");
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      id: "id-1",
      document: "doc one",
      score: 0.1,
      metadata: { type: "service" },
    });
    assert.deepEqual(results[1], {
      id: "id-2",
      document: "doc two",
      score: 0.3,
      metadata: { type: "endpoint" },
    });
  });
});

// ---------------------------------------------------------------------------
// INTG-03 — Project/repo namespace, where-filter, deleteRepoRecords
// ---------------------------------------------------------------------------

describe("INTG-03 — Chroma record namespacing", () => {
  /** Helper: init with a mock collection that records upsert/query/delete calls. */
  async function setupMockCollectionRecording() {
    const calls = [];
    const mockCollection = {
      upsert: async (args) => { calls.push({ op: "upsert", args }); },
      query: async (args) => {
        calls.push({ op: "query", args });
        return { ids: [[]], documents: [[]], distances: [[]], metadatas: [[]] };
      },
      delete: async (args) => { calls.push({ op: "delete", args }); },
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };
    await initChromaSync({ ARCANON_CHROMA_MODE: "local" }, mockClient);
    return calls;
  }

  test("service id is project+repo namespaced: {projectHash}:r{repoId}:svc:{name}", async () => {
    const calls = await setupMockCollectionRecording();
    const findings = { services: [{ name: "api-gateway", endpoints: [] }] };
    await syncFindings(findings, {}, { projectHash: "abc123def456", repoId: 7 });
    const upsert = calls.find((c) => c.op === "upsert");
    assert.ok(upsert, "upsert must have been called");
    assert.ok(
      upsert.args.ids.includes("abc123def456:r7:svc:api-gateway"),
      `expected namespaced id, got: ${JSON.stringify(upsert.args.ids)}`,
    );
  });

  test("endpoint id is project+repo namespaced: {projectHash}:r{repoId}:ep:{svc}:{path}", async () => {
    const calls = await setupMockCollectionRecording();
    const findings = { services: [{ name: "api-gateway", endpoints: [{ path: "/health" }] }] };
    await syncFindings(findings, {}, { projectHash: "abc123def456", repoId: 7 });
    const upsert = calls.find((c) => c.op === "upsert");
    assert.ok(upsert, "upsert must have been called");
    assert.ok(
      upsert.args.ids.includes("abc123def456:r7:ep:api-gateway:/health"),
      `expected namespaced endpoint id, got: ${JSON.stringify(upsert.args.ids)}`,
    );
  });

  test("two syncs with different projectHash produce distinct ids for same service name", async () => {
    const calls = await setupMockCollectionRecording();
    const findings = { services: [{ name: "api-gateway", endpoints: [] }] };
    await syncFindings(findings, {}, { projectHash: "project-aaa", repoId: 1 });
    await syncFindings(findings, {}, { projectHash: "project-bbb", repoId: 1 });
    const upserts = calls.filter((c) => c.op === "upsert");
    assert.equal(upserts.length, 2, "two upserts should have been called");
    const idsA = upserts[0].args.ids;
    const idsB = upserts[1].args.ids;
    assert.ok(idsA[0] !== idsB[0], "ids for the same service name must differ across projects");
    assert.ok(idsA[0].startsWith("project-aaa:"), "first id must be prefixed with project-aaa");
    assert.ok(idsB[0].startsWith("project-bbb:"), "second id must be prefixed with project-bbb");
  });

  test("service metadata includes project_id and repo_id", async () => {
    const calls = await setupMockCollectionRecording();
    const findings = { services: [{ name: "payments-api", endpoints: [] }] };
    await syncFindings(findings, {}, { projectHash: "ph12345", repoId: 3 });
    const upsert = calls.find((c) => c.op === "upsert");
    const meta = upsert.args.metadatas.find((m) => m.type === "service");
    assert.ok(meta, "service metadata must exist");
    assert.equal(meta.project_id, "ph12345", "project_id must be set");
    assert.equal(meta.repo_id, "3", "repo_id must be stringified");
  });

  test("endpoint metadata includes project_id and repo_id", async () => {
    const calls = await setupMockCollectionRecording();
    const findings = { services: [{ name: "payments-api", endpoints: [{ path: "/charge" }] }] };
    await syncFindings(findings, {}, { projectHash: "ph12345", repoId: 3 });
    const upsert = calls.find((c) => c.op === "upsert");
    const meta = upsert.args.metadatas.find((m) => m.type === "endpoint");
    assert.ok(meta, "endpoint metadata must exist");
    assert.equal(meta.project_id, "ph12345", "endpoint project_id must be set");
    assert.equal(meta.repo_id, "3", "endpoint repo_id must be stringified");
  });

  test("chromaSearch forwards where clause to collection.query", async () => {
    const calls = await setupMockCollectionRecording();
    const whereClause = { project_id: { $eq: "myhash" } };
    await chromaSearch("api", 5, { where: whereClause });
    const query = calls.find((c) => c.op === "query");
    assert.ok(query, "query must have been called");
    assert.deepEqual(query.args.where, whereClause, "where clause must be forwarded verbatim");
  });

  test("chromaSearch without where does not include where in query args", async () => {
    const calls = await setupMockCollectionRecording();
    await chromaSearch("api", 5);
    const query = calls.find((c) => c.op === "query");
    assert.ok(query, "query must have been called");
    assert.ok(!("where" in query.args), "where must be absent when not provided");
  });

  test("deleteRepoRecords issues $and filter targeting project_id and repo_id", async () => {
    const calls = await setupMockCollectionRecording();
    await deleteRepoRecords("myhash12345", 42);
    const del = calls.find((c) => c.op === "delete");
    assert.ok(del, "delete must have been called");
    const where = del.args.where;
    assert.ok(where, "delete must include a where clause");
    assert.ok(
      Array.isArray(where.$and) && where.$and.length === 2,
      "where must be $and of two conditions",
    );
    const projectCondition = where.$and.find((c) => c.project_id);
    const repoCondition = where.$and.find((c) => c.repo_id);
    assert.ok(projectCondition, "$and must include project_id condition");
    assert.ok(repoCondition, "$and must include repo_id condition");
    assert.deepEqual(projectCondition.project_id, { $eq: "myhash12345" });
    assert.deepEqual(repoCondition.repo_id, { $eq: "42" });
  });

  test("deleteRepoRecords is a no-op when Chroma is unavailable (no delete call, no throw)", async () => {
    // _resetForTest called in beforeEach — Chroma is unavailable
    let deleteCalled = false;
    const mockCollection = {
      delete: async () => { deleteCalled = true; },
    };
    // Do NOT init Chroma — isChromaAvailable() is false
    await assert.doesNotReject(
      () => deleteRepoRecords("anyhash", 1),
      "deleteRepoRecords must not throw when unavailable",
    );
    assert.equal(deleteCalled, false, "delete must not be called when unavailable");
  });
});

// ---------------------------------------------------------------------------
// INTG-02 — syncFindingsToChroma delete-then-upsert wrapper
// ---------------------------------------------------------------------------

describe("INTG-02 — syncFindingsToChroma delete-then-upsert", () => {
  test("delete precedes upsert in the call sequence", async () => {
    const callOrder = [];
    const mockCollection = {
      upsert: async () => { callOrder.push("upsert"); },
      query: async () => ({ ids: [[]], documents: [[]], distances: [[]], metadatas: [[]] }),
      delete: async () => { callOrder.push("delete"); },
    };
    const mockClient = {
      heartbeat: async () => ({}),
      getOrCreateCollection: async () => mockCollection,
    };
    await initChromaSync({ ARCANON_CHROMA_MODE: "local" }, mockClient);

    const findings = { services: [{ name: "api-gateway", endpoints: [] }] };
    await syncFindingsToChroma("ph123", 1, findings, {});

    assert.equal(callOrder[0], "delete", "delete must be called before upsert");
    assert.equal(callOrder[1], "upsert", "upsert must follow delete");
  });

  test("syncFindingsToChroma is a no-op when Chroma is unavailable (no delete, no upsert, no throw)", async () => {
    // Chroma unavailable (beforeEach resets state)
    let deleteCalled = false;
    let upsertCalled = false;
    const mockCollection = {
      delete: async () => { deleteCalled = true; },
      upsert: async () => { upsertCalled = true; },
    };
    // Do NOT init Chroma — isChromaAvailable() is false
    await assert.doesNotReject(
      () => syncFindingsToChroma("ph123", 1, { services: [] }, {}),
      "syncFindingsToChroma must not throw when unavailable",
    );
    assert.equal(deleteCalled, false, "delete must not be called when unavailable");
    assert.equal(upsertCalled, false, "upsert must not be called when unavailable");
  });
});
