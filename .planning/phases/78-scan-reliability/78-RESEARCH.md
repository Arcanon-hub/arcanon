# Phase 78: Scan Reliability - Research

**Researched:** 2026-03-22
**Domain:** Node.js async orchestration, agent retry patterns, graph UI actor dedup filtering
**Confidence:** HIGH

## Summary

Phase 78 has two independent requirements. SREL-01 transforms `scanRepos` in `worker/scan/manager.js` from a sequential `for...of` loop into a parallel-capable orchestrator: discovery agents (from SARC-01, Phase 76) and deep-scan agents both run concurrently across repos where possible. Failed agent invocations retry once before the repo is skipped with a user-visible warning naming the failing repo. SREL-02 adds a defense-in-depth filter in the graph UI (`worker/ui/graph.js`): after the `/graph` response arrives, any actor whose name matches a known service name is suppressed from rendering and its connections are rerouted to the service node instead.

Both requirements are confined to the existing codebase — no new libraries, no new DB tables, no new API endpoints. The work is pure logic changes on two well-isolated surfaces: `manager.js` (scan orchestration) and `graph.js` (UI data preparation). The test framework is Node.js built-in `node:test` throughout; all existing tests pass at research time.

**Primary recommendation:** Implement SREL-01 by converting the outer repo loop to `Promise.all` (or `Promise.allSettled`) for agent invocations with retry logic inside a per-repo helper. Implement SREL-02 by filtering `raw.actors` in `loadProject` before constructing synthetic nodes, using `serviceNameToId` which is already built at that point.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SREL-01 | Discovery agents run in parallel across repos; deep scan agents run in parallel where possible; failed agents retry once then skip with user warning (THE-952) | Requires refactoring `scanRepos` in `manager.js` from sequential `for...of` to parallel execution with retry wrapper around `agentRunner` calls |
| SREL-02 | Graph UI `/graph` endpoint filters out actors whose name matches a known service, redirecting connections to the service node — defense in depth for stale actor data (THE-948) | Filter logic belongs in `loadProject` in `graph.js`, using the already-populated `serviceNameToId` map as the known-services set |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `node:test` | Node 25.8.1 (already installed) | Test runner | Used by all existing tests in this codebase — zero new deps |
| Node.js `Promise.allSettled` | ES2020 built-in | Parallel async fan-out with failure isolation | Safe: each promise settles independently; no short-circuit on failure unlike `Promise.all` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | ^12.8.0 (existing) | QueryEngine in tests | Already used in manager.test.js for enrichment tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Promise.allSettled` | `Promise.all` | `Promise.all` short-circuits on first rejection — dangerous for multi-repo scan isolation; `allSettled` is correct here |
| `Promise.allSettled` | p-limit (npm) | p-limit adds concurrency control but is an external dep; for agent invocations that are already throttled by Claude's capacity, `Promise.allSettled` is simpler and sufficient |

**No installation required** — all functionality uses Node.js built-ins and existing project dependencies.

---

## Architecture Patterns

### Recommended Project Structure

No structural changes. Both files are edited in place:
```
plugins/ligamen/worker/scan/
├── manager.js          ← SREL-01: parallel scan + retry logic
├── manager.test.js     ← new tests for parallelism and retry
worker/ui/
├── graph.js            ← SREL-02: actor dedup filter in loadProject
```

New test files for SREL-02 (graph UI changes are tested in `tests/ui/`):
```
tests/ui/
├── graph-actor-dedup.test.js   ← new tests for SREL-02 actor filtering
```

### Pattern 1: Per-Repo Async Wrapper with Retry

**What:** Extract per-repo scan logic into an async function. That function calls `agentRunner` and retries once on failure before returning an error result.

**When to use:** When the outer orchestrator needs to fan out concurrently while preserving per-repo isolation.

**Example (conceptual):**
```javascript
// Inside scanRepos — replace for...of with Promise.allSettled
async function scanOneRepo(repoPath, queryEngine, finalPrompt, ctx) {
  let rawResponse;
  try {
    rawResponse = await agentRunner(finalPrompt, repoPath);
  } catch (firstErr) {
    // retry once
    try {
      rawResponse = await agentRunner(finalPrompt, repoPath);
    } catch (retryErr) {
      // skip with warning — return error result
      return { repoPath, mode: ctx.mode, findings: null, error: retryErr.message, skipped: true };
    }
  }
  // ... parse, persist, enrich as before
}

// Fan out all repos in parallel
const settled = await Promise.allSettled(repoPaths.map((p) => scanOneRepo(p, ...)));
const results = settled.map((s) => s.status === 'fulfilled' ? s.value : /* handle rejection */ ...);
```

**Critical constraint from codebase comment (line 13 of manager.js):**
> Background subagents cannot access MCP tools (Claude Code issue #13254) — all agent invocations run in the foreground via the MCP server's agentRunner.

This means parallelism is achievable via `Promise.allSettled` in the foreground (each `agentRunner` call still runs synchronously in Claude's Task queue), but the architecture note about "parallel where possible" should be understood in context: the agentRunner is injected and could either be a sequential or parallel invoker depending on the MCP server's implementation. The change in `manager.js` removes the sequential constraint from the scan loop itself.

**Discovery-before-deep-scan constraint (SARC-01 dependency):** Phase 76 adds a discovery agent call before each deep-scan. For parallelism, the pattern must still respect the per-repo ordering: discovery runs first for a repo, then deep scan. Cross-repo parallelism is: repo A discovery + repo B discovery can run concurrently, then repo A deep + repo B deep can run concurrently. A two-phase fan-out (discovery phase, then deep-scan phase) is the natural implementation.

### Pattern 2: Retry Once with Named Warning

**What:** Wrap a single `agentRunner` call in try/catch. On first failure, retry immediately once. On second failure, log a `WARN` with the repo name and return a skip result.

**Warning format from success criteria:** "the user sees a warning identifying the skipped repo by name"

**Implementation location:** Inside `scanOneRepo` helper, using the existing `slog` mechanism:
```javascript
slog('WARN', 'scan failed after retry — repo skipped', { repoPath, repoName: basename(repoPath), error: retryErr.message });
```

The existing logger in `manager.js` uses `_logger.log(level, msg, extra)`. This pattern is established and tested.

### Pattern 3: SREL-02 Actor Dedup in graph.js

**What:** In `loadProject`, after `const serviceNameToId = {}` is built from `raw.services`, filter `raw.actors` before creating synthetic nodes.

**Key insight:** `serviceNameToId` is already populated at the exact point where actor nodes are created (lines 58-123 of `graph.js`). The filter needs only:
```javascript
// Filter actors whose name matches a known service (SREL-02)
const filteredActors = (raw.actors || []).filter(
  (actor) => !(actor.name in serviceNameToId)
);
state.graphData.actors = filteredActors;
```

For connections rerouting — actor connections that pointed to a filtered-out actor should be redirected to the service node. The actor's `connected_services` array links back to source service IDs. When an actor is filtered out, its synthetic edges are simply not created (they already exist as real connections in `state.graphData.edges` via the services/connections data). No explicit rerouting is needed in the edge data — the existing service-to-service connections already capture the relationship.

**Warning:** Do not filter at the server level (`/graph` endpoint or `getGraph()`). The requirement is explicitly "defense in depth" at the UI layer — the server returns all data, the UI filters. This preserves backward compatibility and keeps the fix minimal.

### Anti-Patterns to Avoid

- **Parallelizing enrichment:** Enrichment runs per-service after the scan bracket closes. It interacts with SQLite. SQLite with better-sqlite3 is synchronous and single-writer. Enrichment must stay sequential per-service (or be carefully serialized). Do not parallelize enrichment in this phase.
- **Modifying getGraph() for SREL-02:** The filter belongs in the UI (`graph.js`), not the query engine. Filtering at the query engine would change the API contract and make future debugging harder.
- **Retrying on parse failures:** The retry should apply to `agentRunner` throwing (network/infra failure), not to the agent returning invalid JSON. Invalid JSON from a successful invocation is a content failure — retrying it would just repeat the same bad output. The current code already handles parse failures gracefully by preserving prior data.
- **Abandoning all repos when one fails the retry:** The success criteria states "remaining repos complete normally" — use `Promise.allSettled` not `Promise.all`, and never throw from the outer orchestrator.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel async fan-out | Custom queue | `Promise.allSettled` | Built-in, handles partial failure |
| Retry logic | Exponential backoff library | Inline try/catch (retry once) | Requirement is exactly one retry — no backoff needed |
| Test timing for parallelism | wall-clock timer | Track invocation order with arrays | Flaky on slow CI; order/concurrency verification is more reliable |

---

## Common Pitfalls

### Pitfall 1: SQLite Write Contention from Parallelism
**What goes wrong:** `beginScan`, `persistFindings`, and `endScan` write to SQLite via `better-sqlite3`. If two repos try to write simultaneously in truly parallel async code, better-sqlite3 will serialize them (it uses synchronous calls), but if both try to call `db.prepare().run()` from overlapping microtask ticks, it may throw `SQLITE_BUSY`.
**Why it happens:** `Promise.allSettled` resolves promises concurrently. The async calls to `agentRunner` (truly async — they await Claude's response) create concurrency. When both complete near-simultaneously, their `persistFindings` calls could overlap.
**How to avoid:** Either serialize the DB write portion (fan out only the `agentRunner` call, serialize the DB writes after `allSettled` resolves), or rely on better-sqlite3's built-in serialization (it is thread-safe and will block on WAL conflicts). Simplest: await the agent calls in parallel, then process results sequentially for DB writes.
**Warning signs:** `SQLITE_BUSY` errors in tests with multiple repos.

### Pitfall 2: enrichment._db reference in parallel context
**What goes wrong:** `scanRepos` uses `queryEngine._db.prepare(...).all(repo.id)` for enrichment (lines 425-433 of manager.js). If enrichment runs inside a per-repo async wrapper that executes in parallel, the same DB handle is accessed from multiple logical execution paths.
**Why it happens:** better-sqlite3 is synchronous — its `prepare().all()` calls are blocking. In truly concurrent async execution, two enrichment passes could interleave.
**How to avoid:** Run enrichment serially after all parallel scan invocations complete. The two-phase pattern (fan out agentRunner calls, then serially persist + enrich) avoids this entirely.

### Pitfall 3: The existing test "agents run sequentially" must be updated
**What goes wrong:** `manager.test.js` line 384 has a test titled "agents run sequentially — for...of not Promise.all". After SREL-01, this test's assertion becomes invalid. Leaving it will fail.
**Why it happens:** The test explicitly checks that `svc-a` runs before `svc-b`.
**How to avoid:** Update this test to verify parallelism (e.g., both agents are called, both produce results) rather than sequential ordering. The test name and assertion need updating.

### Pitfall 4: actor.name case sensitivity in SREL-02 filter
**What goes wrong:** `serviceNameToId` uses service names exactly as stored in the DB. Actor names are derived from `conn.target` in `persistFindings`. If there's any casing mismatch, the filter won't catch duplicates.
**Why it happens:** Service names come from the agent's JSON output (`svc.name`) while actor names come from `conn.target` (the same field in a different context). They should match, but vigilance is needed.
**How to avoid:** Use exact string equality (`actor.name in serviceNameToId`) — this is the correct behavior per the spec ("actor whose name exactly matches a known service name").

### Pitfall 5: Retry on parse failure vs agentRunner throw
**What goes wrong:** Treating `parseAgentOutput` returning `{ valid: false }` as a retryable failure.
**Why it happens:** The distinction between "agent threw an error" and "agent returned garbage" is subtle.
**How to avoid:** Only retry when `agentRunner(...)` throws. If it returns but the output is invalid JSON, do NOT retry — log the parse failure with the existing `WARN` path (preserves prior data).

---

## Code Examples

Verified patterns from existing codebase:

### Current scanRepos sequential pattern (to be replaced)
```javascript
// Source: plugins/ligamen/worker/scan/manager.js lines 346-437
for (const repoPath of repoPaths) {
  // ... setup ...
  const rawResponse = await agentRunner(finalPrompt, repoPath);
  // ... parse + persist ...
}
```

### Existing retry-adjacent error handling (already present)
```javascript
// Source: plugins/ligamen/worker/scan/manager.js lines 404-413
if (result.valid === false) {
  slog('WARN', 'scan failed — preserving prior data', { repoPath, error: result.error });
  results.push({ repoPath, mode: ctx.mode, findings: null, error: result.error });
  continue;
}
```

### serviceNameToId map in graph.js (already built — SREL-02 hooks here)
```javascript
// Source: plugins/ligamen/worker/ui/graph.js lines 58-86
const serviceNameToId = {};
// ...
state.graphData.nodes = (raw.services || []).map((s) => {
  serviceNameToId[s.name] = s.id;
  // ...
});
```

### Existing actor synthetic node creation (SREL-02 filters before this)
```javascript
// Source: plugins/ligamen/worker/ui/graph.js lines 112-138
for (const actor of state.graphData.actors) {
  const syntheticId = -actor.id;
  state.graphData.nodes.push({ ... });
}
for (const actor of state.graphData.actors) {
  for (const cs of actor.connected_services || []) {
    state.graphData.edges.push({ ... });
  }
}
```

### Existing slog pattern for warnings
```javascript
// Source: plugins/ligamen/worker/scan/manager.js lines 329-331
function slog(level, msg, extra = {}) {
  if (_logger) _logger.log(level, msg, extra);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential scan (`for...of`) | Parallel scan (`Promise.allSettled` fan-out) | Phase 78 | Total scan time ≈ slowest single-repo scan |
| No retry — one failure = silent data loss | One retry then skip with named warning | Phase 78 | Transient agent failures auto-recover; persistent failures surface to user |
| Actor nodes rendered even when name matches a service | Actor nodes filtered when name matches known service | Phase 78 | Eliminates phantom hexagon nodes from stale scan data |

**Deprecated/outdated after this phase:**
- The test assertion "agents run sequentially" in `manager.test.js` (line 384) — needs updating to verify parallel behavior instead.

---

## Open Questions

1. **Two-phase parallel vs per-repo sequential with parallel repos**
   - What we know: SARC-01 (Phase 76) adds a discovery agent call before each deep scan. SREL-01 says "parallel where possible."
   - What's unclear: Does Phase 76 wire discovery into `scanRepos` before Phase 78 runs, or does Phase 78 need to handle both discovery and deep-scan orchestration?
   - Recommendation: Design SREL-01 to handle both cases cleanly. If discovery is already wired (Phase 76 complete), the parallel pattern is: fan out all repos through a per-repo async function that runs discovery then deep-scan in sequence. If Phase 76 is not yet merged, SREL-01 should still parallelize the existing deep-scan invocations.

2. **agentRunner parallelism at the Claude Task level**
   - What we know: The comment says "foreground only" due to Claude Code issue #13254. `agentRunner` is injected — its implementation controls actual parallelism.
   - What's unclear: Whether truly concurrent `agentRunner` calls in the MCP server context are safe.
   - Recommendation: `scanRepos` should remove its own sequential constraint (switching from `for...of` to `Promise.allSettled`) and trust the injected `agentRunner` to handle concurrency correctly. The success criterion measures wall-clock time, not the mechanism.

3. **User-visible warning format for SREL-01**
   - What we know: "the user sees a warning identifying the skipped repo by name"
   - What's unclear: "User sees" — is this the log terminal UI, or stdout, or both?
   - Recommendation: Use `slog('WARN', ...)` which goes to the structured logger (visible in the log terminal UI). Also include the repo name in the result object's `error` field (already done for parse failures). The MCP server or command output layer can surface this.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (v25.8.1) |
| Config file | None — run directly with `node --test` |
| Quick run command | `node --test plugins/ligamen/worker/scan/manager.test.js` |
| Full suite command | `node --test plugins/ligamen/worker/scan/manager.test.js plugins/ligamen/worker/db/query-engine-actors.test.js tests/ui/graph-actor-dedup.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SREL-01 | Scanning 3 repos concurrently takes ~single-repo time | unit (timing via order/concurrency tracking) | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — file exists, new tests needed |
| SREL-01 | Failed agentRunner retries once before skip | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — new test needed |
| SREL-01 | Skipped repo produces user-visible warning with repo name | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — new test needed |
| SREL-01 | Skipped repo does not abort remaining repos | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | Partial — covered by existing "error isolation" test, verify still passes |
| SREL-02 | Actor whose name matches a service is absent from rendered nodes | unit | `node --test tests/ui/graph-actor-dedup.test.js` | ❌ Wave 0 |
| SREL-02 | Actor connections redirect to service node when actor is filtered | unit | `node --test tests/ui/graph-actor-dedup.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test plugins/ligamen/worker/scan/manager.test.js`
- **Per wave merge:** Full suite command above
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/ui/graph-actor-dedup.test.js` — covers SREL-02 actor dedup filter logic (unit test for the filter function extracted from `loadProject`, or a mock-fetch integration test)

*(Note: `plugins/ligamen/worker/scan/manager.test.js` already exists and all 21 tests pass. New tests are additions to the existing file, not a new file.)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `plugins/ligamen/worker/scan/manager.js` — full implementation, comments, and constraints
- Direct code inspection: `plugins/ligamen/worker/scan/manager.test.js` — 21 passing tests, test patterns
- Direct code inspection: `plugins/ligamen/worker/ui/graph.js` — `loadProject`, `serviceNameToId`, actor node construction
- Direct code inspection: `plugins/ligamen/worker/db/query-engine.js` — `getGraph`, `persistFindings`, actor persistence
- Direct code inspection: `plugins/ligamen/worker/db/query-engine-actors.test.js` — 7 passing actor tests
- `.planning/REQUIREMENTS.md` — SREL-01, SREL-02 definitions
- `plugins/ligamen/package.json` — Node >=20, better-sqlite3 ^12.8.0, no test framework dep

### Secondary (MEDIUM confidence)
- `node:test` parallel behavior: Node.js 25 built-in test runner; `Promise.allSettled` semantics are ES2020 standard
- SQLite WAL concurrency with better-sqlite3: synchronous API serializes naturally; SQLITE_BUSY risk is real but manageable

### Tertiary (LOW confidence)
- MCP agentRunner true parallelism safety — inferred from codebase comment; actual behavior depends on Claude Code Task tool internals

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; everything is Node.js built-ins + existing project libs
- Architecture: HIGH — both touch points (`manager.js`, `graph.js`) are fully read and understood
- Pitfalls: HIGH — SQLite contention and test update requirement are verified from code inspection; retry/parse distinction verified from existing code

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain — no external library changes expected)
