# Stack Research

**Domain:** Claude Code Plugin — quality gates, cross-repo checks, auto-format/lint hooks
**Researched:** 2026-03-15
**Confidence:** HIGH (primary sources: official Claude Code docs at code.claude.com, direct examination of installed plugins)

---

## Recommended Stack

### Core Plugin Format

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `.claude-plugin/plugin.json` | (schema v1) | Plugin manifest — name, version, description, author | Required entry point for the Claude Code plugin system; `name` field sets the skill namespace (e.g., `allclear:quality`) |
| `skills/<name>/SKILL.md` | (current) | Slash-command + autonomous skill definitions | Official format for user-invokable skills (`/allclear:quality`); replaces legacy `commands/` .md files; supports `$ARGUMENTS` for parameterized invocation |
| `hooks/hooks.json` | (current) | Hook event configuration | Canonical location; wraps `{"hooks": {...}}`; supports all event types including `PostToolUse`, `PreToolUse`, `SessionStart` |
| `${CLAUDE_PLUGIN_ROOT}` | — | Runtime path variable | Required for referencing plugin scripts in hooks — plugin is copied to cache on install, so absolute paths break |

### Distribution Layer

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `.claude-plugin/marketplace.json` | (current) | Marketplace catalog listing this plugin | Required for `/plugin install allclear@<marketplace>` distribution; supports `source: github`, `source: npm`, `source: git-subdir` |
| npm (`@allclear/cli`) | Node.js 18+ | `npx @allclear/cli init` installer | Provides frictionless bootstrap path; `bin` field in package.json maps to CLI entry; standard `#!/usr/bin/env node` shebang pattern |
| Git clone + symlink | — | Manual install path | Second distribution channel; documented in README; users run `ln -s /path/to/allclear ~/.claude/plugins/local/allclear` |

### Hook Script Runtime

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bash (POSIX sh where possible) | sh/bash | Hook scripts | Claude Code `command` hooks execute shell; `jq` is the standard tool for parsing stdin JSON (`tool_input.file_path`, `tool_name`, etc.) |
| `jq` | 1.6+ | Parse hook stdin JSON | De-facto standard in all documented examples; parse `tool_input.file_path` from PostToolUse Write/Edit events |
| bats-core | 1.13.0 (2025-11-07) | Test hook shell scripts | Official recommended test framework for bash; PROJECT.md explicitly specifies bats; supports `run` helper, exit code assertions, fixture files |

### Supporting Libraries (npm / CLI)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js | 18+ (LTS) | `npx @allclear/cli init` runtime | Only needed for the CLI installer entrypoint; the plugin itself has zero Node.js runtime dep |
| `commander` or `minimist` | current | CLI argument parsing for init | If init needs `--config`, `--scope` flags; `commander` is heavier but more ergonomic; `minimist` is minimal |
| `bats-support` | current | bats helper: formatted failure output | Add as git submodule in `test/libs/`; improves test DX significantly |
| `bats-assert` | current | bats assertion library | Provides `assert_output`, `assert_success`, `assert_failure` — covers 90% of hook test needs |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `claude --plugin-dir ./allclear` | Load plugin locally for testing without install | Use during development; `--plugin-dir` can be specified multiple times |
| `/reload-plugins` | Hot-reload plugin changes in running session | Avoids restarting; LSP changes still need full restart |
| `claude plugin validate .` | Validate `plugin.json` and `marketplace.json` JSON syntax | Run before every push; catches missing commas, wrong field types |
| `chmod +x scripts/*.sh` | Make hook scripts executable | Hooks silently fail if script is not executable; always chmod in repo and verify |

---

## Installation

```bash
# Plugin directory structure bootstrap (no npm install needed for core plugin)
mkdir -p allclear/.claude-plugin
mkdir -p allclear/skills/quality allclear/skills/impact allclear/skills/drift
mkdir -p allclear/skills/pulse allclear/skills/deploy
mkdir -p allclear/hooks allclear/scripts

# CLI installer package
mkdir -p allclear/bin
npm init -y  # in allclear/
# Set "name": "@allclear/cli", "bin": {"allclear": "./bin/init.js"}

# Testing
git submodule add https://github.com/bats-core/bats-core test/bats
git submodule add https://github.com/bats-core/bats-support test/libs/bats-support
git submodule add https://github.com/bats-core/bats-assert test/libs/bats-assert

# Dev tool: run tests
./test/bats/bin/bats test/
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `skills/` + SKILL.md | `commands/` + .md files | Never for new plugins — commands/ is the legacy format; skills/ enables both slash-command and autonomous invocation |
| Bash hook scripts | Node.js hook scripts | If hook logic requires complex async (e.g., API calls, JSON manipulation beyond jq) — claude-mem uses Node for this reason |
| bats-core as git submodule | `brew install bats-core` or `npm install bats` | Global install acceptable in CI/CD; submodule is preferred for reproducibility and zero-setup on clone |
| `${CLAUDE_PLUGIN_ROOT}` in hook commands | Hardcoded paths | Never use hardcoded paths — plugin is cached to `~/.claude/plugins/cache/` on install, breaking absolute paths |
| Single GitHub repo + marketplace.json | Monorepo with git-subdir source | Use git-subdir if AllClear is eventually embedded in a larger Claude plugins monorepo |
| npm source in marketplace.json | github source | Use npm source if publishing to npmjs.org becomes primary; github source is simpler for open-source initial release |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `commands/` directory for new skills | Legacy format; does not support autonomous invocation by Claude; docs explicitly mark it for migration | `skills/<name>/SKILL.md` |
| Absolute paths in hook commands | Plugin is copied to `~/.claude/plugins/cache/` at install time — any path outside the plugin root breaks | `${CLAUDE_PLUGIN_ROOT}/scripts/...` |
| Placing `skills/`, `hooks/`, `agents/` inside `.claude-plugin/` | Official docs call this the most common structural mistake; those dirs must be at plugin root, only `plugin.json` goes inside `.claude-plugin/` | Place at plugin root |
| Blocking hooks for format/lint | PROJECT.md constraint: "Non-blocking hooks must not block edits on failure" — exit code 2 blocks the edit action | Use exit 0 with `systemMessage` for warnings, or rely on non-zero non-2 exit for non-blocking error display |
| External service dependencies in hooks | PROJECT.md constraint: "No external service deps" — hooks must work offline | Use git, local tools (ruff, cargo fmt, prettier, gofmt), kubectl only |
| `../` paths in plugin | Claude Code refuses path traversal outside plugin root during cache copy | Self-contained scripts; use symlinks if shared deps are needed |
| Setting version in both `plugin.json` and `marketplace.json` | `plugin.json` silently wins, marketplace version is ignored — causes version confusion | Set version in `plugin.json` only; omit from marketplace entry |

---

## Stack Patterns by Variant

**For format/lint hooks (PostToolUse Write|Edit):**
- Read `tool_input.file_path` from stdin with `jq -r '.tool_input.file_path'`
- Detect language from file extension: `.py` → ruff/black, `.rs` → rustfmt, `.ts/.tsx/.js` → prettier, `.go` → gofmt
- Exit 0 always (non-blocking); output `{"systemMessage": "..."}` to surface warnings

**For sensitive file guard (PreToolUse Write|Edit):**
- Check `tool_input.file_path` against a blocklist (`.env`, `*.pem`, `secrets.*`)
- Exit 2 with message on stderr to block; exit 0 to allow
- `permissionDecision: "deny"` in hookSpecificOutput for structured response

**For session start context (SessionStart):**
- Matcher: `startup|clear|compact`
- Output `additionalContext` field with cross-repo status summary
- Only `command` type is supported for SessionStart (not prompt or agent)

**For the CLI installer (`npx @allclear/cli init`):**
- `#!/usr/bin/env node` shebang in `bin/init.js`
- `"type": "module"` in package.json for ES module syntax
- Detection logic: find `.claude/` in HOME, write plugin symlink or copy files
- Ask user for scope (user/project) if interactive TTY

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Claude Code 1.0.33+ | plugin system (--plugin-dir, /plugin commands) | Minimum version for plugin dev support; run `claude --version` |
| bats-core 1.13.0 | bats-support (any), bats-assert (any) | No known breaking incompatibilities as of 2025-11-07 release |
| Node.js 18+ | npm 9+, npx | Node 18 is current LTS baseline; `package.json` should specify `"engines": {"node": ">=18.0.0"}` |
| hooks.json hook types | PostToolUse, PreToolUse, SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PreCompact, TaskCompleted, TeammateIdle | All available as of current Claude Code docs; `command` type is universal; `prompt` and `agent` types not available for SessionStart |

---

## Sources

- `https://code.claude.com/docs/en/plugins` — Plugin structure, SKILL.md format, hooks.json location, --plugin-dir flag (HIGH confidence — official Anthropic docs, verified 2026-03-15)
- `https://code.claude.com/docs/en/plugins-reference` — Complete manifest schema, component paths, hook event types, LSP fields, CLI commands (HIGH confidence — official Anthropic docs)
- `https://code.claude.com/docs/en/hooks` — Hook stdin JSON format, stdout fields, exit code semantics, timeout defaults, blocking vs non-blocking events (HIGH confidence — official Anthropic docs)
- `https://code.claude.com/docs/en/plugin-marketplaces` — marketplace.json schema, npm/github/git-subdir sources, distribution patterns (HIGH confidence — official Anthropic docs)
- `/Users/ravichillerega/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/` — Direct inspection of `hooks.json` (${CLAUDE_PLUGIN_ROOT} usage, SessionStart/PostToolUse patterns), `package.json` (Node 18 engines field, bun support), `skills/do/SKILL.md` (frontmatter format) (HIGH confidence — production plugin, local filesystem)
- `/Users/ravichillerega/.claude/plugins/cache/claude-plugins-official/code-review/d5c15b861cd2/` — Direct inspection of `commands/code-review.md` frontmatter (allowed-tools, description, disable-model-invocation fields) (HIGH confidence — official Anthropic plugin)
- `https://github.com/bats-core/bats-core/releases/latest` — bats-core 1.13.0, released 2025-11-07 (HIGH confidence — GitHub API)

---

*Stack research for: Claude Code plugin (AllClear — quality gates, cross-repo checks, auto-format hooks)*
*Researched: 2026-03-15*

---
---

# Stack Addendum: v2 Service Dependency Intelligence

**Milestone:** v2.0 — Service Dependency Graph, Worker Process, MCP Server, Graph UI
**Researched:** 2026-03-15
**Confidence:** HIGH for core libraries (npm registry + GitHub releases verified); MEDIUM for ChromaDB integration (official JS client verified, MCP bridge pattern inferred from design)

This section covers only the **new** stack additions required for v2. The v1 stack above remains unchanged.

---

## New Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `better-sqlite3` | 12.8.0 (2026-03-13) | SQLite primary storage — sync API, WAL + FTS5 | Fastest Node.js SQLite library; fully synchronous API avoids callback complexity in a single worker process; ships with SQLite 3.51.3 which includes WAL + FTS5 natively. Requires Node.js v20+. Do NOT use the experimental `node:sqlite` built-in — it's still flagged `--experimental-sqlite` and not production-ready. |
| `fastify` | 5.8.2 | HTTP server for REST API + static UI serving | 2.4× faster than Express in benchmarks; built-in TypeScript support; `@fastify/static` plugin for serving the D3 graph UI HTML; native JSON schema validation removes need for external validator. v5 requires Node.js v20+, aligned with better-sqlite3. |
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server (stdio transport) exposing impact tools | Official Anthropic TypeScript SDK; `McpServer` + `StdioServerTransport` is the canonical pattern for stdio MCP servers. The worker process runs both HTTP and MCP concurrently — HTTP for the UI/REST API, stdio MCP for Claude agent consumption. Peer dep: zod ≥3.25. |
| `d3` | 7.9.0 | Force-directed graph visualization in browser UI | Stable v7 (last major release); `d3-force` subpackage handles force simulation, `d3-selection` + `d3-zoom` + `d3-drag` handle interactivity. Served as static HTML/JS from the worker's Fastify server. No build step needed — use ESM CDN import or bundle from npm. |
| `chromadb` | 3.3.3 | Optional vector storage client for semantic search | Official Chroma JS/TS client v3 (complete rewrite June 2025); ~70% smaller bundle vs v2; talks to a running ChromaDB HTTP server over REST. This is the optional acceleration layer only — the system works fully without it via FTS5. |

---

## New Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 3.25+ | Schema validation for MCP tool parameters | Required peer dep of `@modelcontextprotocol/sdk`; use for validating `impact_query`, `impact_scan`, etc. tool inputs |
| `@fastify/static` | current | Serve D3 graph HTML + assets from worker | Register once pointing at `worker/ui/` dir; handles `index.html`, `d3.js`, CSS |
| `@fastify/cors` | current | CORS headers for REST API | Needed if the graph UI is ever opened from a different origin than localhost; also useful during development when testing from `file://` |
| `@types/better-sqlite3` | current | TypeScript types for better-sqlite3 | Dev dependency; only if worker is written in TypeScript |
| `@types/d3` | current | TypeScript types for D3 | Dev dependency; only for TypeScript-authored UI code |

---

## Worker Process Architecture

The AllClear worker is a **single Node.js process** (`worker/index.js`) that runs:

1. **Fastify HTTP server** on `localhost:PORT` (default `37888`) — REST API + static D3 UI
2. **MCP stdio server** — reads from stdin, writes to stdout; registered in Claude Code settings as an MCP server entry pointing to the worker executable

These two transports share the same in-process query engine and SQLite connection. No inter-process communication needed.

**PID file pattern** (no external daemon manager):

```javascript
// worker/index.js startup
import fs from 'fs';
import path from 'path';

const PID_FILE = path.join(process.env.ALLCLEAR_DATA_DIR, '.allclear/worker.pid');

// Write PID on start
fs.writeFileSync(PID_FILE, String(process.pid));

// Clean up on exit
function shutdown() {
  fs.rmSync(PID_FILE, { force: true });
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
```

**Port availability check** (before binding):

```javascript
import net from 'net';

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}
```

The `/allclear:map` and `/allclear:cross-impact` shell scripts check for the PID file and send a `curl localhost:PORT/health` probe before invoking the worker. If no worker is running, they `node worker/index.js &` with `nohup` and wait for the health endpoint.

---

## SQLite Configuration

```javascript
import Database from 'better-sqlite3';

const db = new Database(path.join(dataDir, '.allclear/impact-map.db'));

// Required configuration
db.pragma('journal_mode = WAL');       // concurrent readers, single writer
db.pragma('foreign_keys = ON');        // enforce FK constraints
db.pragma('synchronous = NORMAL');     // safe with WAL; faster than FULL
db.pragma('cache_size = -64000');      // 64MB page cache

// FTS5 virtual table for endpoint/schema search
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(
    path,
    protocol,
    source_file,
    target_file,
    content='connections',
    content_rowid='id'
  );
`);
```

**WAL checkpoint note:** better-sqlite3 is single-threaded synchronous. The worker never uses `worker_threads` for database access — one connection, one thread. This avoids WAL checkpoint starvation entirely. All HTTP requests are handled by Fastify's async event loop, serialized through the synchronous SQLite calls (fast enough for local use; no concurrency pressure expected).

---

## MCP Server Pattern

```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const mcp = new McpServer({ name: 'allclear-impact', version: '2.0.0' });

mcp.tool('impact_query', 'Find services consuming or exposing an endpoint', {
  service: z.string(),
  endpoint: z.string().optional(),
  direction: z.enum(['consumes', 'exposes']).default('consumes'),
  transitive: z.boolean().default(false),
}, async ({ service, endpoint, direction, transitive }) => {
  // delegate to QueryEngine (same instance used by HTTP API)
  const results = queryEngine.impact(service, endpoint, direction, transitive);
  return { content: [{ type: 'text', text: JSON.stringify(results) }] };
});

// Connect stdio transport (separate from HTTP server)
const transport = new StdioServerTransport();
await mcp.connect(transport);
```

The MCP server and Fastify HTTP server run in the same Node.js process. The MCP transport consumes stdin/stdout; Fastify binds a TCP socket. They don't conflict.

**MCP server registration** in user's Claude Code settings (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "allclear-impact": {
      "command": "node",
      "args": ["/path/to/allclear/worker/index.js", "--mcp-only"]
    }
  }
}
```

The `/allclear:map` skill writes this entry automatically after first scan.

---

## ChromaDB Integration

chroma-mcp (the official Python MCP server from chroma-core) is a **Python process** — it is not used directly. Instead, AllClear uses the official `chromadb` npm package (v3.3.3) to talk directly to a running ChromaDB HTTP server.

```javascript
import { ChromaClient } from 'chromadb';

// Only instantiated if config.chroma is present
const chroma = new ChromaClient({
  path: `${config.chroma.ssl ? 'https' : 'http'}://${config.chroma.host}:${config.chroma.port}`,
  auth: config.chroma['api-key']
    ? { provider: 'token', credentials: config.chroma['api-key'] }
    : undefined,
});

const collection = await chroma.getOrCreateCollection({ name: 'allclear-connections' });
```

The `chromadb` v3 package removed bundled embedding functions. For semantic search, use `@chroma-core/default-embed` (installs the default embedding function separately). AllClear's fallback chain (vector → FTS5 → direct SQL) means ChromaDB failure is non-fatal.

---

## D3.js Graph UI

The graph UI is a single `worker/ui/index.html` file with inline or adjacent JS. No build step, no React, no bundler required for the UI. Fastify serves it as a static file.

```html
<!-- worker/ui/index.html -->
<script type="module">
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// Fetch graph data from local REST API
const { nodes, links } = await fetch('/graph').then(r => r.json());

const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(80))
  .force('charge', d3.forceManyBody().strength(-300))
  .force('center', d3.forceCenter(width / 2, height / 2));
</script>
```

For production distribution (offline use, no CDN dependency), bundle `d3` via esbuild:

```bash
# Bundle D3 into worker/ui/d3.bundle.js
npx esbuild node_modules/d3/src/index.js --bundle --format=esm \
  --outfile=worker/ui/d3.bundle.js --platform=browser
```

---

## Bundling and Distribution

The worker process is distributed as source (`worker/` directory in the plugin repo). No pre-bundling is required for correctness. For the optional npm distribution path:

```bash
# Bundle worker to single file for npm package inclusion
npx esbuild worker/index.js \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:better-sqlite3 \
  --external:@modelcontextprotocol/sdk \
  --outfile=dist/worker.js
```

`better-sqlite3` must be external because it contains native binaries (`.node` addon) that cannot be bundled. It must be installed as a runtime dependency, not inlined.

**Package.json additions** for the worker:

```json
{
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "better-sqlite3": "^12.8.0",
    "fastify": "^5.8.2",
    "@fastify/static": "^8.0.0",
    "@fastify/cors": "^10.0.0",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "chromadb": "^3.3.3",
    "zod": "^3.25.0"
  },
  "optionalDependencies": {
    "@chroma-core/default-embed": "^1.0.0"
  }
}
```

D3 is a **browser-side** dependency, not a Node.js dependency. It is either loaded via CDN in `index.html` or bundled as a static asset — it does not appear in the Node.js `dependencies`.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `better-sqlite3` | `node:sqlite` (built-in) | `node:sqlite` requires `--experimental-sqlite` flag; not production-stable as of Node.js 22/24; no FTS5 examples confirmed in production use |
| `better-sqlite3` | `bun:sqlite` | Bun is not the AllClear runtime; better-sqlite3 works across all Node.js LTS versions the plugin must support |
| `fastify` v5 | `express` v5 | Fastify is 2.4× faster; first-class TypeScript; built-in schema validation; `@fastify/static` is purpose-built. Express is reasonable if team prefers it but offers no advantage here |
| `fastify` v5 | Native `http.createServer` | Native http lacks routing, static file serving, CORS middleware — would need manual reimplementation of what Fastify provides for free |
| `chromadb` npm package | Running `chroma-mcp` as Python subprocess | chroma-mcp is Python-only; spawning a Python subprocess from the Node.js worker adds OS dependency, version conflicts, and startup latency. The `chromadb` npm package talks directly to ChromaDB's HTTP REST API |
| D3.js v7 via CDN/bundle | Observable Plot | D3 provides the force simulation primitives needed for a dependency graph; Plot is higher-level and not suited for custom force-directed layouts |
| D3.js v7 | Cytoscape.js | Cytoscape is heavier (~400KB) and more suited for pre-defined graph layouts; D3 force simulation is the standard for exploratory dependency graphs |
| Single-process worker (HTTP + MCP stdio) | Separate HTTP process + MCP process | Single process shares the SQLite connection and query engine with zero IPC overhead; two processes would require a shared DB or RPC layer |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node:sqlite` (built-in) | Experimental flag required; no FTS5 production examples; API still changing | `better-sqlite3` |
| `bun:sqlite` | AllClear targets Node.js, not Bun; introduces runtime dependency assumption | `better-sqlite3` |
| `sequelize` or `prisma` ORM | Heavy abstractions over SQLite add complexity, break raw FTS5 queries, and add significant bundle size for what is essentially a local file database | Raw `better-sqlite3` with prepared statements |
| `ws` or `socket.io` WebSocket library | The graph UI doesn't need real-time push; polling `/graph` on demand is sufficient | Fastify REST + browser `fetch()` |
| `pm2` or `forever` for worker management | Overkill for a local dev tool; adds a global npm install requirement for the user; PID file + signal handling is sufficient | Native Node.js `process.on('SIGTERM')` + PID file |
| React / Vue / Svelte for graph UI | A build step in the plugin adds complexity for users cloning/installing it; D3 in a single HTML file requires no toolchain | Vanilla JS + D3 + inline `<script type="module">` |
| TypeScript compilation step in the plugin | Plugin files are executed directly by Node.js or Claude Code; a required `tsc` build step breaks the zero-config install promise | Plain JavaScript (JSDoc types for IDE support if needed) |
| `axios` or `node-fetch` for HTTP client | Node.js 20+ has native `fetch`; no additional HTTP client needed | Native `fetch()` (Node.js 20 global) |

---

## Version Compatibility (v2 additions)

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `better-sqlite3` 12.8.0 | Node.js 20+ | v12.8.0 raised minimum to Node.js v20; verified 2026-03-13. SQLite 3.51.3 bundled (includes WAL-reset fix) |
| `fastify` 5.8.2 | Node.js 20+ | v5 dropped Node.js 18 support; `@fastify/static` v8+ required for Fastify v5 |
| `@modelcontextprotocol/sdk` 1.27.1 | `zod` ≥3.25 | SDK imports from `zod/v4` internally but accepts zod v3.25+ via compatibility shim |
| `chromadb` 3.3.3 | ChromaDB server 0.5+ | v3 JS client is a full rewrite; incompatible with v2 API; requires separately installed embedding functions |
| `d3` 7.9.0 | Modern browsers (ES2017+) | v7 is the current stable; no v8 announced; ESM import works in all modern browsers |
| Node.js 20+ | All above | The minimum Node.js version for v2 worker is Node.js 20 (LTS), driven by better-sqlite3 12.x and fastify v5 |

---

## Sources (v2 addendum)

- `https://github.com/WiseLibs/better-sqlite3/releases` — v12.8.0 released 2026-03-13, Node.js v20+ required, SQLite 3.51.3 (HIGH confidence — GitHub releases, verified)
- `https://github.com/WiseLibs/better-sqlite3/discussions/1245` — Community discussion "Should I use better-sqlite3 over Node 22 core sqlite?" concluding node:sqlite not production-ready (MEDIUM confidence — community discussion)
- `https://github.com/WiseLibs/better-sqlite3/issues/1266` — `node:sqlite` benchmarking thread confirming better-sqlite3 still leads performance (MEDIUM confidence)
- `https://github.com/fastify/fastify/releases` — Fastify 5.8.2 current, Node.js v20+ required (HIGH confidence — GitHub releases)
- `https://github.com/modelcontextprotocol/typescript-sdk/releases` — @modelcontextprotocol/sdk v1.27.1 current (HIGH confidence — GitHub releases, verified 2026-03-15)
- `https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/` — StdioServerTransport pattern confirmed (MEDIUM confidence — official MCP docs)
- `https://d3js.org/getting-started` — D3 v7.9.0 confirmed current stable, ESM import pattern (HIGH confidence — official D3 docs)
- `https://www.trychroma.com/changelog/js-client-v3` — chromadb v3 rewrite changelog; v3.3.3 current (HIGH confidence — official Chroma changelog)
- `https://github.com/chroma-core/chroma-mcp` — chroma-mcp is Python-only (uvx command); no Node.js version exists (HIGH confidence — GitHub repo inspection)
- `https://esbuild.github.io/getting-started/` — esbuild `--external` flag for native modules, `--platform=node` pattern (HIGH confidence — official esbuild docs)
- `https://github.com/fastify/fastify-static` — @fastify/static for SPA serving pattern (HIGH confidence — official Fastify plugin)

---

*Stack research addendum for: AllClear v2 — Service Dependency Intelligence (worker, SQLite, MCP, D3, ChromaDB)*
*Researched: 2026-03-15*

---
---

# Stack Addendum: v2.1 UI Polish & Observability

**Milestone:** v2.1 — HiDPI canvas, zoom/pan tuning, project switcher, log terminal
**Researched:** 2026-03-16
**Confidence:** HIGH for HiDPI pattern and SSE (MDN + npm registry verified); HIGH for @xterm/xterm (npm registry, 2 months old); MEDIUM for zoom sensitivity (D3 docs verified, wheel delta tuning is underdocumented)

This section covers only the **new** stack additions for v2.1. The existing v1 and v2 stacks remain unchanged. No new npm packages are required for HiDPI or zoom tuning — those are pure JavaScript patterns applied to the existing Canvas 2D context.

---

## New Capabilities Required

| Capability | Approach | New npm dep? |
|------------|----------|--------------|
| HiDPI / Retina canvas | `devicePixelRatio` + `ResizeObserver` pattern in renderer.js | No |
| Zoom/pan sensitivity tuning | Custom wheel delta multiplier in interactions.js | No |
| Project switcher dropdown | DOM enhancement to existing `#project-select` in index.html | No |
| Log terminal with real-time streaming | `@xterm/xterm` (browser) + `@fastify/sse` (server) | Yes — 2 packages |

---

## New npm Dependencies

### Server-side: `@fastify/sse`

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `@fastify/sse` | 0.4.0 | Server-Sent Events endpoint for log streaming | Official Fastify plugin; compatible with Fastify v5 (peer dep `^5.x`); accepts async generators and Node.js Readable streams natively. One new Fastify route (`GET /logs`) streams `~/.allclear/logs/worker.log` tail as SSE. No WebSocket overhead — SSE is one-directional (server → browser), exactly the right primitive for log tailing. |

### Browser-side: `@xterm/xterm` + `@xterm/addon-fit`

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `@xterm/xterm` | 6.0.0 | Terminal emulator for log display panel | Current stable (published 2 months ago, Jan 2026). Full ANSI/VT100 support means structured JSON logs with color codes render correctly. Powers VS Code's integrated terminal — battle-tested for this exact use case. Successor to the `xterm` package (5.3.0) which is no longer updated. |
| `@xterm/addon-fit` | 0.11.0 | Resize xterm.js to fill its container | Required companion for responsive panels; call `fitAddon.fit()` on panel open/resize — without it the terminal has a fixed character grid that won't fill the log panel. |

These are **browser-side only** and loaded via CDN `+esm` import in `index.html`. They do NOT go in the Node.js `dependencies` in `package.json`.

---

## Implementation Patterns

### HiDPI Canvas Fix

The existing `resize()` function in `graph.js` sets `canvas.width = container.clientWidth` — this maps one canvas pixel to one CSS pixel, which is blurry on Retina displays (devicePixelRatio = 2).

**Fix — apply in `graph.js` resize function and propagate to renderer.js:**

```javascript
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = container.clientWidth;
  const cssHeight = container.clientHeight;

  // Physical pixel dimensions (crisp on Retina)
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  // CSS size stays the same — browser scales down to fit
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';

  // Scale drawing context so all coordinates remain in CSS pixels
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  render();
}
```

**Monitor devicePixelRatio changes** (user drags window between monitors):

```javascript
function watchDPR() {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener('change', () => { resize(); watchDPR(); }, { once: true });
}
watchDPR();
```

**Critical:** After `ctx.scale(dpr, dpr)`, all drawing code uses CSS pixel coordinates. The existing `renderer.js` code requires no changes to coordinates — only the canvas setup changes.

**Font size fix:** The existing renderer uses `${Math.round(11 / state.transform.scale)}px` for node labels. On HiDPI this renders at the correct logical size since the ctx is already scaled. However, the base font sizes (11px, 9px) are small — increase to 13px and 11px for legibility at normal zoom.

### Zoom/Pan Sensitivity Tuning

The existing wheel handler in `interactions.js` uses a fixed multiplier of `1.1` (zoom in) / `0.9` (zoom out). This is coarse — 10% per tick feels jumpy on trackpads where events fire rapidly.

**Recommended approach:** Replace fixed multiplier with a continuous delta based on `e.deltaY` magnitude, matching the D3 zoom default formula:

```javascript
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();

  // D3-style wheel delta: normalize across deltaMode values, apply sensitivity factor
  const SENSITIVITY = 0.001; // lower = slower zoom; D3 default is 0.002
  const delta = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : SENSITIVITY);
  const factor = Math.pow(2, delta);  // exponential feels more natural than linear

  const newScale = Math.min(5, Math.max(0.15, state.transform.scale * factor));
  const ratio = newScale / state.transform.scale;
  state.transform.x = e.offsetX - ratio * (e.offsetX - state.transform.x);
  state.transform.y = e.offsetY - ratio * (e.offsetY - state.transform.y);
  state.transform.scale = newScale;
  render();
}, { passive: false });
```

**Pan sensitivity:** Current pan is 1:1 pixel-to-pixel which is correct — no tuning needed.

**Zoom bounds:** Lower minimum from `0.2` to `0.15` (allows seeing larger graphs) and keep maximum at `5`.

### Project Switcher (Persistent Dropdown)

The existing `#project-select` element is hidden and partially wired. The v2.1 goal is a working dropdown in the toolbar that switches projects without a page reload.

**No new library needed.** The pattern:

1. On load, `GET /projects` → populate `<select id="project-select">` options
2. On `change`, fetch new graph data and reinitialize the force simulation in-place
3. Persist selection to `localStorage` so refresh restores last project

The existing `project-picker.js` module handles first-load selection. The toolbar dropdown is the persistent "already selected, switch it" control. Both can coexist — picker fires once on first load (no URL params), dropdown is always visible after.

### Log Terminal Panel

**Server side — new Fastify route in `server/http.js`:**

```javascript
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { watch } from 'fs';

fastify.get('/logs', { config: { sse: true } }, async (request, reply) => {
  const logFile = path.join(os.homedir(), '.allclear', 'logs', 'worker.log');

  // Stream existing lines, then tail for new ones
  async function* logLines() {
    // 1. Emit last N lines of existing log (backfill)
    try {
      const rl = createInterface({ input: createReadStream(logFile) });
      const buffer = [];
      for await (const line of rl) buffer.push(line);
      for (const line of buffer.slice(-200)) yield { data: line };
    } catch { /* log file may not exist yet */ }

    // 2. Watch for appends
    let resolve;
    const watcher = watch(logFile, () => { if (resolve) resolve(); });
    request.raw.on('close', () => watcher.close());

    let position = 0;
    try {
      const stat = await fs.promises.stat(logFile);
      position = stat.size;
    } catch { /* ok */ }

    while (!request.raw.destroyed) {
      await new Promise(r => { resolve = r; setTimeout(r, 5000); }); // max 5s wait
      const stream = createReadStream(logFile, { start: position });
      const rl = createInterface({ input: stream });
      for await (const line of rl) {
        position += Buffer.byteLength(line + '\n');
        yield { data: line };
      }
    }
    watcher.close();
  }

  await reply.sse.send(logLines());
});
```

**Browser side — `ui/modules/log-terminal.js` (new module):**

```javascript
import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/+esm';
import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/+esm';

let term = null;
let fitAddon = null;
let eventSource = null;
let componentFilter = '';
let searchFilter = '';

export function openLogTerminal(container) {
  if (!term) {
    term = new Terminal({
      theme: { background: '#0f1117', foreground: '#e2e8f0' },
      fontSize: 12,
      fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
      convertEol: true,
      scrollback: 5000,
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
  }

  if (!eventSource) {
    eventSource = new EventSource('/logs');
    eventSource.onmessage = (e) => {
      const line = e.data;
      // Apply component/search filter before writing
      if (shouldShow(line)) term.writeln(line);
    };
  }
}

function shouldShow(line) {
  if (componentFilter && !line.includes(componentFilter)) return false;
  if (searchFilter && !line.toLowerCase().includes(searchFilter)) return false;
  return true;
}

export function setComponentFilter(value) {
  componentFilter = value;
}

export function setSearchFilter(value) {
  searchFilter = value.toLowerCase();
}

export function closeLogTerminal() {
  if (eventSource) { eventSource.close(); eventSource = null; }
}

export function resizeLogTerminal() {
  if (fitAddon) fitAddon.fit();
}
```

**xterm.js CSS** — required for correct rendering. Load via CDN link tag in `index.html`:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.css" />
```

---

## Installation (v2.1 additions)

```bash
# Server-side only — one new npm dependency
npm install @fastify/sse@^0.4.0

# No npm install for xterm — loaded via CDN in index.html
# CDN URLs (pin to specific versions for reproducibility):
# @xterm/xterm:     https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/+esm
# @xterm/addon-fit: https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/+esm
# xterm CSS:        https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.css
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `@xterm/xterm` 6.0 via CDN | `xterm` 5.3.0 (legacy package) | `xterm` (without `@xterm/` scope) is the old package; no longer updated; 5.3.0 is the last release. The `@xterm/xterm` scoped package is the official continuation. |
| `@xterm/xterm` via CDN | Bundle xterm into a static asset | Xterm ships both CJS and ESM; ESM CDN import from jsDelivr works directly in `<script type="module">` with no bundler. Bundling is only needed for offline/air-gapped deployments. |
| `@fastify/sse` 0.4.0 | `fastify-sse-v2` 4.2.2 | `fastify-sse-v2` is a community plugin; `@fastify/sse` is the official Fastify-org plugin with Fastify 5 peer dep verified. Both work; official plugin preferred for long-term maintenance alignment. |
| `@fastify/sse` + `fs.watch` | WebSocket (`ws` package) for log streaming | WebSockets are bidirectional; log tailing is server-to-client only. SSE is simpler (no handshake, native browser `EventSource` API, automatic reconnect), and `@fastify/sse` integrates cleanly with the existing Fastify instance. |
| Native `fs.watch` + readline | `tail` npm package | The `tail` npm package (last meaningful update 2021) adds a dependency for functionality achievable with 20 lines of native Node.js. `fs.watch` + `readline` + position tracking is well-understood and sufficient. |
| `window.matchMedia` + `{ once: true }` re-registration | `ResizeObserver` with `devicePixelContentBoxSize` | `devicePixelContentBoxSize` is the most precise modern API but has inconsistent support in older Chrome/Safari versions still in use. `matchMedia('(resolution: Xdppx)')` + `change` event is the MDN-documented pattern with broad compatibility. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| WebGL renderer for xterm | `@xterm/addon-webgl` is available but xterm's Canvas renderer (default in v6) is sufficient for log display; WebGL renderer is for interactive PTY sessions with heavy rendering | Default Canvas renderer (built-in to `@xterm/xterm`) |
| `ansi-to-html` npm package | AllClear worker logs are structured JSON, not raw ANSI sequences; xterm handles ANSI natively if color codes appear | Let xterm render ANSI directly |
| `chokidar` for file watching | `chokidar` adds a dependency (and fsevents native on macOS) for something `fs.watch` already does adequately for a single log file | Native `fs.watch` |
| `loglevel` or `pino` browser logger | The log terminal is a viewer, not a logger; no browser-side log library is needed | `EventSource` + xterm `writeln()` |
| Virtualized log list (React-window, etc.) | xterm.js has a built-in `scrollback` buffer with configurable line count; no virtual list needed | `Terminal({ scrollback: 5000 })` |

---

## Version Compatibility (v2.1 additions)

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@fastify/sse` 0.4.0 | `fastify` ^5.x | Verified peer dep. Will NOT work with Fastify v4 — if ever downgraded, use `fastify-sse-v2` instead. |
| `@xterm/xterm` 6.0.0 | Modern browsers (Chrome 89+, Firefox 85+, Safari 14+) | v6 removed the legacy Canvas renderer addon in favor of built-in Canvas; removed WebGL by default. ES module import requires a browser with native ESM support — all browsers in scope qualify. |
| `@xterm/addon-fit` 0.11.0 | `@xterm/xterm` v4+ | Verified against v6.0.0 (same release cycle, same maintainer). |
| `fs.watch` log tailing | Node.js 20+ (macOS, Linux) | `fs.watch` on macOS uses FSEvents (reliable); on Linux uses inotify (reliable). Does not work for network file systems — not a concern for `~/.allclear/logs/`. |

---

## Sources (v2.1 addendum)

- `https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio` — devicePixelRatio property, matchMedia pattern for DPR change detection (HIGH confidence — MDN official docs)
- `https://web.dev/articles/canvas-hidipi` — Three-step HiDPI canvas pattern: multiply dimensions, CSS scale back down, scale context (HIGH confidence — Google web.dev official article)
- `npm info @fastify/sse` — version 0.4.0, peerDependencies: `{ fastify: '^5.x' }`, published 2026 (HIGH confidence — npm registry, verified 2026-03-16)
- `npm info @xterm/xterm` — version 6.0.0, MIT license, published ~2 months ago (Jan 2026) (HIGH confidence — npm registry, verified 2026-03-16)
- `npm info @xterm/addon-fit` — version 0.11.0, requires xterm.js v4+ (HIGH confidence — npm registry, verified 2026-03-16)
- `https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/` — ESM package available at jsDelivr with `+esm` suffix (HIGH confidence — CDN directory listing, verified 2026-03-16)
- `https://raw.githubusercontent.com/fastify/sse/main/README.md` — `reply.sse.send(asyncGenerator)` and `reply.sse.send(readableStream)` API; async generator pattern for streaming (HIGH confidence — official Fastify SSE README, fetched 2026-03-16)
- `https://d3js.org/d3-zoom` — wheel delta formula `−event.deltaY * (deltaMode=1 ? 0.05 : deltaMode ? 1 : 0.002)`, `zoom.wheelDelta()` customization (MEDIUM confidence — official D3 docs; sensitivity tuning is documented but behavior varies by trackpad driver)
- `https://newreleases.io/project/github/xtermjs/xterm.js/release/6.0.0` — xterm.js 6.0.0 breaking changes: Canvas renderer addon removed (built-in now), viewport/scrollbar changes (MEDIUM confidence — release announcement, not official changelog)

---

*Stack research addendum for: AllClear v2.1 — UI Polish & Observability (HiDPI canvas, zoom tuning, log terminal)*
*Researched: 2026-03-16*
