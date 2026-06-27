/**
 * worker/ui/modules/protocol.js — SINGLE SOURCE OF TRUTH for the canonical
 * protocol vocabulary.
 *
 * Schema validation (scan/findings.js), persist + read (db/query-engine.js),
 * the scan-version diff, AND the browser graph UI all import from here. The
 * original #42 bug was three layers each defining their own protocol vocabulary
 * with nothing reconciling them — so an edge stored as `kafka` was silently
 * dropped by a UI that only knew `events`, and `findings.js` rejected the
 * ENTIRE repo's parse on any unknown protocol. Defining the canonical set + the
 * alias map exactly once and importing it everywhere is what prevents that
 * divergence from recurring.
 *
 * Pure ESM, zero dependencies, NO DOM / browser API usage — it is imported by
 * both the Node worker and the browser, so it must run in either runtime.
 */

/**
 * The render-palette buckets. Every value canonicalProtocol() can return is a
 * member, including the "other" catch-all so consumers (e.g. the UI filter
 * panel) can iterate the full render set.
 *
 * The CONTEXT canonical set is rest·grpc·events·db·internal·sdk. k8s/tf/helm/
 * import are pre-existing first-class infra protocols already present in the
 * schema. They ARE rendered (default-on in state.activeProtocols, under a shared
 * --color-edge-infra token, with their own filter checkboxes) — so "every
 * canonical value is renderable" holds and the renderer's
 * activeProtocols.has(edge.protocol) gate can never silently drop a canonical
 * protocol. They are preserved verbatim, never folded to "other".
 *
 * @type {Set<string>}
 */
export const CANONICAL_PROTOCOLS = new Set([
  "rest",
  "grpc",
  "events",
  "db",
  "internal",
  "sdk",
  "k8s",
  "tf",
  "helm",
  "import",
  "other",
]);

/**
 * Raw agent token → canonical bucket. Frozen so no layer can mutate the shared
 * vocabulary at runtime.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PROTOCOL_ALIASES = Object.freeze({
  // pub/sub + streaming → events
  kafka: "events",
  rabbitmq: "events",
  nats: "events",
  sqs: "events",
  pubsub: "events",
  sse: "events",
  // datastores → db
  postgres: "db",
  postgresql: "db",
  mysql: "db",
  mongodb: "db",
  redis: "db", // redis buckets to db: its dominant use in scanned repos is a datastore dependency
  sql: "db",
  // request/response over HTTP → rest
  graphql: "rest",
  http: "rest",
});

/**
 * Normalize a raw protocol token to its canonical bucket.
 *
 * Coerces non-string / null / undefined input to "" then lowercases + trims.
 * If the normalized token is already a canonical bucket (other than "other"),
 * it passes through unchanged; if it is a known alias, the alias target is
 * returned; otherwise it falls back to "other". Never throws.
 *
 * @param {unknown} raw - The agent-emitted protocol token (any type).
 * @returns {string} A canonical bucket from CANONICAL_PROTOCOLS.
 */
export function canonicalProtocol(raw) {
  const token = (typeof raw === "string" ? raw : "").toLowerCase().trim();
  if (token !== "other" && CANONICAL_PROTOCOLS.has(token)) {
    return token;
  }
  if (Object.prototype.hasOwnProperty.call(PROTOCOL_ALIASES, token)) {
    return PROTOCOL_ALIASES[token];
  }
  return "other";
}
