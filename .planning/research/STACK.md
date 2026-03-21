# Stack Research

**Domain:** Claude Code plugin runtime dependency distribution (v5.2.0)
**Researched:** 2026-03-21
**Confidence:** HIGH — core patterns sourced from official Claude Code documentation and Node.js ESM docs

---

## Context: What This Milestone Adds

This is a **subsequent milestone** on an existing plugin. The existing stack (Node.js ESM, better-sqlite3, fastify, @modelcontextprotocol/sdk, D3 canvas, bats) is already validated and out of scope. This document covers only what is needed for v5.2.0: runtime dependency installation via SessionStart hook, CLAUDE_PLUGIN_DATA usage, MCP config changes, and version sync tooling.

---

## Recommended Stack

### Core Technologies (Additions/Changes Only)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `npm install --prefix` | npm 11.x (bundled with Node 25) | Install runtime deps into CLAUDE_PLUGIN_ROOT at SessionStart | Native npm, no extra tooling. `--prefix` puts node_modules exactly where ESM resolution walks to find it |
| `diff -q` (coreutils) | system | Detect when runtime-deps.json changed to trigger reinstall | Used verbatim in official Claude Code plugin docs example. Zero-dep, available on all POSIX systems |
| `jq` | >=1.6 | Rewrite version fields in manifests in version-sync script | Already a required dep of session-start.sh (SSTH-03 guard). No new dependency |
| `scripts/bump-version.sh` (bash) | n/a | Single command to sync version across all 5 manifest files | jq rewrites are atomic per-file; no npm version script limitations with this multi-file layout |

### MCP Server Config

The current `plugins/ligamen/.mcp.json` is correct as-is for the post-install state — once node_modules exists at CLAUDE_PLUGIN_ROOT (installed by the SessionStart hook), Node.js ESM resolution finds it automatically.

| Config field | Current value | Change | Reason |
|--------------|--------------|--------|--------|
| `args` | `["${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js"]` | No change | Correct — server.js resolves deps from CLAUDE_PLUGIN_ROOT/node_modules |
| `env.NODE_PATH` | absent | **Do NOT add** | NODE_PATH is explicitly not supported by the Node.js ESM loader. The MCP server uses ESM imports; NODE_PATH has no effect. Adding it creates false confidence |

### Development Tools (No New Additions)

All existing tooling (bats, shellcheck, jq, node:test) covers this milestone. The version-sync script is a plain bash script, not a new dev dependency.

---

## Patterns by Feature

### Feature 1: SessionStart Hook for Dependency Installation

**Approach: npm install --prefix ${CLAUDE_PLUGIN_ROOT}**

Install directly into the plugin cache directory. Node.js ESM module resolution walks up the directory tree from `server.js` and finds `node_modules/` at `CLAUDE_PLUGIN_ROOT`. No symlinks needed.

**Why not CLAUDE_PLUGIN_DATA with NODE_PATH:**
The official Claude Code docs show `"NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"` in the MCP env config — but this pattern only works for CommonJS `require()`. The ligamen MCP server uses ESM `import` statements (`"type": "module"` in package.json). Node.js ESM explicitly does not support NODE_PATH — confirmed in Node.js v25 documentation: "No NODE_PATH: NODE_PATH is not part of resolving import specifiers."

**Why not CLAUDE_PLUGIN_DATA with symlink:**
Installing into `CLAUDE_PLUGIN_DATA/node_modules` and symlinking `CLAUDE_PLUGIN_ROOT/node_modules -> CLAUDE_PLUGIN_DATA/node_modules` would work for ESM (symlinks ARE followed by ESM resolution), but requires recreating the symlink on every session and on every plugin update. The plugin cache directory (`~/.claude/plugins/cache/`) is user-owned and writable, so installing directly into CLAUDE_PLUGIN_ROOT is simpler with identical outcome.

**Trigger: diff against sentinel copy of runtime-deps.json**

```bash
diff -q "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" "${CLAUDE_PLUGIN_DATA}/runtime-deps.json" >/dev/null 2>&1 \
  || (cp "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" "${CLAUDE_PLUGIN_DATA}/runtime-deps.json" \
      && npm install --prefix "${CLAUDE_PLUGIN_ROOT}" \
           --package "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" \
           --omit=dev --no-fund --no-audit --package-lock=false) \
  || rm -f "${CLAUDE_PLUGIN_DATA}/runtime-deps.json"
```

Pattern adapted from official Claude Code docs (which uses package.json as sentinel). The `diff` exits nonzero when the CLAUDE_PLUGIN_DATA copy is missing (first run) or differs (plugin update with dep changes). The trailing `rm -f` removes the sentinel if npm install fails, so the next session retries.

**Why runtime-deps.json as sentinel instead of package.json:**
- `package.json` includes dev dependencies (chromadb optional, future tooling) that don't need runtime install.
- `runtime-deps.json` already exists in the repo and scopes the install to exactly what `worker/mcp/server.js` needs.
- Using `runtime-deps.json` avoids spurious reinstalls when only dev deps change.

**npm flags:**
- `--omit=dev` — skip devDependencies (safety net; runtime-deps.json has none)
- `--no-fund --no-audit` — suppress network calls that add hook latency
- `--package-lock=false` — don't write a lockfile into the plugin cache root
- `--package <file>` — use runtime-deps.json as the manifest (not package.json)

**Hook placement:**
This install command is too long for inline hooks.json. Extract to `scripts/install-deps.sh` and invoke from session-start.sh (appended after the existing dedup guard). Do NOT put it in a separate hooks.json entry that runs in parallel with session-start.sh — ordering matters.

**Timeout:**
The existing SessionStart hook has `"timeout": 10`. npm install with native build (better-sqlite3 requires node-gyp) will exceed this on first run. The install should be backgrounded inside session-start.sh to avoid blocking Claude's session context injection. Pattern: fire-and-forget with output to a log file, then report status on next session.

**CLAUDE_PLUGIN_DATA role:**
Stores only the sentinel copy of `runtime-deps.json` that survives plugin updates (the actual `node_modules/` lives at CLAUDE_PLUGIN_ROOT). CLAUDE_PLUGIN_DATA resolves to `~/.claude/plugins/data/ligamen-ligamen/` — confirmed present and empty at current state.

### Feature 2: MCP Server .mcp.json — No Changes Required

The current file:

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

This is correct for post-install. When `node_modules/` exists at CLAUDE_PLUGIN_ROOT, Node.js ESM resolution finds it automatically when starting `server.js`. No env vars needed.

Do not add `NODE_PATH` — it has no effect for ESM and misleads future maintainers.

### Feature 3: Version Sync Across Manifests

Five files contain version strings that must stay in sync. Current state:

| File | Field | Current Value |
|------|-------|--------------|
| `plugins/ligamen/package.json` | `"version"` | 5.1.2 |
| `plugins/ligamen/.claude-plugin/plugin.json` | `"version"` | 5.1.2 |
| `plugins/ligamen/.claude-plugin/marketplace.json` | `.plugins[0].version` | 5.1.2 |
| `.claude-plugin/marketplace.json` (repo root) | `.plugins[0].version` | **5.1.1 (stale)** |
| `plugins/ligamen/runtime-deps.json` | `"version"` | 5.1.2 |

**Tool: `scripts/bump-version.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?Usage: bump-version.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Files with simple top-level "version" field
for f in \
  "$ROOT/plugins/ligamen/package.json" \
  "$ROOT/plugins/ligamen/.claude-plugin/plugin.json" \
  "$ROOT/plugins/ligamen/runtime-deps.json"
do
  jq --arg v "$VERSION" '.version = $v' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# Files with nested .plugins[0].version
for f in \
  "$ROOT/plugins/ligamen/.claude-plugin/marketplace.json" \
  "$ROOT/.claude-plugin/marketplace.json"
do
  jq --arg v "$VERSION" '.plugins[0].version = $v' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

echo "Bumped to $VERSION"
```

Add to Makefile:

```makefile
bump: ## Bump plugin version: make bump VERSION=5.2.0
	@[ -n "$(VERSION)" ] || (echo "Usage: make bump VERSION=x.y.z" && exit 1)
	./scripts/bump-version.sh "$(VERSION)"
```

Add a version-check to `make check`:

```makefile
check: ## Validate JSON and version consistency
	jq empty plugins/ligamen/.claude-plugin/plugin.json
	jq empty plugins/ligamen/hooks/hooks.json
	@V=$$(jq -r '.version' plugins/ligamen/package.json); \
	for f in plugins/ligamen/.claude-plugin/plugin.json plugins/ligamen/runtime-deps.json; do \
	  fv=$$(jq -r '.version' "$$f"); \
	  [ "$$fv" = "$$V" ] || (echo "Version mismatch: $$f has $$fv, package.json has $$V" && exit 1); \
	done; \
	for f in plugins/ligamen/.claude-plugin/marketplace.json .claude-plugin/marketplace.json; do \
	  fv=$$(jq -r '.plugins[0].version' "$$f"); \
	  [ "$$fv" = "$$V" ] || (echo "Version mismatch: $$f has $$fv, package.json has $$V" && exit 1); \
	done
	@echo "JSON valid, versions consistent"
```

**Why not `npm version`:** Only updates `package.json` and creates a git tag. Does not touch `plugin.json`, `marketplace.json`, or `runtime-deps.json`.

**Why not a pre-commit hook:** Single-dev plugin. One explicit command before releasing is the right tradeoff. The `make check` validation catches version drift in CI or manual review.

### Feature 4: Root .mcp.json Cleanup

`/Users/ravichillerega/sources/ligamen/.mcp.json` already contains `{"mcpServers": {}}` — empty and correct for the dev repo. No action needed.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `NODE_PATH` in MCP env config | Node.js ESM loader explicitly ignores NODE_PATH — import statements are unaffected. Official docs example applies to CJS only | npm install into CLAUDE_PLUGIN_ROOT; ESM walks up directory tree to find node_modules/ |
| `CLAUDE_PLUGIN_DATA/node_modules` + symlink | Works for ESM but requires symlink recreation on every session; CLAUDE_PLUGIN_ROOT is user-writable anyway | npm install --prefix CLAUDE_PLUGIN_ROOT directly |
| `package.json` as diff sentinel | Contains dev/optional deps — triggers reinstall on unrelated dep changes | `runtime-deps.json` which scopes to MCP server runtime deps only |
| `npm version` for release bumping | Only updates package.json; no support for plugin.json or marketplace.json | `scripts/bump-version.sh` with jq |
| Separate PostInstall lifecycle hook | Not yet implemented in Claude Code (open feature request #11240) | SessionStart with diff-based sentinel guard |
| `chromadb` as required runtime dep | Optional — MCP server has graceful 3-tier fallback when ChromaDB unavailable | Keep in optionalDependencies; use `--omit=optional` in npm install command if install time is too slow |
| Inline npm install command in hooks.json | Multi-step command is unmaintainable inline; cannot be tested with bats | Extract to `scripts/install-deps.sh` |
| Blocking npm install inside SessionStart timeout | better-sqlite3 requires node-gyp native build; first install can take 30-60s | Background the install with nohup, write to log file, report status on next session |

---

## Version Compatibility

| Package | Range | Resolved | Notes |
|---------|-------|----------|-------|
| `@modelcontextprotocol/sdk` | `^1.27.1` | 1.27.1 | ^1 is safe; no breaking changes in minor versions anticipated |
| `better-sqlite3` | `^12.8.0` | 12.8.0 | Native module — requires node-gyp build on first install. Node 20+ supported per their docs |
| `fastify` | `^5.8.2` | 5.8.2 | v5 API in use; ^5 is safe |
| `@fastify/cors` | `^10.0.0` | 10.1.0 | No breaking changes in minor |
| `@fastify/static` | `^8.0.0` | 8.3.0 | No breaking changes in minor |
| `zod` | `^3.25.0` | 3.25.76 | v3 API in use; ^3 is safe |
| `chromadb` | `^3.3.3` | 3.3.3 | Optional; omit with `--omit=optional` |
| Node.js | `>=20.0.0` | v25.8.1 (dev) | No compatibility issues; ESM support stable since Node 14 |

**better-sqlite3 native build note:** Requires Xcode CLT on macOS, build-essential on Linux. This is a pre-existing project requirement — no new concern. The SessionStart install must handle build failures gracefully (trailing `rm -f` sentinel pattern ensures retry on next session).

---

## Alternatives Considered

| Feature | Recommended | Alternative | Why Not |
|---------|-------------|-------------|---------|
| Dep install target | CLAUDE_PLUGIN_ROOT | CLAUDE_PLUGIN_DATA + symlink | PLUGIN_ROOT is user-writable; symlink recreation adds complexity for no benefit |
| ESM module resolution | Directory walk (automatic) | NODE_PATH env var | NODE_PATH not supported in Node.js ESM — documented explicitly |
| Sentinel file | runtime-deps.json copy in CLAUDE_PLUGIN_DATA | package.json copy | package.json includes dev/optional deps; runtime-deps.json scopes to runtime-only |
| Version sync | bash + jq script | npm version + lifecycle hooks | npm version only updates package.json; plugin.json and marketplace.json are not npm artifacts |
| Hook placement for install | Inside session-start.sh | Separate hooks.json entry | Separate entry runs in undefined order relative to session-start.sh; shared dedup flag in session-start.sh controls both |

---

## Sources

- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — CLAUDE_PLUGIN_DATA path resolution (`~/.claude/plugins/data/{id}/`), CLAUDE_PLUGIN_ROOT definition, SessionStart npm install diff pattern, NODE_PATH in MCP env example (HIGH confidence — official Anthropic docs, fetched 2026-03-21)
- [Node.js ESM Documentation v25.8.1](https://nodejs.org/api/esm.html) — "No NODE_PATH: NODE_PATH is not part of resolving import specifiers. Please use symlinks if this behavior is desired." (HIGH confidence — official Node.js docs)
- [Claude Code issue #11240](https://github.com/anthropics/claude-code/issues/11240) — PostInstall/PreInstall lifecycle hooks not yet implemented; confirmed SessionStart is the only available hook for setup work (MEDIUM confidence — GitHub issue, open as of 2026-03-21)
- Local filesystem verification: `~/.claude/plugins/cache/ligamen/ligamen/5.1.2/` confirmed user-owned (`drwxr-xr-x ravichillerega`); `~/.claude/plugins/data/ligamen-ligamen/` confirmed present and empty (HIGH confidence — direct inspection)
- `plugins/ligamen/package.json` — `"type": "module"` confirmed, deps and versions verified (HIGH confidence — direct read)
- `plugins/ligamen/package-lock.json` — resolved versions confirmed (HIGH confidence — direct read)
- `plugins/ligamen/runtime-deps.json` — file exists untracked with correct deps subset (HIGH confidence — direct read)

---

*Stack research for: Claude Code plugin runtime dependency distribution (v5.2.0)*
*Researched: 2026-03-21*
