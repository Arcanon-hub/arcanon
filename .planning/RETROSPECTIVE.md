# Retrospective: Ligamen

## Milestone: v1.0 — Plugin Foundation

**Shipped:** 2026-03-15
**Phases:** 13 | **Plans:** 17

### What Was Built
- Complete Claude Code plugin with 5 commands, 4 hooks, 2 shared libraries
- Auto-format hook for Python, Rust, TypeScript, Go, JSON, YAML
- Auto-lint hook with clippy throttling and per-language dispatch
- File guard hook with hard-block/soft-warn protection
- Session context injection with project type detection
- Quality gate command with subcommand dispatch (lint, format, test, typecheck, fix)
- Cross-repo impact scanning and drift detection (versions, types, OpenAPI)
- Kubernetes pulse and deploy-verify commands
- Configuration layer with env var toggles and config file overrides
- 150 bats tests covering all hooks and libraries

### What Worked
- Parallel phase structure — all 13 phases were independent, enabling fast execution
- Shell-only architecture — no build step, no compilation, instant feedback
- Bats testing framework — reliable, fast, bash 3.2 compatible
- Plugin-dev plugin documentation — excellent reference for structuring the plugin

### What Was Inefficient
- GSD verification artifacts (VERIFICATION.md, SUMMARY frontmatter) were not generated during execution — had to be retroactively created
- Roadmap checkbox drift — 5 phases completed but not ticked in ROADMAP.md
- Post-plan structural changes (skills → commands, siblings → linked-repos) required updating tests, scripts, and docs across the codebase

### Patterns Established
- `commands/` for user-invoked features (auto-namespaced by plugin system)
- `skills/` for auto-invoked contextual knowledge only
- `linked-repos` terminology over `siblings`
- `allclear.config.json` as the single config file
- Non-blocking hooks (exit 0 always for PostToolUse)
- Guard hook uses exit 2 for PreToolUse deny

### Key Lessons
- Skills vs commands distinction in Claude Code plugins matters for namespacing — user-invoked features must be in `commands/`
- The plugin system auto-namespaces commands with `(plugin:allclear)` but does not namespace skills
- bash 3.2 compatibility is essential on macOS — no mapfile, no associative arrays in portable code

### Cost Observations
- Sessions: ~5 (planning + execution + cleanup)
- Notable: All 13 phases planned and executed in a single day

## Milestone: v2.0 — Service Dependency Intelligence

**Shipped:** 2026-03-15
**Phases:** 8 | **Plans:** 19

### What Was Built
- Node.js worker daemon with SQLite storage, WAL mode, FTS5 search, per-project isolation
- Agent-based repo scanning with Claude for service/dependency extraction
- MCP server with 5 impact tools for autonomous agent checking
- Interactive D3 Canvas graph UI with node coloring, detail panel, mismatch indicators
- HTTP server with Fastify for graph data, scan endpoints, and static UI serving
- Optional ChromaDB vector sync with 3-tier search fallback
- Repo discovery with user confirmation flow

### What Worked
- SQLite as primary storage — fast, zero-config, per-project isolation via content hash
- Agent scanning with structured JSON output — reliable extraction from diverse repo types
- Canvas over SVG for graph rendering — scales well beyond 30 nodes

### What Was Inefficient
- ChromaDB integration added complexity for marginal benefit — optional but still maintenance surface
- Migration system evolved mid-milestone (inline → file-based) requiring retroactive fixes

### Patterns Established
- Service is the unit, not repo — works for mono-repo and multi-repo
- Content hash for project isolation in ~/.allclear/
- Web Worker for D3 force simulation (60fps main thread)
- MCP tool pattern: resolve DB → query → return structured response

### Key Lessons
- Agent prompts need strong boundary rules to prevent hallucinated services
- SQLite foreign key constraints interact poorly with ALTER TABLE RENAME in 3.51+
- Per-project DB isolation via content hash is simple and effective

---

## Milestone: v2.1 — UI Polish & Observability

**Shipped:** 2026-03-16
**Phases:** 5 | **Plans:** 11

### What Was Built
- HiDPI/Retina-crisp canvas rendering with MDN three-step DPR pattern
- Smooth exponential zoom with trackpad pinch/scroll split (ctrlKey)
- Fit-to-screen button with bounding box computation
- Shared structured logger (createLogger factory) with component tags across all worker modules
- GET /api/logs endpoint with component and since filtering
- Collapsible log terminal with 2s polling, 500-line DOM ring buffer, component filter, keyword search, auto-scroll
- Persistent project switcher with full teardown and in-place graph reload

### What Worked
- CSS pixel space as single coordinate truth — clean separation from DPR render-time detail
- Logger injection pattern (setter for modules that can't self-create) kept modules decoupled
- Named handler pattern for event listener teardown — clean project switching
- TDD approach caught several bugs during RED→GREEN cycles

### What Was Inefficient
- setupControls() has no teardown counterpart — listener accumulation on project switch (tech debt)
- Log terminal polling interval (2s) is hardcoded — no user configurability

### Patterns Established
- HiDPI Canvas: canvas.width = cssW * dpr, canvas.style.width = cssW + 'px', ctx.scale(dpr, dpr)
- Wheel event ctrlKey split: pinch/Ctrl+scroll zooms, two-finger scroll pans
- Logger injection: pass logger as final optional arg, set module-level _logger, fall back gracefully
- Teardown-before-load pattern for project switching

### Key Lessons
- matchMedia re-registration (not persistent listener) is the correct DPR change detection pattern
- Polling over SSE avoids zombie connection risks for log viewers
- Module-scope named functions are essential for removeEventListener to work

---

## Milestone: v2.2 — Scan Data Integrity

**Shipped:** 2026-03-16
**Phases:** 3 | **Plans:** 5

### What Was Built
- Migration 004: UNIQUE(repo_id, name) constraint via in-place dedup + FTS5 rebuild
- upsertService rewritten to ON CONFLICT DO UPDATE preserving row ID and child FKs
- Migration 005: scan_versions table with beginScan/endScan bracket for atomic re-scans
- Agent prompt service naming convention (manifest-derived, lowercase-hyphenated, generic name block-list)
- Migration 006: repo deduplication with UNIQUE path constraint (shipped outside formal phase system)
- Cross-project MCP queries via per-call resolveDb dispatching by path/hash/repo name

### What Worked
- In-place dedup strategy (DELETE duplicates + CREATE UNIQUE INDEX) avoided SQLite FK constraint issues
- Atomic shipment of UNIQUE constraint + ON CONFLICT rewrite prevented cascade-delete of child rows
- Bracket pattern (beginScan/endScan) cleanly handles both success and failure paths
- WAL pragma bug fix in pool.js unblocked all cross-project discovery

### What Was Inefficient
- Migration 006 shipped outside the formal phase system — discovered duplicate repos only after migration 004 dedup
- HTTP POST /scan endpoint doesn't participate in scan bracket (by design, but creates two code paths)
- Naming convention enforced at prompt level only — no runtime validation

### Patterns Established
- In-place dedup migration: temp id map → UPDATE child FKs → DELETE duplicates → CREATE UNIQUE INDEX
- Scan bracket: beginScan before agent, persistFindings+endScan on success, skip endScan on failure
- Per-call DB resolution: resolveDb dispatches by format (absolute path, hex hash, repo name, undefined)

### Key Lessons
- INSERT OR REPLACE in SQLite is semantically DELETE+INSERT — cascade-deletes FK children; use ON CONFLICT DO UPDATE instead
- SQLite 3.51+ rewrites FK references on ALTER TABLE RENAME regardless of legacy_alter_table pragma
- Always test migrations against databases with existing dirty data, not just clean fixtures

---

## Milestone: v2.3 — Type-Specific Detail Panels

**Shipped:** 2026-03-18
**Phases:** 3 | **Plans:** 5

### What Was Built
- Migration 007: `kind` column on `exposed_endpoints` with COALESCE unique index for NULL-safe dedup
- `persistFindings()` type-conditional dispatch: services split METHOD/PATH, libraries store raw signatures, infra stores raw resource refs
- `getGraph()` attaches per-node `exposes` arrays with try/catch pre-migration guard
- `getNodeType()` and `getNodeColor()` infra guard + NODE_TYPE_COLORS
- Three-way `showDetailPanel()` dispatch: library Exports+Used by, infra Manages+Wires, service unchanged
- `escapeHtml()` helper for XSS-safe rendering of scan-derived strings

### What Worked
- Investigation-first approach — mapped entire data flow before defining milestone, avoided wrong scope
- Sequential phase dependencies (storage → API → UI) meant each phase built on verified foundations
- TDD approach caught SQLite NULL dedup bug during Plan 30-02 GREEN phase
- Source-inspection test pattern effective for browser UI code without jsdom

### What Was Inefficient
- SUMMARY frontmatter `requirements-completed` not consistently populated by executors
- VALIDATION.md `nyquist_compliant` not updated to `true` post-execution

### Patterns Established
- `kind` discriminant column pattern for multi-type rows in a shared table
- try/catch migration guard for backward-compatible query expansion
- `escapeHtml()` for all user-controlled template literal insertions in UI code

### Key Lessons
- SQLite `UNIQUE` constraints treat `NULL != NULL` — must use COALESCE in unique index for nullable columns
- Investigation before milestone definition prevents building the wrong thing (detail panel code was already type-aware; the real bug was in storage)
- Embedding data in existing API responses is simpler than adding new per-click endpoints

---

## Milestone: v3.0 — Layered Graph & Intelligence

**Shipped:** 2026-03-18
**Phases:** 6 | **Plans:** 11

### What Was Built
- Deterministic layered layout engine replacing D3 force simulation
- Boundary grouping via config with dashed rounded rectangle rendering
- External actor detection and hexagon rendering in right column
- Protocol-differentiated edge styles (solid/dashed/dotted/red)
- Collapsible filter panel with 7 filter types
- ChromaDB and MCP response enrichment with boundary + actor context
- `node_metadata` extensibility table for future STRIDE/vuln views

### What Worked
- Thorough design discussion before milestone creation — the mockup-first approach prevented rework
- Parallel planning of phases 36-38 saved significant time
- Integration checker caught two real bugs (crossing field drop, node.boundary missing) before release
- Bug review caught 10+ issues including XSS, null guards, idempotency, event listener leaks

### What Was Inefficient
- Phase 34 (Layout Engine) planner didn't account for row wrapping with many nodes — had to fix post-verification
- Boundary config reading failed silently due to `qe.db` vs `qe._db` — private field access pattern is fragile
- VALIDATION.md was missing for Phase 34, blocking the plan checker — the orchestrator should generate it automatically
- Visual verification items accumulated across phases — should batch these earlier

### Patterns Established
- Layer boxes for non-service layers (Libraries, Infrastructure) auto-generated from node positions
- Separate X/Y padding for boundary boxes to cover node label widths
- `_filterPanelWired` guard pattern to prevent event listener leaks on project switch
- Enrichment functions (`enrichImpactResult`, `enrichSearchResult`) as best-effort wrappers with null-db guards

### Key Lessons
- Always verify the full data pipeline (prompt → validator → DB → API → UI) before shipping — the `crossing` field was in the prompt and schema but dropped in `writeScan`
- Private field naming (`_db`) creates fragile coupling when accessed from other modules — consider a public accessor
- Row wrapping is essential for any grid layout with variable node counts — MAX_PER_ROW should be a design constant, not an afterthought
- The milestone discussion phase (C4 vs current, app vs plugin, actor sources) was the most valuable part — it prevented building features that don't fit the plugin model

---

## Milestone: v4.0 — Ligamen Rebrand

**Shipped:** 2026-03-20
**Phases:** 7 | **Plans:** 14

### What Was Built
- Full allclear → ligamen rename across 91 files (+605/-589 lines)
- Package, manifests, Makefile, config file identity migrated
- 20+ environment variables and all data/temp paths migrated
- 6 slash commands, MCP server, ChromaDB collection renamed
- All shell and JS source code headers, output messages, agent prompts updated
- Full test suite (bats + JS) migrated with renamed env vars, paths, assertions, fixtures
- All documentation and graph UI branding updated

### What Worked
- All 7 phases executed in parallel — rename operations are independent, no ordering needed
- Clean break decision (no backwards compat) simplified the rename enormously — no dual-name logic
- Milestone audit caught 3 pre-existing issues (not v4.0 regressions) — good signal-to-noise
- 2-day turnaround for full rebrand of 91 files across the entire stack

### What Was Inefficient
- Initial parallel execution missed ~30 references — needed a cleanup pass with targeted grep
- REQUIREMENTS.md traceability was not updated during execution (all marked "Pending" despite completion)
- ROADMAP.md plan checkboxes not updated during execution (all show [ ] despite being done)

### Patterns Established
- Parallel execution works well for cross-cutting renames — phase ordering is unnecessary
- Post-execution grep sweep is essential for rename operations — agents miss edge cases in comments, strings, and test data

### Key Lessons
- A rename milestone is a good stress test for codebase organization — if the rename is hard, the naming is inconsistent
- Clean break > backwards compat for internal tools with small user base — avoids indefinite dual-name maintenance
- Milestone audit is most valuable when it confirms no regressions vs finding new gaps

---

## Milestone: v5.6.0 — Logging & Observability

**Shipped:** 2026-03-23
**Phases:** 5 | **Plans:** 6

### What Was Built
- Size-based log rotation (10MB max, 3 rotated files) with TTY-aware stderr suppression
- Structured error logging with full stack traces in HTTP route and MCP tool handler catch blocks
- Scan lifecycle logging: BEGIN/END per invocation, per-repo discovery/deep-scan/enrichment progress
- Auth-db extractor entropy warnings wired to structured logger via setExtractorLogger
- QueryEngine logger injection replacing console.warn for cross-repo name collision warnings

### What Worked
- Clean phase dependency chain: logger infrastructure first (Phase 84), then three independent consumers (85/86/87), then version bump
- Each phase was tightly scoped with clear success criteria — no scope creep
- Existing logger factory pattern made adoption straightforward

### What Was Inefficient
- Version bump phases (88, 91) tracked as separate phases but are trivial one-command operations
- SUMMARY/VERIFICATION artifacts from earlier milestones (v5.4.0, v5.5.0) had incomplete stats in MILESTONES.md

### Patterns Established
- setExtractorLogger/setScanLogger injection pattern for modules that can't self-create loggers
- err.stack inclusion in all logger.error calls as a codebase standard

### Key Lessons
- Logger adoption is best done incrementally (one module per phase) rather than in a big-bang pass
- Version bump phases add overhead — consider folding into the last substantive phase

---

## Milestone: v5.7.0 — Scan Accuracy

**Shipped:** 2026-03-23
**Phases:** 3 | **Plans:** 3

### What Was Built
- Three-value crossing semantics (external/cross-service/internal) replacing binary external/internal
- Post-scan reconciliation step that downgrades false external crossings to cross-service using knownServices set
- Mono-repo detection via subdirectory manifest scanning (one level deep)
- client_files field in discovery schema for outbound HTTP call identification

### What Worked
- Linear issues (THE-949, THE-951) provided clear, well-scoped requirements
- Phase 89 and 90 ran in parallel — different files, no conflicts
- Prompt-level changes are low-risk and easy to verify

### What Was Inefficient
- Both milestones (v5.6.0 and v5.7.0) shipped same day — could have been a single milestone
- Milestone completion wasn't fully automated — STATE.md, ROADMAP.md, and MILESTONES.md required manual cleanup

### Patterns Established
- Post-scan reconciliation pattern: agent does its best, then a global pass corrects with full context
- Discovery schema extension via new fields (client_files) with no DB migration needed (prompt-only)

### Key Lessons
- Agents can't reason about cross-repo context during per-repo scanning — post-scan reconciliation is the right pattern
- Subdirectory manifest detection should be shallow (1 level) to avoid false positives in vendor/ or test fixtures

---

## Milestone: v5.8.0 — Library Drift & Language Parity

**Shipped:** 2026-04-19
**Phases:** 5 (92-96) | **Plans:** 16 | **Linear tickets:** THE-1019, THE-1020, THE-1021

### What Was Built
- Manifest parsers for Maven (with `<parent>` inheritance), Gradle (Groovy + Kotlin DSL + libs.versions.toml catalog), NuGet (incl. Central Package Management), Bundler (Gemfile.lock GEM/GIT/PATH)
- Java/.NET/Ruby language detection in `detect.sh` + `discovery.js` MANIFESTS
- Java/C#/Ruby type extractors in `drift-types.sh` using tmpdir pattern (Bash 3.2 compatible)
- Migration 010 `service_dependencies` table with `dep_kind` discriminant + 4-col UNIQUE + ON DELETE CASCADE
- `dep-collector.js` enrichment module covering 7 ecosystems (npm/pypi/go/cargo/maven/nuget/rubygems), production-deps-only
- Auth/DB enrichment for Java (Spring Security 5+6), C# (ASP.NET Identity, EF Core minimal API), Ruby (Devise, ActiveRecord, `config/database.yml` adapter probe)
- Unified `scripts/drift.sh` dispatcher with `bash` subprocess routing + Bash 4+ floor + reserved `licenses|security` slots
- `lib/worker-restart.sh` extracted from session-start + worker-start with PID-file mutex preserved
- 4 shell bug fixes (bc fork, declare -A leak, global stderr suppression, bash 4 guard) + 2 dead-code removals
- Hub Payload v1.1 with feature flag (default off, v1.0 fallback always works) — ready for hub-side companion THE-1018

### What Worked
- Milestone-level research synthesis (`.planning/research/SUMMARY.md`) replaced per-phase research for all 5 phases — saved ~50 min of duplicate work; planners had file:line precision from upstream researchers
- Locked decisions captured upfront (4-col UNIQUE, dep_kind discriminant, Spring 5+6 dual patterns, production-only deps) eliminated relitigation in plan-checker
- TDD pattern (RED → GREEN tasks per plan) caught real bugs early: Maven `relativePath` off-by-one (RSTART+15 → +14), `seedDb()` missing migration 006, awk regex requiring JS-compatible end-of-string
- Sequential phase execution (forced by submodules → no worktrees) was simpler to reason about than parallel — and integration-checker confirmed zero file-level conflicts because we ordered phases by dependency
- "Reserve column for future use" pattern (`dep_kind` accepting 'transient' even though only 'direct' is written) avoided an expensive ALTER TABLE later

### What Was Inefficient
- `audit-open` CLI command broken in gsd-tools (`output is not defined` ReferenceError) — had to skip the pre-close artifact audit
- `gsd-tools milestone complete` returned `phases: 0` and didn't archive phase directories (manual `mv` required)
- `gsd-tools state complete-phase` showed `total_phases: 32` instead of 5 — schema mismatch unresolved
- Two checker/planner agents exited mid-run without writing outputs (re-spawning with explicit "do not exit mid-way" instructions worked)
- REQUIREMENTS.md DEP-09/10/11 stayed `Pending` after Phase 93 shipped — verifier caught the docs lag, manual sed update needed

### Patterns Established
- **Cross-phase file-overlap detection during planning**: Discovered Phase 92-04 and Phase 95-03 both edit `drift-types.sh` BEFORE execution, scheduled phases serially in dependency order to avoid worktree race
- **Workaround documentation via code comments**: ENR-05 spring.datasource.url detection via in-`.java`-file comments (LANG_EXTENSIONS limitation) is documented in extractor comments, not hidden
- **Feature-flag-gated payload version bumps**: New schemaVersion only emitted when (flag on AND non-empty data); fallback to old version is the default — backward compat preserved by construction
- **`--test-only` guard pattern in shell scripts**: Both drift-versions.sh and drift-types.sh now expose internals for bats sourcing without triggering main loop under `set -euo pipefail`

### Key Lessons
- "Parallel where safe" gets neutered by file overlap — verify cross-phase `files_modified` lists during planning, not at execution
- Submodules (.gitmodules) silently disable worktree parallelism — affected execution time but eliminated merge-conflict risk
- Documentation tracking (REQUIREMENTS.md checkboxes) drifts from code reality unless updated atomically with execution — verifier serves as a backstop
- Pre-existing test failures (WRKR-07 in this case) should be confirmed pre-existing via git stash + test before assuming the new work caused them — saves a debugging cycle
- Milestone-level research synthesis is more efficient than per-phase research when phases share architectural decisions

### Cost Observations
- Model mix: ~70% sonnet (executors, verifiers, checkers, plan-checkers), ~25% opus (planners), ~5% sonnet (researchers)
- Sessions: 1 long autonomous run (~2.5 hours wall clock)
- Notable: 16 plans executed sequentially. Each executor ~3-5 min wall + ~50K subagent tokens. Verifiers ~2 min wall + ~50K tokens. Planners ~7 min wall + ~150K tokens.

---

## Milestone: v0.1.1 — Command Cleanup + Update + Ambient Hooks

**Shipped:** 2026-04-21
**Phases:** 4 | **Plans:** 12

### What Was Built
- Merged `/arcanon:cross-impact` into `/arcanon:impact` (absorbed `--exclude`, `--changed`, 3-state degradation) with a serialization guard so the delete only runs after the merge lands
- Deprecated `/arcanon:upload` stub forwarding to `/arcanon:sync` with stderr warning; `/arcanon:sync` becomes the canonical upload-then-drain verb
- Plugin config rename `auto_upload` → `auto_sync` with two-read fallback and stderr deprecation warning
- New `/arcanon:update` self-update command with four modes: `--check` (semver + offline-safe), `--kill` (scan-lock guard + SIGTERM→5s→SIGKILL), `--prune-cache` (lsof-guarded), `--verify` (10s health poll)
- SessionStart banner enrichment: `N services mapped. K load-bearing files. Last scan: date. Hub: status.` with stale prefix at 48h–7d
- PreToolUse impact hook (`scripts/impact-hook.sh`) — pure-bash Tier 1 schema matching + Tier 2 SQLite root_path prefix + worker HTTP primary/SQLite fallback + self-exclusion inside `$CLAUDE_PLUGIN_ROOT` + JSONL debug trace + DISABLE env escape hatch

### What Worked
- **Mid-execution course correction based on external review** — a 20-point external review arrived after planning was done. Folding 2 points (merge cross-impact features) into the milestone and deferring the other 18 to Linear (THE-1022..1026) preserved scope discipline while closing the biggest regression risk
- **Wave-based parallel execution with serialization guards** — 97-04 (merge) in Wave 1, 97-01 (delete) in Wave 2 gated on the merge landing; deterministic bats tests prevented regression during the split
- **Single-day end-to-end shipping** — discuss → plan → execute → audit → close in one continuous session. Tight feedback loop made decisions faster
- **Integration audit caught a real wiring gap** — session-start.sh reading `hub_auto_upload` after hub.js cmdStatus was renamed to `hub_auto_sync`. Exactly the class of bug that unit tests miss and only cross-phase audits find

### What Was Inefficient
- **gsd-sdk `milestone.complete` helper passes empty args to `phasesArchive`** — always errors with "version required". Manual workaround with `phases.archive v0.1.1` worked, but the helper is broken upstream
- **macOS p99 hook latency (130ms) missed the 50ms Linux target** — pure-bash fork overhead is platform-dependent; the target was written without a cross-platform calibration step. Linux CI expected to hit the target. Documented as an accepted deviation rather than a regression
- **`commands/update.md` carries a stale "Phase 1 status" planning paragraph** — planning-era breadcrumb that survived execution. Cosmetic; logged as tech debt
- **`session-start.sh` duplicates `lib/db-path.sh` hash logic inline** — db-path.sh was introduced in Phase 100-01 for the impact hook, but the Phase 99 enrichment was written before and re-implemented the hash. Not a bug; a consolidation opportunity

### Patterns Established
- **Merge-then-delete with serialization guard** — when removing a command whose capabilities must be preserved, merge the features into the surviving command first, gate the delete on a Wave boundary, prove via bats before the delete lands
- **Deprecated stub pattern** — `[DEPRECATED]` frontmatter + `printf >&2` stderr warning + `$ARGUMENTS` passthrough to the replacement + explicit v0.2.0 removal anchor comment. One-release grace period for CI pipelines
- **Two-read config fallback for renames** — `cfg?.hub?.["new"] ?? cfg?.hub?.["old"]` with stderr warning when the legacy key is read. Guards against silent breakage without maintaining two code paths long-term
- **Tier 1 pure-bash / Tier 2 SQLite / Tier 3 HTTP hot-path split** — keep the hot path out of Node.js; SQLite fallback when worker is down; HTTP primary when worker is up. Enables <50ms p99 on the target platform
- **PreToolUse `systemMessage` + exit 0 for warn-only semantics** — confirmed from file-guard.sh; non-blocking cross-repo context without killing agentic multi-file refactors
- **External review folded into milestone scope via explicit Option A vs B choice** — rather than absorbing all 20 points into scope creep or deferring them all, ask the user which points are load-bearing; fold only those in

### Key Lessons
- **External review before execution is worth the delay** — caught two load-bearing regressions (--exclude, --changed) that would have needed a hotfix milestone. The hour spent discussing the review saved a full bugfix cycle
- **Integration audits find cross-phase wiring gaps that per-phase verification misses** — session-start.sh and hub.js both passed their phase VERIFICATION.md gates individually; the rename mismatch only surfaced when auditing the data flow end-to-end
- **Cross-platform performance targets need cross-platform calibration** — 50ms p99 was set from Linux measurements; macOS fork overhead invalidates the target silently. Either calibrate on each platform during spec or document platform-specific targets from the start
- **gsd-sdk CLI helpers can be broken; test the workflow before relying on it** — `milestone.complete` failed on first invocation. Having the underlying primitives (`phases.archive`) callable directly saved the close
- **Single-day milestones are viable for tightly-scoped work** — 4 phases / 12 plans / 49 commits / 1484 LOC in one day was not rushed; it was focused. The scope was pre-audited against external review before execution began

### Cost Observations
- Model mix: ~70% sonnet (executors, verifiers, integration checker), ~25% opus (planners, orchestration), ~5% sonnet (research-lite for pre-flight validations)
- Sessions: 1 continuous session (~8 hours wall clock including discuss+plan+execute+audit+close)
- Notable: Phase 100 pre-flight validations (4 empirical checks) ran before plan writing and anchored all downstream decisions — that pattern is reusable

---

## Milestone: v0.1.2 — Ligamen Residue Purge

**Shipped:** 2026-04-23
**Phases:** 5 | **Plans:** 9

### What Was Built
- Hard-removed all `LIGAMEN_*` env var reads across 16 worker/lib/script files — no back-compat layer, no two-read fallback, no stderr deprecation warning
- Deleted `$HOME/.ligamen` data-dir fallback and `ligamen.config.json` config reader
- Renamed ChromaDB `COLLECTION_NAME` from `"ligamen-impact"` to `"arcanon-impact"` (breaking change — users rebuild collection via `/arcanon:map`)
- Renamed `runtime-deps.json` package from `@ligamen/runtime-deps` to `@arcanon/runtime-deps`
- Cosmetic rename sweep across 18 source files (comments, docstrings, log messages, Zod schema descriptions, agent prompts)
- Test suite rewrite across 17 files — 110 renames + 1 obsolete test deleted (the `~/.ligamen/config.json` fallback test whose functionality was removed in Phase 101)
- README cleanup: deleted "legacy honored for now" paragraphs + removed entire `## Related repos` section (4 speculative outbound links)
- CHANGELOG `### BREAKING` section added with comprehensive migration instructions

### What Worked
- **Zero-tolerance policy simplified every decision** — "Is this a ligamen reference?" was the only question. No judgment calls about grace periods, two-read patterns, or deprecation warnings.
- **Wave-based parallel execution with non-overlapping file sets** — Phases 101, 102, 104 ran in parallel (different file concerns); 103 depended on 101+102; 105 was the final gate. Saved ~60% wall time versus sequential execution.
- **Combined plan+execute for phases 102–105** — After Phase 101's planner-with-scope-risk-escalation proved the requirements were specific enough, subsequent phases skipped the separate planner spawn. Planner-executor-in-one-agent worked well for mechanical refactor work.
- **Planner-as-scope-verifier** — Phase 101 planner found 3 unplanned runtime reads (pool.js, database.js, auth.js) plus the ChromaDB collection identifier that weren't in the original REQ list. Caught before execution, added as ENV-10 + PATH-07/08/09, prevented a red Phase 105 gate.

### What Was Inefficient
- **Local node test suite timeout** — Phase 105 verification couldn't re-run `npm test` in the main session (180s timeout). Had to rely on Phase 103's in-context results. Likely a lingering worker process holding a port; worth investigating for future milestones but not blocking.
- **gsd-sdk `milestone.complete` + `phases.archive` helpers both buggy** — Same issue from v0.1.1 recurred. `phases.archive v0.1.2` reported 0 archived despite phase dirs existing. Manually moved with `mv`. Two consecutive milestones hit this; worth filing upstream.
- **SDK `roadmap.analyze` missed Phase 101+** — Returned only 32 phases topping out at 83, despite ROADMAP.md having phases up to 105. Likely parses only uncollapsed `<details>` content. Worked around with direct `init.phase-op` calls.

### Patterns Established
- **Zero-tolerance rename** — For product renames, the correct policy is "zero references" not "gradual migration with back-compat". Back-compat stubs permanently encode the legacy name.
- **Scope-verification pattern** — First phase's planner should audit the REQ list against the actual codebase and escalate unplanned matches before execution. Prevents red verification gates.
- **Skip planner-only spawn for mechanical phases** — When requirements are file-path-specific and the work is mechanical (find/replace), a combined plan+execute agent beats a separate planner+executor pair.

### Key Lessons
- **"Out of scope" isn't a real reason for cleanup tasks.** When I initially argued runtime-deps.json at `5.7.0` was "pre-existing so out of scope", the user pushed back and was right. Pre-existing drift is still drift. The correct scoping lens is "is this a ligamen reference?" not "who introduced it?"
- **Breaking-change milestones are the right time to absorb pre-existing drift.** Bumping runtime-deps.json version invalidates the install-deps.sh full-file-diff sentinel, forcing a one-time reinstall. That cost is already sunk in a breaking milestone.
- **Scope-escalation by planners is high-value signal.** Phase 101 planner flagged 4 additional runtime reads. If those had shipped unflagged, Phase 105 would have been red.
- **Test failures count as signal of success during refactor phases.** Phase 101's runtime purge broke tests that pinned legacy env var names — that's the signal the purge landed. Phase 103 fixed them next.

### Cost Observations
- Model mix: ~70% sonnet (executors, cosmetic sweep), ~25% opus (planner-with-scope-verification, audit), ~5% sonnet (verification gates)
- Sessions: 1 continuous session (~2-3 hours wall clock including planning + 5 parallel executors + audit + archive)
- Notable: Phase 103 (test suite rewrite) was the longest-running single agent at ~10 min — 17 files + test suite runs + 1 test deletion decision. Phase 102 was the second longest at ~6.5 min — 18 file cosmetic sweep.

---

## Cross-Milestone Trends

| Metric | v1.0 | v2.0 | v2.1 | v2.2 | v2.3 | v3.0 | v4.0 | v5.6.0 | v5.7.0 | v5.8.0 | v0.1.1 | v0.1.2 |
|--------|------|------|------|------|------|------|------|--------|--------|--------|--------|--------|
| Phases | 13 | 8 | 5 | 3 | 3 | 6 | 7 | 5 | 3 | 5 | 4 | 5 |
| Plans | 17 | 19 | 11 | 5 | 5 | 11 | 14 | 6 | 3 | 16 | 12 | 9 |
| Requirements | 79 | 8 | 13 | 5 | 9 | 33 | 22 | 9 | 6 | — | 46 | 46 |
| Tests | 150 | ~50 | ~20 | ~30 | ~30 | ~60 | 0 (rename only) | ~10 | 0 (prompt only) | ~60 | ~45 | 0 (rename) |
| LOC | 4,323 | ~7,000 | ~7,500 | ~8,000 | ~9,000 | ~12,000 | ~41,600 | ~48,000 | ~48,000 | — | +1,484 / −380 | ~50 files touched |
| Timeline | 1 day | 1 day | 1 day | 1 day | 1 day | 1 day | 2 days | 1 day | 1 day | — | 1 day | 1 day |
