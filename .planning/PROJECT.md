# AllClear

## What This Is

An open-source Claude Code plugin that provides automated quality gates, cross-repo service dependency intelligence, and continuous formatting/linting hooks for multi-repository development workflows. Includes an interactive graph UI for visualizing service dependencies with real-time log observability. Designed for teams managing multiple repos across Python, Rust, TypeScript, and Go — detects project type automatically and runs the right tools without configuration.

## Core Value

Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## Requirements

### Validated

- ✓ Universal quality gate command (`/allclear:quality-gate`) with auto-detection of project type — v1.0
- ✓ Cross-repo impact scanning (`/allclear:cross-impact`) — v1.0
- ✓ Cross-repo consistency checking (`/allclear:drift`) — v1.0
- ✓ Live service health checking (`/allclear:pulse`) — v1.0
- ✓ Deploy state verification (`/allclear:deploy-verify`) — v1.0
- ✓ Auto-format hook on edit (PostToolUse) — v1.0
- ✓ Auto-lint hook on edit (PostToolUse) — v1.0
- ✓ Sensitive file guard hook (PreToolUse) — v1.0
- ✓ Session start context hook (SessionStart) — v1.0
- ✓ Git clone + symlink installation path — v1.0
- ✓ Bats test suite (150 tests) — v1.0
- ✓ Plugin commands use `(plugin:allclear)` namespacing via commands/ directory — v1.0
- ✓ Quality gate skill for auto-invocation by agents — v1.0

- ✓ Service dependency map via `/allclear:map` with two-phase agent scanning — v2.0
- ✓ Redesigned `/allclear:cross-impact` with graph-based transitive impact analysis — v2.0
- ✓ Node.js worker daemon with auto-restart on version mismatch — v2.0
- ✓ MCP server with 5 impact tools for agent-autonomous checking — v2.0
- ✓ Interactive D3 Canvas graph UI with node coloring, mismatch indicators, detail panel — v2.0
- ✓ SQLite storage with WAL, FTS5, per-project isolation, migration system — v2.0
- ✓ Optional ChromaDB vector sync with 3-tier search fallback — v2.0
- ✓ Exposed endpoint cross-referencing for API mismatch detection — v2.0

- ✓ HiDPI/Retina canvas rendering with devicePixelRatio scaling — v2.1
- ✓ Smooth zoom/pan with trackpad pinch/scroll split (ctrlKey) — v2.1
- ✓ Fit-to-screen button to center all nodes — v2.1
- ✓ Shared structured logger with component tags across all worker modules — v2.1
- ✓ Collapsible log terminal with real-time streaming, component filter, keyword search — v2.1
- ✓ Persistent project switcher dropdown with full teardown and in-place reload — v2.1

- ✓ Idempotent scan upsert with UNIQUE(repo_id, name) and ON CONFLICT DO UPDATE — v2.2
- ✓ Scan version bracket (beginScan/endScan) with atomic stale-row cleanup — v2.2
- ✓ Agent prompt service naming convention (lowercase-hyphenated from manifest) — v2.2
- ✓ Cross-project MCP queries via repository name from any working directory — v2.2

- ✓ Type-conditional exposed data storage with `kind` column (endpoint/export/resource) — v2.3
- ✓ Library detail panel showing exported types/interfaces grouped by functions vs types, plus consumer services — v2.3
- ✓ Infra detail panel showing managed resources grouped by prefix, plus wired services — v2.3
- ✓ XSS-safe detail panel rendering with `escapeHtml()` on scan-derived strings — v2.3

### Active

## Current Milestone: v3.0 Layered Graph & Intelligence

**Goal:** Replace force-directed graph with deterministic layered layout, surface external system actors, and enrich the data model for richer MCP impact responses.

**Target features:**
- Deterministic layered layout (services top, libraries middle, infra bottom, externals right)
- External system actors detected from scan shown as distinct hexagon nodes
- Visual boundary grouping within service layer (user-defined in config)
- Different node shapes per type (circle, diamond, hexagon)
- Minimal top bar with collapsible filter panel (protocol, layer, mismatch, boundary, language)
- Metadata extension table (`node_metadata`) for future view data without schema rewrites
- Richer ChromaDB embeddings with boundary context, actor relationships, connection metadata
- Enriched MCP tool responses returning type-aware, boundary-aware impact context

### Out of Scope

- Linear issue enrichment — other plugins cover this; no external service dependencies
- GitHub Issues integration — same reasoning
- Any issue tracker integration — keep AllClear focused on code and infrastructure
- RamaEdge-specific logic — plugin must remain generic and framework-agnostic
- Auto-fix for test/typecheck failures — unsafe, may silently alter code semantics
- xterm.js interactive terminal — log viewer uses styled div, not a full terminal emulator

## Context

Shipped v2.3 with ~9,000 LOC (Node.js worker, Canvas UI, shell scripts, bats tests). 32 phases across 5 milestones, 57 plans. Plugin installed via marketplace and operational.

Architecture: commands/ for user-invoked features, skills/ for auto-invoked knowledge, hooks/ for formatting/linting/guarding, worker/ for Node.js daemon (db/, server/, scan/, mcp/, ui/ subdirectories), lib/ for shared bash/JS libraries. Agent scan prompts modularized into type-specific variants (service, library, infra) with shared common component. Detail panel renders type-appropriate views per node type.

Known tech debt: setupControls() listener accumulation on project switch, no log rotation, db/database.js has console.log in script-mode guard, getQueryEngineByHash inline migration workaround, renderLibraryConnections() unused `outgoing` parameter.

## Constraints

- **Plugin format**: Must follow Claude Code plugin conventions (commands/, skills/, hooks.json)
- **Framework-agnostic**: Detect project type from files, never assume a specific framework
- **No external service deps**: Every command must work with only local files, git, and optionally kubectl
- **License**: Apache 2.0
- **Testing**: Bats-core for hook shell scripts, node:test for worker JS
- **Detect, don't configure**: Infer everything from project files; zero-config by default with optional overrides via allclear.config.json
- **Non-blocking hooks**: Format/lint hooks must not block edits on failure — warn and continue
- **Cross-repo discovery**: Auto-detect linked repos from parent directory, override with config file

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dedicated repo (not part of claude-code) | Clean separation between private orchestration and open-source plugin | ✓ Good |
| Drop /allclear scope | Other plugins handle issue enrichment; keeps AllClear zero external deps | ✓ Good |
| Apache 2.0 license | Permissive with patent protection, standard for dev tools | ✓ Good |
| Auto-detect + config override for linked repos | Parent dir scan works for flat layouts, config.json for custom setups | ✓ Good |
| Canvas not SVG for graph UI | SVG degrades at 30+ nodes, Canvas scales to 100+ | ✓ Good |
| Web Worker for D3 force simulation | Keeps main thread free for smooth 60fps interaction | ✓ Good |
| Cross-impact v2 as separate milestone | Service dependency intelligence is a major new capability | ✓ Good |
| CSS pixel space as single coordinate truth | DPR is render-time only; no mouse/transform values multiplied by DPR | ✓ Good |
| Polling over SSE for log terminal | No zombie connection risk, 2s latency imperceptible for log viewer | ✓ Good |
| Named handlers for teardown | Module-scope named functions enable removeEventListener for project switching | ✓ Good |
| Shared logger factory with component tags | Enables log filtering without coupling modules to each other | ✓ Good |
| Graph dedup via MAX(id) GROUP BY name | Workaround for scan duplication — replaced by UNIQUE constraint in v2.2 | ✓ Good (resolved) |
| ON CONFLICT DO UPDATE over INSERT OR REPLACE | INSERT OR REPLACE cascade-deletes FK child rows; ON CONFLICT preserves row ID | ✓ Good |
| Scan version bracket (beginScan/endScan) | Atomic stale-row cleanup; failed scans leave old data intact | ✓ Good |
| Per-call resolveDb in MCP server | Module-level DB resolution was wrong for cross-project queries | ✓ Good |
| kind column on exposed_endpoints | Single table with discriminant vs separate tables per type — simpler queries, mismatch detection unchanged | ✓ Good |
| Embed exposes in /graph response | Single-load pattern avoids per-click API calls and async rendering complexity | ✓ Good |
| escapeHtml on scan-derived strings | Function signatures contain angle brackets that would be interpreted as HTML | ✓ Good |
| Infra guard first in getNodeType() | Before name heuristics — node named 'k8s-infra-lib' correctly returns 'infra' | ✓ Good |

---
*Last updated: 2026-03-18 after v3.0 milestone started*
