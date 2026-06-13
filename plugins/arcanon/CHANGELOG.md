# Changelog

All notable changes to the Arcanon plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-06-13

Release-grade hardening: license reconciliation, a clean dependency-security
audit, and documentation accuracy. No runtime behavior or command surface changed.

### Changed

- **Relicensed from AGPL-3.0 to Apache-2.0.** The shipped plugin `LICENSE` file
  previously still carried AGPL-3.0 text while every manifest declared Apache-2.0;
  the bundled `LICENSE` now matches the declared license. See `LICENSE` and `NOTICE`.

### Security

- Cleared all known dependency advisories — `npm audit` now reports **0 vulnerabilities**:
  - `fast-uri` 3.1.0 → 3.1.2 — two **high**-severity advisories (path traversal via
    percent-encoded dot segments; host confusion via percent-encoded authority delimiters).
  - `ip-address` → 10.2.0 (with `express-rate-limit` → 8.5.1) — moderate Address6 XSS.
  - `hono`, `qs`, `brace-expansion` — remaining moderate advisories.
  - All are transitive dependencies; no direct dependency or runtime API changed.

### Fixed

- `/arcanon:update` now reads the canonical root `marketplace.json`, and a duplicate
  inner copy was removed, so version checks no longer drift between the two files.
- User-facing documentation corrected against the implementation: hook disable toggles
  are `ARCANON_DISABLE_*` (were mistakenly documented as `LIGAMEN_DISABLE_*`); removed a
  stale claim that `LIGAMEN_*` env vars are still honored; the hub config example uses
  `auto-sync`; the version-drift ecosystem count is 8.

### Internal

- Removed leftover internal ticket IDs from shipped source comments.
- Corrected the planning docs' project identity to Arcanon and documented the
  allclear → Ligamen → Arcanon rename history for contributors.
- Labeled the architecture diagram as target-state (v0.2+).
- Deleted vestigial `v5.x` (Ligamen-era) git tags.

## [0.1.5] - 2026-04-30

### BREAKING

- **Hub uploads now require `org_id` (THE-1029, paired with arcanon-hub THE-1030).**
  Every scan upload sends an `X-Org-Id: <uuid>` HTTP header. Calling `uploadScan`
  without an `orgId` throws `HubError(status=400, code='missing_org_id')` BEFORE the
  network attempt. Resolution precedence: `opts.orgId` → `ARCANON_ORG_ID` env →
  `~/.arcanon/config.json#default_org_id`. Per-repo override (`hub.org_id` in
  `arcanon.config.json`) beats env beats machine default.

  **Upgrade path for v0.1.4 users:** Existing `~/.arcanon/config.json` files contain
  `{api_key, hub_url}` but no `default_org_id`. The next `/arcanon:sync` (or any
  auto-sync on scan-end) will fail with:

  ```
  AuthError: Missing org_id (sources tried: opts.orgId, ARCANON_ORG_ID env, ~/.arcanon/config.json#default_org_id).
    Run /arcanon:login --org-id <uuid> to set the machine default.
    Or set ARCANON_ORG_ID in your environment.
    Or add hub.org_id to this repo's arcanon.config.json for a per-repo override.
  ```

  Re-run `/arcanon:login arc_xxx` (auto-selects when the key has 1 grant; prompts
  on N>1; accepts explicit `--org-id <uuid>`) to populate `default_org_id` and
  resume uploads.

- **Hard prerequisite: arcanon-hub THE-1030 deploy.** v0.1.5 plugin code targets the
  server-side personal-credential rewrite + `whoami` endpoint + `X-Org-Id`
  enforcement shipped in arcanon-hub THE-1030. If the plugin is upgraded without
  the hub deploy, every upload fails fast with an actionable error — no silent
  data loss.

- **Internal: `uploadScan(payload, opts)` requires `opts.orgId` (AUTH-01).** No
  public-facing breakage. External tooling that imported `worker/hub-sync/client.js`
  directly must thread an org id.

### Added

- **`X-Org-Id` header on every scan upload** (AUTH-01). `uploadScan` sends the
  resolved org id on every POST to `${hubUrl}/api/v1/scans/upload`. Missing
  `orgId` throws `HubError(status=400, code='missing_org_id')` before any
  network call.
- **`worker/hub-sync/whoami.js` module** (AUTH-02). New module exporting
  `getKeyInfo(apiKey, hubUrl)` that calls `GET /api/v1/auth/whoami` and returns
  `{user_id, key_id, scopes, grants}`. Auth-class HTTP errors throw `AuthError`;
  transport errors throw `HubError`.
- **`/arcanon:login [arc_xxx] [--org-id <uuid>]` whoami flow** (AUTH-06). With
  `--org-id`: store the credential triple after a `whoami` verification pass
  (warn-but-allow if the key is not authorized for that org — the hub rejects
  at upload time anyway). Without `--org-id`: call `whoami` and branch — exactly
  **1 grant** auto-selects, **N grants** prompt via `AskUserQuestion` (CLI
  exit-code 7 + `__ARCANON_GRANT_PROMPT__` stdout sentinel for markdown-layer
  re-entry), **0 grants** fail loud with "key has no org grants — ask your
  admin". Hub-unreachable case: store the credential anyway when `--org-id` is
  supplied, emit a WARN that grants could not be verified.
- **Identity block in `/arcanon:status`** (AUTH-07). Renders resolved org id +
  source (env / repo config / machine default), key preview (`arc_xxxx…1234`),
  scopes, and the list of orgs the key is authorized for. Shows `(missing)` when
  no org id resolves. `--json` mode emits `identity: {…}` as a nested object
  (no top-level field churn for existing JSON consumers).
- **`worker/lib/path-mask.js` module** (PII-01). Exports `maskHome(p)` (`$HOME`
  prefix → `~`; idempotent; non-string passes through; exact-`$HOME` match
  returns `~`) and `maskHomeDeep(obj)` (walks an object/array, masks any string
  property whose key is path-y: `path`, `repo_path`, `source_file`,
  `target_file`, `root_path`, plus a configurable allowlist; cycle-safe via
  WeakSet).
- **`ARCANON_ORG_ID` environment variable** (AUTH-03). Mid-precedence source
  for org id: `opts.orgId` → `ARCANON_ORG_ID` env →
  `~/.arcanon/config.json#default_org_id`.
- **`arcanon.config.json hub.org_id` per-repo override** (AUTH-05). Threaded
  into `uploadScan` ahead of the resolver chain (per-repo override beats env
  beats machine default).
- **Server error code parsing on `uploadScan` failures** (AUTH-08). Recognized:
  `missing_x_org_id`, `invalid_x_org_id`, `insufficient_scope`,
  `key_not_authorized_for_org`, `not_a_member`, `forbidden_scan`,
  `invalid_key`. Each surfaces a user-actionable message via the frozen
  `HUB_ERROR_CODE_MESSAGES` map; unknown codes fall back to the existing
  RFC 7807 `body.title` rendering. `HubError` gains a `.code` field
  (string|null) without breaking `.status`, `.retriable`, `.body`, `.attempts`.
- **PII test gates** (PII-07). New `worker/lib/path-mask.test.js` (12 cases),
  `worker/scan/findings.pii06.test.js` (4 cases), and `tests/pii-masking.bats`
  (10 grep-assertions across MCP responses, HTTP responses, and worker logs).
- **Auth test suite** (AUTH-10). New `worker/hub-sync/whoami.test.js` (7 tests
  pinning parsed grants, `AuthError` on 401/403, `HubError` on transport / 5xx).
  Extended `client.test.js` (12 tests: `X-Org-Id` lands, missing-orgId throws
  before fetch, table-driven 7-code RFC 7807 contract, body.title fallback).
  Extended `integration.test.js` (8 tests: 3 e2e precedence sub-cases, login
  round-trip, whoami auto-select on N=1).

### Changed

- **`resolveCredentials(opts)` return shape** (AUTH-03). Now returns
  `{apiKey, hubUrl, orgId, source}` (was `{apiKey, hubUrl, source}`). Strict
  superset — existing destructures `{apiKey, hubUrl}` continue to work. Missing
  org id throws `AuthError` whose message names the three resolution sources
  and suggests `/arcanon:login --org-id <uuid>`. New
  `resolveCredentials({orgIdRequired: false})` opt-out for non-upload callers
  (e.g. doctor check 8) returns `orgId: null` instead of throwing.
- **`hasCredentials()` semantics (C2 option-a)** stays org_id-tolerant. Reports
  on api_key presence only; the missing-org_id throw is deferred to upload time
  so the actionable `AuthError` lands in scan-end logs verbatim. Preserves the
  v0.1.4 → v0.1.5 upgrade path (no silent auto-sync gating-off on first upgrade).
- **`storeCredentials(apiKey, opts)`** accepts `opts.defaultOrgId` and persists
  it as `default_org_id` in `~/.arcanon/config.json`. Existing keys preserved
  via spread-merge. File mode 0600 / dir mode 0700 unchanged.
- **MCP tool responses are masked** (PII-02). Every MCP tool response payload
  referencing `repo.path`, `path`, `source_file`, `target_file`, or `root_path`
  runs through `maskHomeDeep` before returning to the client. **Highest
  priority** — only egress to a third party (Anthropic).
- **HTTP responses are masked** (PII-03). `/api/scan-freshness`, `/projects`,
  and `/graph` responses run through `maskHomeDeep` before serialization. The
  `repo_path` projection from `query-engine.js` is masked at the response
  boundary, not in the DB.
- **Worker logger masks `extra` and stack traces** (PII-04). A single masking
  seam in `worker/lib/logger.js` (between the `Object.assign(lineObj, extra)`
  merge and the `JSON.stringify` serialize) routes all log output through
  `maskHomeDeep`. Stack-trace strings inside `extra.stack` are also masked.
  Console (TTY) output uses the same path.
- **CLI exporters mask repo paths** (PII-05). `worker/cli/export*.js` —
  mermaid, dot, and html exports run repo path strings through `maskHome`
  before emitting.
- **`parseAgentOutput` rejects absolute `source_file` values** (PII-06).
  `worker/scan/findings.js` logs WARN with the offending value (also masked),
  drops the field, does not fail the scan. Belt-and-suspenders against future
  agent regressions; the agent prompt contract already mandates relative paths.
- **`_readHubConfig` reads `cfg.hub.org_id`** (AUTH-05). `worker/scan/manager.js`
  threads the per-repo override into `uploadScan` ahead of the resolver chain.
- **Doctor check 8** (NAV-03 regression fix) uses
  `resolveCredentials({orgIdRequired: false})` so the round-trip works without
  an org id seeded in fixtures.
- **`commands/login.md`, `commands/status.md`, `arcanon.config.json.example`,
  `docs/hub-integration.md`, `docs/getting-started.md`,
  `docs/configuration.md`** (AUTH-09). Document the new `default_org_id` field,
  the `ARCANON_ORG_ID` env var, the `/arcanon:login [--org-id <uuid>]` flow
  with grant-count branching, the resolution-order precedence, and the
  Identity block in `/arcanon:status`.

## [0.1.4] - 2026-04-27

### Added

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
- **`--help` / `-h` / `help` flag on every `/arcanon:*` command** (HELP-01..04).
  Usage and examples extracted from each command's own `## Help` section
  (single source of truth — no separate help text file). New helper
  `lib/help.sh` is the shared extractor invoked from each command's bash
  block via `arcanon_print_help_if_requested`. bats test iterates every
  command + asserts non-empty output and exit 0.
- **`/api/scan-freshness` worker endpoint** (FRESH-03). Returns per-repo git
  commits since last scan, computed from `git log <last_scanned_sha>..HEAD
  --oneline | wc -l` per tracked repo. Mirrors `/api/scan-quality` and
  `/api/version` patterns; the existing `/api/scan-quality` endpoint is
  unchanged and remains available for back-compat. (Phase 116, FRESH-01..05)
- **`scan_overrides` table + apply hook** (CORRECT-01, CORRECT-03). Migration
  017 adds the table (kind ∈ {connection, service}, action ∈ {delete, update,
  rename, set-base-path}, payload JSON, applied_in_scan_version_id nullable
  for staged-vs-applied tracking). Scan pipeline applies pending overrides
  between `persistFindings` and `endScan`, stamping `applied_in_scan_version_id`
  per-override; idempotent re-apply.
- **`/arcanon:correct` command** (CORRECT-02, CORRECT-04, CORRECT-06). Stages
  a scan-overrides row per invocation. Subcommands cover all four (kind ×
  action) combos: `connection --action delete|update`, `service --action
  rename|set-base-path`. Override is queued (created_by='cli'), not applied
  — the next `/arcanon:map` or `/arcanon:rescan` consumes it via the Phase
  117-02 apply-hook. Silent in non-Arcanon directories.
- **`/arcanon:rescan <repo>` command** (CORRECT-04, CORRECT-05, CORRECT-07).
  Re-scans exactly one linked repo, bypassing the incremental change-detection
  skip. Other repos in the project are not touched. Resolves the repo by path
  or name with friendly disambiguation on multi-match (`worker/lib/repo-resolver.js`).
  Pending `scan_overrides` for the rescanned repo are applied automatically
  via the Phase 117-02 `applyPendingOverrides` hook between `persistFindings`
  and `endScan`. **Markdown-orchestrated** — the slash command itself drives
  the two-phase Claude agent workflow (discovery → deep scan) and persists
  via `openDb` + `QueryEngine` inline, mirroring `/arcanon:map`'s pattern.
  No worker HTTP route. Cross-repo reconciliation is preserved by reading
  the existing `services.name` set from the live DB before downgrading
  `external` connections to `cross-service`. Silent in non-Arcanon
  directories.
- **`/arcanon:shadow-scan` command** (SHADOW-01). Runs a scan into
  `${ARCANON_DATA_DIR}/projects/<hash>/impact-map-shadow.db`, leaving the live
  `impact-map.db` byte-untouched. Persistence routes through the new
  `getShadowQueryEngine` pool helper (always-fresh, never cached — bypasses
  the `openDb` process-singleton problem). **Markdown-orchestrated** — same
  agent recipe as `/arcanon:map`, but the persistence step swaps `openDb`
  for `getShadowQueryEngine`. No worker HTTP route. Shadow data NEVER
  uploads to the Hub by construction (`/arcanon:sync` reads from the live
  DB only). The repos to scan are derived from a read-only open of the
  live `impact-map.db` (no WAL pragma write) so the byte-identity contract
  on the live file is enforced structurally. Existing shadow DB triggers a
  one-line warning and is overwritten in place (non-interactive). Silent
  in non-Arcanon directories.
- **`/arcanon:diff --shadow` mode** (SHADOW-02). Compares the LATEST completed
  scan in the live `impact-map.db` against the LATEST completed scan in the
  `impact-map-shadow.db`. Reuses Phase 115's `diffScanVersions(dbA, dbB,
  scanIdA, scanIdB)` engine — passing the live DB handle and the shadow DB
  handle as the two sources (115's engine is pool-agnostic + read-only by
  contract — see scan-version-diff.js module docs). Both DBs opened READ-ONLY
  so neither file is mutated. Exits 2 with a friendly error when either DB is
  missing. Silent in non-Arcanon directories.
- **`/arcanon:promote-shadow` command** (SHADOW-03). Atomically swaps the
  shadow impact map over the live one (POSIX `rename(2)` — same filesystem
  guaranteed by sibling-path placement under `projectHashDir(...)`), backing
  up the prior live DB to `impact-map.db.pre-promote-<ISO-timestamp>`. WAL
  sidecars (`-wal`, `-shm`) are renamed alongside the main file in BOTH the
  backup and promote steps so SQLite never sees a stale log on next open.
  Cached live `QueryEngine` is evicted from the worker pool BEFORE the rename
  via the new `evictLiveQueryEngine(projectRoot)` helper (T-119-02-01 —
  prevents fd-to-renamed-out-inode bug). Active scan-lock check refuses to
  promote during a live `/arcanon:map` or `/arcanon:rescan` (T-119-02-04).
  Backups are NEVER auto-deleted — clean up manually. Best-effort rollback on
  mid-flight rename failure. Silent in non-Arcanon directories.
- **`plugins/arcanon/data/known-externals.yaml` catalog** (INT-05). Curated
  catalog of 20 common third-party services (Stripe, Auth0, OTel Collector,
  S3, GitHub, Slack webhooks, Datadog, Sentry, etc.) spanning
  api/webhook/observability/storage/auth/infra categories, with glob-style
  host patterns and/or port lists. Schema is documented in the file header.
- **Externals catalog enrichment pass** (INT-06). New scan enrichment pass
  loads `data/known-externals.yaml` and labels actors with friendly names
  (e.g., `api.stripe.com` becomes "Stripe API", `lambda.us-east-1.amazonaws.com`
  becomes "AWS Lambda"). Migration 018 adds the `actors.label TEXT NULL`
  column. `getGraph()` (used by the `/graph` endpoint and graph UI) now
  includes `actors[].label`, falling back gracefully to `null` on
  pre-migration-018 databases. The labeling pass runs once per repo after
  per-service enrichment, is repo-scoped via `actor_connections` JOIN,
  self-healing (clears stale labels when entries leave the catalog), and
  failure-isolated (any error logs WARN; the scan continues).
- **Externals catalog user extension** (INT-07). `arcanon.config.json` now
  accepts an `external_labels` key with the same shape as the shipped
  catalog. User entries merge with `data/known-externals.yaml` at scan time;
  user keys override shipped keys on collision (so a project can rename
  "Stripe API" to "Stripe (Production)"). The shipped YAML file is never
  mutated — the merge is in-memory only. Malformed user entries log WARN and
  are skipped; valid entries still load. Removing a user override reverts to
  the shipped label on the next scan.
- **Actor labels in `/arcanon:list`** (INT-08). The `Actors:` line now renders
  friendly labels inline, e.g., `Actors: 4 external (Stripe API, GitHub API,
  raw1.example.com, raw2.example.com)`. Inline list is capped at 5 labels
  with a `+N more` tail for the remainder. JSON mode (`--json`) gains an
  `actors` array of `{name, label}` objects with `label: null` when the
  catalog has no match. Zero actors prints the bare `0 external` line with
  no parenthetical.
- **Bats coverage for `/arcanon:drift openapi --spec`** (INT-10). End-to-end
  happy-path test with two real OpenAPI 3.0 fixtures (User.name ->
  User.full_name rename) validates the explicit-spec entry point shipped in
  Phase 120. Adds 4 tests to `tests/drift-openapi-explicit-spec.bats` (atop
  the 5 INT-04 tests from Phase 120), plus a control test that proves the
  explicit-spec code path is what runs — not a fallback through
  auto-discovery. Tolerant substring matching covers both the `oasdiff`
  rich-diff output and the `yq` structural-diff fallback. Fixtures live at
  `plugins/arcanon/tests/fixtures/externals/openapi-spec-{a,b}.yaml`.

### Changed

- **`/arcanon:status` per-repo freshness reporting** (FRESH-01, FRESH-02,
  FRESH-04). `/arcanon:status` now reports per-repo git commits since last
  scan via the new `GET /api/scan-freshness` endpoint. The existing
  `/api/scan-quality` endpoint is unchanged and remains available for
  back-compat.

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
