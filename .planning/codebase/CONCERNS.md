# Codebase Concerns

**Analysis Date:** 2026-04-24
**Plugin Version:** v0.1.2 (shipped 2026-04-24)
**Prior map:** 2026-03-31 (stale — this document supersedes)

This document tracks known tech debt, pre-existing bugs, deferred design
decisions, platform caveats, and breaking-change migration notes for the
Arcanon Claude Code plugin (`plugins/arcanon/`).

---

## 1. Active Concerns

Unresolved items that can bite during active development or in production.

### macOS platform caveats

**HOK-06 p99 latency — macOS BSD fork overhead**
- Files: `plugins/arcanon/scripts/impact-hook.sh`, `tests/bats/impact-hook.bats` (test 155 `HOK-06`)
- Issue: PreToolUse `impact-hook.sh` p99 latency measures ~130ms on macOS versus the 50ms Linux target. Root cause is BSD fork overhead, not hook logic.
- Current mitigation: CI on Linux passes with `IMPACT_HOOK_LATENCY_THRESHOLD=100`; local macOS developers may set `IMPACT_HOOK_LATENCY_THRESHOLD=200`.
- Status: Documented since v0.1.1. Not a regression. Pre-existing deviation noted in `.planning/milestones/v0.1.2-phases/105-verification-gate/105-VERIFICATION.md` (VER-02).
- Fix approach: Any future optimisation must stay in `impact-hook.sh` hot path — avoid adding new subprocess spawns.

**macOS BSD `date +%s%3N` returns literal garbage**
- Files: `plugins/arcanon/scripts/impact-hook.sh` lines 27–40 (`_ms_now()` helper)
- Issue: `date +%s%3N` emits the literal string `1234567890N` on macOS BSD `date(1)` instead of millisecond epoch.
- Current mitigation: `_ms_now()` shell helper detects the literal `N` and falls back to `python3 -c 'import time; print(int(time.time()*1000))'`. Note: python3 spawn costs ~30–40ms on macOS (documented in the file's PERFORMANCE NOTE).
- Status: Stable. Any new timing code that needs ms precision MUST use `_ms_now()` — do not call `date +%s%3N` directly.

**Bash 3.2 on macOS is incompatible**
- Files: `tests/bats/*.bats` setup() blocks; most `plugins/arcanon/scripts/*.sh`
- Issue: macOS ships Bash 3.2 as `/bin/bash`. Project requires Bash 4+ (associative arrays, `${var,,}` case conversion, `mapfile`).
- Current mitigation: bats test `setup()` functions inject the Homebrew Bash path (`/opt/homebrew/bin/bash` or `/usr/local/bin/bash`) when running on macOS.
- Status: Contributors on macOS must have Homebrew bash installed. Not enforced at install time.

### Design questions — unresolved

**`services.boundary_entry` vs `exposed_endpoints.handler` supersession**
- Files: `plugins/arcanon/worker/db/migrations/011_services_boundary_entry.js`, `plugins/arcanon/worker/db/query-engine.js` (upsertService paths), scan prompts in `worker/scan/agent-prompt-service.md` / `agent-prompt-library.md` / `agent-prompt-infra.md`
- Issue: Phase 106 shipped `boundary_entry` on `services` but the pre-existing `exposed_endpoints.handler` column remains populated. Both coexist with overlapping semantics — one is service-wide, one is per-endpoint.
- Risk: Consumers (UI, MCP tools, hub payload) may diverge over which field to trust.
- Decision deferred to a future milestone: supersede `exposed_endpoints.handler` with `services.boundary_entry`, or keep both with sharpened contracts.
- Fix approach: Before changing either column, audit all read sites (`worker/ui`, `worker/mcp`, `worker/hub-sync/payload.js`, `worker/cli/hub.js`).

### Coupling risks

**MCP Zod schema descriptions mention `ARCANON_PROJECT_ROOT`**
- Files: `plugins/arcanon/worker/mcp/server.js`
- Issue: MCP tool Zod schemas expose `ARCANON_PROJECT_ROOT` (renamed from `LIGAMEN_PROJECT_ROOT` in Phase 102) in their user-visible descriptions.
- Risk: Downstream Claude agents may copy the description text into prompts / configs. Any future rename of this env var silently breaks those downstream consumers.
- Fix approach: Treat the names `ARCANON_PROJECT_ROOT`, `ARCANON_DB_PATH`, `ARCANON_LOG_LEVEL` as a versioned public API. Bump the plugin version and document in CHANGELOG BREAKING if they ever change again.

**`/arcanon:update` depends on Claude Code CLI plugin install/uninstall shape**
- Files: `plugins/arcanon/commands/update.md`, `plugins/arcanon/scripts/update.sh`
- Issue: `/arcanon:update` shells out to the Claude Code CLI plugin lifecycle (install/uninstall). If Anthropic changes the CLI surface, the command breaks at runtime, not install time.
- Current mitigation: Script tries CLI path first and surfaces a diagnostic when the shape mismatches.
- Fix approach: When the CLI signature changes, update `scripts/update.sh` and bump the command's minimum Claude Code version. Do not silently swallow non-zero CLI exit codes.

---

## 2. Known Tech Debt (carried from earlier releases)

Items pre-dating v0.1.2 that are still in the tree.

**`console.log` in `database.js` script-mode guard**
- Files: `plugins/arcanon/worker/db/database.js` lines 324–339
- Issue: Script-mode guard block still uses `console.log` for schema diagnostics instead of the structured logger.
- Origin: pre-v5.5.0 era.
- Impact: Low — only fires when `database.js` is invoked as a script, not in the worker hot path.
- Fix approach: Replace with `logger.info` once a logger is already imported in that scope; otherwise leave — this path is developer-only.

**`getQueryEngineByHash` inline migration workaround**
- Files: `plugins/arcanon/worker/db/pool.js` lines 193 and 301–302 (fallback branch), `plugins/arcanon/worker/db/pool-repo.test.js` line 121
- Issue: `getQueryEngineByHash` runs inline migrations as a fallback when the canonical migration runner has not yet touched the DB. Duplicates migration logic.
- Impact: Works today but any new migration must be echoed in the inline path, which is an easy-to-miss contract.
- Fix approach: Collapse to a single migration entry point and have the hash-based lookup call it unconditionally. Cover with an explicit test that a pristine DB opened by hash applies all migrations.

**`renderLibraryConnections()` unused `outgoing` parameter**
- Files: `plugins/arcanon/worker/ui/modules/detail-panel.js` line 171 (definition), line 155 (call site), `plugins/arcanon/worker/ui/modules/detail-panel.test.js` lines 68–70 (`PANEL-03` asserts call site signature)
- Issue: `renderLibraryConnections(node, outgoing, incoming, nameById)` takes `outgoing` but the current body does not consume it.
- Impact: Harmless dead param; keeps the signature stable for tests.
- Fix approach: Either consume `outgoing` for library→library edges, or drop it and update `PANEL-03`.

**`node_metadata` table unused**
- Files: `plugins/arcanon/worker/db/migrations/` (whichever migration creates `node_metadata`); currently no reader or writer under `worker/`
- Issue: Table was added for forward-looking STRIDE/vuln enrichment views; nothing writes or reads it yet.
- Impact: Zero runtime cost, but migration must stay forever (or ship a destructive migration).
- Fix approach: Either land the STRIDE/vuln view that consumes it, or drop it via a new migration with a CHANGELOG BREAKING entry.

**`impact-flow.bats` imports stale module paths**
- Files: `tests/integration/impact-flow.bats` (e.g. line 27 imports `${PROJECT_ROOT}/worker/query-engine.js`, line 28 imports `${PROJECT_ROOT}/worker/chroma-sync.js`)
- Issue: Paths predate the Phase-3.0 restructure. Current locations are `plugins/arcanon/worker/db/query-engine.js` and `plugins/arcanon/worker/server/chroma.js`.
- Impact: Tests fail if anyone runs this bats file directly (it is not in the default `make test` flow, which is why this has not been caught).
- Fix approach: Rewrite import paths to the current `plugins/arcanon/worker/...` layout, or delete the file if the coverage is duplicated by newer node tests.

**`graph-fit-to-screen.test.js` — 2 stale assertions (Phase 26 regression)**
- Files: `tests/ui/graph-fit-to-screen.test.js`
- Issue: 2 assertions still target the extracted-helper shape of `fitToScreen()` from before Phase 26 inlined it into `worker/ui/graph.js`.
- Impact: Depends on current CI skip/allow-list — if the file runs, those assertions fail.
- Fix approach: Rewrite the two assertions against the inlined `fitToScreen()` in `plugins/arcanon/worker/ui/graph.js`, or delete them if the behaviour is covered by newer tests.

**`package.json` bin entry — resolved**
- File: `plugins/arcanon/package.json`
- Status: **Already resolved in v0.1.2** — there is no `bin` field in the current manifest. Earlier debt note about `ligamen-init.js` no longer applies.

---

## 3. v0.1.2-Specific Debt (new, introduced this milestone)

### Pre-existing test failures (confirmed unrelated to v0.1.2 but still red)

**`worker/mcp/server-search.test.js` — `queryScan` behaviour drift**
- Files: `plugins/arcanon/worker/mcp/server-search.test.js`
- Issue: `queryScan` tests assert on behaviour that diverged during an earlier refactor. 1 of 2 failing node tests as of ship.
- Impact: Masks real drift in `queryScan` if a new regression lands.
- Status: Filed for future milestone, no Linear ticket yet.
- Reference: `.planning/milestones/v0.1.2-phases/105-verification-gate/105-VERIFICATION.md` (VER-02).

**`worker/scan/manager.test.js` — `incremental prompt` mock missing `_db`**
- Files: `plugins/arcanon/worker/scan/manager.test.js` (affected describe block: `scanRepos — incremental prompt constraint`, line ~618; adjacent healthy mocks at lines 294, 512, 807, 1180, 1430)
- Issue: Incremental prompt test sets up a `queryEngine` mock without `_db`, but production code now threads `_db` through to `runEnrichmentPass`.
- Impact: Second of 2 failing node tests as of ship.
- Status: Filed for future milestone, no Linear ticket yet.
- Fix approach: Extend the mock with `_db: { prepare: () => ({ all: () => [] }) }` to match the pattern already used in the adjacent mocks.

### Missing tests for try/catch fallback paths

**No explicit test for `upsertService` pre-migration-011 fallback**
- Files: `plugins/arcanon/worker/db/query-engine.js` lines 358–379
- Issue: The `try { prepare(... boundary_entry ...) } catch { prepare(... no boundary_entry ...) }` fallback path is unit-tested only implicitly (test schemas always have the column).
- Related: `upsertConnection` has the same pattern for migration 009 fallback (lines 383–) and is also untested against an intentionally pre-009 schema.
- Priority: Low. Both fallbacks exist for upgrade robustness, not normal operation.
- Fix approach: Add one focused test in `query-engine-upsert.test.js` that boots the engine against a hand-rolled pre-011 schema and asserts the insert still succeeds.

**Silent catch in `_stmtUpsertService` hides schema drift**
- Files: `plugins/arcanon/worker/db/query-engine.js` lines 368–379 (catch branch for the boundary_entry prepare)
- Issue: The `catch {}` branch silently switches to the pre-011 prepared statement without a `logger.warn`. If a future schema bug makes the primary prepare fail for a reason other than missing `boundary_entry`, we silently downgrade.
- Priority: Medium if a user ever reports "boundary_entry showing null on new services" — the silent fallback is the first suspect.
- Fix approach: Emit `logger.warn('[upsertService] falling back to pre-011 schema', { err: err.message })` in the catch, keyed behind a dev/debug flag so it does not noise up normal upgrades.

---

## 4. Deferred Items

### Deferred design decisions

**Skills + agents layer — deferred to v0.2.0**
- Explicitly punted from v0.1.1 to v0.2.0.
- Rationale: The hooks layer is ambient (observable at every Write/Edit/MultiEdit). Skills/agents are higher-ceremony and we want real firing-behaviour data from hooks in the wild before we design the next layer.
- Files when work begins: new dirs under `plugins/arcanon/skills/` and `plugins/arcanon/agents/` (currently empty/placeholder).

**`boundary_entry` vs `exposed_endpoints.handler` supersession**
- See §1 (Active Concerns → Design questions). Both coexist after Phase 106; supersession call deferred.

**Issue #18 — closed in v0.1.2**
- Bug 1: better-sqlite3 Node 25 bindings — fixed.
- Bug 2: `services.boundary_entry` missing migration — fixed by migration 011.
- No carry-forward.

### Linear tickets (THE-1022..1026)

Filed after an external 20-point review before v0.1.1. Two of the twenty folded into v0.1.1 (cross-impact merge features); the remaining 18 were grouped into these 5 tickets:

| Ticket | Priority | Theme |
|---|---|---|
| THE-1022 | High | Scan quality improvements |
| THE-1023 | — | Read-only command polish |
| THE-1024 | — | Scan ops improvements |
| THE-1025 | — | UX polish |
| THE-1026 | — | Integration improvements |

Work order: THE-1022 first (quality gates everything else). THE-1023/1024 bundle naturally. THE-1025/1026 target v0.2.x.

### v0.1.1 carry-forwards still present in v0.1.2

**`session-start.sh` duplicates `lib/db-path.sh` hash logic inline**
- Files: `plugins/arcanon/scripts/session-start.sh` lines ~95–104, `plugins/arcanon/lib/db-path.sh`
- Issue: SHA-256 hasher resolution (`shasum -a 256` vs `sha256sum`) and the project-hash `printf '%s'` pattern are inlined in `session-start.sh` instead of sourcing `lib/db-path.sh`.
- Impact: Two places to update if hash semantics change. Both must stay byte-identical with Node's `crypto.createHash('sha256').update(cwd)`.
- Fix approach: Factor the shared helper into `lib/db-path.sh` with a sourceable function and call it from `session-start.sh`.
- Reference: v0.1.1 audit.

**`commands/update.md` — stale "Phase 1 status" paragraph**
- Files: `plugins/arcanon/commands/update.md` line 13
- Issue: Still reads "Phase 1 status: only the `--check` step is wired. Confirmation, kill, prune, ..." despite the rest of the update flow shipping in v0.1.1.
- Impact: Cosmetic — misleads users reading the command doc.
- Fix approach: Delete the paragraph, or rewrite as a current-state note.

**`/arcanon:update` CLI coupling**
- See §1 (Active Concerns → Coupling risks).

---

## 5. Breaking-Change Migration Notes (v5.x Ligamen → v0.1.2 Arcanon)

These are intentional breaks. Existing Ligamen users must act manually — the upgrade is **not** transparent.

Documented in `plugins/arcanon/CHANGELOG.md` BREAKING section (the only remaining user-visible `ligamen` references in the tree — all intentional migration instructions, confirmed by Phase 105 VER-01).

### ChromaDB collection rename — breaking

- Old: collection `ligamen-impact`
- New: collection `arcanon-impact` (`plugins/arcanon/worker/server/chroma.js` line 24: `COLLECTION_NAME = "arcanon-impact"`)
- Impact: Existing `ligamen-impact` collections are orphaned on v0.1.2 upgrade. Embeddings are not migrated.
- User action: Rebuild via `/arcanon:map`.
- Documented in CHANGELOG BREAKING.

### `~/.ligamen` data directory — ignored

- Old: `~/.ligamen/`
- New: `~/.arcanon/` (resolver: `plugins/arcanon/lib/data-dir.sh`; only `ARCANON_DATA_DIR` + `$HOME/.arcanon` are considered)
- Status: v0.1.2 removed the `~/.ligamen` fallback (Phase 101).
- User action: Rename the directory manually: `mv ~/.ligamen ~/.arcanon`.

### `ligamen.config.json` — ignored

- Old: `ligamen.config.json` in repo root
- New: `arcanon.config.json` (resolver: `plugins/arcanon/lib/config-path.sh`, `plugins/arcanon/worker/db/pool.js` line 131 iteration array `["arcanon.config.json"]`)
- Status: v0.1.2 removed the reader.
- User action: Rename the file manually. No schema changes.

### `LIGAMEN_*` shell profile env vars — ignored

- Old: `LIGAMEN_PROJECT_ROOT`, `LIGAMEN_DB_PATH`, `LIGAMEN_LOG_LEVEL`, `LIGAMEN_WORKER_PORT`, `LIGAMEN_CHROMA_*`, `LIGAMEN_DATA_DIR`, `LIGAMEN_CONFIG_FILE`
- New: same names with `ARCANON_` prefix
- Consumers (all read only the new `ARCANON_*` names):
  - `plugins/arcanon/worker/index.js` — `ARCANON_LOG_LEVEL`, `ARCANON_WORKER_PORT`
  - `plugins/arcanon/worker/mcp/server.js` — `ARCANON_LOG_LEVEL`, `ARCANON_DB_PATH`, `ARCANON_PROJECT_ROOT`
  - `plugins/arcanon/worker/server/chroma.js` — `ARCANON_CHROMA_*`
  - `plugins/arcanon/lib/data-dir.sh` — `ARCANON_DATA_DIR`
  - `plugins/arcanon/lib/config.sh` — `ARCANON_CONFIG_FILE`
- User action: `sed -i '' 's/LIGAMEN_/ARCANON_/g' ~/.zshrc ~/.bashrc` (or equivalent per shell).

### `@ligamen/runtime-deps` → `@arcanon/runtime-deps` — breaking

- Old package name: `@ligamen/runtime-deps`
- New: `@arcanon/runtime-deps` (`plugins/arcanon/runtime-deps.json`)
- Installer: `plugins/arcanon/scripts/install-deps.sh` uses full-file diff for idempotency — the rename propagated cleanly in v0.1.2.
- User action: None required if they rerun `install-deps.sh`; a fresh install writes the new name.

---

*Concerns audit: 2026-04-24*
