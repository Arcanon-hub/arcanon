# Changelog

All notable changes to the Arcanon plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Externals catalog user extension (INT-07)**: `arcanon.config.json` now accepts an `external_labels` key with the same shape as the shipped catalog. User entries merge with `data/known-externals.yaml` at scan time; user keys override shipped keys on collision (so a project can rename "Stripe API" to "Stripe (Production)"). The shipped YAML file is never mutated — the merge is in-memory only. Malformed user entries log WARN and are skipped; valid entries still load. Removing a user override reverts to the shipped label on the next scan.
- **Actor labels in `/arcanon:list` (INT-08)**: the `Actors:` line now renders friendly labels inline, e.g., `Actors: 4 external (Stripe API, GitHub API, raw1.example.com, raw2.example.com)`. Inline list is capped at 5 labels with a `+N more` tail for the remainder. JSON mode (`--json`) gains an `actors` array of `{name, label}` objects with `label: null` when the catalog has no match. Zero actors prints the bare `0 external` line with no parenthetical.
- **Externals catalog (INT-06)**: New scan enrichment pass loads `data/known-externals.yaml` and labels actors with friendly names (e.g., `api.stripe.com` becomes "Stripe API", `lambda.us-east-1.amazonaws.com` becomes "AWS Lambda"). Migration 018 adds the `actors.label TEXT NULL` column. `getGraph()` (used by the `/graph` endpoint and graph UI) now includes `actors[].label`, falling back gracefully to `null` on pre-migration-018 databases. The labeling pass runs once per repo after per-service enrichment, is repo-scoped via `actor_connections` JOIN, self-healing (clears stale labels when entries leave the catalog), and failure-isolated (any error logs WARN; the scan continues). Plan 121-02 ships the user extension and the UI / `/arcanon:list` surfacing on top of this foundation.
- `plugins/arcanon/data/known-externals.yaml` — curated catalog of 20 common third-party services (Stripe, Auth0, OTel Collector, S3, GitHub, Slack webhooks, Datadog, Sentry, etc.) spanning api/webhook/observability/storage/auth/infra categories, with glob-style host patterns and/or port lists. Schema is documented in the file header. Phase 120 ships data only — Phase 121 (INT-06..08) consumes the catalog to label external actors in the dependency graph. (INT-05)
- scan_overrides table (migration 017) for staged operator corrections (CORRECT-01).
- Scan pipeline applies pending scan_overrides between persistFindings and endScan, stamps applied_in_scan_version_id per-override (CORRECT-03).
- `/arcanon:correct` command stages a scan-overrides row per invocation. Subcommands cover all four (kind × action) combos: `connection --action delete|update`, `service --action rename|set-base-path`. Override is queued (created_by='cli'), not applied — the next `/arcanon:map` or `/arcanon:rescan` consumes it via the Phase 117-02 apply-hook. Silent in non-Arcanon directories. (CORRECT-02, CORRECT-04, CORRECT-06)
- `/arcanon:rescan <repo>` command re-scans exactly one linked repo, bypassing the incremental change-detection skip. Other repos in the project are not touched. Resolves the repo by path or name with friendly disambiguation on multi-match. Pending `scan_overrides` for the rescanned repo are applied automatically via the Phase 117-02 apply-hook during the rescan. New worker endpoint `POST /api/rescan?project=<root>&repo=<id>` and `scanSingleRepo` wrapper in the scan manager. Silent in non-Arcanon directories. (CORRECT-04, CORRECT-05, CORRECT-07)
- `/arcanon:shadow-scan` command (SHADOW-01). Runs a scan into `${ARCANON_DATA_DIR}/projects/<hash>/impact-map-shadow.db`, leaving the live `impact-map.db` byte-untouched. Same scan code path, different DB target via the new `getShadowQueryEngine` pool helper (always-fresh, never cached — bypasses the `openDb` process-singleton problem). New worker endpoint `POST /scan-shadow?project=<root>` and `options.skipHubSync` flag in `scanRepos` so synthetic shadow data NEVER uploads to the Arcanon Hub. Existing shadow DB triggers a one-line warning and is overwritten in place (non-interactive). Foundation for `/arcanon:diff --shadow` and `/arcanon:promote-shadow` (Plan 119-02). Silent in non-Arcanon directories.
- `/arcanon:promote-shadow` command (SHADOW-03). Atomically swaps the shadow impact map over the live one (POSIX `rename(2)` — same filesystem guaranteed by sibling-path placement under `projectHashDir(...)`), backing up the prior live DB to `impact-map.db.pre-promote-<ISO-timestamp>`. WAL sidecars (`-wal`, `-shm`) are renamed alongside the main file in BOTH the backup and promote steps so SQLite never sees a stale log on next open. Cached live `QueryEngine` is evicted from the worker pool BEFORE the rename via the new `evictLiveQueryEngine(projectRoot)` helper (T-119-02-01 — prevents fd-to-renamed-out-inode bug). Active scan-lock check refuses to promote during a live `/arcanon:map` or `/arcanon:rescan` (T-119-02-04). Backups are NEVER auto-deleted — clean up manually. Best-effort rollback on mid-flight rename failure. Silent in non-Arcanon directories.
- `/arcanon:diff --shadow` (SHADOW-02). Compares the LATEST completed scan in the live `impact-map.db` against the LATEST completed scan in the `impact-map-shadow.db`. Reuses Phase 115's `diffScanVersions(dbA, dbB, scanIdA, scanIdB)` engine — passing the live DB handle and the shadow DB handle as the two sources (115's engine is pool-agnostic + read-only by contract — see scan-version-diff.js module docs). Both DBs opened READ-ONLY so neither file is mutated. Exits 2 with a friendly error when either DB is missing. Silent in non-Arcanon directories.
- Every `/arcanon:*` command now responds to `--help` / `-h` / `help` with usage and examples extracted from its own markdown source. New helper `lib/help.sh` is the shared extractor; each command's own `## Help` section is the source of truth. (Phase 116, HELP-01..04)

### Changed

- `/arcanon:status` now reports per-repo git commits since last scan via the new `GET /api/scan-freshness` endpoint. The existing `GET /api/scan-quality` endpoint is unchanged and remains available for back-compat. (Phase 116, FRESH-01..05)
- **`/arcanon:list` command** (NAV-01). Concise project overview: linked repos,
  services partitioned by type, connection counts by confidence, external actor
  count, and hub sync status. Read-only via worker HTTP. Silent in non-Arcanon
  directories. Supports `--json` for machine consumption.
- **`/arcanon:view` command** (NAV-02). Top-level slash-command alias for
  `/arcanon:map view` — opens the graph UI in your default browser. Auto-starts
  the worker if it is not running. Pure markdown command (no Node-side
  handler); the existing `/arcanon:map view` keystroke is preserved for
  back-compat.
- **`/arcanon:doctor` command** (NAV-03). 8 smoke-test diagnostics with
  PASS/WARN/FAIL/SKIP per check and structured exit codes (0 = all pass or
  only non-critical WARN; 1 = critical fail). Critical checks: worker
  reachable, data dir writable, DB integrity. Non-critical: version match,
  schema head, config + linked repos, MCP smoke (liveness probe — server
  starts cleanly without crashing on import), hub credentials. Migration
  head computed dynamically from filesystem glob (no hard-coded constant).
  Supports `--json` for machine consumption. Silent in non-Arcanon
  directories. Read-only — uses an isolated read-only SQLite connection for
  the integrity check (does not touch the worker's process-cached DB pool).
- **`/arcanon:diff <scanA> <scanB>` command** (NAV-04). Compare any two scan
  versions — accepts integer scan IDs, `HEAD`/`HEAD~N` shorthand, ISO 8601
  timestamps, or branch names (resolves via `repo_state.last_scanned_commit`).
  Shows services + connections added/removed/modified. Read-only via direct
  SQLite read; silent in non-Arcanon directories. Supports `--json` for
  machine consumption. Diff engine factored into `worker/diff/` so Phase
  119's `/arcanon:diff --shadow` can reuse it. Same-DB diff detects
  added/removed only (production schema's UNIQUE constraints prevent same
  row across two scans); true modify-detection requires shadow-DB pattern
  (Phase 119).

## [0.1.3] - 2026-04-25

### BREAKING

- **`/arcanon:upload` removed** (DEP-01..05). The deprecated stub introduced in
  v0.1.1 is now gone. Use `/arcanon:sync` (canonical since v0.1.1). CI pipelines
  or scripts hardcoded to `/arcanon:upload` will fail with "command not found";
  migrate to `/arcanon:sync`.
- **`runtime-deps.json` removed** (INST-01). `package.json` is now the single
  source of truth for runtime npm dependencies. The `@arcanon/runtime-deps`
  package identity is retired. `scripts/install-deps.sh` no longer reads any
  separate manifest — it derives its sentinel from
  `jq '.dependencies + .optionalDependencies' package.json` directly.

### Added

- **`/arcanon:verify` command** (TRUST-01, 07, 08, 09). Re-reads cited evidence
  in source files and returns one of `ok` / `moved` / `missing` /
  `method_mismatch` per connection, without re-running a full `/arcanon:map`.
  Read-only and idempotent — safe to wire into CI or pre-commit hooks. Supports
  `--connection <id>` / `--source <file>` filters and structured exit codes
  (0=all-ok, 1=findings, 2=usage-error).
- **`services.base_path` column** (TRUST-04, 12). Migration 012 adds the column.
  `agent-prompt-service.md` instructs the scanner to emit per-service
  `base_path` (e.g., `/api`); connection resolution strips `base_path` before
  path matching, eliminating a class of false-mismatch findings on services
  that mount their routes under a common prefix.
- **`scan_versions.quality_score` column** (TRUST-05, 13). Migration 014 adds
  the column. `endScan()` computes
  `(high_confidence_count + 0.5 × low_confidence_count) / total_connections`
  and persists it. Surfaced in `/arcanon:status` and at the end of
  `/arcanon:map` as `Scan quality: 87% high-confidence, 3 prose-evidence warnings`.
- **`enrichment_log` table + `impact_audit_log` MCP tool** (TRUST-06, 14).
  Migration 015 adds the table. Post-scan reconciliation (e.g., external →
  cross-service downgrades) writes a row per change. New MCP tool
  `impact_audit_log(scan_version_id)` exposes the log to any project context
  (brings MCP tool count to 9).

### Changed

- **`scripts/install-deps.sh` rewritten** (INST-02..05). Sentinel is sha256 of
  `jq '.dependencies + .optionalDependencies' package.json`. Validation uses
  `node -e "require('better-sqlite3'); ..."` (binding-load), not file
  existence. Broken binding triggers `npm rebuild better-sqlite3` once before
  giving up. Happy path exits in <100ms with no `npm` process spawn. Always
  exits 0 — genuine failures are surfaced via worker startup, not by failing
  the SessionStart hook.
- **`scripts/mcp-wrapper.sh` simplified** (INST-06). Reduced to
  `CLAUDE_PLUGIN_ROOT` resolution + `exec node "${PLUGIN_ROOT}/worker/mcp/server.js"`.
  No self-heal block, no dep-install fallback, no file-existence checks.
- **`/arcanon:status` surfaces scan quality score** (TRUST-05). When the worker
  has graph data, status output now includes the same `Scan quality: NN%` line
  as `/arcanon:map`.

### Fixed

- **`/arcanon:update --check` 5-second false-offline** (THE-1027 / UPD-01..03).
  The mirror file (`~/.claude/plugins/marketplaces/arcanon/.../marketplace.json`)
  is now the source of truth for the offline-decision. A slow
  `claude plugin marketplace update arcanon` (>5s) no longer flips the verdict
  to `offline` — that status is reserved for genuinely missing mirror dirs
  (fresh install, no network).
- **Evidence-at-ingest enforcement** (TRUST-02, 03, 10, 11). `persistFindings`
  now rejects connections whose `evidence` field is prose with no literal
  substring match against the cited `source_file` at ±3 lines of `line_start`.
  Rejected connections log a structured warning and are skipped; the rest of
  the scan completes normally. Stops a class of hallucinated connections from
  polluting the graph. Migration 013 also canonicalizes the historical
  `path_template` column.

### Removed

- **`plugins/arcanon/runtime-deps.json`** (INST-01). File deleted; package
  identity `@arcanon/runtime-deps` retired. See `### Changed → install-deps.sh`
  for the replacement sentinel mechanism.
- **`/arcanon:upload`** (DEP-01..05). `commands/upload.md` deleted; the 5
  deprecated-stub assertions in `tests/commands-surface.bats` removed (replaced
  with a single regression-guard test asserting absence); `README.md` Quick
  start + Commands table mentions removed; `plugins/arcanon/skills/impact/SKILL.md`
  mentions removed. Use `/arcanon:sync` (canonical since v0.1.1).

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
