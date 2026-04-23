# Phase 101: Runtime Purge — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — well-scoped refactor)

<domain>
## Phase Boundary

Worker, MCP server, bash libs, and scripts read ONLY `ARCANON_*` env vars, `~/.arcanon`, and `arcanon.config.json`. Every `LIGAMEN_*` env var read, `$HOME/.ligamen` data-dir fallback, and `ligamen.config.json` config-reader branch is deleted outright. No two-read fallback pattern. No stderr deprecation warning for legacy names. `runtime-deps.json` package identity changes from `@ligamen/runtime-deps` to `@arcanon/runtime-deps`.

**Requirements (18):** ENV-01..09, PATH-01..06, PKG-01..03.

**Scope boundary:** This phase is runtime-only. Cosmetic rename in comments/docstrings/log-messages is Phase 102. Tests are Phase 103.

</domain>

<decisions>
## Implementation Decisions

### Hard-remove, not two-read
Per policy memory (feedback_no_ligamen_references.md) — do NOT add two-read fallbacks like `ARCANON_X ?? LIGAMEN_X`. Just read `ARCANON_X` only.

### No deprecation warnings
Do NOT emit stderr warnings when a `LIGAMEN_*` var would have been honored — simply do not read it.

### Breaking change acceptable
Users upgrading from v5.x must migrate their env vars, config file, and data dir. No migration tooling (would encode the legacy name).

### Files in scope (per REQUIREMENTS.md)
- `plugins/arcanon/worker/index.js` (ENV-01)
- `plugins/arcanon/worker/server/chroma.js` (ENV-02)
- `plugins/arcanon/worker/mcp/server.js` (ENV-03)
- `plugins/arcanon/lib/config.sh` (ENV-04)
- `plugins/arcanon/lib/data-dir.sh` (ENV-05, PATH-01)
- `plugins/arcanon/scripts/{lint,file-guard,format,worker-start,worker-stop,session-start,install-deps}.sh` (ENV-06, ENV-07)
- `plugins/arcanon/worker/lib/data-dir.js` (ENV-08, PATH-02)
- `plugins/arcanon/worker/lib/config-path.js` (ENV-09, PATH-04)
- `plugins/arcanon/lib/config-path.sh` (PATH-03)
- `plugins/arcanon/lib/linked-repos.sh` (PATH-05)
- `plugins/arcanon/lib/db-path.sh` (PATH-06)
- `plugins/arcanon/runtime-deps.json` (PKG-01)
- `plugins/arcanon/scripts/install-deps.sh` (PKG-03)

</decisions>

<code_context>
## Existing Code Insights

### Worker env var reads (current state)
- `worker/index.js` lines 25, 33-35 read `LIGAMEN_LOG_LEVEL`, `LIGAMEN_WORKER_PORT`; line 62 reads `LIGAMEN_CHROMA_MODE`.
- `worker/server/chroma.js` lines 56-85 read `LIGAMEN_CHROMA_MODE|HOST|PORT|SSL|API_KEY|TENANT|DATABASE`.
- `worker/mcp/server.js` lines 23, 27, 46-47 read `LIGAMEN_LOG_LEVEL`, `LIGAMEN_DB_PATH`, `LIGAMEN_PROJECT_ROOT`.

### Lib back-compat aliases
- `lib/config.sh` currently reads `LIGAMEN_CONFIG_FILE` as legacy alias, then re-exports both `ARCANON_*` and `LIGAMEN_*` for downstream consumers. Remove both the read and the re-export.
- `lib/data-dir.sh` currently checks `$HOME/.ligamen` if `~/.arcanon` doesn't exist. Remove that branch — only check `~/.arcanon`, create if missing.

### Package identity
- `runtime-deps.json` `"name"` field is `"@ligamen/runtime-deps"`. `scripts/install-deps.sh` uses full-file diff for idempotency (not version-based), so renaming will invalidate the sentinel exactly once — acceptable per v0.1.1 bump precedent.

### Test impact (deferred to Phase 103)
Tests in `tests/config.bats`, `tests/detect.bats`, `tests/format.bats`, `tests/file-guard.bats`, `tests/mcp-*.bats`, and worker `*.test.js` files currently set `LIGAMEN_*` env vars as fixtures. Phase 103 rewrites those. Until then, those tests will fail — that's expected and validates the purge landed.

</code_context>

<specifics>
## Specific Ideas

### Phase 101 must leave Phase 102 work alone
When editing a file, purge only the env var reads + fallback branches. Don't rename comments/docstrings/log messages — that's Phase 102. Leaving some `ligamen` text in comments during 101 is fine.

### TDD approach recommended
RED: remove the LIGAMEN_* read, confirm test that relies on it fails (proving the purge landed).
GREEN: verify ARCANON_* read path works end-to-end with only ARCANON_* set.

### Verification grep commands (run after edits)
- `grep -rn "LIGAMEN_" plugins/arcanon/worker plugins/arcanon/lib plugins/arcanon/scripts` → must return 0 lines
- `grep -rn "\.ligamen\|ligamen\.config\.json" plugins/arcanon/worker plugins/arcanon/lib plugins/arcanon/scripts` → must return 0 lines
- `grep "name" plugins/arcanon/runtime-deps.json` → must show `@arcanon/runtime-deps`

### Test failures during Phase 101 are expected
Tests in Phase 103's scope will break. Don't fix them in 101 — leave them red. Phase 103 rewrites them.

</specifics>

<deferred>
## Deferred Ideas

None — this phase is fully scoped.

</deferred>
