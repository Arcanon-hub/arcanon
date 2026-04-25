# Phase 109 — Deferred / Out-of-Scope Items

## Pre-existing test failures (not caused by Phase 109)

### `worker/scan/manager.test.js` — incremental scan prompt test

- **Test:** "incremental scan prompt contains INCREMENTAL_CONSTRAINT heading and changed filename"
- **Failure:** `TypeError: Cannot read properties of undefined (reading 'prepare')` at manager.js:806
- **Root cause:** The `back-fill DB ids onto r.findings.services` block in `scanRepos` calls `queryEngine._db.prepare(...)`, but the test's stub `queryEngine` (in `makeIncrementalQE`) doesn't define `_db`.
- **Verified pre-existing:** Stashing all 109-02 changes and running the test still produces the same failure. Predates this phase.
- **Owner:** Should be filed against the source plan that introduced the back-fill block (manager.js commit history points to v0.1.2 hotfixes).

### `tests/impact-hook.bats` — HOK-06 p99 latency

- **Test:** `impact-hook - HOK-06: p99 latency < ${IMPACT_HOOK_LATENCY_THRESHOLD:-50}ms over 100 iterations`
- **Failure:** Measured p99 ~183ms exceeds the 50ms threshold on this development machine.
- **Root cause:** Environment-dependent performance threshold. The hook's actual logic is fine; the threshold is too tight for non-CI machines.
- **Verified pre-existing:** Same failure with all 109-02 changes stashed.
- **Owner:** Performance/HOK-06 tuning ticket — separate concern.

## Stub-tracking sweep (109-02)

None. All new code paths are wired to real data sources:

- `canonicalizePath` is a pure-JS helper invoked from persistFindings.
- `_validateEvidence` reads real source_file content via `fs.readFileSync`.
- `path_template` is populated from the agent's actual `conn.path` value.
- Warnings are written to the real `process.stderr` / injected logger.
