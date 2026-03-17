# Retrospective: AllClear

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

## Cross-Milestone Trends

| Metric | v1.0 | v2.0 | v2.1 | v2.2 |
|--------|------|------|------|------|
| Phases | 13 | 8 | 5 | 3 |
| Plans | 17 | 19 | 11 | 5 |
| Requirements | 79 | 8 | 13 | 5 |
| Tests | 150 | ~50 | ~20 | ~30 |
| LOC | 4,323 | ~7,000 | ~7,500 | ~8,000 |
| Timeline | 1 day | 1 day | 1 day | 1 day |
