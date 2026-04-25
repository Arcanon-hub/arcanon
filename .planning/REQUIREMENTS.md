# Requirements: Arcanon v0.1.3 — Trust & Foundations

**Defined:** 2026-04-25
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

**Milestone intent:** Land both High-priority backlog items (THE-1022 scan trust, THE-1028 install architecture), close THE-1027 (update-check timeout), and remove the deprecated `/arcanon:upload` stub. Ships a trustworthy install path, trustworthy scan layer, and a tighter command surface — the foundation v0.1.4 / v0.1.5 build new commands on.

**Linear tickets covered:** THE-1022, THE-1027, THE-1028.

## v1 Requirements (Milestone v0.1.3)

### Install + Worker Startup Architecture (INST) — THE-1028

Hard-remove `runtime-deps.json`. Single source of truth = `package.json`. Replace file-existence checks with binding-load validation. Drop duplicate self-heal in `mcp-wrapper.sh`.

- [x] **INST-01
**: `plugins/arcanon/runtime-deps.json` deleted from the repo
- [x] **INST-02
**: `scripts/install-deps.sh` rewritten — sentinel = sha256 of `jq '.dependencies + .optionalDependencies' package.json` (computed from current package.json each run, no separate manifest)
- [x] **INST-03
**: `install-deps.sh` validates binding load via `node -e "require('better-sqlite3'); new (require('better-sqlite3'))(':memory:').close()"` after install. If validation fails, runs `npm rebuild better-sqlite3` once before giving up.
- [x] **INST-04
**: `install-deps.sh` early-exits in <100ms when sentinel matches AND binding loads. No `npm install` invocation in the happy-path.
- [x] **INST-05
**: `install-deps.sh` exits 0 on all paths (non-blocking). Genuine install failure is logged to stderr and surfaced via worker startup, not by failing the SessionStart hook.
- [x] **INST-06
**: `scripts/mcp-wrapper.sh` reduced to `exec node "${PLUGIN_ROOT}/worker/mcp/server.js"` plus the existing CLAUDE_PLUGIN_ROOT resolution. No self-heal block. No npm install fallback.
- [x] **INST-07
**: bats test — sentinel matches AND binding loads → install-deps.sh exits in <100ms with no npm process spawned (lsof / process count assertion)
- [x] **INST-08
**: bats test — broken binding (delete `node_modules/better-sqlite3/build/Release/`) → install-deps.sh detects and triggers `npm rebuild better-sqlite3` (or full reinstall) → binding loads after
- [x] **INST-09
**: bats test — `npm install` succeeds with prebuild-install silent failure simulation (mock npm install that wipes `build/Release/`) → install-deps.sh detects via `require()` and triggers rebuild
- [x] **INST-10
**: bats test — fresh install (empty `node_modules/`) → install-deps.sh creates `node_modules/`, installs deps, validates binding, writes sentinel, exits 0
- [x] **INST-11
**: bats test — sentinel mismatch → install-deps.sh runs `npm install`, validates binding, updates sentinel
- [x] **INST-12
**: No regression in fresh-install flow: `claude plugin marketplace add` + `claude plugin install` + first session start → worker daemon healthy, MCP server starts, slash commands work

### Update-check Timeout Fix (UPD) — THE-1027

Decouple the `/arcanon:update --check` offline-decision from the 5-second `claude plugin marketplace update` refresh outcome. The mirror file is the source of truth; refresh failure is a staleness signal, not an offline signal.

- [x] **UPD-01
**: `scripts/update.sh --check` reads `~/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json` regardless of whether the background `claude plugin marketplace update arcanon` finished within 5s
- [x] **UPD-02
**: `update.sh --check` returns `status: "offline"` ONLY when the marketplace mirror file is missing entirely (genuinely fresh install, no mirror dir)
- [x] **UPD-03
**: `update.sh --check` returns `status: "newer"` when the mirror has a newer version than installed, even if the refresh background process timed out
- [x] **UPD-04
**: bats test — simulate slow `claude plugin marketplace update` (sleep 10) with mirror file present + remote version ahead of installed → assert `status: "newer"` (not `offline`)
- [x] **UPD-05
**: bats test — missing mirror dir → `status: "offline"` (regression guard)
- [x] **UPD-06
**: bats test — mirror present but same version as installed → `status: "equal"` regardless of refresh outcome

### Scan Trust Hardening (TRUST) — THE-1022

Six items from the v0.1.0 external review, deferred since 2026-04-21. Adds a verify command, enforces evidence schema, normalizes paths, adds base_path support, surfaces quality scores, and audits reconciliation.

- [ ] **TRUST-01**: New `/arcanon:verify` command — accepts a connection ID or a source-file path; re-reads the cited file; checks the claimed evidence snippet still exists at ±3 lines of `line_start`; returns per-connection verdict (`ok` / `moved` / `missing` / `method_mismatch`) with concrete evidence pointer
- [x] **TRUST-02**: `persistFindings` rejects connections whose `evidence` field is prose with no literal substring match against the contents of `source_file` at ±3 lines of `line_start`. Rejected connections logged to stderr (visible in worker logs) and skipped, not failing the whole scan. _(Phase 109-02 — implemented as whole-file substring check per CONTEXT D-03 since the connections schema has no `line_start` column. Lenient on null/missing/unreadable per D-05.)_
- [x] **TRUST-03**: Path canonicalization — connections whose only difference is a template variable name (`/runtime/streams/{stream_id}` vs `/runtime/streams/{name}`) collapse to one normalized key (`{_}` placeholder). Original template preserved in new `connections.path_template` column for display. _(Phase 109-01 + 109-02. Migration 013 also creates UNIQUE INDEX uq_connections_dedup which was missing in the codebase.)_
- [x] **TRUST-04
**: New migration adds `services.base_path TEXT` column; agent-prompt-service.md instructs the scanner to emit a `base_path` field per service (e.g., `/api`); connection resolution strips `base_path` from frontend-to-backend matches before comparing paths
- [x] **TRUST-05**: New migration adds `scan_versions.quality_score REAL` column. End-of-scan output computes and persists quality score = (high_confidence_count + 0.5 × low_confidence_count) / total_connections. Surface in `/arcanon:status` output (when worker has graph data) AND end of `/arcanon:map` output. Format: `"Scan quality: 87% high-confidence, 3 prose-evidence warnings"`. _(Phase 111-01 + 111-02 — migration 015; endScan persists; new GET /api/scan-quality + getScanQualityBreakdown; format strings match D-01)_
- [ ] **TRUST-06**: New migration adds `enrichment_log` table (`scan_version_id INTEGER REFERENCES scan_versions(id)`, `enricher TEXT`, `target_kind TEXT`, `target_id INTEGER`, `field TEXT`, `from_value TEXT`, `to_value TEXT`, `reason TEXT`, `created_at TEXT`). Post-scan reconciliation (`external` → `cross-service` reclassification) writes a row per change. New MCP tool `impact_audit_log(scan_version_id)` exposes the log.
- [x] **TRUST-07**: bats test — verify command happy path (cited evidence still present in source) → returns `ok` _(Phase 112-02 — `tests/verify.bats` Test 1; 3 ok verdicts + exit 0)_
- [x] **TRUST-08**: bats test — verify command file-moved path (source file no longer exists at the recorded path) → returns `moved` _(Phase 112-02 — `tests/verify.bats` Test 2; deleted users.js → 1 moved + 2 ok + exit 1)_
- [x] **TRUST-09**: bats test — verify command evidence-removed path (file exists but the snippet is gone) → returns `missing` _(Phase 112-02 — `tests/verify.bats` Test 3; rewritten users.js → 1 missing + 2 ok + exit 1)_
- [x] **TRUST-10**: node test — `persistFindings` evidence schema enforcement: agent emits a connection with `evidence: "this is just a paragraph with no code"` against a source file containing actual code → connection skipped, warning logged _(Phase 109-02 — `worker/db/query-engine-evidence.test.js`, 7 tests)_
- [x] **TRUST-11**: node test — path canonicalization: agent emits two connections with template variants → upserted as one row with both templates preserved in `path_template` _(Phase 109-02 — `worker/db/query-engine-canonical.test.js`, 9 tests including helper unit tests)_
- [x] **TRUST-12
**: node test — `services.base_path` migration runs idempotently; agent prompt populates the field; connection resolution honors it
- [x] **TRUST-13**: node test — `scan_versions.quality_score` populated by `endScan()`; readable via `getQualityScore(scan_version_id)` _(Phase 111-02 — `worker/db/query-engine.quality-score.test.js`, 10 cases incl. mixed/all-high/all-low/with-NULL/zero-conn/getter/breakdown/pre-015/scope)_
- [ ] **TRUST-14**: node test — `enrichment_log` table created by migration; reconciliation writes one row per crossing-value change

### Deprecated Command Removal (DEP) — scope addition

Remove the `/arcanon:upload` deprecated stub. Originally promised for v0.2.0; brought forward to v0.1.3 since v0.1.2 already shipped a breaking change.

- [x] **DEP-01**: `plugins/arcanon/commands/upload.md` deleted
- [x] **DEP-02**: `tests/commands-surface.bats` lines 33–40 (5 tests asserting `/arcanon:upload` exists as deprecated stub) removed
- [x] **DEP-03**: New bats test added — `tests/commands-surface.bats` asserts `commands/upload.md` does NOT exist (regression guard against accidental re-add)
- [x] **DEP-04**: `README.md` mentions of `/arcanon:upload` removed (currently in command table line ~55) — leaving only `/arcanon:sync` as the canonical verb
- [x] **DEP-05**: `plugins/arcanon/skills/impact/SKILL.md` reviewed and any `/arcanon:upload` references removed (likely none — verify)
- [x] **DEP-06**: `plugins/arcanon/CHANGELOG.md` `[0.1.3]` `### BREAKING` subsection adds entry: "Removed `/arcanon:upload` deprecated stub. Use `/arcanon:sync` (canonical since v0.1.1). CI scripts hardcoded to `/arcanon:upload` will fail."

### Verification Gate (VER)

- [ ] **VER-01**: bats suite green (≥310 tests, allowing the 1 macOS HOK-06 caveat at threshold=200)
- [ ] **VER-02**: node test suite green for affected modules (migrations, query-engine, scan, hub-sync, server)
- [ ] **VER-03**: Final repo-wide grep — `runtime-deps.json` does not exist anywhere in the repo
- [ ] **VER-04**: Final repo-wide grep — `commands/upload.md` does not exist; no `--help` references in command files (verify v0.1.4 scope wasn't accidentally absorbed)
- [ ] **VER-05**: Fresh-install integration smoke test on Node 25 — clone v0.1.3 tag, run `claude plugin install`, start session, run `/arcanon:map` (or `/arcanon:status`) without hitting binding errors
- [x] **VER-06**: Manifest version strings all bumped to 0.1.3 (5 manifest files: `plugins/arcanon/.claude-plugin/plugin.json`, `plugins/arcanon/.claude-plugin/marketplace.json`, `.claude-plugin/marketplace.json`, `plugins/arcanon/package.json`, `plugins/arcanon/runtime-deps.json` if not yet deleted at this point — actually it WILL be deleted per INST-01
, so 4 manifest files at 0.1.3)
- [ ] **VER-07**: CHANGELOG `[0.1.3] - 2026-04-XX` section pinned with all `### BREAKING`, `### Added`, `### Changed`, `### Fixed`, `### Removed` subsections complete

## Future Requirements (Deferred)

- **v0.1.4 Read-only & UX:** THE-1023 (`/arcanon:list`, `/arcanon:view`, `/arcanon:doctor`, `/arcanon:diff`), THE-1025 (`/arcanon:status` freshness completion + `--help` on every command + git-commits-since-scan count)
- **v0.1.5 Scan Ops & Integration:** THE-1024 (`/arcanon:rescan`, `/arcanon:correct`, `/arcanon:shadow-scan`, `scan_overrides` table, shadow DB infrastructure), THE-1026 (offline mode, explicit OpenAPI specs, known-externals catalog)
- **v0.2.0:** Skills layer + agent-composing skills, MCP-tool-wrapping skills

## Out of Scope

Explicit exclusions for v0.1.3.

| Feature | Reason |
|---|---|
| New commands beyond `/arcanon:verify` | Scope discipline — `/arcanon:list`, `/arcanon:doctor`, `/arcanon:diff` go to v0.1.4 |
| `--help` system on every command | v0.1.4 (THE-1025 Item 2) |
| `/arcanon:status` git-commits-since-scan count | v0.1.4 (THE-1025 Item 1 remainder; partially shipped via SessionStart enrichment in v0.1.1) |
| `/arcanon:rescan`, `/arcanon:correct`, `/arcanon:shadow-scan` | v0.1.5 (THE-1024) |
| Offline mode, explicit OpenAPI specs, known-externals catalog | v0.1.5 (THE-1026) |
| MCP server zombies cleanup | Separate investigation — Claude Code's plugin lifecycle ownership question |
| Worker port mid-session reload | Separate config-reload ticket |
| Skills + agents layer | v0.2.0 |
| Backwards-compat for `/arcanon:upload` callers | Zero-tolerance policy. Users on v0.1.2+ already adapted to BREAKING removals. |
| Migration tooling for `runtime-deps.json` users | None needed — install-deps.sh handles the upgrade silently via sentinel mismatch |

## Traceability

Populated by gsd-roadmapper during ROADMAP.md creation.

| Requirement | Phase | Status |
|---|---|---|
| INST-01 | Phase 107 | Complete (107-01, commit f58488d) |
| INST-02 | Phase 107 | Complete (107-02, commit e7cc02d) |
| INST-03 | Phase 107 | Complete (107-02, commit e7cc02d) |
| INST-04 | Phase 107 | Complete (107-02, commit e7cc02d) |
| INST-05 | Phase 107 | Complete (107-02, commit e7cc02d) |
| INST-06 | Phase 107 | Complete (107-01, commit 0f1862c) |
| INST-07 | Phase 107 | Pending |
| INST-08 | Phase 107 | Pending |
| INST-09 | Phase 107 | Pending |
| INST-10 | Phase 107 | Pending |
| INST-11 | Phase 107 | Pending |
| INST-12 | Phase 107 | Pending |
| UPD-01 | Phase 108 | Pending |
| UPD-02 | Phase 108 | Pending |
| UPD-03 | Phase 108 | Pending |
| UPD-04 | Phase 108 | Pending |
| UPD-05 | Phase 108 | Pending |
| UPD-06 | Phase 108 | Pending |
| TRUST-01 | Phase 112 | Pending |
| TRUST-02 | Phase 109 | Done |
| TRUST-03 | Phase 109 | Done |
| TRUST-04 | Phase 110 | Pending |
| TRUST-05 | Phase 111 | Done |
| TRUST-06 | Phase 111 | Pending |
| TRUST-07 | Phase 112 | Done |
| TRUST-08 | Phase 112 | Done |
| TRUST-09 | Phase 112 | Done |
| TRUST-10 | Phase 109 | Done |
| TRUST-11 | Phase 109 | Done |
| TRUST-12 | Phase 110 | Pending |
| TRUST-13 | Phase 111 | Done |
| TRUST-14 | Phase 111 | Pending |
| DEP-01 | Phase 108 | Pending |
| DEP-02 | Phase 108 | Pending |
| DEP-03 | Phase 108 | Pending |
| DEP-04 | Phase 108 | Pending |
| DEP-05 | Phase 108 | Pending |
| DEP-06 | Phase 108 | Pending |
| VER-01 | Phase 113 | Pending |
| VER-02 | Phase 113 | Pending |
| VER-03 | Phase 113 | Pending |
| VER-04 | Phase 113 | Pending |
| VER-05 | Phase 113 | Pending |
| VER-06 | Phase 113 | Pending |
| VER-07 | Phase 113 | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 45, Unmapped: 0

**Phase distribution:**
- Phase 107 (Install Architecture Cleanup): 12 requirements (INST-01..12)
- Phase 108 (Update-check Timeout + Deprecated Command Removal): 12 requirements (UPD-01..06, DEP-01..06)
- Phase 109 (Path Canonicalization + Evidence at Ingest): 4 requirements (TRUST-02, TRUST-03, TRUST-10, TRUST-11)
- Phase 110 (services.base_path End-to-End): 2 requirements (TRUST-04, TRUST-12)
- Phase 111 (Quality Score + Reconciliation Audit Trail): 4 requirements (TRUST-05, TRUST-06, TRUST-13, TRUST-14)
- Phase 112 (`/arcanon:verify` Command): 4 requirements (TRUST-01, TRUST-07, TRUST-08, TRUST-09)
- Phase 113 (Verification Gate): 7 requirements (VER-01..07)

---
*Requirements defined: 2026-04-25 — Roadmap traceability filled by gsd-roadmapper 2026-04-25*
