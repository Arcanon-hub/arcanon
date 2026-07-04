# Milestones

## v0.2.0 Scan Persistence, Pipeline & Security Hardening (Shipped: 2026-07-04)

**Phases completed:** 9 phases (135-143), 21 plans, ~50 tasks
**Requirements:** 38/38 complete (SEC-01..08, ISO-01..11, PIPE-01..04, CTR-01..05, INTG-01..04, PERF-01..06)
**Git range:** `v0.1.9` → `8a5496c` (PRs #58, #59, #60, #61, #62, #63, #64, #68, #70 + CI hotfix #69) — 65 files, +9,692 / −982
**Timeline:** 2026-06-29 → 2026-07-04 (~6 days) · audit `passed`, 0 blockers — `.planning/milestones/v0.2.0-MILESTONE-AUDIT.md`
**Shape:** four GitHub issues (#49/#50/#51/#52) fixed as one dependency-ordered milestone — security (independent) → persistence foundation → pipeline → integrations → scaling. Every phase carries a `VERIFICATION.md = passed`; the cross-phase integration checker confirmed the scan write path composes correctly across six phases without any later phase undoing an earlier one.

**Key accomplishments:**

- **Security (#51 — phases 135-136, PRs #58/#59):** closed an RCE-class shell-injection in the MCP server (git + oasdiff via `execFileSync` argv, `commit_range` validation, redacted error logs); bound Hub upload-queue rows to an immutable `(hub_url, org_id)` so an org switch can't misroute a queued upload, with dead-on-4xx.
- **Persistence foundation (#49 — phases 137-139, PRs #60/#61/#62):** removed the process-global DB singleton → per-project pool keyed by resolved dbPath; wrapped the full scan write path in one transaction (rollback-atomic, `completed_at` last, repo-scoped cleanup); added immutable snapshots wired into scan completion (migration 021 `map_versions.kind`/`repos_json`), a project run-id, and full child-state reconciliation.
- **Pipeline (#50 — phases 140-141, PRs #63/#64):** one canonical `contract.js` all persistence paths validate against (`cross-service` crossing, schema↔connection identity, source/symbol split — migrations 022/023); one `persistScanResult` pipeline behind all four transports (commands, manager, HTTP, MCP), fixing the MCP false-success, the rescan override `TypeError`, and the incremental-delete-of-unchanged bug.
- **Integration correctness (#52a — phase 142, PR #68):** `/arcanon:drift graph` routed through retained snapshots via `diffScanVersions` (fixed two fatal SQL bugs); Chroma sync hooked once into the completion path with project-namespaced IDs; dead `writeScan` removed; UI dangling-edge/ghost-node fix.
- **Scaling (#52b — phase 143, PR #70):** getGraph pagination, N+1 query batching (detectMismatches / actor connections / evidence cache), performance indexes (migration 024), bounded multi-repo concurrency, DB-pool idle eviction + close-on-shutdown, TTL caches. Benchmarked: a 200-service / 1000-connection graph renders in ~2.6ms.

**Patterns established:**

- **Verify CI-green before merging (learned the hard way):** CI checks are NOT required status checks on `main`, so `gh pr merge --auto` merged PRs #64/#68 while CI was red (a logger `ENOENT`-on-fresh-install bug that only reproduced where no worker had ever run — every CI runner). Fixed in #69; thereafter every merge was gated on actual CI green, and phase verifiers gained a fresh-`HOME` CI-parity check.
- **Sequential-on-main execution with per-phase executor→verifier→PR:** each phase shipped as its own reviewed PR; the verifier re-ran the full suite against shipped code (not SUMMARY claims).
- **Reproduce CI env issues locally with `HOME=$(mktemp -d)`** — the fresh-home run surfaces missing-dir/first-install bugs the developer's populated `~/.arcanon` hides.

**Known deferred at close (all tracked as GitHub issues):**

- **#71** (bug) — DB pool idle-eviction can close a handle held by a >10-min running scan (that repo silently fails). Low probability at current scale; fix = re-touch at write time or scan-lock/sweep integration.
- **#72** (enhancement) — the agent scan path bypasses the canonical `validateFindings` gate (Phase 140 design intent; defense-in-depth follow-up).
- **#73** (process, priority: high) — make the four CI checks *required* on `main` branch protection so auto-merge can't land red again.

---

## v0.1.9 Shadow Trio Removal, Rescan Repair & Scan/Mismatch Fixes (Shipped: 2026-06-29)

**Phases completed:** 6 phases (129-134), 13 plans, 32 tasks
**Requirements:** 52/52 complete (RM/FIX/DOC/TST/VER for 129-130 + the 4 inserted families PV-01..18, DM-01..03, SC-01..07, MM-01..09)
**Git range:** `ca5cb96` → `af8dfae` (PRs #41, #44, #47, #48); audit `tech_debt`, no blockers — `.planning/milestones/v0.1.9-MILESTONE-AUDIT.md`
**Shape:** began as the focused 129-130 cleanup, then absorbed four issue-driven scan/mismatch fixes (#42/#43/#45/#46) inserted mid-milestone via `/gsd-phase --insert`. Each inserted phase was verified by cross-AI (codex) review captured in `*-REVIEWS.md` rather than the formal verify-phase flow.

**Key accomplishments:**

- **Shadow trio removed end-to-end (RM-01..06, FIX-01, DOC-01..03 — Phase 129, PR #41):** Deleted `/arcanon:shadow-scan`, `/arcanon:promote-shadow`, and `/arcanon:diff --shadow` plus all worker machinery (`getShadowQueryEngine`, `cmdPromoteShadow` + handler, diff-engine shadow branch), while preserving the shared `diffScanVersions` scan-version engine. Repaired `/arcanon:rescan` — repointed its inline `node` off the removed `better-sqlite3` onto the `node:sqlite` adapter. Scrubbed both READMEs, `docs/commands.md`, and added a `[0.1.9]` BREAKING changelog entry.
- **Regression tests + release gate (TST-01..03, VER-01..02 — Phase 130):** New `tests/rescan-resolve.bats` executes the rescan Step-1 inline-`node` resolve path against a fixture DB so a future dependency rename fails CI instead of breaking silently; reintroduction guards assert the shadow command files stay absent. Manifests pinned to 0.1.9 with an npm-regenerated lockfile.
- **One canonical protocol vocabulary (PV-01..18 — Phase 131, #42, PR #44):** `worker/ui/modules/protocol.js` (`canonicalProtocol` + `CANONICAL_PROTOCOLS` + aliases) is the single source of truth shared across scan → persist → getGraph → UI. Fallback-not-reject: pub/sub, DB, GraphQL, SSE and unknown protocols all render as toggleable edges (`other`, never dropped). Cross-AI review added: actor edges carry `protocol_raw` end-to-end (NATS shows as "NATS"), and k8s/tf/helm/import render under a shared infra token.
- **No false endpoint mismatches on parameterized routes (DM-01..03 — Phase 132, #43, PR #47):** `detectMismatches()` canonicalizes `{...}`→`{_}` on both consumed and exposed paths before comparing and restricts the candidate set to `c.protocol IN ('rest','grpc')` — eliminating the false `endpoint_not_exposed` flood and the mis-flagging of events/db/infra connections.
- **Scanner detects backing-service clients by reasoning (SC-01..07 — Phase 133, #45, PR #48):** Discovery + service agent prompts now flag any file opening a network connection to a stateful backing service (datastore/broker/search/cache/vector DB) by reasoning with non-exhaustive examples — never a static allowlist. A two-stage `backing_service_deps` candidate handoff makes `arcanon → chromadb` actually detectable even when the importer isn't an entry point; emission is call-site-conditioned, ambiguous protocol → `other`.
- **Method-aware mismatch detection (MM-01..09 — Phase 134, #46, PR #48):** `detectMismatches()` now compares HTTP method, keyed on `(UPPER(method), canonicalPath)` via a nested `exposedByMethod` Map with case-insensitive comparison and a null-method path-only fallback (zero new false positives). Cross-AI round-2 review replaced an earlier forgeable string-delimiter key with the structurally collision-free Map and added a `normalizeMethod()` helper plus forge-regression tests.

**Patterns established:**

- **Reasoning-based agent detection, not static allowlists:** the LLM scanner identifies backing-service clients by reasoning over open input; only the render/canonical vocabulary stays a closed set. A static list silently misses the next library (the #42/#45 anti-pattern).
- **Cross-AI (codex) review as a verification seam:** a same-model plan-checker missed the #42 actor `protocol_raw` gap, the #45 chromadb-incremental gap, and the #46 forgeable-key issue; an independent model caught all three. Findings captured per-phase in `*-REVIEWS.md`.
- **Pre-push hook mirrors CI:** `scripts/pre-push.sh` + `make hooks-install` runs the CI-equivalent suite (bats, worker npm test, jq manifests, shellcheck `--severity=error`) before push, with OS-conditional HOK-06 latency headroom on Darwin.

**Known deferred at close:**

- Phase 131 live-graph human-verify (#42, plan 131-02 Task 4) — code + automated tests green; the db/other buckets + edge colors were never visually confirmed in a running `/arcanon:view`.
- (Optional) a dedicated `db`-bucket mismatch-exclusion test mirroring the existing `events` case.

---

## v0.1.5 Identity & Privacy (Shipped: 2026-04-30)

**Phases completed:** 5 phases (123-127), 5 plans
**Requirements:** 20/21 complete (PII-01..07, AUTH-01..10, VER-01..03); VER-04 deferred — operator e2e walkthrough blocked on arcanon-hub THE-1030 deploy
**Timeline:** 2026-04-27 → 2026-04-30 (4 days)
**Stats:** 57 files changed, +9,150 / -871 lines, 45 commits squashed into PR #23 (merge commit `525a160`)

**Key accomplishments:**

- **PII path masking primitive (PII-01..07):** New `worker/lib/path-mask.js` with `maskHome` + `maskHomeDeep` (cycle-safe WeakSet, idempotent on already-relative paths, no-mutate). Wired at 4 egress seams — MCP server (`mcp/server.js:32`), HTTP routes (`/projects` + `/graph` + `/api/scan-freshness`), single-seam logger (`lib/logger.js:66`), and CLI export (mermaid/dot/html). Belt-and-suspenders parse-time reject of absolute `source_file` in `findings.parseAgentOutput` (X2 mitigation). Hardened agent contract in `agent-prompt-service.md`. Bats grep gate (`tests/pii-masking.bats`, 10 tests) + 12 unit tests + 4 PII-06 specific tests.
- **Hub auth core / X-Org-Id contract (AUTH-01..05):** Every `uploadScan` now sends `X-Org-Id` header; missing-orgId throws `HubError(code='missing_org_id')` BEFORE network attempt. New `worker/hub-sync/whoami.js` client calling `GET /api/v1/auth/whoami` returning `{user_id, key_id, scopes, grants}`. `resolveCredentials({orgIdRequired})` precedence chain: opts → `ARCANON_ORG_ID` env → `~/.arcanon/config.json#default_org_id`. `storeCredentials` spread-merge preserves unknown keys at mode 0600. Per-repo `hub.org_id` override threaded through `manager.js _readHubConfig`.
- **Whoami-driven `/arcanon:login` flow (AUTH-06):** Full 4×2 branch table (auth-error / hub-5xx / network × `--org-id` / no-flag) — AuthError NEVER stores; hub-5xx + `--org-id` stores with WARN; success on N=1 grant auto-selects; success on N>1 grants emits `__ARCANON_GRANT_PROMPT__` stdout sentinel + exit code 7 for the slash-command markdown layer to handle via `AskUserQuestion` + re-invocation with `--org-id <chosen>`. Verified-vs-mismatch differentiation when explicit `--org-id` is supplied.
- **`/arcanon:status` Identity block (AUTH-07) + 7-code RFC 7807 error parser (AUTH-08):** Nested `identity: {…}` object in `--json` mode (D-125-03 — additive contract, existing top-level keys unchanged). Frozen `HUB_ERROR_CODE_MESSAGES` map in `client.js` covers all 7 server codes (`missing_x_org_id`, `invalid_x_org_id`, `insufficient_scope`, `key_not_authorized_for_org`, `not_a_member`, `forbidden_scan`, `invalid_key`); `body.title` fallback preserved for forward-compat. `_buildIdentityBlock` 4 s timeout cap so `/arcanon:status` never hangs.
- **Auth regression test suite (AUTH-10):** `client.test.js` 7-code table-driven test exercising every entry in `HUB_ERROR_CODE_MESSAGES`; `whoami.test.js` (7 tests) pinning `getKeyInfo` contract; `integration.test.js` round-trip via new `withTempHome` async fixture (login → store → resolve → upload). Net +3 tests over Phase 124 baseline (824 total / 823 pass / 1 baseline-flake fail).
- **Release gate (VER-01..03):** All 4 manifests pinned at 0.1.5 (`package.json`, `plugins/arcanon/package.json`, `plugins/arcanon/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`); lockfile regenerated; CHANGELOG `[0.1.5]` section with explicit `### BREAKING` block citing THE-1030 hub-side dep, the `/arcanon:login --org-id` upgrade path, and the X-Org-Id requirement; bats 458/459 + node 823/824 green at v0.1.4 floors with no new pre-existing-mock carryforwards.

**Patterns established:**

- **Egress-seam masking (mask at the wire, not in the DB):** DB stores absolute paths (git operations need them); the boundary is the wire, not the store. Single primitive (`maskHomeDeep`) wrapped at every egress seam, single seam per file.
- **CLI exit-code-as-action:** exit 0 = success, exit 2 = failure, exit 7 = needs-human-decision. Markdown layer parses stdout sentinel (`__ARCANON_GRANT_PROMPT__`), prompts via `AskUserQuestion`, re-invokes CLI with the chosen flag.
- **Centralized error-code → message map:** Single `Object.freeze` constant; UI surfaces just print the message. New error codes added in one place.
- **Nested-object additive JSON contract:** When extending a status command's `--json` output, nest new structured data under a new top-level key (`identity:`) rather than spreading flat fields — protects existing consumers.
- **`withTempHome(fn)` async fixture pattern:** HOME-swap for tests touching `~/.arcanon/config.json` so the developer's real home is never mutated; reusable across phases.

**Known deferred items at close: 3 (see STATE.md `## Deferred Items`)**

The 3 deferred operator walkthroughs (125-01 T4, 125-02 T4, 127-01 T4) all unblock together when arcanon-hub THE-1030 deploys. They're operator-side validation against a real hub — not codebase gaps. Bundle into a single operator session post-deploy.

**External hub dependency:** v0.1.5 plugin codebase is shipped, but hub-half of the product (login round-trip, /arcanon:sync upload) is non-functional until arcanon-hub THE-1030 deploys server-side `X-Org-Id` enforcement and the `whoami` endpoint. Marketplace publication should wait for the hub deploy. Local features (`/arcanon:map`, `/arcanon:impact`, `/arcanon:list`, `/arcanon:diff`, `/arcanon:export`, `/arcanon:doctor`, `/arcanon:view`) work standalone.

---

## v0.1.3 Trust & Foundations (Shipped: 2026-04-25)

**Phases completed:** 7 phases (107-113), 14 plans
**Requirements:** 45/45 complete (INST-01..12, UPD-01..06, TRUST-01..14, DEP-01..06, VER-01..07)
**Linear:** THE-1022 (High), THE-1027, THE-1028 (High) — all closed
**Timeline:** 2026-04-25 (single-day milestone)

**Key accomplishments:**

- **Install architecture rebuilt (THE-1028):** Deleted `runtime-deps.json` — single source of truth = `package.json`. Rewrote `install-deps.sh` with sha256-of-deps sentinel + `require("better-sqlite3")` binding-load validation + npm rebuild fallback. Trimmed `mcp-wrapper.sh` from 30 lines to 12 (`exec node` only). Fixes Node 25 binding bug class permanently.
- **Update-check timeout decoupled (THE-1027):** `/arcanon:update --check` now reads marketplace mirror file regardless of whether `claude plugin marketplace update` finishes within 5s. File-existence is the offline source of truth.
- **`/arcanon:upload` removed (DEP):** Deprecated stub gone (originally promised v0.2.0; brought forward to v0.1.3 since v0.1.2 already shipped a breaking change). README + skills scrubbed; CHANGELOG `### BREAKING` entry.
- **New `/arcanon:verify` command (TRUST-01):** Reads cited evidence from source files; returns `ok` / `moved` / `missing` / `method_mismatch` per connection. Read-only contract enforced. 1000-connection cap on unscoped runs.
- **Evidence-at-ingest enforcement (TRUST-02):** `persistFindings` rejects connections whose `evidence` has no literal substring match against `source_file`. Skipped, not failing the scan. Catches scanner-agent hallucinations directly.
- **Path canonicalization (TRUST-03):** Template variants like `/streams/{stream_id}` and `/streams/{name}` collapse to `/streams/{_}`. Original templates preserved in new `connections.path_template` column.
- **`services.base_path` migration (TRUST-04):** New column. Agent prompts emit it. Connection resolution strips `base_path` before path matching, eliminating false mismatches when reverse-proxies prefix-strip.
- **Per-scan quality score (TRUST-05):** New `scan_versions.quality_score` column. `endScan` computes `(high + 0.5*low)/total`. Surfaced in `/arcanon:map` end-of-output and `/arcanon:status`.
- **Reconciliation audit trail (TRUST-06):** New `enrichment_log` table + `impact_audit_log` MCP tool. `external` → `cross-service` reclassifications now write audit rows (no more silent reconciliation).
- **9th MCP tool added:** `impact_audit_log` (was 8). bats fixtures updated.

**Issues caught and fixed beyond REQs:**

- Migration 013 numbering collision (Phase 109 + Phase 110 both claimed 013) — caught at planning review, renumbered before execution
- `UNIQUE INDEX uq_connections_dedup` missing on connections table — added during 109-02 to make `INSERT OR REPLACE` actually collapse rows
- `upsertService` `lastInsertRowid` poisoning — fixed via explicit `SELECT id` post-upsert
- MCP test stdio transport hang — gated behind `NODE_TEST_CONTEXT` env var
- v0.1.2's documented `worker/mcp/server-search.test.js queryScan` pre-existing failure now resolved by Phase 107-112 work

**Stats:**

- bats: 315/315 green (HOK-06 macOS latency caveat unchanged from v0.1.1; not triggered at threshold=200)
- node: 630/631 green (1 pre-existing v0.1.2 mock failure carried forward; net 1 fewer failure than v0.1.2 baseline)
- 4 manifests + package-lock.json all at 0.1.3
- ~30 new tests across worker modules

**Breaking changes for v0.1.2 → v0.1.3 upgraders:**

- `runtime-deps.json` deleted — install-deps.sh sentinel mismatch on first session post-upgrade triggers a one-time reinstall
- `/arcanon:upload` removed — CI scripts hardcoded to it must update to `/arcanon:sync`

---

## v0.1.2 Ligamen Residue Purge (Shipped: 2026-04-23)

**Phases completed:** 5 phases (101-105), 9 plans
**Requirements:** 46/46 complete (ENV-01..10, PATH-01..09, PKG-01..03, SRC-01..08, TST-01..07, DOC-01..03, README-01..03, VER-01..03)
**Timeline:** 2026-04-23 (single-day refactor milestone)

**Key accomplishments:**

- **Hard-removed all `LIGAMEN_*` env var reads** across worker, MCP server, libs, and scripts — no back-compat layer, no two-read fallback, no stderr deprecation warning
- **Removed `$HOME/.ligamen` data-dir fallback and `ligamen.config.json` reader** — only `$HOME/.arcanon` and `arcanon.config.json` honored
- **Renamed ChromaDB `COLLECTION_NAME`** from `"ligamen-impact"` to `"arcanon-impact"` — existing collections orphaned; users rebuild via `/arcanon:map`
- **Renamed `runtime-deps.json` package identity** from `@ligamen/runtime-deps` to `@arcanon/runtime-deps`
- **Source cosmetic sweep across 18 files** — comments, docstrings, log messages, Zod schema descriptions, agent prompts renamed or deleted where meaning became stale
- **Test suite rewrite across 17 files** — 110 renames; 1 obsolete test deleted (the `resolveCredentials ~/.ligamen/config.json` test whose functionality was removed in Phase 101)
- **README cleanup** — deleted "legacy honored for now" paragraphs, removed the entire `## Related repos` section (4 speculative outbound links)
- **CHANGELOG `### BREAKING` section** added with comprehensive migration instructions

**Breaking changes for v5.x upgraders:**

- Rename `ligamen.config.json` → `arcanon.config.json`
- Rename `$HOME/.ligamen/` → `$HOME/.arcanon/`
- Rename shell `LIGAMEN_*` env vars → `ARCANON_*`
- Rebuild ChromaDB collection via `/arcanon:map` (if using semantic search)

**Known non-regressions (documented):**

- bats 309/310 (1 macOS-only HOK-06 p99 latency caveat, pre-existing since v0.1.1, CI passes with `IMPACT_HOOK_LATENCY_THRESHOLD=100`)
- node 524/526 (2 pre-existing test failures unrelated to the rename, confirmed via git diff against pre-Phase-101 base)

---

## v0.1.1 Command Cleanup + Update + Ambient Hooks (Shipped: 2026-04-21)

**Phases completed:** 4 phases (97-100), 12 plans
**Requirements:** 46/46 complete
**Git range:** `d351150` → `ea081be` (49 commits, +1484/-380 LOC across 18 files)
**Timeline:** 2026-04-21 (single-day milestone)

**Key accomplishments:**

- Merged `/arcanon:cross-impact` into `/arcanon:impact` — absorbed `--exclude`, `--changed`, and the 3-state degradation model (no worker → grep fallback / worker up no map → prompt + partial / map has data → graph query) with a serialization guard so the delete only runs after the merge lands
- Shipped `/arcanon:update` self-update flow with four modes (`--check`, `--kill`, `--prune-cache`, `--verify`) — semver-correct, offline-safe, scan-lock guarded, SIGTERM→5s→SIGKILL shutdown, 10s health poll
- SessionStart banner now carries ambient cross-repo context: `"N services mapped. K load-bearing files. Last scan: date. Hub: status."` with stale prefix at 48h–7d (53ms warm-cache overhead measured)
- PreToolUse impact hook (`scripts/impact-hook.sh`) — Tier 1 bash pattern match for schema files (*.proto, openapi.*, swagger.*), Tier 2 SQLite root_path prefix match with trailing-slash guard, worker HTTP primary + SQLite fallback, self-exclusion inside `$CLAUDE_PLUGIN_ROOT`, `ARCANON_DISABLE_HOOK` + `ARCANON_IMPACT_DEBUG` env guards
- `auto_upload` → `auto_sync` rename across plugin.json userConfig, `worker/cli/hub.js`, `worker/scan/manager.js` with two-read fallback (`cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]`) + stderr deprecation warning on legacy key reads
- Deprecated `/arcanon:upload` stub preserved for one release (forwards to `/arcanon:sync` with stderr warning) so hardcoded CI pipelines don't break

**Deferred to Linear:**

- THE-1022 (High — scan quality), THE-1023 (read-only command polish), THE-1024 (scan ops), THE-1025 (UX polish), THE-1026 (integration improvements) — 18 of 20 external review points filed; 2 folded into this milestone

**Known tech debt:**

- `session-start.sh` duplicates `lib/db-path.sh` hash logic inline (consolidation opportunity, not a bug)
- `commands/update.md` has a stale "Phase 1 status" planning-era paragraph (cosmetic)

---

## v5.8.0 Library Drift & Language Parity (Shipped: 2026-04-19)

**Phases completed:** 0 phases, 0 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.7.0 Scan Accuracy (Shipped: 2026-03-23)

**Phases completed:** 3 phases, 3 plans, 5 tasks

**Key accomplishments:**

- Three-value crossing enum (internal/cross-service/external) added to agent-prompt-common.md with corrected examples across all type-specific scan prompts
- Post-scan reconciliation step added to map.md that auto-downgrades false external crossings to cross-service using the knownServices set built from all scan findings
- Mono-repo heuristic (subdirectory manifest detection) and client_files schema field added to discovery agent prompt for THE-951

---

## v5.6.0 Logging & Observability (Shipped: 2026-03-23)

**Phases completed:** 5 phases, 6 plans

**Key accomplishments:**

- Size-based log rotation (10MB max, 3 rotated files) with TTY-aware stderr suppression for daemon mode
- Structured error logging with full stack traces in all HTTP route and MCP tool handler catch blocks
- Scan lifecycle logging (BEGIN/END with repo count/mode, per-repo discovery/deep-scan/enrichment progress)
- Auth-db extractor entropy warnings wired to structured logger via setExtractorLogger
- QueryEngine accepts injected logger for cross-repo name collision warnings (replaces console.warn)

---

## v5.5.0 Security & Data Integrity Hardening (Shipped: 2026-03-22)

**Phases completed:** 4 phases, 9 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.4.0 Scan Pipeline Hardening (Shipped: 2026-03-22)

**Phases completed:** 6 phases, 9 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.3.0 Scan Intelligence & Enrichment (Shipped: 2026-03-22)

**Phases completed:** 7 phases, 12 plans, 2 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.2.1 Scan Data Integrity (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 7 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.2.0 Plugin Distribution Fix (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 5 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.1 Graph Interactivity (Shipped: 2026-03-21)

**Phases completed:** 7 phases, 11 plans, 2 tasks

**Key accomplishments:**

- Keyboard shortcuts module (F=fit, Esc=deselect, /=search, I=isolate, 2/3=expand depth) with input guard for typing contexts
- Clickable service names in detail panel — click-to-navigate with pan-to-center and panel replacement
- Subgraph isolation via N-hop BFS — press I to focus on neighborhood, 2/3 to expand, Esc to exit
- scan_version_id exposed in /graph API with latest_scan_version_id MAX computation for change detection
- What-changed overlay with yellow glow ring on new/modified nodes and edges, toggleable via toolbar button
- Edge bundling collapsing parallel edges into weighted edges with count badge, click-to-expand in detail panel
- PNG export via canvas.toDataURL — one-click download of current graph view
- 798 insertions across 14 files, 173/173 bats tests passing, zero regressions

---

## v5.0 Marketplace Restructure (Shipped: 2026-03-21)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**

- Restructured repo as Claude Code marketplace — plugin source moved to `plugins/ligamen/` via history-preserving `git mv`
- Created `marketplace.json` at repo root for marketplace discovery (`"source": "./plugins/ligamen"`)
- Fixed drift-common.sh path traversal, Makefile targets, README MCP server path for new layout
- Fixed 3 test root causes (test_helper PLUGIN_ROOT, drift-common exit→return, worker-start version check)
- 173/173 bats tests passing, `claude plugin marketplace add` + `install` verified end-to-end

---

## v4.1 Command Cleanup (Shipped: 2026-03-20)

**Phases completed:** 3 phases, 6 plans, 0 tasks

**Key accomplishments:**

- Removed Kubernetes-specific commands (`/ligamen:pulse`, `/ligamen:deploy-verify`) and supporting `scripts/pulse-check.sh` — plugin now focused on code quality and cross-repo intelligence
- Swept all pulse/deploy-verify references from tests, docs, README, PROJECT.md, session-start context
- Added `drift_versions` MCP tool — query dependency version mismatches (CRITICAL/WARN/INFO severity) across scanned repos
- Added `drift_types` MCP tool — language-grouped shared type/struct/interface mismatch detection with 50-type cap
- Added `drift_openapi` MCP tool — OpenAPI spec breaking change detection with oasdiff graceful degradation
- MCP server now exposes 8 tools (5 impact + 3 drift), all with 19 new tests passing

---

## v4.0 Ligamen Rebrand (Shipped: 2026-03-20)

**Phases completed:** 7 phases, 14 plans, 0 tasks

**Key accomplishments:**

- Renamed npm package, plugin manifests, Makefile, and config file from allclear to ligamen (91 files, +605/-589 lines)
- Migrated 20+ environment variables from `ALLCLEAR_*` to `LIGAMEN_*` and all data/temp paths to `~/.ligamen/`
- Renamed all 6 slash commands to `/ligamen:*`, MCP server to `ligamen-impact`, and ChromaDB collection
- Updated all shell script and JavaScript source code headers, output messages, and agent prompts
- Migrated full test suite (bats + JS) with renamed env vars, paths, assertions, and fixtures
- Updated all documentation (README, docs/, planning) and graph UI branding to Ligamen

---

## v3.0 Layered Graph & Intelligence (Shipped: 2026-03-18)

**Phases completed:** 6 phases, 11 plans, 0 tasks

**Key accomplishments:**

- Migration 008 adds `actors`, `actor_connections`, and `node_metadata` tables for external system tracking and extensible metadata
- Deterministic layered layout engine replaces D3 force simulation — services/libraries/infra in stable rows with row wrapping
- Boundary grouping via `ligamen.config.json` — dashed rounded rectangles with labels around service clusters
- External actor detection from scan `crossing` field — hexagon nodes in dedicated right column with detail panel
- Protocol-differentiated edge styles: solid (REST), dashed (gRPC), dotted (events), arrowed (SDK), red (mismatch)
- Minimal top bar with collapsible filter panel — protocol, layer, boundary, language, mismatch-only, hide-isolated filters
- ChromaDB embeddings enriched with boundary context and actor relationships
- MCP `impact_query` and `impact_search` responses carry type-aware summaries and actor relationship sentences

---

## v2.3 Type-Specific Detail Panels (Shipped: 2026-03-18)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**

- Migration 007 adds `kind` column to `exposed_endpoints` with COALESCE unique index for NULL-safe dedup
- `persistFindings()` type-conditional dispatch: services split METHOD/PATH, libraries store raw signatures, infra stores raw resource refs
- `getGraph()` attaches per-node `exposes` arrays with graceful pre-migration degradation
- Three-way detail panel routing: library panel (Exports + Used by), infra panel (Manages + Wires), service panel unchanged
- XSS-safe rendering with `escapeHtml()` on all scan-derived string insertions

---

## v2.2 Scan Data Integrity (Shipped: 2026-03-16)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**

- UNIQUE(repo_id, name) constraint with in-place dedup + ON CONFLICT DO UPDATE upsert preserving row IDs across re-scans
- Scan version bracket (beginScan/endScan) with atomic stale-row cleanup — failed scans leave prior data intact
- Agent prompt service naming convention enforcing manifest-derived, lowercase-hyphenated names
- Cross-project MCP queries via per-call resolveDb dispatching by path/hash/repo name

---

## v2.1 UI Polish & Observability (Shipped: 2026-03-16)

**Phases completed:** 5 phases, 11 plans, 0 tasks

**Key accomplishments:**

- HiDPI/Retina-crisp canvas rendering with devicePixelRatio scaling and smooth exponential zoom/pan
- Shared structured logger with component tags across all worker modules (zero console.log in production code)
- Collapsible log terminal with 2s polling, ring buffer, component filter, keyword search, and auto-scroll
- Persistent project switcher with full event listener teardown and force worker termination between projects

---

## v2.0 Service Dependency Intelligence (Shipped: 2026-03-15)

**Phases completed:** 8 phases, 19 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.0 Plugin Foundation (Shipped: 2026-03-15)

**Phases completed:** 13 phases, 17 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---
