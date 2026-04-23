# Phase 103: Test Suite Rewrite — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped)
**Depends on:** Phase 101 (runtime purge), Phase 102 (source cosmetic)

<domain>
## Phase Boundary

Every bats and node test file that pins legacy `LIGAMEN_*` env vars, `ligamen.config.json` paths, or `$HOME/.ligamen` directories is rewritten to exercise the `ARCANON_*` / `arcanon.config.json` / `$HOME/.arcanon` equivalents. Both full test suites must be green after the rewrite.

**Requirements (7):** TST-01..07.

</domain>

<decisions>
## Implementation Decisions

### 15 test files identified
- `tests/config.bats` (largest — 33 refs)
- `tests/detect.bats`, `format.bats`, `file-guard.bats`, `structure.bats` (env var fixtures)
- `tests/mcp-chromadb-fallback.bats`, `mcp-launch.bats`, `mcp-server.bats` (MCP + chroma envs)
- `tests/fixtures/config/mock-*.sh` (fixture scripts)
- Worker node tests: `chroma.test.js`, `http.test.js`, `server.test.js`, `server-drift.test.js`, `discovery.test.js`, `manager.test.js`, `auth.test.js`, `migrations.test.js`, `database.test.js`, `snapshot.test.js`, `query-engine-enrich.test.js`, `pragma.test.js`, `query-engine-search.test.js`, `pool-repo.test.js`

### Grep candidate list (actual count from pre-103 sweep)
15 files matched — subset of the REQUIREMENTS.md-enumerated list. Some files (e.g. `tests/detect.bats`, `tests/format.bats`, `tests/file-guard.bats`, `tests/structure.bats`, `tests/fixtures/config/mock-*.sh`) weren't in the grep hits — they may already be clean from an earlier sweep OR the refs are uppercase-only / present in other-encoding contexts. Executor should verify per-file during the pass.

### Don't change test behavior, just names
For each test:
- Find every `LIGAMEN_*` env var fixture set → rename to `ARCANON_*`
- Find every `ligamen.config.json` path assertion → rename to `arcanon.config.json`
- Find every `$HOME/.ligamen` / `~/.ligamen` path → rename to `$HOME/.arcanon` / `~/.arcanon`
- Don't change test assertion logic, don't add/remove tests

### Suite green gate
After rewrite:
- `make test` (bats) must complete green — 310+ tests
- `node --test plugins/arcanon/worker/**/*.test.js` must complete green

Breakage beyond legacy-name assertions would indicate a regression in Phase 101 or 102 work (not a test-rewrite bug). Investigate before proceeding.

</decisions>

<code_context>
## Existing Code Insights

### Runtime contract (from Phase 101)
Tests exercise these runtime surfaces:
- Env vars: `ARCANON_LOG_LEVEL`, `ARCANON_WORKER_PORT`, `ARCANON_DB_PATH`, `ARCANON_PROJECT_ROOT`, `ARCANON_DATA_DIR`, `ARCANON_CHROMA_MODE/HOST/PORT/SSL/API_KEY/TENANT/DATABASE`, `ARCANON_CONFIG_FILE`, `ARCANON_LINT_THROTTLE`, `ARCANON_EXTRA_BLOCKED`, `ARCANON_DISABLE_FORMAT/LINT/GUARD/SESSION_START`, `ARCANON_DISABLE_HOOK`, `ARCANON_IMPACT_DEBUG`
- Paths: `arcanon.config.json`, `$HOME/.arcanon/`
- Package: `@arcanon/runtime-deps`
- Collection: `arcanon-impact`

Any test asserting on the legacy name would fail; the rewrite updates those assertions.

### Test framework specifics
- **bats (`tests/*.bats`):** uses `setup_file`, `setup`, `teardown` hooks. Env vars set via `export` in setup, asserted via `run` + `assert_output`.
- **Node (`worker/**/*.test.js`):** uses `node --test` from Node 20+. Env vars set via `process.env.FOO = ...` or passed via `spawnSync({ env: ... })`.

### Fixture files
- `tests/fixtures/config/mock-guard.sh`, `mock-lint.sh` — these are mock script bodies that may reference legacy env vars. Rewrite alongside tests.

</code_context>

<specifics>
## Specific Ideas

### Approach per file
1. Read the test file
2. Find every `ligamen|LIGAMEN_` occurrence
3. For each:
   - Rename env var: `LIGAMEN_FOO` → `ARCANON_FOO`
   - Rename path: `ligamen.config.json` → `arcanon.config.json`
   - Rename dir: `~/.ligamen` / `$HOME/.ligamen` → `~/.arcanon` / `$HOME/.arcanon`
4. Don't change test LOGIC — only the names

### Verification greps after rewrite
```bash
grep -rn "ligamen\|LIGAMEN_" tests/ 2>/dev/null  # should be 0
grep -rn "ligamen\|LIGAMEN_" plugins/arcanon/worker --include="*.test.js" 2>/dev/null  # should be 0
```

### Test suite green
```bash
make test  # bats
cd plugins/arcanon && npm test  # node
```

Both must pass with zero failures.

### Known pre-existing caveats (not Phase 103 debt)
- The macOS HOK-06 p99 latency benchmark may still fail on macOS (documented in v0.1.1 as platform caveat). On Linux CI it passes with `IMPACT_HOOK_LATENCY_THRESHOLD=100`. Don't treat this as a Phase 103 issue.

</specifics>

<deferred>
## Deferred Ideas

None — this phase is fully scoped.

</deferred>
