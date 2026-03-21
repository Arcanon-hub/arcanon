# Architecture Research

**Domain:** Ligamen v5.2.0 — Plugin Distribution Fix (Runtime Dependency Installation + NODE_PATH MCP Launch)
**Researched:** 2026-03-21
**Confidence:** HIGH — based on direct source inspection of all affected components

---

## Context

This file covers v5.2.0 integration architecture only. The single question answered: how do runtime dependency
installation via SessionStart hook and NODE_PATH-based MCP server launching integrate with the existing plugin
architecture? What changes, what is new, and in what order should work proceed?

---

## The Distribution Problem

When a user installs Ligamen from the marketplace (`claude plugin marketplace add` + `claude plugin install`):

1. Claude Code copies plugin source to an install location (inaccessible path, no `node_modules`)
2. `CLAUDE_PLUGIN_ROOT` is set to that install location at runtime
3. The `.mcp.json` tells Claude to run `node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js`
4. `server.js` opens with bare ESM imports: `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`
5. Node.js fails — there are no `node_modules` at `CLAUDE_PLUGIN_ROOT`
6. MCP server never starts; all 8 impact/drift tools are unavailable

The fix has two parts that must work together:

- **Install side:** SessionStart hook installs npm deps into `${CLAUDE_PLUGIN_DATA}` on first run
- **Launch side:** `.mcp.json` passes `NODE_PATH` env var pointing at installed deps so Node.js finds modules

---

## Existing System Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         Claude Code Plugin Runtime                               │
│                                                                                  │
│   CLAUDE_PLUGIN_ROOT=/path/to/installed/plugin  (set by Claude Code)            │
│   CLAUDE_PLUGIN_DATA=/path/to/plugin/data       (writable per-plugin storage)  │
│   CLAUDE_PLUGIN_CONFIG=...                       (plugin config dir)            │
└──────────────┬───────────────────────────────────────────────┬───────────────────┘
               │                                               │
               ▼                                               ▼
┌──────────────────────────────┐           ┌──────────────────────────────────────┐
│         Hook Layer           │           │           MCP Layer                  │
│  hooks/hooks.json            │           │  .mcp.json (per-plugin)              │
│                              │           │                                      │
│  SessionStart →              │           │  ligamen-impact server:              │
│    scripts/session-start.sh  │           │    command: node                     │
│                              │           │    args: [${CLAUDE_PLUGIN_ROOT}/     │
│  PostToolUse (Write|Edit) →  │           │           worker/mcp/server.js]      │
│    scripts/format.sh         │           │    env: {}    ← MISSING NODE_PATH    │
│    scripts/lint.sh           │           │                                      │
│                              │           │  server.js bare ESM imports:         │
│  PreToolUse (Write|Edit) →   │           │    @modelcontextprotocol/sdk         │
│    scripts/file-guard.sh     │           │    better-sqlite3                    │
│                              │           │    fastify, zod, chromadb            │
└──────────────────────────────┘           └──────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│      session-start.sh        │           ┌─────────────────────────────────────┐
│  (current, pre-v5.2)         │           │         Data Directory              │
│                              │           │  ~/.ligamen/  (LIGAMEN_DATA_DIR)    │
│  1. Dedup by SESSION_ID      │           │  ├── worker.pid / worker.port       │
│  2. Source worker-client.sh  │           │  ├── settings.json                  │
│  3. Auto-start worker if     │           │  ├── projects/<hash>/               │
│     ligamen.config.json      │           │  │   └── impact-map.db (SQLite)     │
│     has [impact-map] key     │           │  └── logs/                          │
│  4. Detect project type      │           │                                     │
│  5. Emit additionalContext   │           │  CLAUDE_PLUGIN_DATA (new in v5.2)   │
│     JSON to stdout           │           │  └── node_modules/ ← TO BE CREATED  │
└──────────────────────────────┘           └─────────────────────────────────────┘
```

---

## v5.2.0 Target Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         Claude Code Plugin Runtime                               │
│   CLAUDE_PLUGIN_ROOT  — plugin source (read-only after install)                  │
│   CLAUDE_PLUGIN_DATA  — writable per-plugin data dir (npm install target)        │
└──────────────┬───────────────────────────────────────────────┬───────────────────┘
               │                                               │
               ▼                                               ▼
┌──────────────────────────────┐           ┌──────────────────────────────────────┐
│         Hook Layer           │           │           MCP Layer (MODIFIED)       │
│  hooks/hooks.json (UNCHANGED)│           │  .mcp.json                           │
│                              │           │                                      │
│  SessionStart →              │           │  ligamen-impact server:              │
│    scripts/session-start.sh  │           │    command: node                     │
│    (MODIFIED: adds dep       │           │    args: [${CLAUDE_PLUGIN_ROOT}/     │
│     install step)            │           │           worker/mcp/server.js]      │
│                              │           │    env:                              │
│                              │           │      NODE_PATH: ${CLAUDE_PLUGIN_DATA}│
│                              │           │               /node_modules          │
└──────────────────────────────┘           └──────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    session-start.sh (MODIFIED — new Step 0)                      │
│                                                                                  │
│  Step 0 (NEW): Runtime dep install                                               │
│    - Check CLAUDE_PLUGIN_DATA is set and writable                                │
│    - Check ${CLAUDE_PLUGIN_DATA}/.ligamen-deps-version                           │
│    - If version missing or != current plugin version → run npm install           │
│      npm install --prefix ${CLAUDE_PLUGIN_DATA}                                  │
│               --no-save --no-package-lock                                        │
│               --ignore-scripts                                                   │
│               $(jq -r deps from runtime-deps.json | format as pkg@ver)          │
│    - On success: write version stamp to .ligamen-deps-version                    │
│    - On failure: exit 0 (non-blocking; MCP server will just fail gracefully)     │
│                                                                                  │
│  Step 1 (UNCHANGED): Dedup by SESSION_ID flag file                               │
│  Step 2 (UNCHANGED): Source worker-client.sh, auto-start worker                 │
│  Step 3 (UNCHANGED): Detect project type                                         │
│  Step 4 (UNCHANGED): Emit additionalContext JSON                                 │
└──────────────────────────────────────────────────────────────────────────────────┘
               │ npm install
               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    CLAUDE_PLUGIN_DATA/                                           │
│  ├── node_modules/                     ← npm install target                     │
│  │   ├── @modelcontextprotocol/sdk/                                             │
│  │   ├── better-sqlite3/                                                         │
│  │   ├── fastify/                                                                │
│  │   ├── @fastify/cors/                                                          │
│  │   ├── @fastify/static/                                                        │
│  │   ├── chromadb/                                                               │
│  │   └── zod/                                                                   │
│  └── .ligamen-deps-version             ← version stamp (e.g. "5.2.0")          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | v5.2.0 Change |
|-----------|----------------|---------------|
| `hooks/hooks.json` | Hook event routing — SessionStart, PostToolUse, PreToolUse | UNCHANGED |
| `scripts/session-start.sh` | Session initialization: context injection, worker start | MODIFIED: add Step 0 dep install before existing logic |
| `.mcp.json` | MCP server spawn config — command, args, env | MODIFIED: add `env.NODE_PATH` pointing to installed deps |
| `runtime-deps.json` | Manifest of npm packages needed by MCP server | NEW FILE (already exists in repo — needs to be the authoritative source) |
| `.claude-plugin/plugin.json` | Plugin metadata: name, version, author | MODIFIED: version bump to match milestone |
| `.claude-plugin/marketplace.json` (plugin-level) | Marketplace listing metadata | MODIFIED: version sync |
| `.claude-plugin/marketplace.json` (root-level) | Repo-level marketplace discovery | MODIFIED: version sync |
| `package.json` | npm package metadata for dev install path | MODIFIED: version sync |
| `worker/mcp/server.js` | MCP server — 8 tools for impact + drift queries | UNCHANGED: Node.js ESM resolution will find modules via NODE_PATH |
| Root `.mcp.json` | Dev repo MCP config | UNCHANGED: already `{"mcpServers": {}}` — correct for dev repo |

---

## Key Integration Points

### 1. SESSION_ID Deduplication vs. Dep Install Timing

**The tension:** session-start.sh has a dedup guard (exits 0 if flag file for SESSION_ID already exists). The dep install step must happen BEFORE the dedup check, or it will only run on the very first session and never again after updates.

**Resolution:** Place dep install as Step 0, before the SESSION_ID flag file check. The install itself is idempotent (version stamp prevents unnecessary reinstalls), so running it every session start is safe — the stamp check makes it near-zero cost after first install.

```
session-start.sh execution order:
  1. (NEW) Dep install check: CLAUDE_PLUGIN_DATA version stamp ≠ plugin version → npm install
  2. (existing) SESSION_ID dedup: exit if flag file exists
  3. (existing) Worker auto-start
  4. (existing) Project detection
  5. (existing) Emit additionalContext JSON
```

### 2. NODE_PATH Resolution in .mcp.json

**What NODE_PATH does:** When set, Node.js searches these directories for modules before its normal resolution path. A module imported as `@modelcontextprotocol/sdk/server/mcp.js` will be found at `${NODE_PATH}/@modelcontextprotocol/sdk/server/mcp.js`.

**The variable:** `.mcp.json` env values support `${CLAUDE_PLUGIN_DATA}` expansion. The path must be `${CLAUDE_PLUGIN_DATA}/node_modules` — the direct `node_modules` dir, not the parent.

**Current `.mcp.json`:**
```json
{
  "mcpServers": {
    "ligamen-impact": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js"]
    }
  }
}
```

**Target `.mcp.json`:**
```json
{
  "mcpServers": {
    "ligamen-impact": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js"],
      "env": {
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

**Why not `--require` or `--loader`:** NODE_PATH is the standard mechanism for redirecting module resolution without modifying source. It works with ESM (`import`) when Node.js falls through to `NODE_PATH` directories after failing local resolution.

**Confidence note:** Claude Code's variable expansion of `${CLAUDE_PLUGIN_DATA}` in `.mcp.json` `env` blocks should be confirmed against official docs. The `${CLAUDE_PLUGIN_ROOT}` pattern in `args` is proven to work (it's in the existing hooks.json). Extension to `env` values is likely but not confirmed from source.

### 3. runtime-deps.json as Authoritative Manifest

**Current state:** `runtime-deps.json` exists at `plugins/ligamen/runtime-deps.json` with correct deps. `package.json` also has the same deps listed as `dependencies`. There are now two sources of truth.

**Integration:** `session-start.sh` Step 0 must read from `runtime-deps.json`, not `package.json`. Reading `package.json` would install all deps including dev tooling. `runtime-deps.json` is intentionally trimmed to MCP server needs only.

**Install command pattern:**
```bash
# Read runtime-deps.json, format as "pkg@version" list, pass to npm install
DEPS_JSON="${CLAUDE_PLUGIN_ROOT}/runtime-deps.json"
INSTALL_ARGS=$(jq -r '
  .dependencies // {} |
  to_entries[] |
  "\(.key)@\(.value | ltrimstr("^") | ltrimstr("~"))"
' "$DEPS_JSON")
npm install --prefix "${CLAUDE_PLUGIN_DATA}" \
  --no-save --no-package-lock --ignore-scripts \
  $INSTALL_ARGS
```

Note: `optionalDependencies` (chromadb embed) should be handled separately — pass `--no-optional` on main install, attempt optional in a second pass that exits 0 on failure.

### 4. Version Stamp Mechanism

**Purpose:** Prevents npm install from running on every session start after deps are already installed. Also ensures deps are re-installed after plugin upgrade.

**Location:** `${CLAUDE_PLUGIN_DATA}/.ligamen-deps-version`
**Contents:** The plugin version string (e.g., `5.2.0`)
**Source of truth for version:** `${CLAUDE_PLUGIN_ROOT}/runtime-deps.json` `.version` field

**Logic:**
```bash
STAMP="${CLAUDE_PLUGIN_DATA}/.ligamen-deps-version"
CURRENT_VERSION=$(jq -r '.version // empty' "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" 2>/dev/null)
INSTALLED_VERSION=$(cat "$STAMP" 2>/dev/null || echo "")

if [[ "$INSTALLED_VERSION" == "$CURRENT_VERSION" && -d "${CLAUDE_PLUGIN_DATA}/node_modules" ]]; then
  # Deps are current — skip install
  :
else
  # Install (or re-install on version mismatch)
  npm install ... && echo "$CURRENT_VERSION" > "$STAMP"
fi
```

### 5. Version Sync Across Manifest Files

Four files carry the plugin version; they must stay in sync:

| File | Field | Current |
|------|-------|---------|
| `plugins/ligamen/runtime-deps.json` | `.version` | 5.1.2 |
| `plugins/ligamen/package.json` | `.version` | 5.1.2 |
| `plugins/ligamen/.claude-plugin/plugin.json` | `.version` | 5.1.2 |
| `plugins/ligamen/.claude-plugin/marketplace.json` | `.plugins[0].version` | 5.1.2 |
| `.claude-plugin/marketplace.json` (root) | `.plugins[0].version` | 5.1.1 (STALE) |

The root `.claude-plugin/marketplace.json` is already stale (5.1.1 vs 5.1.2). Version sync is a discrete, independent step with no code dependencies.

---

## Data Flow: v5.2.0 Runtime Boot

```
Claude Code starts new session
    │
    ▼
SessionStart hook fires → session-start.sh
    │
    ├─ Step 0: Dep install check (NEW)
    │   ├─ CLAUDE_PLUGIN_DATA set? → YES/NO
    │   ├─ node_modules/ exists AND version stamp matches? → skip
    │   └─ otherwise → npm install --prefix $CLAUDE_PLUGIN_DATA
    │                  → write .ligamen-deps-version
    │                  → exit 0 on failure (non-blocking)
    │
    ├─ Step 1: SESSION_ID dedup (unchanged)
    ├─ Step 2: Worker auto-start (unchanged)
    ├─ Step 3: Project detection (unchanged)
    └─ Step 4: Emit additionalContext JSON (unchanged)

Claude Code launches MCP server (separately, concurrently with hook)
    │
    ├─ Reads .mcp.json:
    │   command: node
    │   args: [${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js]
    │   env: { NODE_PATH: "${CLAUDE_PLUGIN_DATA}/node_modules" }
    │
    └─ Node.js starts server.js
        ├─ import { McpServer } from "@modelcontextprotocol/sdk/..."
        │   └─ Node searches NODE_PATH → finds in $CLAUDE_PLUGIN_DATA/node_modules/
        ├─ import Database from "better-sqlite3"
        │   └─ Node searches NODE_PATH → finds native module
        └─ MCP server initializes, 8 tools registered
```

**Timing consideration:** MCP server launch and SessionStart hook may run concurrently. The dep install in SessionStart may not complete before the MCP server starts. This is acceptable:
- On first install: MCP server fails to start (deps not yet installed). User can restart session.
- On subsequent sessions: deps are already installed (stamp exists); install step is a fast no-op; MCP server starts normally.
- Alternative: move dep install to a pre-install script (if Claude Code supports it). No evidence this exists in the plugin format.

---

## Recommended Build Order

Dependencies flow strictly from manifest → install logic → MCP config.

### Step 1 — Version sync across all manifest files (MODIFY 5 files)

**Files:**
- `plugins/ligamen/runtime-deps.json` — bump `.version` to 5.2.0
- `plugins/ligamen/package.json` — bump `.version` to 5.2.0
- `plugins/ligamen/.claude-plugin/plugin.json` — bump `.version` to 5.2.0
- `plugins/ligamen/.claude-plugin/marketplace.json` — bump `.plugins[0].version` to 5.2.0
- `.claude-plugin/marketplace.json` (root) — bump `.plugins[0].version` to 5.2.0 (also fix stale 5.1.1)

**Why first:** Dep install step reads version from `runtime-deps.json`. If version is wrong, stamp check logic breaks. Do this before writing any install logic.

**Risk:** None — pure string changes, no logic.

### Step 2 — Update .mcp.json with NODE_PATH env (MODIFY 1 file)

**File:** `plugins/ligamen/.mcp.json`

**What:** Add `env.NODE_PATH` pointing to `${CLAUDE_PLUGIN_DATA}/node_modules`.

**Why second:** Independent of the install logic — can be verified in isolation. A user can manually run the install and test MCP server launch with NODE_PATH set before the hook is written.

**Risk:** Low — additive JSON change. If `${CLAUDE_PLUGIN_DATA}` expansion doesn't work in env values, fallback is to use an absolute path (less portable) or a wrapper script.

### Step 3 — Add dep install Step 0 to session-start.sh (MODIFY 1 file)

**File:** `plugins/ligamen/scripts/session-start.sh`

**What:** Insert dep install block before the SESSION_ID dedup check. Read version from `runtime-deps.json`, compare stamp, run npm install if needed, write stamp. Non-blocking (exit 0 on any failure).

**Why third:** Depends on Step 1 (`runtime-deps.json` version must be correct). Step 2 can precede this because MCP config and install logic are independent.

**Risk:** Moderate. The install step runs in a hook context; `npm` may not be on PATH in all environments. Mitigation: check `command -v npm` before attempting, exit 0 silently if absent.

### Step 4 — Clean up root .mcp.json (VERIFY, no change needed)

**File:** `/Users/ravichillerega/sources/ligamen/.mcp.json`

**Current state:** `{"mcpServers": {}}` — already correct. This is the dev repo's MCP config; it should not register the MCP server (developers use the plugin-scoped `.mcp.json` for that).

**Why last:** Verification only. If any cleanup is needed, it's isolated and safe to do last.

---

## What Does NOT Change

| Component | Reason |
|-----------|--------|
| `hooks/hooks.json` | Hook event routing is correct; SessionStart already fires the right script |
| `worker/mcp/server.js` | ESM imports are correct; NODE_PATH makes them findable at runtime |
| `worker/index.js` | HTTP worker — started by worker-start.sh with full node_modules at plugin root (dev) or CLAUDE_PLUGIN_DATA (marketplace) |
| `lib/worker-client.sh` | Worker HTTP helpers — no change |
| `scripts/worker-start.sh` | Worker daemon launcher — no change |
| All 8 MCP tool implementations | Pure business logic; module resolution is the only issue |
| SQLite schema and migrations | No data model changes |
| `worker/ui/` (graph UI) | Served from HTTP worker; not affected by MCP distribution changes |

---

## Anti-Patterns

### Anti-Pattern 1: Run npm install on every session start

**What people do:** Skip the version stamp and run `npm install` unconditionally at the start of each session.
**Why wrong:** `npm install` for 7 packages including native addons (`better-sqlite3`) takes 5-30 seconds. This blocks every session start. The hook has a 10-second timeout in `hooks.json` — it would fire timeout errors regularly.
**Do this instead:** Version stamp check. If `${CLAUDE_PLUGIN_DATA}/.ligamen-deps-version` matches `runtime-deps.json` `.version` and `node_modules/` exists, skip the install entirely. Near-zero overhead on subsequent sessions.

### Anti-Pattern 2: Install deps into CLAUDE_PLUGIN_ROOT

**What people do:** Run `npm install` into the plugin source directory (`${CLAUDE_PLUGIN_ROOT}/node_modules`).
**Why wrong:** `CLAUDE_PLUGIN_ROOT` is the plugin install location — it may be read-only. The correct writable per-plugin storage is `CLAUDE_PLUGIN_DATA`, which is explicitly provided for this purpose.
**Do this instead:** Always target `--prefix ${CLAUDE_PLUGIN_DATA}`.

### Anti-Pattern 3: Hardcode dependencies in session-start.sh

**What people do:** Write the npm install command with package names and versions hardcoded in the shell script.
**Why wrong:** Every dependency update requires editing two places: `runtime-deps.json` and `session-start.sh`. They inevitably drift. The version stamp check also becomes unreliable (stamp could match even if the hardcoded list diverges).
**Do this instead:** Read deps dynamically from `runtime-deps.json` using `jq`. Single source of truth.

### Anti-Pattern 4: Place dep install after SESSION_ID dedup

**What people do:** Add the dep install block after the existing SESSION_ID flag file check.
**Why wrong:** The dedup guard exits 0 if the flag file exists. Once the flag file is created in session N, session N+1 exits before reaching the install step. Deps never get re-installed after a plugin upgrade.
**Do this instead:** Dep install (Step 0) must precede the SESSION_ID dedup check (Step 1). The stamp mechanism provides its own idempotency — the dedup guard is for context injection, not dep management.

### Anti-Pattern 5: Blocking session-start.sh on npm install failure

**What people do:** Use `set -e` semantics where an npm install failure causes session-start.sh to exit non-zero.
**Why wrong:** Claude Code may treat a non-zero exit from a SessionStart hook as an error that blocks the session. The entire plugin policy is non-blocking (`trap 'exit 0' ERR` is already set).
**Do this instead:** Wrap the npm install in a subshell or `|| true`. If install fails, the MCP server fails to start, but hooks still function and the user sees an error message through Claude's MCP status rather than a broken session.

---

## Integration Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `session-start.sh` ↔ `runtime-deps.json` | Shell reads JSON via `jq` | `runtime-deps.json` must exist at `${CLAUDE_PLUGIN_ROOT}/runtime-deps.json` |
| `session-start.sh` ↔ `CLAUDE_PLUGIN_DATA` | Shell writes files to writable dir | Must check `CLAUDE_PLUGIN_DATA` is set; not available in dev/direct-install context |
| `.mcp.json` ↔ `CLAUDE_PLUGIN_DATA/node_modules` | Node.js ENV at server spawn | `NODE_PATH` is Node.js standard; requires `${CLAUDE_PLUGIN_DATA}` expansion in Claude Code `.mcp.json` env values |
| `npm install` ↔ native addons | `node-gyp` at install time | `better-sqlite3` is a native addon; requires build tools (Python, C++ compiler). May fail in restricted environments. |
| Version stamp ↔ dep install freshness | File read/write in `CLAUDE_PLUGIN_DATA` | Stamp must be written atomically after successful install (not before) |

---

## Recommended Project Structure Changes

```
plugins/ligamen/
├── .claude-plugin/
│   ├── plugin.json              # MODIFIED: version → 5.2.0
│   └── marketplace.json         # MODIFIED: version → 5.2.0
├── .mcp.json                    # MODIFIED: add env.NODE_PATH
├── runtime-deps.json            # MODIFIED: version → 5.2.0 (was 5.1.2)
├── package.json                 # MODIFIED: version → 5.2.0
└── scripts/
    └── session-start.sh         # MODIFIED: add Step 0 dep install block

.claude-plugin/
└── marketplace.json             # MODIFIED: version → 5.2.0 (fix stale 5.1.1)
```

No new files. No directory additions. All changes are modifications to existing files.

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| MCP server ESM import failure root cause | HIGH | Direct inspection of server.js imports + installed file layout |
| `CLAUDE_PLUGIN_DATA` as install target | HIGH | Standard Claude Code plugin convention; `CLAUDE_PLUGIN_ROOT` vs `CLAUDE_PLUGIN_DATA` distinction clear from env vars in session-start.sh |
| NODE_PATH for ESM module resolution | HIGH | Node.js docs; standard mechanism; no source changes needed |
| `${CLAUDE_PLUGIN_DATA}` expansion in .mcp.json env | MEDIUM | `${CLAUDE_PLUGIN_ROOT}` works in args (confirmed); env value expansion likely follows same pattern but not confirmed from official docs |
| npm install in SessionStart hook timing | MEDIUM | MCP server and SessionStart may run concurrently; first-install race is known but acceptable |
| `better-sqlite3` native addon build at install | LOW | Native addon requires build tools; may fail in some environments; no mitigation in current plan |
| Session-start.sh dedup order issue | HIGH | Code directly read; SESSION_ID flag logic is lines 31-37; must precede flag write with Step 0 |
| Version files needing sync | HIGH | All 5 files directly inspected; root marketplace.json confirmed stale at 5.1.1 |

---

## Sources

- `plugins/ligamen/worker/mcp/server.js` — ESM import statements (lines 1-14); confirmed bare package imports (source code, HIGH)
- `plugins/ligamen/.mcp.json` — current spawn config without NODE_PATH (source code, HIGH)
- `plugins/ligamen/runtime-deps.json` — authoritative dep list with versions (source code, HIGH)
- `plugins/ligamen/scripts/session-start.sh` — dedup logic lines 31-37, overall flow (source code, HIGH)
- `plugins/ligamen/hooks/hooks.json` — SessionStart → session-start.sh wiring (source code, HIGH)
- `plugins/ligamen/lib/worker-client.sh` — worker start pattern (source code, HIGH)
- `plugins/ligamen/scripts/worker-start.sh` — version mismatch restart pattern (reference for stamp approach) (source code, HIGH)
- `plugins/ligamen/package.json` — version 5.1.2, dep list (source code, HIGH)
- `plugins/ligamen/.claude-plugin/plugin.json` — version 5.1.2 (source code, HIGH)
- `plugins/ligamen/.claude-plugin/marketplace.json` — version 5.1.2 (source code, HIGH)
- `.claude-plugin/marketplace.json` (root) — version 5.1.1, confirmed stale (source code, HIGH)
- `.planning/PROJECT.md` — v5.2.0 milestone goals (source code, HIGH)

---

*Architecture research for: Ligamen v5.2.0 Plugin Distribution Fix*
*Researched: 2026-03-21*
