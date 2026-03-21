# Feature Research

**Domain:** Claude Code plugin — runtime dependency installation, MCP server distribution, version manifest sync
**Researched:** 2026-03-21
**Confidence:** HIGH (official Claude Code docs + direct codebase inspection)

> **Scope note:** This document covers v5.2.0 features only. All prior capabilities (MCP server with
> 8 tools, hooks, commands, graph UI, SQLite storage, marketplace plugin structure) are **already
> shipped** and are **dependencies**, not targets. Features below make the MCP server work when the
> plugin is installed from the marketplace.

---

## Current State (Evidence Base)

Read directly from the v5.1.2 source. These are facts, not assumptions.

| What exists | File | Notes |
|-------------|------|-------|
| MCP server with 8 tools | `plugins/ligamen/worker/mcp/server.js` | Imports `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod` at the top level — will throw on startup if these are not resolvable |
| `.mcp.json` in plugin root | `plugins/ligamen/.mcp.json` | Points to `${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js` with no `env` key — no `NODE_PATH` set |
| `runtime-deps.json` | `plugins/ligamen/runtime-deps.json` | Lists all 7 MCP server dependencies with correct semver; version field `5.1.2` matches plugin version |
| `package.json` with all deps | `plugins/ligamen/package.json` | Has `"type": "module"`, devDependencies, scripts — unsuitable as the install manifest for `npm install` into `CLAUDE_PLUGIN_DATA` |
| SessionStart hook | `plugins/ligamen/hooks/hooks.json` + `scripts/session-start.sh` | Injects project context; runs worker auto-start; does NOT do npm install; timeout is 10s |
| Root marketplace.json | `.claude-plugin/marketplace.json` | Version is `5.1.1` — drifted behind `plugin.json` and inner `marketplace.json` which are `5.1.2` |
| Inner marketplace.json | `plugins/ligamen/.claude-plugin/marketplace.json` | Version `5.1.2` — correct |
| `plugin.json` | `plugins/ligamen/.claude-plugin/plugin.json` | Version `5.1.2` — correct |

The core problem: when a user installs Ligamen from the marketplace and Claude Code starts the MCP
server subprocess (`node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js`), Node.js cannot find
`@modelcontextprotocol/sdk`, `better-sqlite3`, or `fastify` because they are not in the plugin
directory and `NODE_PATH` is not set. The server crashes silently at import time. All 8 MCP tools
are invisible to Claude.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are the minimum for v5.2.0. Missing any one = MCP server fails after marketplace install.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| SessionStart hook installs runtime deps into `${CLAUDE_PLUGIN_DATA}` | MCP server.js imports 7 packages; none ship with Node.js; without install those imports throw at startup and all 8 tools vanish | MEDIUM | Official Claude Code pattern: `diff -q "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" "${CLAUDE_PLUGIN_DATA}/runtime-deps.json" >/dev/null 2>&1 \|\| (cd "${CLAUDE_PLUGIN_DATA}" && cp "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" . && npm install --omit=dev) \|\| rm -f "${CLAUDE_PLUGIN_DATA}/runtime-deps.json"` |
| `NODE_PATH` env var in `.mcp.json` | MCP server starts as a subprocess launched by Claude Code; it must find its dependencies via `NODE_PATH` pointing to `${CLAUDE_PLUGIN_DATA}/node_modules` | LOW | Add `"env": { "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules" }` to the `ligamen-impact` server entry in `.mcp.json` |
| High timeout on the install hook | `npm install` of 7 packages (including `better-sqlite3` native build, `chromadb` with platform binaries) takes 30–60s on first run; current SessionStart timeout is 10s — hook is killed mid-install | LOW | Add a **separate** hook entry for the install step with `"timeout": 120`; keep the existing session-start.sh hook at its current timeout |
| Idempotent install guard | SessionStart fires on every session start; reinstalling every session blocks startup for 30–60s | LOW | The `diff ... \|\| install` pattern is the guard: runs only when `runtime-deps.json` differs from the stored copy; first run and post-update are both covered |
| Version sync: root marketplace.json | Root `.claude-plugin/marketplace.json` version is `5.1.1`; this is what users discover via `claude plugin marketplace add`; stale version means consumers are offered the old cached build | LOW | Bump to `5.2.0` to match other manifests |
| `runtime-deps.json` as the install manifest (not full `package.json`) | Full `package.json` has `"type": "module"`, devDependencies, and scripts that conflict with a plain `npm install` in a data directory; `runtime-deps.json` already contains only the 7 production deps | LOW | File already exists; just wire it into the install hook command instead of `package.json` |

### Differentiators (Competitive Advantage)

Features beyond minimum that improve distribution quality.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Graceful fallback when `npm` unavailable | Install hook exits 0 silently when `npm` is missing rather than printing an error and interrupting session start | LOW | Add `command -v npm >/dev/null 2>&1 \|\|  exit 0` guard at top of install command or in a wrapper script; the `\|\| rm -f ...` trailing clause already handles npm failure by clearing the copied manifest so next session retries |
| Version field in `runtime-deps.json` triggers reinstall on plugin updates | `runtime-deps.json` already has `"version": "5.1.2"` — diff against this file detects when a new plugin version ships, even if semver ranges in deps didn't change, because the version field bumps | LOW | Already present in `runtime-deps.json`; no code change needed; just keep version in sync with plugin version during releases |
| Single source-of-truth version bump script | A `make bump-version VERSION=X.Y.Z` target that updates all four version locations atomically prevents the current 5.1.1 vs 5.1.2 drift | MEDIUM | Uses `jq` or `sed` to write: `.claude-plugin/marketplace.json`, `plugins/ligamen/.claude-plugin/marketplace.json`, `plugins/ligamen/.claude-plugin/plugin.json`, `plugins/ligamen/runtime-deps.json` |
| Separate install hook entry (not inline in hooks.json command) | A dedicated shell script for the install step is testable, has proper error handling, and allows the install logic to evolve independently of hooks.json | LOW | `scripts/install-runtime-deps.sh` invoked from hooks.json; easier to bats-test than an inline one-liner |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Bundling `node_modules` inside the plugin directory | "Just ship the deps — no install step needed" | Claude Code copies marketplace plugins to `~/.claude/plugins/cache`; `better-sqlite3` and `chromadb` include platform-specific native binaries (darwin-arm64, linux-x64); bundling them fails on any platform other than where they were built; also inflates plugin size by ~40MB | Runtime install via `${CLAUDE_PLUGIN_DATA}` — platform-correct binaries, zero plugin size bloat |
| Using full `package.json` as the install manifest | One file to maintain | `"type": "module"` in package.json causes problems in the `CLAUDE_PLUGIN_DATA` directory where server.js is not being loaded from; devDependencies install unnecessary packages; the `chromadb` optional dep for platform binaries needs separate handling | Use `runtime-deps.json` — already exists, contains only the 7 production deps plus the optional chroma binding |
| Global `npm install -g` in hook | Appears simpler | Requires elevated permissions; breaks in sandboxed Claude Code environments; pollutes the user's global npm namespace with Ligamen's deps | `npm install` locally into `${CLAUDE_PLUGIN_DATA}/node_modules` with `NODE_PATH` |
| Checking `node_modules` directory existence as install guard | "Skip if folder exists" | A prior install from an older plugin version stays forever even after dep changes; a failed partial install leaves the directory but modules are broken | `diff` the stored `runtime-deps.json` against the bundled one — detects both first-run and post-update states reliably |
| Single combined SessionStart hook for context injection + install | "Keep hooks.json simple" | The existing session-start.sh has a 10s timeout that is correct for context injection; merging install into the same hook entry would require raising the timeout to 120s, making every session start wait up to 120s even after install is done | Two separate hook entries: one for install (timeout: 120), one for context injection (timeout: 10) |
| Versioning only in `plugin.json` | "One place is enough" | Root `marketplace.json` at `.claude-plugin/marketplace.json` is what Claude Code reads during `claude plugin marketplace add`; if it is stale, users install the old cached version; the docs warn explicitly: "If you change your plugin's code but don't bump the version in plugin.json, existing users won't see your changes due to caching" — the same applies to marketplace.json | Keep all four files in sync; automate with version-bump script |

---

## Feature Dependencies

```
[runtime-deps.json as install manifest]
    └──required by──> [SessionStart install hook (diff-based idempotency)]
                          └──required by──> [NODE_PATH in .mcp.json]
                                                └──required by──> [MCP server starts after marketplace install]
                                                                       └──required by──> [8 MCP tools visible to Claude]

[High timeout on install hook]
    └──required by──> [First-run native build doesn't time out]
    └──separate from──> [Existing session-start.sh hook (timeout: 10)]

[Root marketplace.json version sync]
    └──independent of install work (manifest files only)]
    └──required by──> [Consumers offered correct version via `claude plugin marketplace add`]
```

### Dependency Notes

- **Install hook must run before MCP server starts.** Claude Code fires SessionStart hooks before initializing MCP servers from `.mcp.json`. The install creates `${CLAUDE_PLUGIN_DATA}/node_modules` first; then the MCP server subprocess finds them via `NODE_PATH`. Ordering is guaranteed by design.
- **`NODE_PATH` requires a successful install first.** If the install hook fails and `node_modules` does not exist, the MCP server will still fail. The `|| rm -f ...` cleanup in the install command ensures the next session retries rather than skipping.
- **Two separate hook entries, not one.** The install hook needs `"timeout": 120`. The context injection hook needs `"timeout": 10`. They are independent and should be listed as separate entries in `hooks.json` under `SessionStart`.
- **Version sync is fully independent.** Can be done in any order. Does not affect runtime behavior. Affects only what version users see when discovering/updating the plugin.
- **`runtime-deps.json` version field must track plugin version.** When v5.2.0 ships, the file's `"version"` field must be `5.2.0`. This ensures the diff triggers a reinstall on update even if no dep semver ranges changed.

---

## MVP Definition (v5.2.0)

### Launch With (v5.2.0 core)

Minimum needed to make the MCP server work when installed from marketplace.

- [ ] Add install hook entry to `hooks/hooks.json` — separate entry under `SessionStart` with `"timeout": 120`, invoking `scripts/install-runtime-deps.sh`
- [ ] Create `scripts/install-runtime-deps.sh` — implements the `diff ... || (cd "${CLAUDE_PLUGIN_DATA}" && cp runtime-deps.json . && npm install --omit=dev) || rm -f ...` pattern with `npm` availability guard
- [ ] Add `NODE_PATH` env to `.mcp.json` — `"env": { "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules" }` on the `ligamen-impact` server entry
- [ ] Bump root `marketplace.json` to `5.2.0` — `.claude-plugin/marketplace.json` `"version"` field
- [ ] Bump all other manifests to `5.2.0` — `plugins/ligamen/.claude-plugin/marketplace.json`, `plugins/ligamen/.claude-plugin/plugin.json`, `plugins/ligamen/runtime-deps.json`

### Add After Validation (v5.2.x)

- [ ] Makefile `bump-version` target — automates keeping all four version files in sync; trigger: any version drift found in CI or during next release
- [ ] Bats tests for `install-runtime-deps.sh` — cover: first run, already-installed idempotency, npm missing fallback, failed install cleanup; trigger: any CI failure on install script

### Future Consideration (v6+)

- [ ] Declarative plugin dependency manifest (if Anthropic ships [issue #27113](https://github.com/anthropics/claude-code/issues/27113)) — would replace the manual npm install hook pattern with Claude Code managing the install lifecycle natively; the `runtime-deps.json` file already serves as the data source for this

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| SessionStart install hook + install script | HIGH — MCP server broken without it | LOW — ~30 lines of shell | P1 |
| `NODE_PATH` in `.mcp.json` | HIGH — MCP server broken without it | LOW — one env key in JSON | P1 |
| High timeout on install hook entry | HIGH — first-run install silently killed without it | LOW — one integer change | P1 |
| Root marketplace.json version sync (5.2.0) | MEDIUM — users discover/install wrong version | LOW — one field in JSON | P1 |
| All manifest files bumped to 5.2.0 | MEDIUM — consistency, avoids confusion | LOW — four field changes | P1 |
| Makefile version-bump target | MEDIUM — prevents future drift | MEDIUM — jq/sed script | P2 |
| Bats tests for install script | MEDIUM — CI confidence | MEDIUM — bats fixtures needed | P2 |

**Priority key:**
- P1: Required for v5.2.0 to meet its goal (MCP server works from marketplace install)
- P2: Should have; include in same PR if low risk, otherwise next patch
- P3: Future consideration

---

## Ecosystem Reference: Official Pattern (HIGH confidence)

The official Claude Code docs ([plugins-reference](https://code.claude.com/docs/en/plugins-reference)) document this exact pattern:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "diff -q \"${CLAUDE_PLUGIN_ROOT}/package.json\" \"${CLAUDE_PLUGIN_DATA}/package.json\" >/dev/null 2>&1 || (cd \"${CLAUDE_PLUGIN_DATA}\" && cp \"${CLAUDE_PLUGIN_ROOT}/package.json\" . && npm install) || rm -f \"${CLAUDE_PLUGIN_DATA}/package.json\""
          }
        ]
      }
    ]
  }
}
```

And the `NODE_PATH` MCP server pattern:

```json
{
  "mcpServers": {
    "routines": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"],
      "env": {
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

Ligamen should use `runtime-deps.json` instead of `package.json` as the diff target, and add
`--omit=dev` to the `npm install` invocation to skip devDependencies.

The `${CLAUDE_PLUGIN_DATA}` directory resolves to `~/.claude/plugins/data/{id}/` where `{id}` is
the plugin identifier with special characters replaced by `-`. It is created automatically on first
reference. It persists across plugin updates and is only deleted on full uninstall.

---

## Sources

- [Claude Code Plugins Reference — official docs](https://code.claude.com/docs/en/plugins-reference) — HIGH confidence; canonical source for `CLAUDE_PLUGIN_DATA`, `NODE_PATH` pattern, SessionStart install hook, version management warnings, data directory path resolution
- Direct code inspection of `plugins/ligamen/.mcp.json`, `plugins/ligamen/runtime-deps.json`, `plugins/ligamen/.claude-plugin/plugin.json`, `plugins/ligamen/.claude-plugin/marketplace.json`, `.claude-plugin/marketplace.json`, `plugins/ligamen/hooks/hooks.json`, `plugins/ligamen/scripts/session-start.sh`, `plugins/ligamen/worker/mcp/server.js` — HIGH confidence (source of truth for current state)
- [Claude Code GitHub Issue #27113 — Declarative plugin dependencies](https://github.com/anthropics/claude-code/issues/27113) — MEDIUM confidence; feature request, not yet shipped

---
*Feature research for: Ligamen v5.2.0 — Plugin Distribution Fix (runtime deps + MCP server auto-start)*
*Researched: 2026-03-21*
