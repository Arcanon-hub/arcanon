# Project Research Summary

**Project:** Ligamen v5.2.0 — Plugin Distribution Fix
**Domain:** Claude Code plugin runtime dependency distribution via SessionStart hook + MCP server configuration
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

Ligamen is an existing Claude Code plugin (v5.1.2) with a fully functional MCP server exposing 8 impact/drift analysis tools backed by SQLite, Fastify, and the MCP SDK. The v5.2.0 milestone addresses a critical distribution bug: when a user installs the plugin from the marketplace, the MCP server subprocess starts without `node_modules` present, causing every ESM import to throw `ERR_MODULE_NOT_FOUND` at startup. All 8 tools silently vanish. The fix requires two coordinated changes — a SessionStart hook that installs runtime deps into a findable location, and correct module resolution so the running MCP server can find those deps.

The recommended approach is to install npm deps directly into `${CLAUDE_PLUGIN_ROOT}` using `npm install --prefix ${CLAUDE_PLUGIN_ROOT}`, with a diff-based sentinel check against a copy of `runtime-deps.json` stored in `${CLAUDE_PLUGIN_DATA}`. This placement allows Node.js ESM to find the modules via its natural directory-walk resolution without any `NODE_PATH` tricks. The critical technical constraint cutting across all research files is that `worker/mcp/server.js` uses ESM (`"type": "module"` in package.json), and `NODE_PATH` has zero effect on ESM import resolution — a fact the official Claude Code docs example does not account for when recommending the `NODE_PATH` pattern (which applies to CJS only). This must be resolved in Phase 1 before any other work proceeds.

The top risks are: (1) the NODE_PATH/ESM incompatibility invalidating the assumed architecture, (2) `better-sqlite3`'s native binary compiling for the wrong Node.js version, (3) a first-session race condition where the MCP server starts before the SessionStart hook finishes installing deps, and (4) the 10-second hook timeout aborting native compilation mid-way. All are solvable. Version sync across five manifest files is an independent, lower-risk concern that should be automated with a single bump script. The overall scope is small: three file modifications, five version bumps, one new script.

## Key Findings

### Recommended Stack

No new technologies are required for v5.2.0. The existing stack (Node.js 25, ESM, better-sqlite3, fastify, @modelcontextprotocol/sdk, bats, jq) is sufficient. The additions are: `npm install --prefix` to install deps at runtime into `${CLAUDE_PLUGIN_ROOT}`, `diff -q` as the idempotency guard (from official Claude Code docs), and a `scripts/bump-version.sh` bash script using `jq` to atomically sync versions across all five manifest files.

See `.planning/research/STACK.md` for full detail including code-level patterns and alternatives considered.

**Core technologies:**
- `npm install --prefix ${CLAUDE_PLUGIN_ROOT}` — runtime dep install; ESM resolution walks up from `server.js` and finds `node_modules/` at CLAUDE_PLUGIN_ROOT automatically; no env vars needed
- `diff -q` (coreutils) — sentinel check against `${CLAUDE_PLUGIN_DATA}/runtime-deps.json` copy to detect when deps need reinstall; exits nonzero on first run (no copy) or after plugin update (file differs)
- `runtime-deps.json` as install manifest — scopes install to exactly the 7 MCP server runtime deps; avoids triggering reinstall on dev dep changes; version field bumps with plugin version to trigger reinstall after updates
- `jq` (already required) — reads dep manifest dynamically; rewrites version fields in all manifest files atomically
- `scripts/bump-version.sh` (new) — single command syncing version across all 5 files; added as `make bump VERSION=x.y.z`

**Critical non-use:** Do NOT add `NODE_PATH` to `.mcp.json` env for ESM resolution. Node.js ESM ignores `NODE_PATH` by design — documented explicitly in Node.js v25 ESM docs: "NODE_PATH is not part of resolving import specifiers." The official Claude Code plugin docs example that uses `NODE_PATH` applies to CJS `require()` only.

### Expected Features

All features are P1 (required for v5.2.0 to work) or P2 (should-have for release quality). Full feature analysis in `.planning/research/FEATURES.md`.

**Must have (table stakes for v5.2.0):**
- SessionStart install hook — installs deps into `${CLAUDE_PLUGIN_ROOT}` on first run and after version bumps; MCP server fails silently on marketplace install without this
- Idempotent install guard — diff-based sentinel using `runtime-deps.json` copy in `${CLAUDE_PLUGIN_DATA}`; install runs only when sentinel differs from bundled copy (first run or plugin update)
- Separate hook entry with high timeout — current 10-second timeout must increase to 120-300 seconds for the install hook; keep existing session-start.sh entry at 10 seconds as a separate hooks.json entry
- Root `.claude-plugin/marketplace.json` version fix — currently at 5.1.1 while all other manifests are at 5.1.2; causes users to receive wrong version via `claude plugin marketplace add`
- All manifests bumped to 5.2.0 — five files: `package.json`, `plugin.json`, both `marketplace.json` files, `runtime-deps.json`

**Should have (P2, include in same PR):**
- `scripts/bump-version.sh` Makefile target — prevents future version drift with `make bump VERSION=x.y.z`
- `make check` version consistency validation — CI-level guard asserting all manifests carry the same version
- Bats tests for install script — covers first-run, idempotency, npm-missing fallback, partial-install recovery

**Defer (v6+):**
- Declarative plugin dependency manifest — depends on Anthropic shipping issue #27113; `runtime-deps.json` already serves as the data source and will be a clean migration path

**Anti-features explicitly avoided:**
- Bundling `node_modules` in the plugin — platform-specific native binaries (better-sqlite3, chromadb) fail cross-platform; inflates plugin by ~40MB
- `NODE_PATH` in `.mcp.json` — silently ignored by ESM; causes misleading debugging experience
- Global `npm install -g` — requires elevated permissions; pollutes user's global namespace with Ligamen's deps
- Inline npm install in hooks.json — untestable, unmaintainable; extract to `scripts/install-deps.sh`
- Blocking SessionStart on npm install failure — non-zero exit from hook may break session; use `|| true` or `trap 'exit 0' ERR`

### Architecture Approach

The fix is surgical: three files modified (session-start.sh, runtime-deps.json version, hooks.json), five manifest files version-bumped, one new script added. No new files or directories. No changes to the MCP server tools, SQLite schema, HTTP worker, or graph UI. The dep install runs as Step 0 in session-start.sh — critically BEFORE the SESSION_ID dedup check — so it fires on every session and detects plugin updates. The MCP server launch config needs no changes when deps are installed into `${CLAUDE_PLUGIN_ROOT}`.

See `.planning/research/ARCHITECTURE.md` for full diagrams, data flow, integration boundary analysis, and build order rationale.

**Major components and their v5.2.0 changes:**
1. `plugins/ligamen/scripts/session-start.sh` — MODIFIED: add Step 0 dep install block before SESSION_ID dedup; runs `diff -q` against sentinel, runs `npm install --prefix ${CLAUDE_PLUGIN_ROOT}` only when sentinel differs, updates sentinel on success, cleans sentinel on failure
2. `plugins/ligamen/hooks/hooks.json` — MODIFIED: add separate SessionStart entry for install script with `"timeout": 300`; existing session-start.sh entry unchanged at `"timeout": 10`
3. `plugins/ligamen/.mcp.json` — UNCHANGED: current config (`node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js`) is correct once node_modules exists at CLAUDE_PLUGIN_ROOT; no env block needed
4. `plugins/ligamen/runtime-deps.json` — MODIFIED: version bumped to 5.2.0; remains authoritative install manifest
5. `scripts/bump-version.sh` — NEW: jq-based version sync script for all 5 manifest files

**Build order (dependency-driven):**
1. Version sync first — no logic deps; fixes stale root marketplace.json; `runtime-deps.json` version must be correct before install step reads it
2. hooks.json install entry + session-start.sh Step 0 — core fix; reads runtime-deps.json version
3. `.mcp.json` verification — confirm no changes needed (should be automatic with deps in CLAUDE_PLUGIN_ROOT)
4. `bump-version.sh` script — independent; prevents future drift

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for full coverage including recovery strategies, UX pitfalls, security notes, and a "looks done but isn't" verification checklist.

1. **NODE_PATH is silently ignored by ESM** — The official Claude Code docs recommend `NODE_PATH` in `.mcp.json` env, but this only works for CommonJS. `worker/mcp/server.js` is ESM (`"type": "module"`). ESM uses URL-based resolution; `NODE_PATH` is explicitly excluded. Solution: install deps into `${CLAUDE_PLUGIN_ROOT}` via `npm install --prefix`; ESM finds `node_modules/` via directory walk automatically. Do not add `NODE_PATH` to `.mcp.json`.

2. **better-sqlite3 binary compiled for wrong Node.js version** — Claude Code may use a different Node runtime than the system `node`/`npm` on PATH. The installed native binary may be ABI-incompatible with the runtime that launches the MCP server. Prevention: add a smoke-test after install (`node -e "require('better-sqlite3')"` using Claude Code's node if determinable); handle gracefully with retry on next session via sentinel cleanup.

3. **First-session race: MCP server starts before hook installs deps** — Claude Code starts the MCP server in parallel with SessionStart hooks. On first install, `npm install` (30-120 seconds with native compilation) may still be running when the MCP server starts. GitHub issue #10997 also indicates hooks may not fire at all on first marketplace install. Prevention: make the MCP wrapper self-healing — wrapper script checks for deps before exec'ing server.js; SessionStart is a fast-path optimization for subsequent sessions, not the sole install path.

4. **SessionStart 10-second timeout aborts native compilation** — `better-sqlite3` requires `node-gyp` which takes 30-120 seconds on macOS/Linux. The current hook timeout of 10 seconds kills the install mid-way, leaving partial `node_modules`. Prevention: separate hooks.json entry for the install with `"timeout": 300`; keep existing session-start.sh at 10 seconds.

5. **Version sync drift breaks the update mechanism** — Five manifest files carry version numbers. If any one is not bumped, Claude Code's caching/update mechanism delivers the stale plugin or wrong dep list. Root `.claude-plugin/marketplace.json` is already stale at 5.1.1 vs the rest at 5.1.2. Prevention: `scripts/bump-version.sh` atomically updates all five; `make check` enforces consistency.

## Implications for Roadmap

Based on combined research, the milestone work splits into three phases ordered by technical dependency. All three are small in scope. The only genuine architectural decision is the ESM/NODE_PATH resolution in Phase 1 — everything else is implementation of well-understood patterns.

### Phase 1: Runtime Dependency Installation

**Rationale:** This is the core bug fix. The ESM/NODE_PATH incompatibility (Pitfall 1) must be resolved here first — it invalidates the assumed architecture from the official docs and requires a deliberate decision on install target location before any install script is written. All other work is unblocked once deps are reliably installable and findable by the ESM loader.

**Delivers:** MCP server starts after marketplace install; all 8 MCP tools visible to Claude on second session (first-session race is acceptable on v5.2.0; self-healing wrapper eliminates it permanently)

**Addresses:**
- Separate hooks.json install entry with `"timeout": 300`
- `scripts/install-deps.sh` implementing the `diff -q ... || (cp ... && npm install --prefix ${CLAUDE_PLUGIN_ROOT}) || rm -f ...` pattern
- Step 0 in session-start.sh: check sentinel, invoke install script, handle failure non-blocking
- better-sqlite3 smoke-test after install
- ChromaDB optional dep isolation verification (3-tier fallback must activate at module load)
- Partial install recovery: `rm -f` sentinel on npm failure ensures next session retries

**Avoids:**
- Pitfall 1: Install into `${CLAUDE_PLUGIN_ROOT}` (not CLAUDE_PLUGIN_DATA + NODE_PATH)
- Pitfall 2: Smoke-test native binary after install
- Pitfall 3: Self-healing MCP wrapper as belt-and-suspenders for first-session race
- Pitfall 4: Separate high-timeout hook entry, existing session-start.sh unchanged
- Pitfall 7: Sentinel is only written after successful install; partial installs cause sentinel cleanup, not persistence

**Research flag: VALIDATE ONE ASSUMPTION** — Confirm whether `${CLAUDE_PLUGIN_ROOT}` in the plugin cache is truly user-writable at SessionStart hook time. STACK.md confirms `~/.claude/plugins/cache/ligamen/ligamen/5.1.2/` is `drwxr-xr-x ravichillerega` (user-owned). However, verify empirically that npm can write `node_modules/` there at hook runtime before committing to this approach.

### Phase 2: MCP Server Launch Verification

**Rationale:** Independent of install logic — verifies that once deps exist at `${CLAUDE_PLUGIN_ROOT}/node_modules`, the Node.js ESM loader resolves them correctly when the MCP server is launched from `.mcp.json`. This is primarily a verification and hardening phase.

**Delivers:** Confirmed end-to-end MCP server startup from a marketplace-simulated install; all 8 tools visible; `.mcp.json` confirmed to need no env changes; root dev repo `.mcp.json` confirmed as `{"mcpServers": {}}` (correct)

**Addresses:**
- Run `node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js` with deps in place; confirm no `ERR_MODULE_NOT_FOUND`
- Verify `better-sqlite3` loads correctly in ESM context (bare `import` should work in v12.x; fall back to `module.createRequire` if not)
- Confirm `${CLAUDE_PLUGIN_DATA}` expansion behavior in `.mcp.json` `env` block (needed only if hooks.json expansion of CLAUDE_PLUGIN_DATA is used; not needed for CLAUDE_PLUGIN_ROOT install path)
- Confirm ChromaDB graceful degradation: delete `@chroma-core/default-embed`, verify MCP server still starts

**Avoids:**
- Pitfall 1: Verify ESM directory-walk resolution works; no NODE_PATH needed
- Pitfall 2: Smoke-test using same Node binary Claude Code uses for MCP servers

**Research flag: STANDARD PATTERNS** — If Phase 1 installs into `${CLAUDE_PLUGIN_ROOT}`, ESM resolution is automatic and well-documented. No new research needed; this is an integration test phase.

### Phase 3: Version Sync and Release Tooling

**Rationale:** Independent of install work. Fixes the current 5.1.1 drift in root marketplace.json, bumps all files to 5.2.0, and adds automation to prevent future drift. Must be complete before the v5.2.0 release tag.

**Delivers:** All five manifest files at 5.2.0; `scripts/bump-version.sh` + `make bump` + `make check`; confirmed `claude plugin marketplace add` offers 5.2.0; bats tests for install script (P2)

**Addresses:**
- Root `.claude-plugin/marketplace.json` fix (5.1.1 → 5.2.0)
- `scripts/bump-version.sh` with jq — updates all five files atomically per STACK.md template
- `make bump VERSION=5.2.0` target
- `make check` version consistency validation (checks all five files match)
- Bats tests for install script: first-run, idempotency, npm-absent fallback, partial-install recovery

**Avoids:**
- Pitfall 5: Automated sync prevents manual version drift across five files
- Pitfall 6: Version bump in all files ensures Claude Code cache refresh triggers correctly on plugin update

**Research flag: STANDARD PATTERNS** — Pure jq/bash scripting with well-understood patterns. STACK.md provides the exact script template. No research needed.

### Phase Ordering Rationale

- Phase 1 before Phase 2: Cannot verify MCP server launch until deps are installable and in place
- Phase 2 before Phase 3: Release-quality version bump should happen after the fix is confirmed working end-to-end; avoids shipping a 5.2.0 tag against unverified install behavior
- Phase 3 is the release gate: version consistency is required before `claude plugin publish`; the stale 5.1.1 in root marketplace.json is already a live bug affecting users on v5.1.x
- The ESM/NODE_PATH decision in Phase 1 is the only genuine architectural decision; all other work follows from it

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** One empirical validation needed — confirm `${CLAUDE_PLUGIN_ROOT}` is writable at SessionStart hook runtime (not just at dev time). Also confirm which `node` binary Claude Code uses to launch MCP servers (system PATH vs. bundled) to assess better-sqlite3 ABI risk. Both can be tested directly on the developer's machine in the first Phase 1 task.

Phases with standard patterns (skip research-phase):
- **Phase 2:** ESM directory-walk module resolution is thoroughly documented; no unknowns once Phase 1 install target is confirmed
- **Phase 3:** jq-based version sync is straightforward; `make` targets are standard; STACK.md provides exact script implementation

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Node.js ESM docs + Claude Code plugin docs + direct package.json inspection; all sources agree; NODE_PATH/ESM incompatibility confirmed from primary source |
| Features | HIGH | Derived entirely from direct code inspection of current plugin state + official docs; current broken state is directly observable and reproducible |
| Architecture | HIGH | Direct source inspection of all affected files; build order is dependency-driven with no ambiguity; one MEDIUM item noted below |
| Pitfalls | HIGH | ESM/NODE_PATH documented in official Node.js v25 docs; better-sqlite3 ABI issue from issue tracker; race condition from Claude Code issue #10997; hook timeout from direct hooks.json inspection |

**Overall confidence:** HIGH

### Gaps to Address

- **`${CLAUDE_PLUGIN_ROOT}` write permissions at runtime** (MEDIUM, Phase 1): STACK.md confirms the cache directory is user-owned and writable at dev time. Needs empirical confirmation that npm can write `node_modules/` there during a live SessionStart hook. If it is read-only in some environments, the fallback is to install into `${CLAUDE_PLUGIN_DATA}` and create a runtime symlink at `${CLAUDE_PLUGIN_ROOT}/node_modules -> ${CLAUDE_PLUGIN_DATA}/node_modules` (symlinks ARE followed by ESM). Test this in the first Phase 1 task.

- **Which Node binary does Claude Code use for MCP servers?** (MEDIUM, Phase 1): If Claude Code's bundled Node differs from system `node`, the better-sqlite3 binary compiled during the hook may be ABI-incompatible with the MCP server runtime. Resolution: add a smoke-test in the install script using the correct node; document build tool requirements for source compilation fallback.

- **GitHub issue #10997 (hooks may not fire on first marketplace install)** (MEDIUM, Phase 1): If confirmed reproducible, the self-healing MCP wrapper is mandatory (not optional) for the first-session experience. Test empirically: uninstall and reinstall the plugin, confirm whether SessionStart fires on first session. If it does not, implement MCP wrapper script as `command` in `.mcp.json`.

- **`better-sqlite3` ESM bare import in Node v25** (LOW, Phase 2): v12.x ships ESM-compatible exports but the native addon loads via CJS internally. Verify `import Database from 'better-sqlite3'` works in Node 25 ESM context without `module.createRequire`. If it fails, use `module.createRequire(import.meta.url)` as the fix — server.js already uses ESM so this is a one-line change.

## Sources

### Primary (HIGH confidence)
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — CLAUDE_PLUGIN_DATA path resolution (`~/.claude/plugins/data/{id}/`), CLAUDE_PLUGIN_ROOT definition, SessionStart npm install diff pattern, NODE_PATH in MCP env example (CJS context), version management warnings, caching behavior
- [Node.js ESM Documentation v25.8.1](https://nodejs.org/api/esm.html) — NODE_PATH not supported in ESM import resolution; native addon loading via `module.createRequire`
- Direct codebase inspection: `plugins/ligamen/worker/mcp/server.js` (ESM imports), `.mcp.json` (current spawn config), `runtime-deps.json` (dep manifest), `hooks/hooks.json` (timeout: 10), `scripts/session-start.sh` (dedup logic), `package.json` ("type": "module"), `plugin.json`, both `marketplace.json` files, `package-lock.json` (resolved versions)
- Local filesystem: `~/.claude/plugins/cache/ligamen/ligamen/5.1.2/` confirmed user-owned (`drwxr-xr-x ravichillerega`); `~/.claude/plugins/data/ligamen-ligamen/` confirmed present and empty

### Secondary (MEDIUM confidence)
- [Claude Code issue #11240](https://github.com/anthropics/claude-code/issues/11240) — PostInstall/PreInstall lifecycle hooks not yet implemented; SessionStart is the only available hook for setup work
- [Claude Code issue #10997](https://github.com/anthropics/claude-code/issues/10997) — SessionStart hooks may not fire on first marketplace plugin run
- [Claude Code issue #19491](https://github.com/anthropics/claude-code/issues/19491) — SessionStart hooks may run before plugins are fully loaded
- [Claude Code issue #27113](https://github.com/anthropics/claude-code/issues/27113) — Declarative plugin dependency manifest (feature request, not shipped; runtime-deps.json is the migration path)

### Tertiary (MEDIUM confidence, issue trackers)
- [better-sqlite3 issue #1384](https://github.com/WiseLibs/better-sqlite3/issues/1384) — Node.js v24 prebuilt binary availability delay; pattern applies to any non-LTS Node version
- [better-sqlite3 issue #549](https://github.com/WiseLibs/better-sqlite3/issues/549) — NODE_MODULE_VERSION mismatch pattern and recovery steps

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
