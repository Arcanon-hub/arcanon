/**
 * worker/confirmation-flow.test.js — Unit tests for user confirmation flow
 *
 * Tests cover:
 * - groupByConfidence: confidence splitting and low-confidence cap
 * - formatHighConfidenceSummary: grouped repo formatting
 * - formatLowConfidenceQuestions: per-finding question formatting
 * - applyEdits: edit instruction parsing and application
 * - buildConfirmationPrompt: full prompt assembly
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LOW_CONFIDENCE,
  groupByConfidence,
  formatHighConfidenceSummary,
  formatLowConfidenceQuestions,
  applyEdits,
  buildConfirmationPrompt,
  NEEDS_REPROMPT,
  AFFIRMATIVE_SYNONYMS,
} from "./confirmation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding({
  service = "svc-a",
  repo = "/repos/svc-a",
  confidence = "high",
  sourceService = "caller",
  targetService = "svc-a",
  protocol = "rest",
  method = "GET",
  path = "/items",
  sourceFile = "caller/client.ts:42",
} = {}) {
  return {
    service,
    repo,
    confidence,
    connections: [
      {
        sourceService,
        targetService,
        protocol,
        method,
        path,
        sourceFile,
        targetFile: `${service}/routes.ts:handler`,
      },
    ],
    schemas: [],
  };
}

function makeFindings(count, confidence = "high", repoBase = "/repos/svc-") {
  return Array.from({ length: count }, (_, i) =>
    makeFinding({
      service: `svc-${i}`,
      repo: `${repoBase}${i}`,
      confidence,
      sourceService: `caller-${i}`,
      targetService: `svc-${i}`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Task 1 Tests: groupByConfidence
// ---------------------------------------------------------------------------

describe("groupByConfidence", () => {
  test("empty array returns empty groups", () => {
    const result = groupByConfidence([]);
    assert.equal(result.high.length, 0);
    assert.equal(result.low.length, 0);
    assert.equal(result.lowOverflow.length, 0);
  });

  test("5 high + 3 low returns correct counts", () => {
    const findings = [
      ...makeFindings(5, "high"),
      ...makeFindings(3, "low", "/repos/low-"),
    ];
    const result = groupByConfidence(findings);
    assert.equal(result.high.length, 5);
    assert.equal(result.low.length, 3);
    assert.equal(result.lowOverflow.length, 0);
  });

  test("15 low findings: low.length === 10, lowOverflow.length === 5", () => {
    const findings = makeFindings(15, "low", "/repos/low-");
    const result = groupByConfidence(findings);
    assert.equal(result.low.length, 10);
    assert.equal(result.lowOverflow.length, 5);
    assert.equal(result.high.length, 0);
  });

  test("MAX_LOW_CONFIDENCE is 10", () => {
    assert.equal(MAX_LOW_CONFIDENCE, 10);
  });

  test("confidence matching is case-insensitive", () => {
    const findings = [
      makeFinding({ confidence: "HIGH" }),
      makeFinding({
        confidence: "Low",
        service: "svc-low",
        repo: "/repos/low",
      }),
    ];
    const result = groupByConfidence(findings);
    assert.equal(result.high.length, 1);
    assert.equal(result.low.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Task 1 Tests: formatHighConfidenceSummary
// ---------------------------------------------------------------------------

describe("formatHighConfidenceSummary", () => {
  test("empty input returns empty string", () => {
    const result = formatHighConfidenceSummary([]);
    assert.equal(result, "");
  });

  test('output contains "confirm" instruction', () => {
    const findings = makeFindings(1, "high");
    const result = formatHighConfidenceSummary(findings);
    assert.match(result, /confirm/i);
  });

  test("groups connections by repo path", () => {
    const findings = [
      makeFinding({
        service: "svc-a",
        repo: "/repos/a",
        confidence: "high",
        sourceService: "caller",
        targetService: "svc-a",
        path: "/items",
      }),
      makeFinding({
        service: "svc-b",
        repo: "/repos/b",
        confidence: "high",
        sourceService: "caller",
        targetService: "svc-b",
        path: "/users",
      }),
    ];
    const result = formatHighConfidenceSummary(findings);
    assert.match(result, /\[repo: \/repos\/a\]/);
    assert.match(result, /\[repo: \/repos\/b\]/);
  });

  test("includes header with connection and service counts", () => {
    const findings = makeFindings(2, "high");
    const result = formatHighConfidenceSummary(findings);
    assert.match(result, /High confidence findings/i);
    assert.match(result, /2 connection/i);
    assert.match(result, /2 service/i);
  });
});

// ---------------------------------------------------------------------------
// Task 1 Tests: formatLowConfidenceQuestions
// ---------------------------------------------------------------------------

describe("formatLowConfidenceQuestions", () => {
  test("returns array of same length as input", () => {
    const findings = makeFindings(3, "low", "/repos/low-");
    const result = formatLowConfidenceQuestions(findings);
    assert.equal(result.length, 3);
  });

  test("each question contains sourceService and targetService names", () => {
    const finding = makeFinding({
      confidence: "low",
      sourceService: "payment-service",
      targetService: "order-service",
      repo: "/repos/order",
    });
    const result = formatLowConfidenceQuestions([finding]);
    assert.equal(result.length, 1);
    assert.match(result[0], /payment-service/);
    assert.match(result[0], /order-service/);
  });

  test("empty input returns empty array", () => {
    const result = formatLowConfidenceQuestions([]);
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// Task 2 Tests: applyEdits
// ---------------------------------------------------------------------------

describe("applyEdits", () => {
  test('"confirm" instruction returns findings unchanged', () => {
    const findings = makeFindings(3, "high");
    const result = applyEdits(findings, "confirm");
    assert.deepEqual(result, findings);
  });

  test('"Confirm" (mixed case) returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "Confirm");
    assert.deepEqual(result, findings);
  });

  test("empty string returns findings unchanged", () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "");
    assert.deepEqual(result, findings);
  });

  test('"remove {service-name}" removes matching findings', () => {
    const findings = [
      makeFinding({ service: "user-service", repo: "/repos/user" }),
      makeFinding({ service: "auth-service", repo: "/repos/auth" }),
    ];
    const result = applyEdits(findings, "remove user-service");
    assert.equal(result.length, 1);
    assert.equal(result[0].service, "auth-service");
  });

  test('"remove {service-name}" is case-insensitive', () => {
    const findings = [
      makeFinding({ service: "User-Service", repo: "/repos/user" }),
      makeFinding({ service: "auth-service", repo: "/repos/auth" }),
    ];
    const result = applyEdits(findings, "remove user-service");
    assert.equal(result.length, 1);
    assert.equal(result[0].service, "auth-service");
  });

  test("unrecognized instruction returns NEEDS_REPROMPT sentinel", () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "do something weird");
    assert.equal(result, NEEDS_REPROMPT);
    assert.notEqual(Array.isArray(result), true);
  });
});

// ---------------------------------------------------------------------------
// Task 2 Tests: buildConfirmationPrompt
// ---------------------------------------------------------------------------

describe("buildConfirmationPrompt", () => {
  test("includes high-confidence summary when high findings present", () => {
    const high = makeFindings(2, "high");
    const grouped = {
      high,
      low: [],
      lowOverflow: [],
      highSummary: formatHighConfidenceSummary(high),
      lowQuestions: [],
    };
    const result = buildConfirmationPrompt(grouped);
    assert.match(result, /High confidence findings/i);
  });

  test("omits high-confidence section when only low findings present", () => {
    const low = makeFindings(2, "low", "/repos/low-");
    const grouped = {
      high: [],
      low,
      lowOverflow: [],
      highSummary: "",
      lowQuestions: formatLowConfidenceQuestions(low),
    };
    const result = buildConfirmationPrompt(grouped);
    assert.doesNotMatch(result, /High confidence findings/i);
  });

  test("includes overflow notice when lowOverflow.length > 0", () => {
    const low = makeFindings(10, "low", "/repos/low-");
    const lowOverflow = makeFindings(3, "low", "/repos/overflow-");
    const grouped = {
      high: [],
      low,
      lowOverflow,
      highSummary: "",
      lowQuestions: formatLowConfidenceQuestions(low),
    };
    const result = buildConfirmationPrompt(grouped);
    assert.match(result, /3 additional/i);
  });

  test("no overflow notice when lowOverflow is empty", () => {
    const high = makeFindings(1, "high");
    const grouped = {
      high,
      low: [],
      lowOverflow: [],
      highSummary: formatHighConfidenceSummary(high),
      lowQuestions: [],
    };
    const result = buildConfirmationPrompt(grouped);
    assert.doesNotMatch(result, /additional low-confidence/i);
  });
});

// ---------------------------------------------------------------------------
// Task 1 (THE-934) Tests: applyEdits — synonym normalization and NEEDS_REPROMPT
// ---------------------------------------------------------------------------

describe("applyEdits — synonym normalization", () => {
  test("AFFIRMATIVE_SYNONYMS is exported and is a Set", () => {
    assert.ok(AFFIRMATIVE_SYNONYMS instanceof Set);
  });

  test("NEEDS_REPROMPT is exported and is not an array", () => {
    assert.notEqual(Array.isArray(NEEDS_REPROMPT), true);
  });

  test('"sure" returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "sure");
    assert.deepEqual(result, findings);
  });

  test('"yep" returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "yep");
    assert.deepEqual(result, findings);
  });

  test('"ok" returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "ok");
    assert.deepEqual(result, findings);
  });

  test('"accept" returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "accept");
    assert.deepEqual(result, findings);
  });

  test('"looks good" returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "looks good");
    assert.deepEqual(result, findings);
  });

  test('"sounds good" returns findings unchanged', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "sounds good");
    assert.deepEqual(result, findings);
  });

  test('"OK" (uppercase) returns findings unchanged (case-insensitive)', () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "OK");
    assert.deepEqual(result, findings);
  });

  test("unrecognized instruction returns NEEDS_REPROMPT sentinel (not findings array)", () => {
    const findings = makeFindings(2, "high");
    const result = applyEdits(findings, "do something weird");
    assert.equal(result, NEEDS_REPROMPT);
    assert.notEqual(Array.isArray(result), true);
  });
});
