import test from "node:test";
import assert from "node:assert/strict";

import { uploadScan, HubError, UPLOAD_PATH } from "./client.js";

const BASE_URL = "https://api.arcanon.test";

function mkPayload() {
  return {
    version: "1.0",
    metadata: {
      tool: "claude-code",
      repo_name: "mock",
      commit_sha: "0".repeat(40),
      scan_mode: "full",
    },
    findings: { services: [{ name: "svc" }], connections: [], schemas: [], actors: [] },
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("uploadScan sends Bearer auth and JSON body to /api/v1/scans/upload", async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse(202, { scan_upload_id: "abc", status: "processing" });
  };
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    fetchImpl,
  });
  assert.equal(res.scan_upload_id, "abc");
  assert.ok(captured.url.endsWith(UPLOAD_PATH));
  assert.equal(captured.init.headers.Authorization, "Bearer arc_test");
  assert.equal(captured.init.headers["Content-Type"], "application/json");
  assert.equal(captured.init.method, "POST");
});

test("uploadScan treats 409 as a successful idempotent hit", async () => {
  const fetchImpl = async () =>
    jsonResponse(409, { scan_upload_id: "existing", status: "completed" });
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    fetchImpl,
  });
  assert.equal(res.scan_upload_id, "existing");
});

test("uploadScan retries on 503 and eventually succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3)
      return jsonResponse(503, { title: "down", detail: "backend unavailable" });
    return jsonResponse(202, { scan_upload_id: "ok", status: "processing" });
  };
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    fetchImpl,
    backoffsMs: [0, 0, 0],
  });
  assert.equal(calls, 3);
  assert.equal(res.scan_upload_id, "ok");
});

test("uploadScan honors Retry-After on 429", async () => {
  let calls = 0;
  const started = Date.now();
  const fetchImpl = async () => {
    calls++;
    if (calls === 1)
      return jsonResponse(429, { detail: "slow down" }, { "Retry-After": "0" });
    return jsonResponse(202, { scan_upload_id: "ok", status: "processing" });
  };
  const res = await uploadScan(mkPayload(), {
    apiKey: "arc_test",
    hubUrl: BASE_URL,
    fetchImpl,
    backoffsMs: [0, 0, 0],
  });
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 1000);
  assert.equal(res.scan_upload_id, "ok");
});

test("uploadScan fails fast on 4xx (non-429)", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(422, { title: "validation failed", detail: "bad field" });
  };
  await assert.rejects(
    () =>
      uploadScan(mkPayload(), {
        apiKey: "arc_test",
        hubUrl: BASE_URL,
        fetchImpl,
        backoffsMs: [0, 0, 0],
      }),
    (err) => {
      assert.ok(err instanceof HubError);
      assert.equal(err.status, 422);
      assert.equal(err.retriable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("uploadScan treats network errors as retriable", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () =>
      uploadScan(mkPayload(), {
        apiKey: "arc_test",
        hubUrl: BASE_URL,
        fetchImpl,
        backoffsMs: [0, 0, 0],
      }),
    (err) => {
      assert.ok(err instanceof HubError);
      assert.equal(err.retriable, true);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("uploadScan validates apiKey and hubUrl are present", async () => {
  const fetchImpl = async () => jsonResponse(202, {});
  await assert.rejects(
    () => uploadScan(mkPayload(), { hubUrl: BASE_URL, fetchImpl }),
    /apiKey is required/,
  );
  await assert.rejects(
    () => uploadScan(mkPayload(), { apiKey: "arc_x", fetchImpl }),
    /hubUrl is required/,
  );
});
