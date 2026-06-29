# Phase 141: ScanService Unification — Research

**Researched:** 2026-06-29
**Domain:** Scan orchestration, transport adapter unification, incremental scan semantics
**Confidence:** HIGH — all findings verified against direct source reads

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPE-01 | `/arcanon:map`, `/arcanon:rescan`, MCP `impact_scan`, HTTP scan all invoke the SAME ScanService pipeline; commands/transports are thin adapters with no duplicated persistence/reconciliation | §Q1 (three-path map), §Q2 (ScanService shape), §Q8 (command path crux) |
| PIPE-02 | MCP `impact_scan` returns actual HTTP/pipeline failure (honors `response.ok`) instead of false `triggered` success | §Q3 (exact code location + fix) |
| PIPE-03 | Pending corrections applied exactly once on next successful map or rescan — `/arcanon:map` applies them, `/arcanon:rescan` no longer throws on overrides | §Q4 (exact bug locations + fix via scan-service.js) |
| PIPE-04 | Incremental scans preserve unchanged findings and correctly remove findings owned by deleted/renamed files | §Q5 (full analysis + fix strategy) |
| CTR-05 | E2E tests exercise each transport (command, MCP, HTTP) against the real pipeline | §Q6 (test architecture) |
</phase_requirements>

---

## Summary

Phase 141 is an orchestration-unification phase. The persistence/reconciliation write path (beginScan → validate → persistFindings → applyPendingOverrides → endScan) is currently duplicated — with bugs — in four places: `map.md` Step 5, `rescan.md` Step 5, HTTP `/scan` route, and `manager.js` Phase B. None of these duplicates will have Phase 138's transaction wrapping or Phase 139's child reconciliation until they all route through a shared module.

The canonical fix is a thin `scan-service.js` module at `plugins/arcanon/worker/scan/scan-service.js` that exports `persistScanResult()`. This function owns the entire write pipeline and can be imported by any of the four transports via `node --input-type=module -e` inline scripts (for commands) or direct import (for server paths). The agent-running step stays in each transport's own domain — commands use Claude's `Agent()` API; the HTTP worker doesn't run agents; MCP fires HTTP.

Four bugs addressed: (1) `queryScan()` ignores `response.ok` → always returns `triggered` even on 400 (PIPE-02); (2) `map.md` never calls `applyPendingOverrides` (PIPE-03); (3) `rescan.md` calls `applyPendingOverrides(scanVersionId, qe)` with only 2 args — missing `slog` — which throws `TypeError: slog is not a function` (PIPE-03); (4) incremental scans constrain the agent to changed files only but `endScan` deletes ALL unstamped rows including unchanged files' findings (PIPE-04).

**Primary recommendation:** Create `scan-service.js` with `persistScanResult()` that wraps the Phase 138 transaction, calls `applyPendingOverridesSync` with a safe no-op fallback logger, includes PIPE-04's incremental re-stamp logic, and accepts optional Phase 140 validation. Update map.md, rescan.md, HTTP `/scan`, and manager.js Phase B to call it. Fix `queryScan()` to check `response.ok`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agent-running (discovery + deep scan) | Claude command context (Agent() API) | manager.js (test-only injected runner) | Agent() is only available in Claude's markdown context; Node.js worker processes cannot invoke Claude agents |
| Persistence/reconciliation write pipeline | `scan-service.js` (new) | — | The unification target; called by all four transports |
| Transport dispatch: commands | map.md / rescan.md inline-node persistence step | — | Imports scan-service.js in the `node --input-type=module -e` block |
| Transport dispatch: HTTP | HTTP `/scan` route in `server/http.js` | — | Calls persistScanResult() instead of direct beginScan/endScan |
| Transport dispatch: MCP | MCP `impact_scan` tool in `mcp/server.js` → `queryScan()` | HTTP `/scan` route | MCP fires HTTP; HTTP route is the server-side adapter |
| Transaction boundary | Phase 138's `db.transaction(fn)` inside scan-service.js | sqlite-adapter.js | Phase 138 established the pattern; Phase 141 moves it into scan-service.js |
| Contract validation | Phase 140 findings validator | scan-service.js (calls validator) | Phase 141 calls the validator; does not define it |
| Snapshot + child reconciliation | Phase 139 (inside persistFindings + post-bracket in manager.js) | scan-service.js post-bracket | Phase 141 ensures snapshot call is reached via unified path |

---

## Standard Stack

This phase adds no new npm packages. All primitives are in the existing codebase.

### Core Files Being Modified or Created

| File | Role in Phase 141 |
|------|-------------------|
| `plugins/arcanon/worker/scan/scan-service.js` | NEW — `persistScanResult()` + incremental re-stamp |
| `plugins/arcanon/worker/scan/overrides.js` | Already changed by Phase 138 — `applyPendingOverridesSync` export |
| `plugins/arcanon/worker/scan/manager.js` | Phase B loop: replace 3-call block with `persistScanResult()` |
| `plugins/arcanon/commands/map.md` | Step 5: replace inline `beginScan/persistFindings/endScan` with `persistScanResult()` |
| `plugins/arcanon/commands/rescan.md` | Step 5: replace broken `applyPendingOverrides(scanVersionId, qe)` with `persistScanResult()` |
| `plugins/arcanon/worker/server/http.js` | `/scan` route: call `persistScanResult()` instead of direct calls |
| `plugins/arcanon/worker/mcp/server.js` | `queryScan()`: add `response.ok` check + fix body key |

---

## Package Legitimacy Audit

No external packages installed by this phase.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent-Running Layer (stays per-transport — cannot be unified)              │
│                                                                             │
│  map.md / rescan.md:  Agent(discovery prompt) → Agent(deep scan prompt)    │
│  ↓                                                                          │
│  JSON findings in Claude context                                            │
│  ↓ (write to temp file)                                                     │
│  node --input-type=module -e "import { persistScanResult } ..."            │
│                                                                             │
│  HTTP /scan route:   POST {repo_path, findings} (pre-parsed by caller)     │
│                                                                             │
│  MCP impact_scan:    queryScan() → POST /scan → HTTP /scan route           │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │ all four paths converge here
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  scan-service.js — persistScanResult(repoId, findings, commit, opts, qe)   │
│                                                                             │
│  1. Phase 140 contract validation (if validateFindings is available)        │
│  2. db.transaction(() => {          ← Phase 138 transaction wrapper        │
│       beginScan(repoId)                                                     │
│       [incremental only] re-stamp existing rows with new scan_version_id   │
│       persistFindings(repoId, findings, commit, scanVersionId)              │
│         ├ upsertService × N                                                 │
│         ├ upsertConnection × N                                              │
│         ├ [Phase 139] DELETE actor_connections WHERE service_id IN (repo)   │
│         ├ INSERT actor_connections × N                                      │
│         ├ [Phase 139] DELETE exposed_endpoints WHERE service_id IN (repo)   │
│         └ INSERT exposed_endpoints × N                                      │
│       applyPendingOverridesSync(scanVersionId, qe, safeSlog)               │
│       endScan(repoId, scanVersionId) ← completed_at last (Phase 138 fix)   │
│     })()                                                                    │
│  3. [incremental only] DELETE services WHERE source_file IN (deleted)      │
│  4. Returns { repoId, scanVersionId }                                       │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      ▼
        Post-bracket (orchestrating layer — per transport):
        ├ runEnrichmentPass()         (manager.js / future command step)
        ├ collectDependencies()       (manager.js)
        ├ runActorLabeling()          (manager.js)
        └ createSnapshot()            (Phase 139 — manager.js post Phase B)
```

### Recommended Project Structure

No new directories. Changes are within existing files plus one new file:

```
plugins/arcanon/worker/
├── scan/
│   ├── scan-service.js    ← NEW: persistScanResult() + incremental semantics
│   ├── manager.js         ← Phase B loop: call persistScanResult()
│   └── overrides.js       ← Phase 138 adds applyPendingOverridesSync (already planned)
├── server/
│   └── http.js            ← /scan route: call persistScanResult()
└── mcp/
    └── server.js          ← queryScan(): response.ok check + body fix
plugins/arcanon/commands/
├── map.md                 ← Step 5: import + call persistScanResult()
└── rescan.md              ← Step 5: replace broken override call
```

---

## Q1: The Three Current Scan Paths — Precise Map

[VERIFIED: map.md, rescan.md, manager.js, mcp/server.js, server/http.js — direct source reads]

### Path A: Claude Command (map.md / rescan.md)

These are markdown-orchestrated commands. Agent-running happens inside Claude's own context via `Agent()`. Persistence happens in a **separate `node --input-type=module -e` subprocess**.

**map.md Step 5 persistence block** (`map.md:306-366`):

```javascript
// Inline node subprocess (not in the same process as Claude's Agent() orchestration)
import { openDb } from '${CLAUDE_PLUGIN_ROOT}/worker/db/database.js';
import { QueryEngine } from '${CLAUDE_PLUGIN_ROOT}/worker/db/query-engine.js';
const db = openDb('${PROJECT_ROOT}');
const qe = new QueryEngine(db);
const repoId = qe.upsertRepo({ ... });
const scanVersionId = qe.beginScan(repoId);
qe.persistFindings(repoId, findings, findings.commit || null, scanVersionId);
// *** NO applyPendingOverrides call ***        ← PIPE-03 BUG #1
qe.endScan(repoId, scanVersionId);
// ... quality breakdown, enrichment_log audit ...
```

Characteristics:
- Uses `openDb()` directly (not the Phase 137 pool)
- Runs per-repo in a loop; `endScan` is called per repo
- **No `applyPendingOverrides`** — corrections are NEVER applied on map.md runs
- No transaction wrapper (Phase 138 fix not applied here)
- No snapshot (Phase 139 fix not applied here)

**rescan.md Step 5 persistence block** (`rescan.md:247-304`):

```javascript
import { openDb } from '${CLAUDE_PLUGIN_ROOT}/worker/db/database.js';
import { QueryEngine } from '${CLAUDE_PLUGIN_ROOT}/worker/db/query-engine.js';
import { applyPendingOverrides } from '${CLAUDE_PLUGIN_ROOT}/worker/scan/overrides.js';
const qe = new QueryEngine(db);
const repoId = qe.upsertRepo({ ... });
const scanVersionId = qe.beginScan(repoId);
qe.persistFindings(repoId, findings, findings.commit || null, scanVersionId);
await applyPendingOverrides(scanVersionId, qe);   // ← PIPE-03 BUG #2: missing 3rd arg
qe.endScan(repoId, scanVersionId);
```

The `applyPendingOverrides(scanVersionId, qe)` call at `rescan.md:262` passes only 2 arguments. The function signature is `(scanVersionId, queryEngine, slog)`. Inside the function body, `slog` is `undefined`. Line 64 immediately calls `slog('INFO', ...)` → `TypeError: slog is not a function`. **This always throws regardless of whether any overrides are pending**, because both the pre-guard path and the main path call `slog` before returning. The node subprocess exits code 1, rescan.md fails.

**Why commands can't import a "scan pipeline including agent-running":**
The `Agent()` API exists only in Claude's main markdown orchestration context. You cannot call it from inside a `node --input-type=module -e` subprocess. So `manager.js`'s `scanRepos()` (which needs `agentRunner` injected) can NEVER be the write path for commands. The commands' persistence step is always a separate inline-node subprocess that receives already-parsed findings (written to a temp file) and only does the write side.

**BUT the commands CAN import a pure write module** (`scan-service.js`) because it's a stateless function that only needs a QueryEngine handle. This is the same pattern as `openDb()` and `QueryEngine` already being imported today.

### Path B: manager.js `scanRepos()` + `setAgentRunner()`

[VERIFIED: manager.js:282-291, 600-919]

`scanRepos()` at `manager.js:600` is the most complete implementation. It has:
- Phase A: parallel agent invocations via `Promise.allSettled` (lines 771-784)
- Phase B: sequential DB writes (lines 794-919) — `persistFindings` + `applyPendingOverrides` + `endScan`
- Post-bracket: enrichment, dep-collection, actor labeling, hub sync

The `agentRunner` module-global variable at `manager.js:282` is set via `setAgentRunner(fn)` at `manager.js:290`.

**Critical finding:** A comprehensive grep of all non-test production code confirms **zero callers of `setAgentRunner()` or `scanRepos()` in production**. Only test files (`manager.test.js`) call `setAgentRunner`. The v0.1.4 milestone notes confirm this was intentional: at release prep, the rescan command was re-shaped from worker-HTTP to markdown-orchestrated, "eliminating the production agent-runner gap." The manager path is therefore **test-only infrastructure**. It is the best-structured scan path but is not wired to anything that can run in production.

**Current Phase B write sequence** (`manager.js:802-813`) — BEFORE Phase 138:

```javascript
// Step 10 — no transaction, three separate top-level writes
queryEngine.persistFindings(r.repoId, r.findings, r.currentHead, r.scanVersionId);  // line 803
await applyPendingOverrides(r.scanVersionId, queryEngine, slog);                      // line 810
queryEngine.endScan(r.repoId, r.scanVersionId);                                       // line 812
```

After Phase 138 lands: this block gets wrapped in `db.transaction(fn)()` and `beginScan` moves inside the transaction. Phase 141 moves this block into `scan-service.js` so all transports share it.

### Path C: MCP `impact_scan` + HTTP `/scan`

[VERIFIED: mcp/server.js:1451-1476, mcp/server.js:1201-1269, server/http.js:627-664]

**MCP `impact_scan`** (`mcp/server.js:1451`) calls `queryScan(params)` which:

1. Reads `worker.port` file to find the HTTP server port
2. Checks readiness via `GET /api/readiness`
3. POSTs to `/scan` with body:
   ```javascript
   JSON.stringify({ repo, full })  // mcp/server.js:1255-1256
   ```
4. **Does NOT await the response.ok check** — the fetch result is discarded:
   ```javascript
   await fetch(`http://localhost:${port}/scan`, { ... });
   return { status: "triggered", message: "..." };  // always returns triggered
   ```

**HTTP `/scan` route** (`server/http.js:627-664`):

```javascript
fastify.post("/scan", async (request, reply) => {
  const { repo_path, repo_name, repo_type, findings, commit, project } = request.body || {};
  if (!repo_path || !findings) {
    return reply.code(400).send({ error: "Missing repo_path or findings in request body" });
  }
  // ...
  qe.persistFindings(repoId, findings, commit || null, scanVersionId);
  qe.endScan(repoId, scanVersionId);
  return reply.code(200).send({ status: "persisted", repo_id: repoId });
});
```

**The contract mismatch (PIPE-01 source):**
- MCP sends: `{ repo: "/abs/path", full: false }` — a TRIGGER request
- HTTP expects: `{ repo_path: "/abs/path", findings: { services: [...], connections: [...] } }` — a FINDINGS dump
- Result: HTTP always returns 400 "Missing repo_path or findings" to the MCP POST
- `queryScan` ignores the response status → always returns `{ status: "triggered" }`

**Additional bugs in HTTP `/scan`:**
- No `applyPendingOverrides` call (PIPE-03 bug, same as map.md)
- No transaction wrapper (Phase 138 fix not applied)
- `beginScan` called BEFORE `persistFindings` but OUTSIDE a transaction

---

## Q2: The Cleanest "One ScanService" Shape for This Codebase

[VERIFIED: overrides.js, manager.js, map.md, rescan.md, http.js — direct source reads]

### What scan-service.js Owns

The unification boundary is: **everything AFTER the agent produces findings JSON, BEFORE post-bracket enrichment**. This is the write pipeline that is currently duplicated in 4 places.

**`plugins/arcanon/worker/scan/scan-service.js`**:

```javascript
import { applyPendingOverridesSync } from './overrides.js';  // Phase 138 export

/**
 * Persist one repo's scan findings through the full write pipeline.
 * Wraps beginScan→persistFindings→applyPendingOverridesSync→endScan in one
 * Phase-138 db.transaction() call. Returns scanVersionId after commit.
 *
 * @param {number}  repoId        - Pre-resolved repo row id (from qe.upsertRepo)
 * @param {string}  repoPath      - Absolute path (for incremental delete predicate)
 * @param {object}  findings      - Parsed agent findings { services, connections, ... }
 * @param {string|null} commit    - Git HEAD at scan time
 * @param {object}  opts          - { mode?: 'full'|'incremental', changedFiles?: object,
 *                                   validateFindings?: Function }
 * @param {object}  queryEngine   - QueryEngine instance (already has _db)
 * @param {Function} [slog]       - Optional structured logger (default: no-op)
 * @returns {{ scanVersionId: number }}
 */
export function persistScanResult(repoId, repoPath, findings, commit, opts, queryEngine, slog) {
  const safeSlog = typeof slog === 'function' ? slog : () => {};

  // Phase 140 validation — if validator is provided (may not be available in
  // command context where older QE may lack the validator)
  if (typeof opts.validateFindings === 'function') {
    opts.validateFindings(findings);
  }

  const writeTx = queryEngine._db.transaction(() => {
    // Phase 138: beginScan inside tx → ROLLBACK removes scan_versions row on failure
    const startedAt = opts.startedAt || new Date().toISOString();
    const scanVersionId = queryEngine.beginScan(repoId, startedAt);

    // PIPE-04: for incremental scans, re-stamp ALL existing rows with new scan_version_id
    // before persistFindings overwrites the changed subset. This prevents endScan from
    // deleting unchanged files' findings.
    if (opts.mode === 'incremental') {
      _restampExistingRows(queryEngine._db, repoId, scanVersionId);
    }

    // Phase 138/139: persistFindings includes pre-wipe DELETEs for exposed_endpoints
    // and actor_connections (Phase 139 changes to persistFindings)
    queryEngine.persistFindings(repoId, findings, commit, scanVersionId);

    // PIPE-03: always call with a safe slog — no TypeError from undefined
    applyPendingOverridesSync(scanVersionId, queryEngine, safeSlog);

    // Phase 138: endScan has completed_at as LAST step (ISO-04 fix)
    queryEngine.endScan(repoId, scanVersionId);

    return scanVersionId;
  });

  const scanVersionId = writeTx();

  // PIPE-04 incremental: after transaction commits, delete findings from deleted/renamed files.
  // Must run AFTER commit (not inside transaction) because it uses file-path predicates
  // that don't interact with scan_version_id stamping.
  if (opts.mode === 'incremental' && opts.changedFiles) {
    _deleteDeletedFileFindings(queryEngine._db, repoId, opts.changedFiles, safeSlog);
  }

  return { scanVersionId };
}
```

### What the Four Transports Become

**map.md Step 5** — replaces the inline-node block:
```javascript
// Import scan-service.js in the node --input-type=module -e block
import { persistScanResult } from '${CLAUDE_PLUGIN_ROOT}/worker/scan/scan-service.js';
// ... openDb, QueryEngine as before ...
const repoId = qe.upsertRepo({ path: findings.repo_path, name: findings.repo_name, type: 'single' });
const { scanVersionId } = persistScanResult(repoId, findings.repo_path, findings, findings.commit || null,
  { mode: 'full' }, qe);
```
map.md now gets `applyPendingOverridesSync` automatically — PIPE-03 fixed.

**rescan.md Step 5** — replaces the broken block:
```javascript
import { persistScanResult } from '${CLAUDE_PLUGIN_ROOT}/worker/scan/scan-service.js';
// ... same as map.md but single-repo ...
const { scanVersionId } = persistScanResult(repoId, repoPath, findings, findings.commit || null,
  { mode: 'full' }, qe);
```
The `TypeError: slog is not a function` is gone because `persistScanResult` always passes `safeSlog`.

**HTTP `/scan` route** — minimal delta:
```javascript
fastify.post("/scan", async (request, reply) => {
  const { repo_path, repo_name, repo_type, findings, commit, project } = request.body || {};
  // ... validation unchanged ...
  const repoId = qe.upsertRepo({ path: repo_path, name: repo_name, type: repo_type || 'single' });
  const { scanVersionId } = persistScanResult(repoId, repo_path, findings, commit || null,
    { mode: 'full' }, qe, httpLog.bind(null, 'INFO'));
  return reply.code(200).send({ status: "persisted", repo_id: repoId, scan_version_id: scanVersionId });
});
```

**manager.js Phase B** — replaces the 3-call block at lines 802-812:
```javascript
// Phase 141: delegate to scan-service.js (which wraps Phase 138's db.transaction)
const { scanVersionId } = persistScanResult(
  r.repoId, r.repoPath, r.findings, r.currentHead,
  { mode: r.mode, changedFiles: r.changedFiles, startedAt: r.scanStartedAt },
  queryEngine, slog,
);
```
Note: `r.changedFiles` requires threading `ctx.files` into the Phase A result object (see §Q5).

### Where the Host-Agent Adapter Plugs In

The agent runner (how to invoke Claude) is NOT part of `scan-service.js`. Each transport handles it separately:

| Transport | Agent-runner mechanism | How findings reach persistScanResult |
|-----------|----------------------|--------------------------------------|
| map.md | `Agent()` call in Claude markdown | Written to temp file → `node -e` reads it |
| rescan.md | `Agent()` call in Claude markdown | Same temp-file pattern |
| HTTP /scan | Not applicable — caller sends findings | Request body `findings` field |
| MCP impact_scan | Not applicable — fires HTTP POST | HTTP `/scan` route handles it |
| manager.js | `agentRunner` injection (test-only) | Phase A result object `r.findings` |

Phase 141 does NOT wire the production `agentRunner` for manager.js — that path remains test-only. The production paths are the command path and HTTP/MCP path.

---

## Q3: PIPE-02 — The Exact impact_scan False-Success Fix

[VERIFIED: mcp/server.js:1201-1269 — direct source read]

### The Bug (mcp/server.js:1250-1263)

```javascript
// CURRENT — line 1252-1260:
try {
  await fetch(`http://localhost:${port}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, full }),   // ← body key "repo", HTTP expects "repo_path"
  });
  return {
    status: "triggered",                   // ← always returned; response never checked
    message: "Scan started. ...",
  };
} catch (err) {
  ...
}
```

The `fetch()` is awaited but the response object is discarded. The HTTP route returns `400 { error: "Missing repo_path or findings" }`, but `queryScan` never reads it.

### The Fix

```javascript
// FIXED — check response.ok and read error body:
let scanRes;
try {
  scanRes = await fetch(`http://localhost:${port}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_path: repo, full }),  // fix key: repo → repo_path
  });
} catch (err) {
  logger.error('queryScan fetch failed', { error: err.message, stack: err.stack });
  return { status: "error", message: err.message };
}
if (!scanRes.ok) {
  let errBody = {};
  try { errBody = await scanRes.json(); } catch { /* body may not be JSON */ }
  const msg = errBody.error || `HTTP ${scanRes.status} from scan endpoint`;
  logger.warn('queryScan: scan endpoint returned error', { status: scanRes.status, error: msg });
  return { status: "error", message: msg };
}
const body = await scanRes.json().catch(() => ({}));
return {
  status: body.status || "triggered",
  message: body.message || "Scan persisted.",
};
```

**Note on the body fix:** changing `repo` → `repo_path` in the body still sends no `findings`, so the HTTP route still returns 400 unless findings are included. The HTTP `/scan` route is a "receive pre-parsed findings" endpoint — it cannot trigger an agent. After Phase 141, `impact_scan` with no findings will return `{ status: "error", message: "Missing repo_path or findings" }` — an honest error instead of a false `triggered`. This is the correct behavior for the current architecture: `impact_scan` tells the user the scan endpoint requires findings to be provided.

If a future phase wants `impact_scan` to trigger an agent scan without pre-parsed findings, that requires a new HTTP endpoint or IPC mechanism (out of Phase 141 scope).

---

## Q4: PIPE-03 — Applying Pending Corrections Exactly Once

[VERIFIED: map.md:313-317, rescan.md:262, manager.js:810, overrides.js:56-68]

### Two Bugs, One Root Cause

**Bug 1 — map.md never calls applyPendingOverrides** (`map.md:313-317`):
The inline node block goes directly `beginScan → persistFindings → endScan`. No override call anywhere. Pending `scan_overrides` are silently skipped on every `/arcanon:map` run.

**Bug 2 — rescan.md throws on override call** (`rescan.md:262`):
```javascript
await applyPendingOverrides(scanVersionId, qe);  // ← 2 args, slog is 3rd required arg
```
Inside `applyPendingOverrides`, `slog` is `undefined`. The function's first code path (guard check, lines 62-68) calls `slog('INFO', 'overrides apply BEGIN', { count: 0 })` regardless of whether overrides are configured. This throws `TypeError: slog is not a function` in every rescan.md invocation. The node subprocess exits 1, rescan.md fails at Step 5.

**Root cause:** the call sites must pass a valid logger function. Today each call site rolls its own slog; the inconsistency is inevitable across 4 duplicates.

### The Fix in scan-service.js

`persistScanResult()` always passes `safeSlog`:
```javascript
const safeSlog = typeof slog === 'function' ? slog : () => {};
// ...inside transaction:
applyPendingOverridesSync(scanVersionId, queryEngine, safeSlog);
```

After Phase 138, `applyPendingOverridesSync` is a named export from `overrides.js` with the same body as `applyPendingOverrides` but synchronous — safe to call inside `db.transaction(fn)`. Phase 141 uses it.

For the command paths (inline-node subprocess): `persistScanResult()` is called without a logger, `safeSlog` becomes `() => {}`. Override mutations still happen (the slog calls are just silenced). If a logger file handle is desired, the inline-node block can construct a simple logger and pass it.

**"Exactly once" guarantee:** The override `applied_in_scan_version_id` stamp (set by `markOverrideApplied` inside `applyPendingOverridesSync`) is inside the Phase 138 transaction. If the transaction rolls back, the stamp is rolled back too — the override remains pending for the next scan. On successful commit, the stamp is permanent. Re-running the scan reads `getPendingOverrides() WHERE applied_in_scan_version_id IS NULL` — already-applied overrides are filtered out. The "exactly once" guarantee is maintained by the transaction atomicity.

---

## Q5: PIPE-04 — Incremental Scan Preserve/Remove Semantics

[VERIFIED: manager.js:380-438, manager.js:667-768, query-engine.js (via 138-RESEARCH.md §Q2)]

### The Current Broken Semantics

**How incremental scans work today in manager.js:**

1. `buildScanContext()` at `manager.js:383` returns `{ mode: 'incremental', files: { modified: [...], deleted: [...], renamed: [...] } }`
2. `scanOneRepo()` appends `buildIncrementalConstraint(ctx.files.modified)` to the prompt — listing only changed files. The agent is told not to examine unchanged files.
3. `agentRunner` returns findings for ONLY the changed files (by prompt constraint)
4. Phase B: `beginScan(repoId)` creates new `scan_version_id = N`
5. `persistFindings()` upserts services/connections from the partial findings — only changed-file services get stamped with `scan_version_id = N`
6. `endScan()` executes: `DELETE FROM services WHERE repo_id = ? AND scan_version_id != ?` — this deletes ALL services not stamped with N, including unchanged files' services

**Result:** an incremental scan of repo with 10 services where 2 changed → after the scan, only 2 services remain. The 8 unchanged services are deleted. PIPE-04 violation.

**For deleted/renamed files:** `ctx.files.deleted` and `ctx.files.renamed` are available in Phase A but NOT threaded into Phase B (the result object at `manager.js:757-765` only carries `repoPath, mode, findings, repoId, scanVersionId, currentHead`). There's no mechanism to explicitly remove findings from deleted files' paths; they'd be caught by the `scan_version_id` cleanup only if the full re-stamp approach is used.

### The Fix Strategy

**Step 1: Thread `changedFiles` into Phase B**

In `scanOneRepo()` return statement (`manager.js:757-765`), add:
```javascript
return {
  repoPath, mode: ctx.mode, findings: result.findings,
  repoId, scanVersionId, currentHead: getCurrentHead(repoPath),
  changedFiles: ctx.files,    // ← NEW: { modified, deleted, renamed }
  scanStartedAt,              // ← Phase 138: pre-captured timestamp
  _writeDb: true,
};
```

**Step 2: Re-stamp existing rows inside the transaction (preserve unchanged)**

Inside `persistScanResult()`, before `persistFindings()`, for incremental mode:

```javascript
function _restampExistingRows(db, repoId, newScanVersionId) {
  // Find the latest completed scan version for this repo (the one to re-stamp FROM)
  const prevRow = db.prepare(
    `SELECT id FROM scan_versions WHERE repo_id = ? AND completed_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`
  ).get(repoId);
  if (!prevRow) return; // First scan — nothing to re-stamp

  const prevSvId = prevRow.id;

  // Re-stamp services: unchanged files' services keep their data; only their
  // scan_version_id is updated so endScan doesn't delete them
  db.prepare(
    `UPDATE services SET scan_version_id = ? WHERE repo_id = ? AND scan_version_id = ?`
  ).run(newScanVersionId, repoId, prevSvId);

  // Re-stamp connections: connections whose source_service was just re-stamped
  // (connection rows also have scan_version_id; they must be re-stamped too)
  db.prepare(
    `UPDATE connections SET scan_version_id = ?
     WHERE source_service_id IN (SELECT id FROM services WHERE repo_id = ?)
       AND scan_version_id = ?`
  ).run(newScanVersionId, repoId, prevSvId);
}
```

After this, `persistFindings()` runs and upserts the changed files' data with the new scan_version_id (overwriting the re-stamped values for changed services). `endScan()` then only deletes rows with `scan_version_id != N` — there are none, because all rows are now N. No unchanged service is deleted.

**Step 3: Explicitly delete findings from deleted/renamed files (outside transaction)**

After `writeTx()` commits, for incremental scans with deleted/renamed files:

```javascript
function _deleteDeletedFileFindings(db, repoId, changedFiles, slog) {
  const deletedPaths = [
    ...(changedFiles.deleted || []),
    ...(changedFiles.renamed || []).map(r => r.from),
  ];
  if (deletedPaths.length === 0) return;

  // Delete services whose source_file is one of the deleted/renamed paths.
  // ON DELETE CASCADE removes their connections, actor_connections, etc.
  // source_file is the relative path within the repo as recorded by the agent.
  for (const filePath of deletedPaths) {
    const result = db.prepare(
      `DELETE FROM services WHERE repo_id = ? AND source_file = ?`
    ).run(repoId, filePath);
    if (result.changes > 0) {
      slog('INFO', 'incremental: removed service from deleted file', { filePath, changes: result.changes });
    }
  }
}
```

**Why outside the transaction:** The transaction must commit before we can safely delete file-path-based rows, because the re-stamp inside the transaction sets all rows to the new scan_version_id. Deleting by file path after the commit is a separate targeted cleanup that only removes findings provably owned by removed source files.

**The subtle edge case: services with no `source_file`**

Some services may have `source_file = NULL` (e.g., external actors, or agents that didn't emit one). These cannot be matched to deleted files. They are preserved by the re-stamp. This is intentional: the incremental scan only removes what it can provably attribute to deleted files. Null-source_file services are untouched.

**For command paths (map.md/rescan.md):** The command paths always run full scans (the WHOLE repo is given to the agent, no per-file constraint). `mode` is never `'incremental'` for command-path calls to `persistScanResult()`. PIPE-04 does not apply to command paths.

**For rescan.md specifically:** rescan.md documentation explicitly states "Always full mode — incremental skip is bypassed." The rescan command scans the whole repo; `mode: 'full'` is always passed. PIPE-04 only applies to manager.js's incremental mode.

---

## Q6: CTR-05 — E2E Tests for Each Transport Against the Real Pipeline

[VERIFIED: existing test patterns in manager.test.js, http.test.js, mcp/server.test.js]

### Design Principle

"Real pipeline" means: real `DatabaseSync` (node:sqlite), real `QueryEngine`, real `persistScanResult()` (including transaction). The agent output is a fixture (hard-coded valid JSON). No mocked QueryEngine, no mocked DB.

### Test Architecture

**File:** `plugins/arcanon/worker/scan/scan-service.e2e.test.js`

```javascript
// Shared fixture: valid findings JSON produced by the agent
const FIXTURE_FINDINGS = {
  services: [{ name: 'svc-a', type: 'service', language: 'node', root_path: 'src/', source_file: 'src/index.js' }],
  connections: [{ source: 'svc-a', target: 'svc-b', protocol: 'REST', method: 'GET', path: '/health', crossing: 'external' }],
};

// Transport 1: Command path (scan-service.js directly — simulates map.md / rescan.md inline-node)
test('command transport: persistScanResult writes services and connections', () => {
  const db = openDb(tmpProjectRoot);
  const qe = new QueryEngine(db);
  const repoId = qe.upsertRepo({ path: tmpProjectRoot, name: 'test', type: 'service' });
  
  const { scanVersionId } = persistScanResult(repoId, tmpProjectRoot, FIXTURE_FINDINGS, 'abc', { mode: 'full' }, qe);
  
  const services = db.prepare('SELECT * FROM services WHERE repo_id = ?').all(repoId);
  assert.equal(services.length, 1, 'one service written');
  const version = db.prepare('SELECT * FROM scan_versions WHERE id = ?').get(scanVersionId);
  assert.ok(version.completed_at, 'completed_at is set');
  db.close();
});

// Transport 2: HTTP /scan route
test('HTTP transport: POST /scan calls the real pipeline', async () => {
  // Set up the Fastify server with a real in-memory DB
  const { app, qe } = await buildTestServer();
  const res = await app.inject({
    method: 'POST', url: '/scan',
    payload: { repo_path: '/tmp/test-repo', findings: FIXTURE_FINDINGS, commit: 'abc' },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'persisted');
  // Verify DB state
  const services = qe._db.prepare('SELECT * FROM services').all();
  assert.equal(services.length, 1);
});

// Transport 3: MCP impact_scan → queryScan → HTTP /scan
test('MCP transport: queryScan honors response.ok on 400', async () => {
  // Start HTTP server on an ephemeral port with no findings pre-configured
  // queryScan sends {repo_path, full} with no findings → 400
  const result = await queryScan({ repo: '/tmp/nonexistent', full: false });
  // After PIPE-02 fix: result.status should be "error" not "triggered"
  assert.equal(result.status, 'error');
  assert.ok(result.message.includes('Missing'));
});

// Transport 4: PIPE-03 — applyPendingOverrides fires via scan-service (both map and rescan paths)
test('PIPE-03: persistScanResult applies pending overrides without slog argument', () => {
  const db = openDb(tmpProjectRoot);
  const qe = new QueryEngine(db);
  // Insert a pending override
  db.prepare(`INSERT INTO scan_overrides (kind, action, target_id, payload)
              VALUES ('connection', 'delete', ?, '{}')`).run(99);
  const repoId = qe.upsertRepo({ ... });
  // Call WITHOUT slog — must not throw
  assert.doesNotThrow(() => {
    persistScanResult(repoId, tmpProjectRoot, FIXTURE_FINDINGS, null, { mode: 'full' }, qe);
    // no slog passed; uses () => {} fallback
  });
  db.close();
});

// Transport 5: PIPE-04 incremental — unchanged findings preserved
test('PIPE-04: incremental scan preserves unchanged services', () => {
  const db = openDb(tmpProjectRoot);
  const qe = new QueryEngine(db);
  const repoId = qe.upsertRepo({ ... });
  
  // Full scan: 3 services
  persistScanResult(repoId, tmpProjectRoot, THREE_SERVICE_FINDINGS, 'sha1', { mode: 'full' }, qe);
  
  // Incremental scan: only service-b changed; agent only returns service-b
  const incrementalFindings = { services: [serviceB_updated], connections: [] };
  persistScanResult(repoId, tmpProjectRoot, incrementalFindings, 'sha2', {
    mode: 'incremental',
    changedFiles: { modified: ['src/service-b.js'], deleted: [], renamed: [] },
  }, qe);
  
  const services = qe._db.prepare('SELECT name FROM services WHERE repo_id = ?').all(repoId);
  assert.equal(services.length, 3, 'all 3 services preserved');  // not just 1
  db.close();
});
```

### Test File Map

| Transport | Test File | Covers |
|-----------|-----------|--------|
| Command path (direct scan-service import) | `scan/scan-service.e2e.test.js` | PIPE-01, PIPE-03, PIPE-04 |
| HTTP /scan route | `server/http.test.js` (extend existing) | PIPE-01, PIPE-03 |
| MCP impact_scan queryScan | `mcp/server.test.js` (extend existing) | PIPE-02 |
| manager.js Phase B (via setAgentRunner mock) | `scan/manager.test.js` (extend existing) | PIPE-01, PIPE-04 |

The key constraint for CTR-05: tests must use a **real database**, not a mock. Existing `http.test.js` and `mcp/server.test.js` already use real DBs. `scan-service.e2e.test.js` is new.

---

## Q7: Boundary — What Phase 141 Owns vs. What It Consumes

[VERIFIED: REQUIREMENTS.md, 138-RESEARCH.md, 139-RESEARCH.md]

### In Scope (Phase 141 does this work)

| Work Item | File(s) |
|-----------|---------|
| Create `scan-service.js` with `persistScanResult()` | NEW file |
| PIPE-04: `_restampExistingRows` + `_deleteDeletedFileFindings` helpers | Inside scan-service.js |
| Update map.md Step 5 to call `persistScanResult()` | map.md |
| Update rescan.md Step 5 to call `persistScanResult()` | rescan.md |
| Update HTTP `/scan` route to call `persistScanResult()` | server/http.js |
| Update manager.js Phase B to call `persistScanResult()` + thread `changedFiles` | manager.js |
| Fix `queryScan()` response.ok check + body key | mcp/server.js |
| CTR-05 E2E tests | scan-service.e2e.test.js + extensions |

### Out of Scope (Phase 141 consumes, does not define)

| Phase | What Phase 141 Consumes |
|-------|-------------------------|
| Phase 138 | `db.transaction(fn)()` pattern from sqlite-adapter.js; `applyPendingOverridesSync` export from overrides.js; `beginScan(repoId, startedAt)` signature with optional timestamp |
| Phase 139 | `createSnapshot()` call after Phase B (in manager.js post-bracket — Phase 141 ensures all repos go through `persistScanResult()` before the snapshot fires); child table pre-wipes inside `persistFindings` |
| Phase 140 | `validateFindings()` contract validator — Phase 141 calls it as `opts.validateFindings` if provided; does not define the validator |

**Phase 141 does NOT:**
- Change the transaction implementation (Phase 138 owns that)
- Change `persistFindings` or `endScan` internals (Phase 138/139 own those)
- Define the canonical contract schema (Phase 140 owns that)
- Change the history/snapshot model (Phase 139 owns that)
- Add new detection capabilities

---

## Q8: The Command-Path Crux — How scan-service.js Reaches map.md and rescan.md

[VERIFIED: map.md:306-366, rescan.md:247-304 — direct source reads]

**The crux:** markdown commands run agents via `Agent()` in Claude's context. They persist via `node --input-type=module -e "..."` subprocess. The subprocess can only reach Node.js code; it cannot call `Agent()`.

**The resolution:** `scan-service.js` is a **pure function module** — it takes a QueryEngine instance, runs synchronous SQLite writes (with the Phase 138 transaction wrapper), and returns a result. It has no dependency on the MCP server, the HTTP server, the pool, or any async infrastructure. This is the same class of module as `openDb()` and `QueryEngine` that the commands already import today.

The inline-node persistence block in map.md today already does:
```javascript
import { openDb } from '.../worker/db/database.js';
import { QueryEngine } from '.../worker/db/query-engine.js';
```

After Phase 141, it becomes:
```javascript
import { openDb } from '.../worker/db/database.js';
import { QueryEngine } from '.../worker/db/query-engine.js';
import { persistScanResult } from '.../worker/scan/scan-service.js';
```

`scan-service.js` imports `applyPendingOverridesSync` from `overrides.js` and calls `queryEngine._db.transaction(fn)()` from the existing sqlite-adapter. Both of these are already available in the inline-node context (same module system, no runtime dependencies).

**The constraint that holds:** Agent-running stays in Claude's markdown orchestration. The ScanService unification is at the write layer only. This is the correct boundary.

**What would NOT work:** Attempting to put the agent-running inside scan-service.js or inside the inline-node subprocess. The `Agent()` API is a Claude Code primitive, not a Node.js API. It cannot be imported or called from a Node.js subprocess.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BEGIN/COMMIT/ROLLBACK in scan-service.js | Custom exec("BEGIN") chain | `queryEngine._db.transaction(fn)` from sqlite-adapter.js:302-339 | Already handles nesting, SAVEPOINT, crash recovery |
| Override apply logic | Duplicate _applyOne | `applyPendingOverridesSync` from overrides.js (Phase 138) | Already tested; the KIND_ACTION_MATRIX is the authority |
| Incremental stale detection | New "dirty" column on services/connections | Re-stamp pattern (set scan_version_id = newId before persistFindings) | Uses existing scan_version_id mechanism; zero schema changes |
| Safe logger fallback | if-slog-then-log throughout | `const safeSlog = typeof slog === 'function' ? slog : () => {};` once at top of persistScanResult | One pattern, zero TypeError risk |
| Deleted-file service cleanup | SQL predicate on scan_version_id for deleted files | `DELETE FROM services WHERE repo_id = ? AND source_file = ?` per deleted path | Direct and explicit; no inference needed |

---

## Common Pitfalls

### Pitfall 1: Calling applyPendingOverridesSync Without a Fallback slog

**What goes wrong:** Any call site that passes `undefined` as `slog` causes `TypeError: slog is not a function` immediately (even the no-op fast path calls `slog` before returning).

**Why it happens:** `applyPendingOverrides` was originally called from manager.js which always has `slog`. When copy-pasted to rescan.md, the `slog` argument was dropped.

**How to avoid:** In `persistScanResult`, always compute `const safeSlog = typeof slog === 'function' ? slog : () => {};` and pass `safeSlog` to `applyPendingOverridesSync`. Never pass `slog` directly.

**Warning signs:** Node process exits with `TypeError: slog is not a function` in rescan.md Step 5.

### Pitfall 2: Incremental Re-stamp Races with beginScan's scan_version_id

**What goes wrong:** The re-stamp (`UPDATE services SET scan_version_id = ?`) targets the PREVIOUS scan's scan_version_id. If a repo has multiple completed scans (pre-138 scenario), `ORDER BY id DESC LIMIT 1` gives the most recent completed one — correct. But if the previous scan is still in progress (incomplete — `completed_at IS NULL`), re-stamping its scan_version_id silently corrupts both scans.

**Why it happens:** The re-stamp logic queries the previous completed scan but doesn't guard against in-progress scans. Phase 138's failure-recovery cleanup (delete abandoned scan_versions older than 5 minutes) mitigates this, but a concurrent scan (prevented by the lock) is the real risk.

**How to avoid:** `_restampExistingRows` queries `WHERE completed_at IS NOT NULL` (already in the proposed SQL). The scan lock (`acquireScanLock`) prevents concurrent scans for the same project. After Phase 138, unfinished scans have no services stamped with their scan_version_id (the transaction rolled back). These two guards together eliminate the race.

### Pitfall 3: map.md Incremental Mode Doesn't Use Per-File Constraint

**What goes wrong:** map.md Step 2 describes incremental as "only scan repos with changes since last scan" — meaning the whole changed repo is scanned, not just individual files. The `buildIncrementalConstraint` per-file logic lives only in manager.js. When map.md calls `persistScanResult(mode='full')` per changed repo, the full scan semantics apply correctly (no re-stamp needed, endScan cleanups work). This is NOT a bug — it's by design.

**Why it matters:** PIPE-04's re-stamp fix is only needed for manager.js's per-file incremental constraint. Do NOT apply the re-stamp logic to map.md's calls (they always pass `mode: 'full'`).

**Warning signs:** Passing `mode: 'incremental'` to `persistScanResult` without `changedFiles` → `_restampExistingRows` runs but no deletion of stale deleted-file findings is possible. Guard: `if (opts.mode === 'incremental' && opts.changedFiles)` for the post-commit deletion step.

### Pitfall 4: openDb() vs Pool After Phase 137

**What goes wrong:** map.md and rescan.md currently call `openDb('${PROJECT_ROOT}')` from `database.js`. After Phase 137 lands (DB isolation pool), `openDb` in database.js may have different semantics or be deprecated. The commands' inline-node scripts use it directly — they bypass the pool entirely.

**Why it matters:** Phase 137 introduces the pool for multi-project isolation. Commands opening via `openDb` directly may get a different handle than what the pool tracks. For single-project commands (map.md runs per-project), this may be acceptable, but schema migrations must have already run (pool normally handles this).

**How to avoid:** Phase 141 can use `openDb` as today if Phase 137's pool doesn't break the standalone path. Document as a flag for the planner: if Phase 137 deprecates `openDb` in favor of a pool-only path, the command inline-node scripts need updating. For Phase 141, use `openDb` unchanged (same as today) and note the dependency.

### Pitfall 5: `queryScan` body key `repo` vs `repo_path`

**What goes wrong:** The HTTP `/scan` route reads `request.body.repo_path`. The MCP `impact_scan` tool sends `body.repo`. Even after the `response.ok` fix, the body key mismatch causes 400s.

**How to avoid:** Change `queryScan()` to send `{ repo_path: repo, full }` instead of `{ repo, full }`. (But note: even with `repo_path`, without `findings`, the HTTP route still returns 400. The `response.ok` check surfaces this correctly as an error.)

### Pitfall 6: Partial Transaction Rollback Leaves changedFiles Deletion Unfired

**What goes wrong:** If the `db.transaction(fn)()` in `persistScanResult` throws (rare after Phase 138, but possible), the deletion of deleted-file findings (post-commit step) never runs. This is correct: if the scan failed, don't delete anything.

**How to avoid:** The code structure already handles this correctly: `_deleteDeletedFileFindings` runs AFTER `const scanVersionId = writeTx();` — if `writeTx()` throws, execution never reaches the deletion. No guard needed; it's structural.

---

## Architecture Patterns: scan-service.js Full Outline

```javascript
// plugins/arcanon/worker/scan/scan-service.js

import { applyPendingOverridesSync } from './overrides.js';

export function persistScanResult(repoId, repoPath, findings, commit, opts = {}, queryEngine, slog) {
  const safeSlog = typeof slog === 'function' ? slog : () => {};

  // Phase 140: optional contract validation
  if (typeof opts.validateFindings === 'function') {
    opts.validateFindings(findings);  // throws on validation failure
  }

  const writeTx = queryEngine._db.transaction(() => {
    const startedAt = opts.startedAt ?? new Date().toISOString();
    const scanVersionId = queryEngine.beginScan(repoId, startedAt);  // Phase 138 signature

    // PIPE-04: preserve unchanged findings for incremental scans
    if (opts.mode === 'incremental') {
      _restampExistingRows(queryEngine._db, repoId, scanVersionId);
    }

    // Phase 138/139: persistFindings contains Phase 139 pre-wipes inside
    queryEngine.persistFindings(repoId, findings, commit, scanVersionId);

    // PIPE-03: always fires with safe logger — no TypeError risk
    applyPendingOverridesSync(scanVersionId, queryEngine, safeSlog);

    // Phase 138: completed_at is last step inside endScan (ISO-04)
    queryEngine.endScan(repoId, scanVersionId);

    return scanVersionId;
  });

  const scanVersionId = writeTx();  // throws on failure → ROLLBACK

  // PIPE-04: remove findings owned by deleted/renamed files (post-commit, targeted cleanup)
  if (opts.mode === 'incremental' && opts.changedFiles) {
    _deleteDeletedFileFindings(queryEngine._db, repoId, opts.changedFiles, safeSlog);
  }

  return { scanVersionId };
}

function _restampExistingRows(db, repoId, newScanVersionId) {
  const prevRow = db.prepare(
    `SELECT id FROM scan_versions WHERE repo_id = ? AND completed_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`
  ).get(repoId);
  if (!prevRow) return;
  db.prepare(`UPDATE services SET scan_version_id = ? WHERE repo_id = ? AND scan_version_id = ?`)
    .run(newScanVersionId, repoId, prevRow.id);
  db.prepare(
    `UPDATE connections SET scan_version_id = ?
     WHERE source_service_id IN (SELECT id FROM services WHERE repo_id = ?)
       AND scan_version_id = ?`
  ).run(newScanVersionId, repoId, prevRow.id);
}

function _deleteDeletedFileFindings(db, repoId, changedFiles, slog) {
  const paths = [
    ...(changedFiles.deleted ?? []),
    ...(changedFiles.renamed ?? []).map(r => r.from),
  ];
  if (paths.length === 0) return;
  for (const p of paths) {
    const r = db.prepare(`DELETE FROM services WHERE repo_id = ? AND source_file = ?`).run(repoId, p);
    if (r.changes > 0) slog('INFO', 'incremental: removed stale service', { path: p });
  }
}
```

---

## Runtime State Inventory

This phase does not rename strings, add migrations, or migrate data. It is pure orchestration restructuring.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — scan-service.js writes no new table schema | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None | None |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node >=22.13) |
| Config file | None — per-file runner |
| Quick run command | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` |
| Full suite command | `cd plugins/arcanon && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-01 | All transports call persistScanResult() — no duplicate persist logic | unit | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| PIPE-01 | HTTP /scan route calls persistScanResult() — DB state matches | integration | `node --test plugins/arcanon/worker/server/http.test.js` | ✅ extend existing |
| PIPE-02 | queryScan() returns `{ status: 'error' }` when HTTP /scan returns 400 | unit | `node --test plugins/arcanon/worker/mcp/server.test.js` | ✅ extend existing |
| PIPE-02 | queryScan() returns real error body message from HTTP response | unit | `node --test plugins/arcanon/worker/mcp/server.test.js` | ✅ extend existing |
| PIPE-03 | persistScanResult() calls applyPendingOverridesSync without slog arg — no throw | unit | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| PIPE-03 | Pending override is stamped with applied_in_scan_version_id after persistScanResult | unit | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| PIPE-03 | map.md path: override is applied (no longer silently skipped) | E2E command | Manual / bats | N/A |
| PIPE-04 | Incremental scan: unchanged services preserved after re-stamp | unit | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| PIPE-04 | Incremental scan: deleted-file services removed after commit | unit | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| PIPE-04 | Incremental scan: renamed-file services removed, new path preserved | unit | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| CTR-05 | Command transport (scan-service.js direct): real DB, real transaction | E2E | `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js` | ❌ Wave 0 gap |
| CTR-05 | HTTP transport: POST /scan → real pipeline → DB has correct rows | E2E | `node --test plugins/arcanon/worker/server/http.test.js` | ✅ extend existing |
| CTR-05 | MCP transport: queryScan() returns error on failure (not false triggered) | E2E | `node --test plugins/arcanon/worker/mcp/server.test.js` | ✅ extend existing |
| CTR-05 | manager.js transport: Phase B uses persistScanResult (mock agentRunner) | E2E | `node --test plugins/arcanon/worker/scan/manager.test.js` | ✅ extend existing |

### Wave 0 Gaps

- [ ] `plugins/arcanon/worker/scan/scan-service.e2e.test.js` — new file; covers PIPE-01 (all transports call persistScanResult), PIPE-03 (slog safety + override stamping), PIPE-04 (incremental re-stamp + deleted-file cleanup, rename coverage)
- [ ] Extend `plugins/arcanon/worker/server/http.test.js` — add PIPE-02 test: mock HTTP server returns 400; assert queryScan returns `{status: 'error'}` not `{status: 'triggered'}`
- [ ] Extend `plugins/arcanon/worker/mcp/server.test.js` — add CTR-05 transport test: verify `/scan` response body surfaces correctly through queryScan

### Sampling Rate

- **Per task commit:** `node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js`
- **Per wave merge:** `cd plugins/arcanon && npm run test:storage && node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js plugins/arcanon/worker/server/http.test.js plugins/arcanon/worker/mcp/server.test.js`
- **Phase gate:** `cd plugins/arcanon && npm test` — full suite green before `/gsd-verify-work`

---

## Security Domain

Phase 141 introduces no new user-controlled inputs. The `scan-service.js` write path uses existing prepared statements from `QueryEngine`. The `_deleteDeletedFileFindings` DELETE uses `source_file = ?` with a bound parameter (no interpolation). File paths come from `execFileSync` git output (not from HTTP request bodies).

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Marginal | Phase 140 validates findings before persistScanResult writes; `_deleteDeletedFileFindings` uses bound SQL parameters |
| V6 Cryptography | No | N/A |

The PIPE-02 response.ok fix adds `await scanRes.json()` parsing of the HTTP error body. This body is produced by the local worker (localhost) and is not user-controlled input. No XSS or injection risk.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 138 lands before Phase 141 — `applyPendingOverridesSync` is a named export from overrides.js | §Q2, §Q4 | If Phase 138 hasn't landed, scan-service.js must inline the sync variant itself; straightforward to extract |
| A2 | Phase 138 lands before Phase 141 — `db.transaction(fn)` is the canonical transaction wrapper in scan-service.js | §Q2 | If Phase 138 hasn't landed, scan-service.js must call `db.exec("BEGIN")` etc. directly; less clean but feasible |
| A3 | Phase 140 provides a `validateFindings(findings)` callable that throws on invalid findings | §Q7 | If Phase 140 ships as a validation middleware inside persistFindings rather than a callable, the `opts.validateFindings` hook is a no-op and validation is implicitly included |
| A4 | `source_file` on services rows is populated by the agent and carries the relative file path within the repo | §Q5 | If `source_file` is often NULL or absolute, `_deleteDeletedFileFindings`'s DELETE affects 0 rows; no crash but deleted-file cleanup is incomplete |
| A5 | map.md and rescan.md always run full scans (not per-file incremental) | §Q5, Pitfall 3 | rescan.md documents "always full mode"; map.md's incremental is repo-level skip, not per-file; if this changes, command paths need `changedFiles` threading |
| A6 | `openDb()` from `database.js` continues to work in the inline-node command context after Phase 137 lands | §Pitfall 4 | If Phase 137 deprecates `openDb` in favor of pool-only access, command persistence scripts need updating to use the pool differently |

---

## Open Questions

1. **Should scan-service.js be the canonical snapshot trigger, or does it stay in manager.js?**
   - What we know: Phase 139 places `createSnapshot()` in `manager.js` after the Phase B loop. scan-service.js is per-repo; the snapshot is per-run (one snapshot for all repos). Snapshot cannot live inside scan-service.js.
   - Recommendation: Keep snapshot in manager.js after the Phase B loop (as Phase 139 designed). scan-service.js is per-repo write only.

2. **Do map.md / rescan.md need post-bracket enrichment calls after Phase 141?**
   - What we know: Enrichment (CODEOWNERS, auth-db, dep-collector) is currently only called from manager.js Phase B (test-only path). Command paths have no enrichment step.
   - Recommendation: Phase 141 does NOT add enrichment to command paths. That's a separate follow-on. Commands get correct persistence; enrichment wiring for commands is Phase 142+ scope.

3. **Is the manager.js path ever planned to become production-wired?**
   - What we know: v0.1.4 milestone deliberately abandoned the manager.js production path. Phase 141 restructures Phase B to call scan-service.js but doesn't add a production agent runner.
   - Recommendation: Phase 141 restructures manager.js Phase B only (for test correctness and so the path is ready if a future phase wires a production agent runner). Document as "test-only path with correct pipeline" — not a priority for production wiring in v0.2.0.

---

## Environment Availability

This phase is pure code/orchestration changes. No external tools, databases, or services beyond the existing Node.js runtime and SQLite.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22.13 | node:sqlite built-in (via Phase 128) | Yes | Project floor | None required |
| node:sqlite DatabaseSync | transaction() in scan-service.js | Yes | Built-in | N/A |

---

## Sources

### Primary (HIGH confidence)

- `plugins/arcanon/commands/map.md:306-366` — Step 5 inline-node persistence block, no applyPendingOverrides (PIPE-03 bug #1)
- `plugins/arcanon/commands/rescan.md:247-304` — Step 5 inline-node with broken override call (PIPE-03 bug #2)
- `plugins/arcanon/worker/scan/manager.js:282-291` — agentRunner module-global and setAgentRunner (confirmed test-only by grep)
- `plugins/arcanon/worker/scan/manager.js:600-919` — scanRepos Phase A/B/enrichment/hub structure
- `plugins/arcanon/worker/scan/manager.js:757-765` — Phase A result object (missing changedFiles for PIPE-04)
- `plugins/arcanon/worker/scan/manager.js:802-812` — Phase B write block: persistFindings + applyPendingOverrides + endScan
- `plugins/arcanon/worker/scan/manager.js:380-438` — buildScanContext and buildIncrementalConstraint
- `plugins/arcanon/worker/scan/overrides.js:56-135` — applyPendingOverrides signature and slog call pattern
- `plugins/arcanon/worker/mcp/server.js:1201-1269` — queryScan: ignored response.ok + body key mismatch
- `plugins/arcanon/worker/mcp/server.js:1451-1476` — impact_scan tool definition
- `plugins/arcanon/worker/server/http.js:627-664` — /scan route: expects {repo_path, findings}; no override call
- `.planning/phases/138-transactional-scan-unit-of-work/138-RESEARCH.md` — db.transaction(), applyPendingOverridesSync design, beginScan inside writeTx pattern
- `.planning/phases/139-history-model-run-identifier-child-reconciliation/139-RESEARCH.md` — snapshot placement, child table reconciliation, scan_version_id threading

### Secondary (MEDIUM confidence)

- `.planning/REQUIREMENTS.md` — PIPE-01..04, CTR-05 exact text
- `.planning/ROADMAP.md` — v0.1.4 milestone note: "Architectural correction at release prep"
- `plugins/arcanon/worker/scan/manager.test.js` — confirms setAgentRunner is test-only (19 callers in test file, 0 in production)

---

## Metadata

**Confidence breakdown:**
- Three-path map (§Q1): HIGH — all three paths read from source; production-only grep for setAgentRunner/scanRepos callers confirmed zero
- ScanService shape (§Q2): HIGH — design follows directly from path analysis and Phase 138/139 research
- PIPE-02 exact bug (§Q3): HIGH — queryScan source read confirmed exact line; fix is straightforward
- PIPE-03 exact bugs (§Q4): HIGH — both bug locations confirmed in source; root cause (undefined slog) verified
- PIPE-04 incremental semantics (§Q5): HIGH — manager.js buildIncrementalConstraint + endScan delete predicate both verified
- CTR-05 test architecture (§Q6): MEDIUM — test patterns based on existing test structure; actual test file implementation may adjust
- Command-path crux (§Q8): HIGH — confirmed by source that inline-node scripts can import from worker JS

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (internal codebase; assumes Phases 138/139/140 land as described in their respective RESEARCH.md files before Phase 141 implementation begins)
