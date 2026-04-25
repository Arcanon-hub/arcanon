# Testing Patterns

**Analysis Date:** 2026-04-24

Arcanon has two test suites that BOTH must be green for phase verification: **bats** for shell (hooks, libs, scripts, plus integration against the worker) and **`node:test`** for JavaScript (worker, MCP, DB, hub-sync). The v0.1.2 ship criterion is **310/310 bats + all affected node tests green**.

## Test Framework Summary

| Stack | Framework | Runner | Location | File suffix |
|-------|-----------|--------|----------|-------------|
| Shell | `bats-core` (git submodule) | `make test` or `./tests/bats/bin/bats tests/*.bats` | `tests/*.bats` | `.bats` |
| Node.js | `node:test` (built-in) + `node:assert/strict` | `cd plugins/arcanon && npm test` | `plugins/arcanon/worker/**/*.test.js` | `.test.js` |

Zero external test-framework dependencies on the Node side -- no Jest, Mocha, Vitest. Zero test-framework npm deps in `plugins/arcanon/package.json`.

## Bats Suite

### Framework wiring

- Bats binary: `tests/bats/bin/bats` (git submodule at `tests/bats/`)
- Helper libs, also submodules: `tests/test_helper/bats-support/`, `tests/test_helper/bats-assert/`
- Shared entry helper: `tests/test_helper.bash` loads both. Each test file sources it:

```bash
load "$TEST_DIR/test_helper/bats-support/load"
load "$TEST_DIR/test_helper/bats-assert/load"
```

- Non-generic helpers: `tests/helpers/arcanon_enrichment.bash` (SessionStart enrichment), `tests/helpers/mock_detect.bash`.

### Run commands

```bash
make test                                # all bats
./tests/bats/bin/bats tests/*.bats       # same, directly
./tests/bats/bin/bats tests/detect.bats  # single file
```

### File organisation

- Location: `tests/*.bats` (repo root, NOT `plugins/arcanon/tests/`).
- Naming: one file per subsystem -- `detect.bats`, `format.bats`, `file-guard.bats`, `mcp-server.bats`, `config.bats`, `drift-dispatcher.bats`, `drift-types.bats`, `drift-versions.bats`, `impact-hook.bats`, `impact-merged-features.bats`, `update.bats`, `session-start.bats`, `session-start-enrichment.bats`, `mcp-launch.bats`, `mcp-wrapper.bats`, `mcp-chromadb-fallback.bats`, `worker-index.bats`, `worker-lifecycle.bats`, `worker-restart.bats`, `structure.bats`, `commands-surface.bats`, `install-deps.bats`, `lint.bats`, `siblings.bats`, `db-path.bats`.
- Fixtures: `tests/fixtures/<category>/` -- usually mock shell scripts or mock config files.
- Subdirs for deeper fixtures: `tests/integration/`, `tests/storage/`, `tests/ui/`, `tests/worker/`.
- Integration flow: `tests/integration/impact-flow.bats` exercises the full scan -> query pipeline.

### Test structure pattern

```bash
#!/usr/bin/env bats

setup() {
  load test_helper
  PLUGIN_ROOT="$(cd "$BATS_TEST_DIRNAME/../plugins/arcanon" && pwd)"
  export PLUGIN_ROOT
  # macOS: prefer Homebrew bash so Bash 4+ features work
  [[ -d /opt/homebrew/bin ]] && PATH="/opt/homebrew/bin:$PATH"
}

@test "detect_project_type returns 'python' for a repo with requirements.txt" {
  source "$PLUGIN_ROOT/lib/detect.sh"
  cd "$(mktemp -d)"
  touch requirements.txt
  run detect_project_type "$PWD"
  assert_success
  assert_output "python"
}
```

### Bats idioms

- `PLUGIN_ROOT` is set per-file in `setup()`; `test_helper.bash` deliberately does NOT set it. Multiple tests rely on `export PLUGIN_ROOT`.
- Always use `bats-assert` matchers: `assert_success`, `assert_failure`, `assert_output`, `assert_output --partial`, `refute_output`.
- Use `run <cmd>` for every shell invocation so exit code is captured in `$status` and stdout in `$output`.
- Temp dirs via `mktemp -d`; tests must clean up after themselves or rely on bats' per-test `BATS_TMPDIR`.

### Stub-based testing for external tools

External binaries (ruff, eslint, chromadb, curl) are stubbed by dropping a shell script into a temp `STUB_DIR` and prepending it to `PATH`:

```bash
@test "format hook - runs ruff format for .py file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/ruff_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/ruff_called" ]
}
```

### Latency tests

`tests/impact-hook.bats` includes a benchmark that asserts p99 latency of `impact-hook.sh`. The threshold is tunable:

- Local-dev target: `50ms` (baseline)
- CI override: `IMPACT_HOOK_LATENCY_THRESHOLD=100` (CI workflow sets this)
- GitHub Actions shared runners add ~30-60ms variance on sub-100ms benchmarks; 2x headroom prevents false alarms while still catching a 200ms+ regression.

The companion script `tests/impact-hook-latency.sh` can be run standalone for profiling.

## Node Suite

### Framework wiring

- Runner: Node's built-in `node:test` -- no devDependencies required.
- Asserts: `node:assert/strict`.
- DB fixtures: `better-sqlite3` used directly with `:memory:` databases.
- Command: `npm test` at `plugins/arcanon/` (script at `plugins/arcanon/package.json:37`):

```
"test": "find worker -name '*.test.js' -not -path '*/node_modules/*' -print0 | xargs -0 node --test"
```

Subsets:

```json
"test:storage":    "node --test worker/db/query-engine-*.test.js"
"test:hub-sync":   "find worker/hub-sync -name '*.test.js' -print0 | xargs -0 node --test"
"test:migrations": "node --test worker/db/migration-*.test.js worker/db/migrations.test.js"
```

### Test file organisation

- **Co-located** with source: `worker/db/query-engine.js` sits next to `worker/db/query-engine-search.test.js`, `query-engine-enrich.test.js`, `query-engine-actors.test.js`, `query-engine-confidence.test.js`, `query-engine-graph.test.js`, `query-engine-logger.test.js`, `query-engine-mcp-enrichment.test.js`, `query-engine-sanitize.test.js`, `query-engine-upsert.test.js`, `query-engine-bugfixes.test.js`, `query-engine.dependencies.test.js`.
- One-test-per-concern: each suffix isolates a behaviour (enrichment vs. search vs. upsert). Keeps individual files readable and allows `test:storage` to target just one.
- Database tests: `worker/db/database.test.js`, `pragma.test.js`, `snapshot.test.js`, `pool-repo.test.js`.
- Migration tests: `migration-004.test.js`, `migration-008.test.js`, `migration-010.test.js`, `migrations.test.js` (sequentially exercises all 11 migrations against an in-memory DB).

### Test structure pattern

```js
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { search, _stmtCache, StmtCache } from "./query-engine.js";

let db;
let tmpRoot;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "arcanon-search-test-"));
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE ...`);
});

after(() => {
  db.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("search() tier selection", () => {
  test("returns an array at the SQL tier", () => {
    const rows = search(db, { query: "payment", skipChroma: true, skipFts5: true });
    assert.ok(Array.isArray(rows));
  });
});
```

### Fixture DB pattern

The canonical recipe (see `plugins/arcanon/worker/db/query-engine-search.test.js` and `migrations.test.js`):

```js
const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
runMigrations(db);        // or inline schema for isolation
const qe = new QueryEngine(db);
```

Per-test isolation: use in-memory DBs, not disk. Phase 14-02 decision was to avoid the module-level singleton in `worker/db/database.js` during tests -- open `better-sqlite3` directly.

### Seed helpers

Seed helpers are defined inline per test file rather than shared modules:

```js
function seedRepo(db) {
  return db.prepare("INSERT INTO repos (path, name, type) VALUES (?,?,?)")
    .run("/tmp/test", "test-repo", "single").lastInsertRowid;
}

function seedService(db, repoId, { name, type = "service" } = {}) {
  return db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language, type) VALUES (?,?,?,?,?)"
  ).run(repoId, name, ".", "typescript", type).lastInsertRowid;
}
```

### Test doubles

- Handwritten mocks for hub / network; no mocking framework.
- Tests that exercise real DB schemas often attach a `_db` reference on the double so assertions can inspect post-state directly.
- Example -- `query-engine-enrich.test.js` builds a custom DB with `buildDb({ withActors: true })` and passes that db into the function-under-test; no class-level mocking.

### Mocking philosophy

- **Mock:** external HTTP (hub), ChromaDB when unavailable, file-system boundaries far from the unit under test.
- **Don't mock:** SQLite -- use `:memory:` DBs instead. They're fast and give real schema coverage.
- **Don't mock:** the migration runner -- run migrations against a fresh in-memory DB so schema drift surfaces immediately.
- **Don't mock:** git -- run real `git init`, commit, status against `mkdtempSync()` directories.

### Known failing tests (documented)

Two pre-existing failures are tracked in `.planning/phases/105-VERIFICATION.md`:

- `plugins/arcanon/worker/mcp/server-search.test.js` -- `queryScan` drift.
- `plugins/arcanon/worker/scan/manager.test.js` -- incremental prompt mock.

These are explicitly carved out of "green" gating until their tracking phase lands. All other tests must pass.

## Coverage

No coverage enforcement is configured. The team relies on code review + TDD discipline instead. `node --test` does not emit coverage unless invoked with `--experimental-test-coverage`, which is not part of the default script.

## CI Pipeline

Workflow: `.github/workflows/ci.yml`. Four jobs, all running on `ubuntu-latest`:

| Job | Purpose | Node | Key step |
|-----|---------|------|----------|
| `lint-manifests` | `jq empty` on plugin.json, marketplace.json, hooks.json, package.json + name assertions | -- | `jq empty plugins/arcanon/.claude-plugin/plugin.json` |
| `shell-lint` | `shellcheck -x --severity=error -e SC1091 plugins/arcanon/{scripts,lib}/*.sh` | -- | apt install shellcheck |
| `test-hub-sync` | Run only `worker/hub-sync/` node tests on a matrix of Node versions | 20, 22 | `npm ci --no-audit --no-fund` then `node --test worker/hub-sync/` |
| `test-bats` | Full bats suite against real worker | 22 | `tests/bats/bin/bats tests/*.bats` with `IMPACT_HOOK_LATENCY_THRESHOLD=100` |

- `actions/checkout@v4` uses `submodules: recursive` -- bats and helper libs are required.
- `npm ci` is used (not `npm install`) so the lockfile MUST stay in sync with `package.json`.
- `actions/setup-node@v4` caches npm based on `plugins/arcanon/package-lock.json`.

## Test Philosophy

- **TDD RED/GREEN cycle.** Phase execution normally writes a failing test first, lands the minimal GREEN edit, then verifies.
- **Test failures count as signal during refactor phases.** Example: Phase 101's runtime purge broke tests that pinned `LIGAMEN_*` env names -- those reds were the intended signal. Update the tests as part of the refactor, don't add a compat shim.
- **Both suites green to ship.** 310/310 bats + all affected node tests is the v0.1.2 criterion. Neither can be waived.
- **In-memory DBs over mocks.** Real SQLite against the real schema is cheaper and catches more drift than a mock.
- **Co-located tests, many small files.** Prefer `query-engine-enrich.test.js` + `query-engine-search.test.js` over one 2000-line `query-engine.test.js`.

## Common Patterns

### Async setup / teardown

```js
import { before, after } from "node:test";

before(async () => { /* ... */ });
after(() => { db.close(); rmSync(tmpRoot, { recursive: true, force: true }); });
```

### Error-path testing

```js
test("throws on missing services table", () => {
  const bareDb = new Database(":memory:");
  assert.throws(() => enrichImpactResult(bareDb, { id: 1 }),
    /no such table: services/);
});

test("chromaSearch rejects when chromaAvailable=false", async () => {
  await assert.rejects(async () => chromaSearch("test", 10),
    /ChromaDB not available/);
});
```

### Graceful degradation

Migration-gated features must keep working when the migration has not been applied -- tests assert this:

```js
test("does not throw when actors table is absent", () => {
  const dbNoActors = buildDb({ withActors: false });
  // function still works, returns empty results
});
```

### Bats JSON assertion

```bash
run bash "$PLUGIN_ROOT/scripts/session-start.sh" <<< '{"session_id":"x","cwd":"'"$PWD"'","hook_event_name":"SessionStart"}'
assert_success
assert_output --partial '"additionalContext"'
```

### Running a single node test

```bash
cd plugins/arcanon
node --test worker/db/query-engine-enrich.test.js
```

### Running a single bats test

```bash
./tests/bats/bin/bats -f "returns 'python'" tests/detect.bats
```

## Where to Add New Tests

| Change type | Test file |
|-------------|-----------|
| New `scripts/<hook>.sh` | New `tests/<hook>.bats` |
| New `lib/<helper>.sh` | Extend matching `tests/<name>.bats` or create one |
| New `worker/<dir>/<mod>.js` | Co-locate `worker/<dir>/<mod>.test.js` |
| New DB migration `NNN_*.js` | Extend `worker/db/migrations.test.js` and optionally add targeted `migration-NNN.test.js` |
| New MCP tool | Extend `worker/mcp/*.test.js` AND `tests/mcp-server.bats` for the CLI surface |
| New hub-sync behaviour | `worker/hub-sync/*.test.js` (also runs under the Node 20/22 matrix) |

---

*Testing analysis: 2026-04-24*
