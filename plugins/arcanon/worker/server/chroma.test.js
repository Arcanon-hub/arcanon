/**
 * worker/chroma-sync.test.js — Unit tests for chroma-sync.js
 *
 * Tests for:
 *   - initChromaSync(settings) with no config → returns false immediately, no connection
 *   - initChromaSync(settings) with config → calls heartbeat, sets availability flag
 *   - syncFindings(findings) → skips silently when unavailable; never throws
 *   - chromaSearch(query, limit) → throws Error when unavailable (triggers fallback)
 *   - isChromaAvailable() → returns current flag state
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 * ChromaDB network calls are mocked via module-level injection (setChromaClient).
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  initChromaSync,
  syncFindings,
  chromaSearch,
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
