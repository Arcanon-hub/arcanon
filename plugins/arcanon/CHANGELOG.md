# Changelog

All notable changes to the Arcanon plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### BREAKING

- Removed `/arcanon:upload` deprecated stub. Use `/arcanon:sync` (canonical since v0.1.1). CI scripts hardcoded to `/arcanon:upload` will fail with "command not found"; migrate to `/arcanon:sync`.

### Removed

- `plugins/arcanon/commands/upload.md` deprecated stub command file.
- 5 bats tests in `tests/commands-surface.bats` asserting the deprecated stub's presence (replaced with a single regression-guard test asserting absence).
- `/arcanon:upload` references from `README.md` Quick start block and Commands table.

## [0.1.2] - 2026-04-24

### Fixed

- **`/arcanon:sync`, `/arcanon:upload`, `/arcanon:impact`, `/arcanon:export`, `/arcanon:drift`, `/arcanon:status` crashing on fresh Node 25 installs** (issue #18 Bug 1). `better-sqlite3` floor bumped from `^12.8.0` to `^12.9.0` so `npm install` pulls prebuilt `node-v141` binaries instead of failing a source compile. Applies to both `package.json` and `runtime-deps.json`.
- **`no such column: boundary_entry` error on `/arcanon:upload` and `/arcanon:export`** (issue #18 Bug 2). Added migration `011_services_boundary_entry.js` which adds the missing `boundary_entry TEXT` column to `services`. `upsertService` now writes `svc.boundary_entry` through; a try/catch fallback preserves backward compatibility for databases that haven't applied migration 011 yet.
- Removed the runtime `ALTER TABLE services ADD COLUMN boundary_entry` workaround from `manager.dep-collector.test.js` now that the migration handles it legitimately.

### BREAKING

The Ligamen → Arcanon rename is now enforced at the runtime layer. Legacy
names, paths, and package identities have been removed without fallback.

1. **All `LIGAMEN_*` env var reads removed.** The worker, `lib/`, and `scripts/`
   no longer read any `LIGAMEN_*` environment variable. Only `ARCANON_*` names
   are recognized (`ARCANON_PROJECT_ROOT`, `ARCANON_CHROMA_MODE`,
   `ARCANON_CHROMA_HOST`, `ARCANON_CHROMA_PORT`, `ARCANON_API_KEY`, etc.).
2. **`$HOME/.ligamen` data-dir fallback removed.** All SQLite, logs, queue,
   and scan state resolve exclusively under `$HOME/.arcanon/`. Existing
   `~/.ligamen/` directories are ignored.
3. **`ligamen.config.json` config reader removed.** Config discovery reads
   `arcanon.config.json` only. Any `ligamen.config.json` file in a repo is
   now invisible to the plugin.
4. **ChromaDB `COLLECTION_NAME` renamed** from `"ligamen-impact"` to
   `"arcanon-impact"`. Existing ChromaDB collections created under the
   Ligamen name are **orphaned** on upgrade — users must rebuild semantic
   search via `/arcanon:map` (or ignore if they were not using ChromaDB).
5. **`runtime-deps.json` package identity renamed** from
   `@ligamen/runtime-deps` to `@arcanon/runtime-deps`.

**Migration instructions:**

- Rename `ligamen.config.json` → `arcanon.config.json` at each repo root.
- Rename `$HOME/.ligamen/` → `$HOME/.arcanon/` (or re-run `/arcanon:map` to
  rebuild state at the new location).
- Rename any shell-profile `LIGAMEN_*` env vars to their `ARCANON_*`
  equivalents (e.g., `LIGAMEN_CHROMA_MODE` → `ARCANON_CHROMA_MODE`).
- If ChromaDB semantic search was in use, re-run `/arcanon:map` to populate
  the new `arcanon-impact` collection.

## [0.1.1] - 2026-04-23

### Added
- `/arcanon:update` self-update command with `--check` (semver-correct version check with offline-safe fallback), `--kill` (scan-lock guarded SIGTERM→5s→SIGKILL worker shutdown), `--prune-cache` (lsof-guarded), and `--verify` (10s health poll) modes.
- SessionStart banner enrichment — every new Claude session in an Arcanon-scanned project now gets an ambient suffix: `N services mapped. K load-bearing files. Last scan: date. Hub: status.` with `[stale map — last scanned Xd ago]` prefix when the scan is 48h–7d old. Silent fallback on any error.
- PreToolUse impact hook (`scripts/impact-hook.sh`) — pure-bash Tier 1 schema-file classification (`*.proto`, `openapi.*`, `swagger.*`) plus Tier 2 SQLite `root_path` prefix match, with worker HTTP primary and direct-SQLite fallback. Surfaces a cross-repo consumer warning as `systemMessage` before an Edit/Write lands. Self-exclusion inside `$CLAUDE_PLUGIN_ROOT`, `ARCANON_DISABLE_HOOK=1` escape hatch, and `ARCANON_IMPACT_DEBUG=1` JSONL trace.
- `lib/db-path.sh` helper that ports `worker/lib/data-dir.js` hash algorithm to pure bash for per-project SQLite resolution in hooks.
- `/arcanon:impact --exclude <repo>` flag (repeatable) and `/arcanon:impact --changed` mode (auto-detects changed symbols from `git diff`), absorbed from the retired `/arcanon:cross-impact` command.

### Changed
- `/arcanon:sync` is now the canonical upload-then-drain verb. Accepts `--drain` (queue-only), `--repo <path>`, `--dry-run`, and `--force`. Running with no flags uploads the current repo's latest scan and then drains the queue.
- Plugin config `auto_upload` renamed to `auto_sync` in `.claude-plugin/plugin.json` userConfig. Worker `hub.js` and `scan/manager.js` read via two-read fallback `cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]` so existing config files continue to work.
- `/arcanon:impact` adopts a 3-state degradation model inherited from the retired cross-impact command: (A) no worker → grep-based legacy fallback; (B) worker up with no map data → prompt to `/arcanon:map` plus grep fallback as partial answer; (C) worker up with map data → graph query flow.
- Manifest versions bumped to 0.1.1 across all 5 files (`plugin.json`, `plugins/arcanon/.claude-plugin/marketplace.json`, root `.claude-plugin/marketplace.json`, `package.json`, `runtime-deps.json`).

### Deprecated
- `/arcanon:cross-impact` command removed; all capabilities absorbed into `/arcanon:impact`. Banner and docs references scrubbed.
- `/arcanon:upload` is now a deprecated stub that forwards to `/arcanon:sync` and emits a stderr deprecation warning. Kept for one release so hardcoded CI pipelines don't break; scheduled for removal in v0.2.0.
- Legacy `auto_upload` config key still works via fallback, but a stderr deprecation warning is emitted on read. Migrate to `auto_sync`.

### Fixed
- `scripts/session-start.sh` was reading a stale JSON key (`hub_auto_upload`) after `worker/cli/hub.js` `cmdStatus` was renamed to emit `hub_auto_sync`. Users with `auto_sync` enabled saw "Hub: manual" in the banner instead of "Hub: auto-sync on". The jq filter now reads `.hub_auto_sync // .hub_auto_upload // false` for transitional safety.

## [0.1.0] Pre-release fixes

### Fixed
- Migration loader no longer imports `.test.js` files from `worker/db/migrations/`, preventing the Node test runner from polluting the MCP server's stdout and the worker's `logs/worker.log`. Fixes previously deferred bats failures MCP-01 ("tools/list returns exactly 8 tools") and WRKR-07 ("worker writes structured JSON log to logs/worker.log").
- Moved `worker/db/migrations/010_service_dependencies.test.js` to `worker/db/migration-010.test.js` to match the existing `migration-004.test.js` / `migration-008.test.js` convention and keep `migrations/` free of test files.
- Fixed broken `npm test` script that pointed at a non-existent `tests/` directory. `test`, `test:storage`, and `test:hub-sync` now resolve real test file paths; new `test:migrations` script added.
- Added `.gitignore` entries for `.DS_Store`, `.superset/`, local `.claude/` directory, `AGENTS.md`, and presentation artifacts (`*.pptx`, `*.xlsx`).

## Notes on prior versions

Earlier pre-public releases (v1.0 through v5.7.0) shipped under the
project's former name. The version was reset to `0.1.0` for the first
public Arcanon release, which added the Arcanon Hub sync pipeline and
consolidated the library-drift workstream.

The v5.8.0 internal milestone (Library Drift & Language Parity) shipped during the Arcanon rebrand and is captured as part of the first Arcanon public release rather than tagged separately. It delivered:

- **Library-level dependency drift (THE-1019):** manifest-aware `dep-collector.js` covering 7 ecosystems (npm, PyPI, Go, Cargo, Maven, NuGet, RubyGems), `service_dependencies` table with `dep_kind` discriminant and 4-column UNIQUE key, and Hub Payload v1.1 gated behind the `hub.beta_features.library_deps` feature flag.
- **Java / C# / Ruby parity (THE-1020):** `lib/detect.sh` language/project-type detection, `worker/scan/discovery.js` MANIFESTS extension (pom.xml, build.gradle, build.gradle.kts, Gemfile), drift parsers for Maven (with `<parent>` inheritance and `<dependencyManagement>` resolution), Gradle (Groovy + Kotlin DSL + `libs.versions.toml` catalog), NuGet (including `Directory.Packages.props` Central Package Management), and Bundler (`Gemfile.lock` with GEM/GIT/PATH sections). Type extractors for `.java`, `.cs`, `.rb`. Auth/DB enrichment signals for Spring Security 5+6, ASP.NET Identity, EF Core (including minimal-API `AddDbContext<T>()`), Devise, ActiveRecord, and `config/database.yml` adapter probe. `EXCLUDED_DIRS` adds Maven `target/` and MSBuild `obj/` / `bin/`.
- **Shell cleanup + dispatcher (THE-1021):** new `scripts/drift.sh` dispatcher with subprocess-based routing and reserved `licenses` / `security` slots, `lib/worker-restart.sh` extracted from duplicated restart logic in `session-start.sh` and `worker-start.sh`, and bug fixes (the `bc` subprocess in `wait_for_worker`, the `declare -A` key leak in `drift-types.sh`, the global stderr suppression in `lint.sh`, and an explicit Bash 4+ floor guard). Dead code removed from `impact.sh` and `lint.sh`.
