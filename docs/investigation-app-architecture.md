# Investigation: Ligamen as a Standalone App

**Date:** 2026-03-21
**Status:** Early investigation
**Author:** Ravi + Claude

## The Problem

Ligamen today is a Claude Code plugin. It runs inside Claude Code sessions, scans repos using Claude agents, and dies when the session ends. This creates three hard limits:

1. **Single-user** — one developer's Claude Code session owns the graph. No team visibility.
2. **Single-tool** — only Claude Code can trigger scans and consume impact data. Copilot, Cursor, and Antigravity users get nothing.
3. **Session-scoped** — the worker lives and dies with the Claude Code session. No persistent monitoring, no scheduled scans, no alerts.

Moving to an app removes all three limits while keeping the plugin as one of several interfaces.

## What We Already Have (and What's Reusable)

The current architecture is more decoupled than it looks. Here's what survives the transition:

| Component | Reusable? | Notes |
|-----------|-----------|-------|
| SQLite schema + migrations | Yes | Core data model is sound. May need to add `users`, `teams`, `scan_jobs` tables |
| QueryEngine (1135 lines) | Yes | Impact traversal, drift queries, FTS5 search — all portable |
| Fastify HTTP server | Yes | Already project-agnostic via `?project=` params. Needs auth middleware |
| Graph UI (vanilla JS + Canvas) | Partially | Debug viewer → needs dashboard features (history, ownership, alerts) |
| MCP server | Yes | Already runs as separate process. Just needs to point at shared DB |
| Scan agent prompts | Yes | Language-agnostic, LLM-agnostic prompts. Core IP |
| Scan manager | No | Tightly coupled to Claude Code's `claude` CLI for agent spawning |
| Hooks (format/lint/guard) | Plugin-only | Stay in the plugin. Not relevant to app |
| ChromaDB integration | Yes | Already optional, already decoupled |

**Key coupling points to break:**
- `manager.js` spawns scans via `claude` CLI subprocess → needs an LLM adapter interface
- Worker lifecycle tied to `session-start.sh` / `worker-start.sh` → needs to be a standalone daemon
- No authentication layer anywhere
- SQLite is single-writer — fine for single-user, problematic for concurrent team access

## Architecture: Plugin + App as Two Interfaces to One Core

```
┌──────────────────────────────────────────────────────────┐
│                      INTERFACES                          │
│                                                          │
│  ┌─────────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  │
│  │ Claude Code  │  │ VS Code  │  │  CLI   │  │  Web   │  │
│  │   Plugin     │  │Extension │  │  Tool  │  │Dashboard│  │
│  │(hooks,cmds,  │  │(Copilot, │  │        │  │(React) │  │
│  │ skills,MCP)  │  │ Cursor)  │  │        │  │        │  │
│  └──────┬───────┘  └────┬─────┘  └───┬────┘  └───┬────┘  │
│         │               │            │            │       │
│         └───────────────┴─────┬──────┴────────────┘       │
│                               │                           │
│                          REST API                         │
│                         (+ MCP stdio)                     │
└───────────────────────────────┬───────────────────────────┘
                                │
┌───────────────────────────────┴───────────────────────────┐
│                        CORE                               │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Scan Engine │  │ Impact/Drift │  │  Search          │  │
│  │  (LLM-       │  │ Analysis     │  │  (ChromaDB/FTS5) │  │
│  │   agnostic)  │  │              │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                   │            │
│         └─────────────────┴─────┬─────────────┘            │
│                                 │                          │
│                          ┌──────┴──────┐                   │
│                          │  Database   │                   │
│                          │  (SQLite or │                   │
│                          │  PostgreSQL)│                   │
│                          └─────────────┘                   │
└────────────────────────────────────────────────────────────┘
```

### Layer 1: Core (shared library)

Extract into `@ligamen/core` (or just `core/` directory):

- **Database abstraction** — QueryEngine that works against SQLite (single-user/plugin mode) or PostgreSQL (team/app mode). Same query interface, swappable backend.
- **Scan engine** — Agent prompts + findings parser + confirmation logic. LLM-agnostic: takes an `LLMAdapter` interface (`{ chat(messages): Promise<string> }`). Plugin mode uses Claude Code CLI. App mode uses Anthropic API directly (or OpenAI, or local models).
- **Impact analysis** — Transitive dependency traversal, blast radius calculation, change detection.
- **Drift analysis** — Version comparison, type diffing, OpenAPI diffing.
- **Search** — ChromaDB semantic + FTS5 keyword + SQL LIKE fallback chain.

### Layer 2: Interfaces (pluggable)

Each interface is a thin adapter over the core:

**Claude Code Plugin (existing)** — hooks, commands, skills, MCP server. Unchanged except scan manager now calls core's LLM-agnostic scan engine instead of spawning `claude` directly.

**VS Code Extension (new)** — Language Server Protocol or simple extension that calls the REST API. Provides:
- Status bar showing "X services affected" based on current git diff
- Hover info on import statements showing downstream consumers
- Command palette: "Ligamen: Show Impact" opens webview with graph
- Works with Copilot, Cursor, and any VS Code-based editor

**CLI Tool (new)** — Standalone `ligamen` binary (or npx command). Replaces the need for Claude Code to run scans:
- `ligamen scan` — trigger a scan
- `ligamen impact` — query impact
- `ligamen serve` — start the daemon
- `ligamen drift` — run drift checks

**Web Dashboard (new)** — Evolution of the current graph UI. Currently vanilla JS canvas app served by the worker. Upgrade path:
- Phase 1: Keep vanilla JS, add auth + team features as additional pages
- Phase 2: Migrate to React/Svelte for richer interactivity if needed
- New dashboard pages: scan history, drift timeline, team ownership map, alert configuration

### Layer 3: Infrastructure

**Plugin mode (current, unchanged):**
- SQLite per-project at `~/.ligamen/projects/<hash>/`
- Worker spawned by session hooks, dies with session
- No auth (single user, single machine)
- Scans via Claude Code CLI

**App mode (new):**
- PostgreSQL (team) or SQLite (self-hosted single-user)
- Persistent daemon (systemd, Docker, or managed service)
- Auth via GitHub OAuth / API keys
- Scans via Anthropic API (or pluggable LLM)
- Webhook triggers (GitHub push → auto-scan)
- Scheduled scans (cron-like)

## The LLM Adapter Problem

This is the hardest architectural decision. Today, scanning works because Claude Code provides the LLM — Ligamen just spawns `claude` subprocesses. In app mode, we need our own LLM access.

**Option A: Anthropic API directly**
- Pro: Best model for code analysis (we already tune prompts for Claude)
- Pro: Simple — just swap subprocess call for API call
- Con: Cost. Each repo scan = many API calls. Users need their own API key or we absorb cost
- Con: Rate limits on large scans

**Option B: Pluggable LLM interface**
- Pro: Users choose their model (Claude, GPT-4, local Llama)
- Pro: No vendor lock-in positioning
- Con: Prompts are tuned for Claude. Quality degrades on other models
- Con: More testing surface

**Option C: Hybrid — Claude default, others supported**
- Ship with Anthropic API as default (best quality)
- Accept OpenAI-compatible API endpoints as alternative
- Local model support via Ollama endpoint
- This is what Greptile does (uses their own models but offers self-hosted option)

**Recommendation: Option C.** Define an `LLMAdapter` interface with `chat()` and `structuredOutput()` methods. Ship `AnthropicAdapter` as default. Community can contribute others.

## Multi-User: What Changes

### Database Schema Additions

```sql
-- Team identity
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  provider TEXT,        -- 'github', 'google'
  provider_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE team_members (
  team_id TEXT REFERENCES teams(id),
  user_id TEXT REFERENCES users(id),
  role TEXT DEFAULT 'member',  -- 'owner', 'admin', 'member'
  PRIMARY KEY (team_id, user_id)
);

-- Project ownership
ALTER TABLE repos ADD COLUMN team_id TEXT REFERENCES teams(id);

-- Scan history with attribution
CREATE TABLE scan_jobs (
  id TEXT PRIMARY KEY,
  project_root TEXT,
  triggered_by TEXT REFERENCES users(id),
  trigger_source TEXT,  -- 'manual', 'webhook', 'schedule', 'plugin'
  status TEXT,          -- 'queued', 'running', 'completed', 'failed'
  started_at TEXT,
  completed_at TEXT,
  findings_count INTEGER,
  error TEXT
);
```

### Auth Middleware

For the REST API, add JWT auth middleware to Fastify:
- GitHub OAuth flow for web dashboard login
- API keys for CLI/extension/MCP access (stored in `api_keys` table, scoped per team)
- Plugin mode bypasses auth entirely (localhost, single user)

### Concurrent Access

SQLite's single-writer limitation matters when multiple team members trigger scans simultaneously. Two paths:

- **Self-hosted teams (< 10 devs):** SQLite with WAL mode + busy_timeout is sufficient. Concurrent reads are fine. Writes serialize but scans are infrequent enough that contention is rare.
- **Larger teams / hosted service:** PostgreSQL. The QueryEngine already uses prepared statements — the migration is mechanical (rewrite SQL dialect differences, swap better-sqlite3 for pg).

## Multi-Tool Support

### VS Code Extension (Copilot + Cursor)

Both Copilot and Cursor run inside VS Code. A single VS Code extension covers both:

```
ligamen-vscode/
├── src/
│   ├── extension.ts      # activation, commands
│   ├── impact-provider.ts # hover/diagnostic provider
│   ├── status-bar.ts     # "3 services affected" indicator
│   └── webview/          # embedded graph viewer
├── package.json          # vscode extension manifest
└── README.md
```

**Integration depth levels:**
1. **Passive** (easiest) — Status bar shows impact count. Click to open graph in browser. Needs only REST API calls.
2. **Active** — Diagnostics/squiggly lines on imports that have downstream impact. Hover shows affected services. Needs LSP-like integration.
3. **Deep** — Copilot Chat participant (`@ligamen what does this change affect?`). Cursor composer integration. Needs Copilot extensibility API.

**Recommendation:** Start with level 1 (passive), ship fast. Level 2 next. Level 3 when Copilot/Cursor APIs stabilize.

### Antigravity

Antigravity is newer and its extension model isn't as established. Two options:
- If it supports MCP: our existing MCP server works as-is
- If it has a VS Code-based UI: our VS Code extension covers it
- If neither: REST API is the universal fallback

### MCP as Universal Protocol

MCP is becoming the standard for tool↔LLM communication. Our MCP server already exposes all 8 tools. Any AI coding agent that speaks MCP (Cursor, Claude Code, potentially Copilot) gets Ligamen integration for free. This is our strongest multi-tool story — invest in MCP over tool-specific extensions.

## Deployment Modes

### Mode 1: Plugin (existing, unchanged)

```
Developer machine
├── Claude Code
│   └── Ligamen plugin
│       ├── hooks (format, lint, guard)
│       ├── commands (map, drift, impact, quality-gate)
│       ├── MCP server (stdio, per-session)
│       └── worker (HTTP + UI, per-session)
└── ~/.ligamen/projects/<hash>/impact-map.db
```

### Mode 2: Self-Hosted Daemon

```
Developer machine (or team server)
├── ligamen serve (persistent daemon)
│   ├── REST API (authenticated)
│   ├── Graph UI (web dashboard)
│   ├── MCP server (stdio, on-demand)
│   └── Scan scheduler
├── ~/.ligamen/ligamen.db (or PostgreSQL)
│
├── Claude Code + Ligamen plugin → REST API
├── VS Code + Ligamen extension → REST API
├── CLI tool → REST API
└── GitHub webhook → REST API → auto-scan
```

### Mode 3: Hosted Service (future)

```
Ligamen Cloud (we operate)
├── API gateway (auth, rate limiting)
├── Scan workers (Anthropic API)
├── PostgreSQL (multi-tenant)
├── ChromaDB cluster
│
├── Web dashboard → API
├── GitHub App → webhook → auto-scan
├── MCP server → API
└── VS Code extension → API
```

## Implementation Phases

### Phase 1: Extract Core (4-6 weeks)

**Goal:** Separate core logic from Claude Code plugin wiring without breaking anything.

- Create `core/` directory alongside `plugins/ligamen/`
- Move QueryEngine, scan prompts, findings parser, impact/drift logic into core
- Define `LLMAdapter` interface, implement `ClaudeCodeAdapter` (wraps current `claude` CLI behavior)
- Plugin imports from core instead of owning the logic
- All existing tests pass, all commands work identically

**Risk:** Refactor scope creep. Mitigate by keeping the plugin as the only consumer initially.

### Phase 2: Standalone Daemon + CLI (4-6 weeks)

**Goal:** Run Ligamen without Claude Code installed.

- Implement `AnthropicAdapter` (direct API calls)
- Create `ligamen` CLI entry point (scan, serve, impact, drift)
- Make worker a persistent daemon (`ligamen serve`)
- Add API key auth (simple bearer tokens, no OAuth yet)
- Docker image for easy self-hosting

**Risk:** Scan quality regression when switching from Claude Code agent to direct API. Mitigate by running same prompts through Anthropic API with same model, comparing results.

### Phase 3: Multi-User + Dashboard (6-8 weeks)

**Goal:** Teams can share a Ligamen instance.

- Add user/team/membership schema
- GitHub OAuth for web dashboard
- Scan history page
- Drift timeline view
- Team ownership map (CODEOWNERS integration from THE-940)
- Webhook-triggered scans (GitHub push events)

**Risk:** SQLite concurrent write contention. Mitigate by starting with advisory locking + WAL mode, add PostgreSQL option if needed.

### Phase 4: Multi-Tool Extensions (4-6 weeks)

**Goal:** Non-Claude-Code users get value.

- VS Code extension (passive: status bar + browser graph link)
- MCP server running as standalone (not session-scoped)
- Documentation for connecting Cursor, Copilot, Antigravity via MCP

**Risk:** Extension marketplace review processes are slow. Ship as sideloadable first.

### Phase 5: Hosted Service (8-12 weeks, optional)

**Goal:** Zero-ops for teams that don't want to self-host.

- Multi-tenant PostgreSQL
- GitHub App (no webhook setup needed)
- Managed scan workers
- Usage-based pricing
- SOC2 / security basics

**Risk:** Operational cost. Only pursue if self-hosted adoption validates demand.

## What This Means for Current Issues

Several filed Linear issues align with app-mode requirements:

| Issue | App Relevance |
|-------|--------------|
| THE-940 (CODEOWNERS ownership) | Team dashboard needs ownership data |
| THE-941 (enrichment pass architecture) | App scans need modular post-processing |
| THE-943 (auth + DB extraction) | Dashboard needs this metadata |
| THE-938 (schemas in UI) | Dashboard feature, not just debug view |
| THE-939 (confidence/evidence) | Scan job auditing needs this |

The bug fixes (THE-930 through THE-936) should be completed before Phase 1 — they affect core stability that the app inherits.

## Product Decisions (2026-03-21)

Decisions made during investigation Q&A:

**Target customer:** External engineering teams from day one. Not internal-first. This means onboarding, docs, and multi-tenant from the start.

**Buyer persona:** VP/Director of Engineering. Cares about org-wide visibility into service dependencies, incident prevention, and cross-team coordination. Enterprise buyer expectations: SSO, audit trails, tiered pricing.

**Deployment target:** Kubernetes/Helm. PostgreSQL required. Targets platform engineering teams who already run k8s. This is the right call for enterprise buyers — they expect Helm charts and won't run Docker Compose in production.

**Hero positioning:** Unified service intelligence platform — blast radius visibility + living service map + drift detection, all bundled. Risk of "too broad" messaging, but VP buyers prefer platforms over point tools. Landing page should lead with the problem ("Your microservices are a black box") and show all three capabilities as facets of one product.

**Scan triggers:** Hybrid three-tier model:
- **QUICK** (every push): File-structure only, no LLM, free. Detects new/removed services, file moves, dependency changes from manifests.
- **STANDARD** (PR open): LLM scans changed services and their neighbors. Cost: ~$0.30-1.00 per PR depending on scope.
- **DEEP** (nightly or on-demand): Full repo re-scan. Re-indexes everything. Cost: $2-10 per repo.
Users configure per-project which triggers are active.

**LLM dependency:** Static analysis first, LLM as upsell. Free tier runs purely on static analysis (package.json, imports, docker-compose, OpenAPI specs, proto files). Paid tier adds LLM-powered deep scan for connections that static analysis can't find (implicit dependencies, event-driven flows, runtime service discovery). This creates a natural upgrade path and removes the "but I need an API key just to try it" friction.

**Pricing:** Too early to lock in. Ship the product, get usage data, then decide. Working assumption for now: open-core model (self-hosted free, hosted paid), but exact pricing structure TBD after validating demand.

## Updated Phase Plan (Post-Decisions)

Decisions above change some phase details:

### Phase 1: Extract Core + Static Scanner (6-8 weeks)

**Goal:** Core library that works without any LLM.

- Extract `@ligamen/core` from plugin
- Build **static scanner** alongside existing LLM scanner:
  - Package.json / go.mod / Cargo.toml → dependency graph
  - Import statements → service-to-service connections
  - Docker-compose / k8s manifests → infrastructure topology
  - OpenAPI specs / proto files → API contract graph
- Define `LLMAdapter` interface for Phase 2
- Plugin continues working unchanged (still uses Claude Code LLM scanner)

**Why static first:** Removes LLM dependency for basic graph. Free tier story. Faster scans. Enterprise teams can evaluate without API key setup.

### Phase 2: Standalone Daemon + CLI + Helm (6-8 weeks)

**Goal:** Run Ligamen without Claude Code. Deploy on k8s.

- `ligamen serve` persistent daemon
- PostgreSQL backend (required for k8s, multi-pod)
- `AnthropicAdapter` for LLM-powered deep scans
- Helm chart: worker pod(s) + PostgreSQL + optional ChromaDB
- API key auth (bearer tokens)
- `ligamen` CLI: scan, serve, impact, drift

### Phase 3: Multi-User Dashboard + GitHub Integration (8-10 weeks)

**Goal:** Teams can share a Ligamen instance. Auto-scan on push.

- GitHub OAuth + SSO (enterprise requirement)
- User/team/membership schema
- GitHub App for webhook-triggered scans (QUICK on push, STANDARD on PR)
- Dashboard pages: service map, scan history, drift timeline, ownership map
- Audit log (who scanned what, when — enterprise requirement)
- RBAC: org admin, team admin, member, viewer

### Phase 4: Multi-Tool Extensions (4-6 weeks)

Unchanged from original plan.

### Phase 5: Hosted Service (8-12 weeks)

Unchanged from original plan. Pricing decision happens after Phase 3 usage data.

## Open Questions (Remaining)

1. **Naming:** Is "Ligamen" the app name too, or do we differentiate? (e.g., "Ligamen" = plugin, "Ligamen Server" = app, "Ligamen Cloud" = hosted)
2. **Data model:** Do we stay with per-project DBs or move to a single PostgreSQL DB with project isolation via foreign keys? Single DB is simpler for team queries (cross-project drift) and required for k8s.
3. **Code graph:** The strategic feature (from project_code_graph.md) — does it land before or after app mode? Static scanner in Phase 1 could include basic code-level graph (function/class relationships from import analysis). LLM deep scan adds richer code graph later.
4. **License:** AGPL (strong copyleft, forces contributors) vs BSL (source-available, time-delayed open source) vs Apache 2.0 (permissive, encourages adoption). Enterprise buyers have opinions here.
5. **Static scanner accuracy:** How good is the service graph without LLM? Need to benchmark against LLM-scanned repos to quantify the gap. This determines whether the free tier is actually useful or just a demo.
