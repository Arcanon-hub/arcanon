# Requirements: Arcanon v0.1.4 — Operator Surface

**Defined:** 2026-04-25
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

**Milestone intent:** Make Arcanon navigable, correctable, and integratable. Bundle all four remaining Medium-priority backlog tickets (THE-1023..1026) into one milestone with wave-ordered phases (read-only first, write-side later, integration last).

**Linear tickets covered:** THE-1023, THE-1024, THE-1025, THE-1026.

## v1 Requirements (Milestone v0.1.4)

### Read-Only Commands (NAV) — THE-1023

Four new read-only commands that make the existing data navigable.

- [ ] **NAV-01**: `/arcanon:list` — concise project overview output. Format:

  ```
  Arcanon map for /path/to/project (scanned 2d ago)
    Repos:        3 linked
    Services:     12 mapped (2 libraries, 8 services, 2 infra)
    Connections:  47 (41 high-conf, 6 low-conf)
    Actors:       4 external
    Hub:          synced, 0 queued
  ```

  Pure read-only via worker HTTP. Silent in non-Arcanon directories (no map.db).

- [x] **NAV-02
**: `/arcanon:view` — top-level alias for the graph UI. Routes to the same implementation as `/arcanon:map view`. Discoverable without knowing about hidden subcommand.

- [x] **NAV-03
**: `/arcanon:doctor` — 7 smoke-test diagnostics:
  1. Worker HTTP reachable (`/api/readiness`)
  2. Worker `/api/version` matches installed plugin version
  3. DB schema version matches migration head (currently 16)
  4. `arcanon.config.json` parses + linked-repos resolve to existing dirs
  5. `$ARCANON_DATA_DIR` exists + is writable
  6. Impact-map DB integrity (`PRAGMA quick_check`) returns `ok`
  7. MCP server starts (smoke test `tools/list` returns 9 tools)
  8. Hub credentials (if configured) authenticate (curl `/api/version` against hub URL)

  Reports PASS/FAIL per check. Exit 1 if any critical (1, 5, 6) fails; exit 0 with WARN if non-critical (4, 7, 8) fails.

- [ ] **NAV-04**: `/arcanon:diff <scanA> <scanB>` — compare two scan_versions. Accepts:
  - Scan version IDs (`/arcanon:diff 5 7`)
  - `HEAD` / `HEAD~N` (resolves to most recent / N-th-most-recent scan)
  - ISO timestamps (`/arcanon:diff 2026-04-20 2026-04-25`)
  - Branch heuristics (`/arcanon:diff main feature-x` — most recent scan associated with each branch's HEAD commit)

  Output: services added/removed/modified, connections added/removed/modified, summary counts.

### `--help` System (HELP) — THE-1025 Item 2

Every `/arcanon:*` command supports `--help` / `-h` / `help`.

- [ ] **HELP-01**: Every command markdown file (currently 9: `map`, `impact`, `drift`, `sync`, `login`, `status`, `export`, `update`, `verify`) gets a `## Help` section with usage block + 2-3 examples. Section is the source of truth — no separate help text file.

- [ ] **HELP-02**: A small bash detector wrapper (or `${CLAUDE_PLUGIN_ROOT}/lib/help.sh` helper) checks `$ARGUMENTS` for `--help` / `-h` / `help` and prints the `## Help` section content via `awk` extraction. Each command's run section calls the helper before its real logic.

- [ ] **HELP-03**: Pre-existing `commands/update.md:21` `claude plugin update --help` reference (upstream Claude Code host CLI flag) is preserved as-is — VER grep should refine to `/arcanon:.*--help` or whitelist that one line.

- [ ] **HELP-04**: bats test — iterate every command file under `plugins/arcanon/commands/*.md`, invoke `<cmd> --help`, assert non-empty output and 0 exit code. Fails if any command lacks the `## Help` section.

### Status Freshness (FRESH) — THE-1025 Item 1 (remainder)

`/arcanon:status` extension. Item 1's "scan age" was partially shipped via v0.1.1 SessionStart enrichment; this active scope adds parity in `/arcanon:status` output + the git-commits-since-scan signal.

- [ ] **FRESH-01**: `/arcanon:status` output now includes a `Latest scan: <date> (NN% high-confidence)` line — same data the SessionStart banner already carries.

- [ ] **FRESH-02**: New per-repo signal: `git log <last_scan_sha>..HEAD --oneline | wc -l` per tracked repo. Reports count of repos with un-scanned commits since last scan, and the number of new commits in each.

  Format addition:
  ```
  Latest scan: 2026-04-23 (87% high-conf)
  2 repos have new commits since last scan: api (12 new), worker (3 new)
  ```

- [ ] **FRESH-03**: New worker HTTP endpoint `GET /api/scan-freshness?project=<root>` returns `{last_scan_iso, last_scan_age_seconds, scan_quality_pct, repos: [{name, path, last_scanned_sha, new_commits}]}`. Mirrors `/api/scan-quality` and `/api/version` patterns.

- [ ] **FRESH-04**: `/arcanon:status` calls the new endpoint via `worker-client.sh` `worker_call` helper.

- [ ] **FRESH-05**: bats test — fixture with mock git repo + seeded scan_version → assert status output contains expected freshness line.

### Scan-Overrides Infrastructure (CORRECT) — THE-1024 Items #2 + #3 (rescan + correct)

New `scan_overrides` table. New `/arcanon:correct` command. New `/arcanon:rescan` command.

**This category gets a discuss-phase before plan-phase** — schema design has real surface area.

- [ ] **CORRECT-01**: Migration `017_scan_overrides.js` creates `scan_overrides` table:
  - `override_id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `kind TEXT NOT NULL CHECK(kind IN ('connection', 'service'))`
  - `target_id INTEGER NOT NULL` (connection_id or service_id)
  - `action TEXT NOT NULL CHECK(action IN ('delete', 'update', 'rename', 'set-base-path'))`
  - `payload TEXT` (JSON blob with action-specific fields, e.g. `{"source": "svc-a", "target": "svc-b"}` for `update`)
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `applied_in_scan_version_id INTEGER REFERENCES scan_versions(id)` (nullable; populated when scan applies the override)
  - `created_by TEXT` (defaults to `system` or whatever user-tracking we have)
  - Index on `kind + target_id` for lookup during scan

- [ ] **CORRECT-02**: New `/arcanon:correct` command supporting four actions:
  - `/arcanon:correct connection <id> --action delete` — removes connection on next scan
  - `/arcanon:correct connection <id> --action update --source <svc> --target <svc>` — re-points connection
  - `/arcanon:correct service <name> --action rename --new <name>` — renames service across all references
  - `/arcanon:correct service <name> --action set-base-path --path /api` — sets base_path

- [ ] **CORRECT-03**: Scan pipeline reads `scan_overrides` BEFORE `endScan` and applies pending overrides to the persisted findings. Override is marked `applied_in_scan_version_id` on apply. Already-applied overrides skipped on subsequent scans.

- [ ] **CORRECT-04**: `/arcanon:rescan <repo-path>` — re-scans exactly one repo. Bypasses the incremental-change-detection skip. Updates `scan_versions` for that repo only; other repos in the linked-repos config are not touched.

- [ ] **CORRECT-05**: `/arcanon:rescan` accepts the repo path or the repo `name` as registered in `repos` table.

- [ ] **CORRECT-06**: Node tests — migration 017 idempotent; insert/select scan_overrides; apply override during scan flow; idempotent re-apply.

- [ ] **CORRECT-07**: bats tests — `/arcanon:correct connection` happy paths for each action; `/arcanon:rescan` happy path; rescan on non-existent repo exits 2 with friendly error.

### Shadow Scan Workflow (SHADOW) — THE-1024 Item #4

Run a scan to a separate DB namespace; diff vs live; promote when ready.

- [ ] **SHADOW-01**: `/arcanon:shadow-scan` writes to `$ARCANON_DATA_DIR/projects/<hash>/impact-map-shadow.db` instead of `impact-map.db`. Same scan code path, different DB target via env var or scan flag.

- [ ] **SHADOW-02**: `/arcanon:diff --shadow` compares shadow vs live for the current project (or `--shadow <projectA>` for a specific project).

- [ ] **SHADOW-03**: `/arcanon:promote-shadow` atomically: (1) backs up `impact-map.db` to `impact-map.db.pre-promote-<timestamp>`, (2) renames `impact-map-shadow.db` → `impact-map.db`, (3) reports the backup path.

- [ ] **SHADOW-04**: bats tests — shadow scan writes to the shadow file (not live); diff --shadow shows differences; promote-shadow swaps and creates backup.

### Integration Improvements (INT) — THE-1026

Three sub-items: offline mode, explicit specs, externals catalog.

- [ ] **INT-01**: New config flag `hub.evidence_mode: "full" | "hash-only" | "none"`. Default `"full"` for back-compat. In `"hash-only"` mode, the hub upload payload's `evidence` field is replaced with `{ "hash": "<sha256>", "start_line": N, "end_line": M }` instead of the raw evidence string.

- [ ] **INT-02**: `/arcanon:sync --offline` exits 0 with a "scan persisted locally, no upload" message. No-op if hub is intentionally disabled OR unreachable. Differentiates "offline" (intentional) from "hub unreachable" (transient — still no-op but with a different exit message).

- [ ] **INT-03**: Hub Payload schema (existing `worker/hub-sync/payload.js`) extended to accept hashed evidence form. Backward-compatible: payload remains valid v1.1; hash-only is a new optional shape on the `evidence` field.

- [ ] **INT-04**: `/arcanon:drift openapi --spec <path>` — explicit spec path, bypasses `discoverOpenApiSpecs()` discovery. Repeatable: `--spec repoA/spec.yaml --spec repoB/spec.yaml` compares the two.

- [ ] **INT-05**: New file `plugins/arcanon/data/known-externals.yaml` with ~20 common third parties:
  - Stripe API (`api.stripe.com`)
  - Auth0 (`*.auth0.com`)
  - Dex (matches container path patterns)
  - OpenTelemetry Collector (port 4317, 4318)
  - S3 / Azure Blob Storage / GCS bucket URLs
  - GitHub API (`api.github.com`)
  - Slack webhooks (`hooks.slack.com`)
  - PagerDuty (`api.pagerduty.com`)
  - Sentry (`sentry.io`, `*.ingest.sentry.io`)
  - Datadog (`*.datadoghq.com`)
  - Twilio (`api.twilio.com`)
  - SendGrid (`api.sendgrid.com`)
  - Plus 8-10 more chosen by usage-frequency analysis

- [ ] **INT-06**: Scan enrichment pass loads `known-externals.yaml` and matches actor URLs/host patterns against the catalog. Matched actors get a friendly `label` field added to their record.

- [ ] **INT-07**: User extension via `arcanon.config.json` `external_labels` key — same shape as the catalog; merged with the shipped catalog (user takes precedence on key collision).

- [ ] **INT-08**: `/arcanon:list` (NAV-01) and graph UI show catalog-labeled external names instead of raw URLs.

- [ ] **INT-09**: Node tests — known-externals loader, catalog match logic, user-extension merge.

- [ ] **INT-10**: bats test — `/arcanon:drift openapi --spec X --spec Y` happy path with two real OpenAPI fixtures.

### Verification Gate (VER)

- [ ] **VER-01**: bats suite green (≥315 baseline + new HELP/NAV/CORRECT/SHADOW/INT tests; allow 1 macOS HOK-06 caveat at threshold=200)
- [ ] **VER-02**: node test suite green for affected modules (migrations 017, query-engine + scan_overrides reads, scan apply flow, hub-sync payload modes, known-externals catalog)
- [ ] **VER-03**: All 9 → 13+ commands have `## Help` sections; `/arcanon:<cmd> --help` returns non-empty output for all
- [ ] **VER-04**: Repo-wide grep for `--help` in commands/ — only acceptable hits are within `## Help` sections themselves OR the documented `commands/update.md` `claude plugin update --help` host-CLI reference. Grep refined from VER-04 in v0.1.3 (which expected zero hits) to `/arcanon:.*--help` outside `## Help` blocks.
- [ ] **VER-05**: Fresh-install integration smoke on Node 25 — `claude plugin install` + first session + `/arcanon:doctor` reports all PASS
- [ ] **VER-06**: 4 manifest files at version 0.1.4 + lockfile regenerated (mirrors v0.1.3 release pin)
- [ ] **VER-07**: CHANGELOG `[0.1.4] - 2026-04-XX` section pinned with all 5 subsections (`### Added` for new commands, `### Changed` for status output, `### Fixed` for any bugs caught, `### Deprecated`/`### Removed` if anything trims, plus `### BREAKING` if applicable — `scan_overrides` table is additive, not breaking)

## Future Requirements (Deferred)

After v0.1.4 ships:
- **v0.2.0 Skills & Agents** — Skills layer on top of shipped hooks, refactor inline `Explore` agent calls, MCP-tool-composing investigator agent. Intentionally deferred since v0.1.1.

## Out of Scope

Explicit exclusions for v0.1.4.

| Feature | Reason |
|---|---|
| Skills + agents layer | v0.2.0 |
| Auto-fix from `/arcanon:verify` results | Manual `/arcanon:correct` is the v0.1.4 answer; auto-apply is a separate design discussion |
| Migration tooling for users with hand-corrected DBs | Greenfield `scan_overrides` table — no prior-version data to migrate |
| `--help` markdown rendering with syntax highlighting | Plain text from `awk`-extracted section is enough; rendering is a Claude Code surface concern |
| Cross-language type inference for diff command | `/arcanon:diff` compares structural fields only (services, connections); type-aware diff is a v0.2.0+ concern |
| Hub-side `hash-only` evidence consumption | Hub-side is a separate repo (arcanon-hub); plugin emits the new payload shape, hub adoption is independent |

## Traceability

Populated by gsd-roadmapper during ROADMAP.md creation.

| Requirement | Phase | Status |
|---|---|---|
| NAV-01 | TBD | Pending |
| NAV-02 | TBD | Pending |
| NAV-03 | TBD | Pending |
| NAV-04 | TBD | Pending |
| HELP-01 | TBD | Pending |
| HELP-02 | TBD | Pending |
| HELP-03 | TBD | Pending |
| HELP-04 | TBD | Pending |
| FRESH-01 | TBD | Pending |
| FRESH-02 | TBD | Pending |
| FRESH-03 | TBD | Pending |
| FRESH-04 | TBD | Pending |
| FRESH-05 | TBD | Pending |
| CORRECT-01 | TBD | Pending |
| CORRECT-02 | TBD | Pending |
| CORRECT-03 | TBD | Pending |
| CORRECT-04 | TBD | Pending |
| CORRECT-05 | TBD | Pending |
| CORRECT-06 | TBD | Pending |
| CORRECT-07 | TBD | Pending |
| SHADOW-01 | TBD | Pending |
| SHADOW-02 | TBD | Pending |
| SHADOW-03 | TBD | Pending |
| SHADOW-04 | TBD | Pending |
| INT-01 | TBD | Pending |
| INT-02 | TBD | Pending |
| INT-03 | TBD | Pending |
| INT-04 | TBD | Pending |
| INT-05 | TBD | Pending |
| INT-06 | TBD | Pending |
| INT-07 | TBD | Pending |
| INT-08 | TBD | Pending |
| INT-09 | TBD | Pending |
| INT-10 | TBD | Pending |
| VER-01 | TBD | Pending |
| VER-02 | TBD | Pending |
| VER-03 | TBD | Pending |
| VER-04 | TBD | Pending |
| VER-05 | TBD | Pending |
| VER-06 | TBD | Pending |
| VER-07 | TBD | Pending |

**Coverage:**
- v1 requirements: 41 total
- Mapped to phases: 0, Unmapped: 41 (roadmapper fills this)

---
*Requirements defined: 2026-04-25*
