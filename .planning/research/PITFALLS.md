# Pitfalls Research

**Domain:** Claude Code plugin runtime dependency installation, MCP server distribution, native addon compilation, ESM module resolution, and version sync
**Researched:** 2026-03-21
**Confidence:** HIGH — based on official Claude Code plugin docs (code.claude.com/docs/en/plugins-reference), Node.js ESM docs (nodejs.org), better-sqlite3 issue tracker, and direct codebase inspection of the existing plugin structure

---

## Critical Pitfalls

### Pitfall 1: NODE_PATH Is Silently Ignored by ESM — Native Addons Never Resolve

**What goes wrong:**
The `runtime-deps.json`-based installation puts `node_modules` into `${CLAUDE_PLUGIN_DATA}/node_modules`. The `.mcp.json` passes `NODE_PATH: "${CLAUDE_PLUGIN_DATA}/node_modules"` as an environment variable to the MCP server process. This works for CommonJS. It does **not** work for ESM.

The `package.json` has `"type": "module"`, making `worker/mcp/server.js` an ESM file. ESM module resolution ignores `NODE_PATH` entirely — it is documented as unsupported in ESM (Node.js docs: "NODE_PATH is not part of resolving import specifiers"). When `server.js` executes `import Database from "better-sqlite3"`, Node resolves relative to `node_modules/` directories in the filesystem hierarchy above the file, not via `NODE_PATH`. Since `better-sqlite3` is not in `${CLAUDE_PLUGIN_ROOT}/node_modules/` (it was installed into `CLAUDE_PLUGIN_DATA`), the import fails with `ERR_MODULE_NOT_FOUND`.

The error is silent at session start — the MCP server dies on startup with a stack trace written to stderr, but Claude Code reports it as a generic "MCP server failed to start" without surfacing the resolution error.

**Why it happens:**
Developers assume `NODE_PATH` works for all module resolution modes. It works for CJS (`require()`). ESM uses a URL-based resolution algorithm that explicitly does not consult `NODE_PATH`. This is a Node.js design decision that has not changed.

**How to avoid:**
Do not rely on `NODE_PATH` for ESM resolution. Instead, choose one of:

1. **`--require` via `createRequire` shim for native addons only** — For `better-sqlite3` specifically (a native addon loaded via `require()`), use `module.createRequire(import.meta.url)` inside the ESM module to load it. The path passed must be absolute: `createRequire(import.meta.url)("${CLAUDE_PLUGIN_DATA}/node_modules/better-sqlite3")`. This must be baked in at install time or resolved at runtime from an env var.

2. **Symlink into plugin root** — In the SessionStart install script, after `npm install` completes, create a `node_modules` symlink inside `${CLAUDE_PLUGIN_ROOT}` pointing at `${CLAUDE_PLUGIN_DATA}/node_modules`. ESM traverses filesystem ancestors looking for `node_modules/`. NOTE: The plugin cache copies symlink targets at install time — this approach only works if the symlink is created dynamically by the hook script at runtime, not shipped as part of the plugin. This makes `${CLAUDE_PLUGIN_ROOT}` writable at runtime (the cache copy is writable).

3. **Install deps into a subdirectory of `${CLAUDE_PLUGIN_ROOT}`** — Skip `CLAUDE_PLUGIN_DATA` and install directly to `${CLAUDE_PLUGIN_ROOT}/node_modules` at first run. ESM resolves from this location. The tradeoff: `CLAUDE_PLUGIN_ROOT` content is in the plugin cache and may be overwritten on plugin update, requiring re-installation after every update — but the SessionStart diff-check (compare `runtime-deps.json` hash before/after update) handles this correctly.

Option 3 is the simplest path with the current architecture. Option 2 is cleanest long-term.

**Warning signs:**
- MCP server listed in Claude's tool menu but zero tools appear
- `claude --debug` shows "MCP server failed to start" for `ligamen-impact`
- Manual `node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js` fails with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3'`
- `NODE_PATH` set in environment but modules still not found

**Phase to address:**
Phase 1: Runtime dep installation. The `NODE_PATH` approach must be validated or replaced before any other work.

---

### Pitfall 2: better-sqlite3 Binary Is Compiled for the Wrong Node.js Version

**What goes wrong:**
`better-sqlite3` is a native addon — it compiles a `.node` binary tied to a specific `NODE_MODULE_VERSION`. When the plugin's SessionStart hook runs `npm install` inside `${CLAUDE_PLUGIN_DATA}`, npm downloads prebuilt binaries for the Node version running at install time. If Claude Code's internal Node version differs from the user's system `node`, the installed binary crashes at load time with:

```
Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION X. This version of Node.js requires NODE_MODULE_VERSION Y.
```

This is especially likely because Claude Code ships its own Node runtime (used for MCP servers) which may differ from whatever `node` is on the user's PATH. The install hook uses the system `node`/`npm` to install deps, but the MCP server is launched by Claude Code using its own Node. The binary is compiled for one, used by the other.

**Why it happens:**
Native addons are ABI-sensitive. `better-sqlite3` provides prebuilt binaries via `prebuild-install` for popular Node versions. If Claude Code's bundled Node version is not an LTS with a prebuilt binary (e.g., an odd release like Node 21, or Node 24 where prebuild-install binaries were slow to arrive), the install falls back to building from source — which requires `python3`, `make`, and a C++ compiler. Most users don't have build tools installed.

**How to avoid:**
- In the install hook, use `node --version` from whatever `node` runs the MCP server, not the system PATH `node`. If `CLAUDE_PLUGIN_ROOT` has a `node` shim that resolves the runtime node, use it.
- Pass `--build-from-source` only as a fallback, never as default. Check for prebuilt binary availability with `npm install --dry-run` first if possible.
- After install, immediately run a smoke-test: `node -e "require('better-sqlite3')"` using the SAME node that will run the MCP server. If it fails, delete the installed `better-sqlite3` and report an actionable error message rather than silently leaving a broken installation.
- Consider adding a `--ignore-scripts` flag during install and then `npm rebuild` as a separate step to isolate compilation failures.
- Document in plugin README that build tools (`xcode-select --install` on macOS, `build-essential` on Linux) are required if prebuilt binaries are not available for the running Node version.

**Warning signs:**
- MCP server starts then immediately exits with `NODE_MODULE_VERSION` mismatch error in stderr
- SessionStart hook completes without error (npm succeeded) but tools never appear
- `ls ${CLAUDE_PLUGIN_DATA}/node_modules/better-sqlite3/build/Release/` shows a `.node` file but the MCP server crashes on load
- Plugin works for one user on the team but not another (they have different system Node versions)

**Phase to address:**
Phase 1: Runtime dep installation. Add Node version validation and smoke-test to install script.

---

### Pitfall 3: SessionStart Hook Runs Before MCP Server Is Available — Chicken-and-Egg at First Run

**What goes wrong:**
The SessionStart hook installs runtime deps into `${CLAUDE_PLUGIN_DATA}`. The MCP server in `.mcp.json` starts after hooks have run. On the very first session after plugin installation, both happen for the first time:

1. SessionStart hook fires, runs `npm install` (takes 10–90 seconds for native deps)
2. `.mcp.json` MCP server starts — but it may start in parallel with step 1, finding an empty or incomplete `node_modules`
3. MCP server crashes because `better-sqlite3` is not yet installed
4. Claude Code marks the MCP server as failed for this session
5. On the next session start, deps are already installed, MCP server starts fine

The user sees no MCP tools on their first session and has to restart Claude Code. There is also a known issue (GitHub Issue #10997) where SessionStart hooks on marketplace plugins don't fire on the very first run at all — meaning deps might not be installed until the second session even if ordering were correct.

**Why it happens:**
Claude Code loads MCP servers from `.mcp.json` in parallel with hook execution. There is no documented mechanism to make MCP server startup wait for a hook to complete. Hooks and MCP server startup are independent initialization paths.

**How to avoid:**
- Make the MCP server startup script (`mcp-wrapper.sh` or the `command` in `.mcp.json`) check for deps itself before launching the server. A wrapper script that runs install if needed, then execs the server, eliminates the race condition:
  ```bash
  #!/usr/bin/env bash
  DEPS_DIR="${CLAUDE_PLUGIN_DATA}/node_modules"
  MANIFEST="${CLAUDE_PLUGIN_DATA}/runtime-deps.json"
  BUNDLED="${CLAUDE_PLUGIN_ROOT}/runtime-deps.json"
  if ! diff -q "$BUNDLED" "$MANIFEST" >/dev/null 2>&1; then
    cd "${CLAUDE_PLUGIN_DATA}" && cp "$BUNDLED" . && npm install --prefix . >/dev/null 2>&1
  fi
  exec node "${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js"
  ```
- Keep the SessionStart hook for user-visible feedback and faster subsequent sessions, but do not make it the sole installation path. The MCP wrapper must be self-healing.
- Set a generous MCP server startup timeout in `.mcp.json` if the SDK supports it — first-run install can take 60+ seconds with native compilation.

**Warning signs:**
- First session after fresh plugin install has zero MCP tools; second session has full tools
- `claude --debug` shows MCP server exits with code 1 during the same session that SessionStart hook reported success
- Users report "tools disappeared" after plugin update (update resets deps, MCP starts before hook re-installs)

**Phase to address:**
Phase 1: Runtime dep installation. The MCP wrapper script must be self-healing, not dependent on hook ordering.

---

### Pitfall 4: SessionStart Hook 10-Second Timeout Aborts npm Install for Native Deps

**What goes wrong:**
The current `hooks.json` configures SessionStart with `"timeout": 10` (10 seconds). Installing `better-sqlite3` from source takes 30–120 seconds on macOS (Xcode CLT build) and 20–60 seconds on Linux. Even downloading prebuilt binaries can take 15–30 seconds on slow connections. The hook process is killed when the timeout expires, leaving a partial `node_modules` in `${CLAUDE_PLUGIN_DATA}` — specifically, `better-sqlite3/build/Release/` may not exist yet, causing the MCP server to crash even though npm "succeeded" (from the partial install's perspective).

**Why it happens:**
A 10-second timeout is appropriate for lightweight hooks (format/lint/file-guard). It was not revisited when a potentially slow `npm install` was added to the same SessionStart hook.

**How to avoid:**
- Increase SessionStart timeout significantly for the install hook. The official docs example uses no timeout restriction for the install hook. A 300-second timeout is reasonable for native dep compilation.
- Alternatively, spawn the install as a background process (`npm install ... &`) and exit the hook immediately. This means the hook does not block session start, but the MCP server may still race. Pair with the self-healing MCP wrapper (Pitfall 3) which will retry on next startup.
- Use a separate hooks entry specifically for the install with a high timeout, separate from the context-injection entry which stays at 10 seconds.
- After install completes (whether in hook or wrapper), write a sentinel file to `${CLAUDE_PLUGIN_DATA}/.deps-ready` to allow fast-path skipping on subsequent sessions.

**Warning signs:**
- SessionStart hook exits with non-zero code on first run
- `${CLAUDE_PLUGIN_DATA}/node_modules` exists but is incomplete (missing `.node` binaries)
- Hook debug output shows "timeout exceeded" or "killed"
- Install works fine when run manually (`cd ${CLAUDE_PLUGIN_DATA} && npm install`) but not via hook

**Phase to address:**
Phase 1: Runtime dep installation. Adjust timeout value in hooks.json before testing.

---

### Pitfall 5: Version Sync Drift Between marketplace.json, plugin.json, package.json, and runtime-deps.json

**What goes wrong:**
There are currently four files that each carry a version number:
- `marketplace.json` (at repo root): `"version": "5.1.2"`
- `.claude-plugin/plugin.json`: `"version": "5.1.2"`
- `package.json`: `"version": "5.1.2"`
- `runtime-deps.json`: `"version": "5.1.2"` (under `"name": "@ligamen/runtime-deps"`)

Claude Code uses the version in `plugin.json` (or `marketplace.json`) to decide whether to prompt users to update. If `plugin.json` version is bumped but `marketplace.json` is not, marketplace users do not see an update. If `runtime-deps.json` version is bumped (to trigger dep re-installation via the diff check) but `plugin.json` is not bumped, existing users never get the updated deps — their SessionStart hook sees no diff because Claude Code cached the old plugin and never fetched the new `runtime-deps.json`.

**Why it happens:**
Four files in different directories, manually maintained, with no enforced sync. The official docs warn explicitly: "If you change your plugin's code but don't bump the version in `plugin.json`, your plugin's existing users won't see your changes due to caching."

**How to avoid:**
- Add a `Makefile` or `scripts/bump-version.sh` that updates all four files atomically. Never bump any one file manually.
- Add a CI check or pre-commit hook that asserts all four version strings are identical. A one-liner: `node -e "const a=require('./marketplace.json').plugins[0].version, b=require('./plugins/ligamen/.claude-plugin/plugin.json').version, c=require('./plugins/ligamen/package.json').version, d=require('./plugins/ligamen/runtime-deps.json').version; if(a!==b||b!==c||c!==d) process.exit(1)"`
- The `runtime-deps.json` version should track the parent plugin version, not be independently versioned. Tie it to the plugin version so bumping the plugin automatically means deps are re-checked.
- Document the release checklist explicitly: bump all four files, tag, push.

**Warning signs:**
- Users on marketplace install report missing MCP tools after a plugin update that added deps
- `claude plugin update` reports "already up to date" even after code changes shipped
- `diff` between bundled and installed `runtime-deps.json` always exits 0 (no diff) even after dep changes — meaning deps are never re-installed after an update

**Phase to address:**
Phase 3: Version sync. Create the sync script before attempting any release or update testing.

---

### Pitfall 6: Plugin Cache Copies the Plugin at Install Time — runtime-deps.json Changes Don't Propagate Without Version Bump

**What goes wrong:**
Claude Code copies marketplace plugins to `~/.claude/plugins/cache/` at install time. If the developer pushes a new `runtime-deps.json` to the marketplace repo without bumping `plugin.json` version, the cached copy in `~/.claude/plugins/cache/` is never refreshed. The SessionStart hook's diff check compares `${CLAUDE_PLUGIN_ROOT}/runtime-deps.json` (the cached copy, which is old) against `${CLAUDE_PLUGIN_DATA}/runtime-deps.json` (the installed copy, which may also be old). Both are old → diff passes → no re-installation → outdated deps forever.

**Why it happens:**
The caching mechanism is version-gated. This is intentional for security (cached plugins are verified at install). The developer assumption that "pushing to the repo updates the plugin" is wrong for cached installs.

**How to avoid:**
- Always bump plugin version when `runtime-deps.json` changes. This is non-negotiable.
- Use `claude plugin update ligamen` explicitly after publishing a new version to force cache refresh.
- Test the full update flow end-to-end before shipping: install plugin at version N, bump to N+1, verify `claude plugin update` fetches the new version and SessionStart re-installs deps.

**Warning signs:**
- `${CLAUDE_PLUGIN_ROOT}/runtime-deps.json` shows old dep versions even after the user ran `claude plugin update`
- Plugin version in `plugin.json` was not bumped between releases

**Phase to address:**
Phase 3: Version sync. Understanding the cache mechanics is prerequisite to designing the diff-check correctly.

---

### Pitfall 7: The diff-Check Pattern Fails If npm install Partially Succeeds Then the manifest copy Persists

**What goes wrong:**
The recommended pattern (from official docs) is:

```bash
diff -q "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" "${CLAUDE_PLUGIN_DATA}/runtime-deps.json" >/dev/null 2>&1 \
  || (cd "${CLAUDE_PLUGIN_DATA}" && cp "${CLAUDE_PLUGIN_ROOT}/runtime-deps.json" . && npm install) \
  || rm -f "${CLAUDE_PLUGIN_DATA}/runtime-deps.json"
```

The trailing `|| rm -f` removes the manifest copy if `npm install` fails, so the next session retries. This is correct for clean failures. However, if `npm install` partially succeeds (installs 8 of 10 packages, then times out or is killed), the manifest copy has already been written (`cp` ran before `npm install`). The `rm -f` runs because `npm install` failed — but by this point, some packages are already in `node_modules`. On the next session, the diff check sees no manifest copy and re-runs the full install, which may partially succeed again in a different way, leaving an inconsistent `node_modules`.

**Why it happens:**
The `cp` and `npm install` are chained in the same subshell with `&&`. The cp must succeed before npm install, so the manifest copy is written first. If npm fails and `rm -f` removes the manifest, the partial `node_modules` is not cleaned up.

**How to avoid:**
- Separate the sentinel from the manifest: write a `.deps-ready` sentinel file only AFTER `npm install` exits 0. On the next session, check for `.deps-ready` (or its absence), not for the manifest diff. The manifest copy can stay — it is only for detecting version changes on future updates.
- Before running `npm install`, record a `.deps-installing` lockfile. On hook startup, if `.deps-installing` exists but `.deps-ready` does not, delete `node_modules` and reinstall from scratch.
- Clean `node_modules` before each install attempt to avoid state accumulation from partial installs: `rm -rf "${CLAUDE_PLUGIN_DATA}/node_modules" && npm install`.

**Warning signs:**
- `${CLAUDE_PLUGIN_DATA}/node_modules` exists and is non-empty but `require('better-sqlite3')` still fails
- `npm ls` inside `${CLAUDE_PLUGIN_DATA}` shows missing or broken dependencies
- SessionStart hook retries install on every session despite seemingly completing

**Phase to address:**
Phase 1: Runtime dep installation. Harden the install script with proper sentinel logic before any integration testing.

---

### Pitfall 8: chromadb-js-bindings (If Used) Has Additional Native Compilation Requirements

**What goes wrong:**
`runtime-deps.json` lists `chromadb` as a dependency and `@chroma-core/default-embed` as an optional dependency. The `@chroma-core/default-embed` package uses Rust-compiled WASM bindings or native addons depending on the version. If it fails to install (missing Rust toolchain or WASM target), the optional dep is skipped — but the ChromaDB client may silently fall back to no embedding, or fail at import time if the main `chromadb` package expects the embed package to be present.

The existing plugin code (server/chroma.js) already has a 3-tier search fallback for ChromaDB unavailability. However, if the import of `chromadb` itself fails due to a transitive dep issue, the fallback never activates.

**Why it happens:**
`optionalDependencies` in npm does not guarantee the package installs successfully — it only guarantees that a failure to install doesn't abort the overall install. A broken optional dep that exports nothing is indistinguishable from a missing one at import time.

**How to avoid:**
- Wrap all ChromaDB imports in try/catch with explicit null-return on failure (already done in chroma.js based on existing architecture decisions). Verify this protection is in place in all paths the MCP server takes.
- In the install script, after npm install completes, run a separate check: `node -e "import('chromadb').then(() => process.exit(0)).catch(() => process.exit(0))"` — the ChromaDB check should always exit 0 (it is optional, not required for core MCP tools).
- Never fail MCP server startup because ChromaDB is unavailable — the 3-tier fallback must activate at module load, not at first use.

**Warning signs:**
- MCP server fails to start entirely when ChromaDB optional dep fails (not just ChromaDB tools missing)
- `import { chromaSearch } from '../server/chroma.js'` throws at module load rather than returning null
- MCP server works on developer machine (Rust available) but fails on user machines

**Phase to address:**
Phase 1: Runtime dep installation. Verify ChromaDB optional dep handling is truly isolated.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Relying solely on SessionStart hook for dep installation | Simple, one place to maintain | Race condition with MCP server startup; hook timeout aborts native compilation; first session always broken | Never — always pair with self-healing MCP wrapper |
| Using `NODE_PATH` for ESM dep resolution | Familiar pattern from CJS days | Silently ignored by ESM; imports fail with `ERR_MODULE_NOT_FOUND`; extremely confusing to debug | Never with `"type": "module"` |
| Single shared version number across all manifest files maintained manually | Obvious starting point | Version drift causes caching bugs; users stuck on old deps; update mechanism broken | Acceptable until first release; after that, automate |
| `diff -q` on full `runtime-deps.json` to detect dep changes | Simple, no additional infrastructure | Full file diff means any comment or whitespace change triggers unnecessary reinstall | Acceptable — reinstall is idempotent; prefer false positives over missed installs |
| Installing deps at `${CLAUDE_PLUGIN_ROOT}/node_modules` instead of `${CLAUDE_PLUGIN_DATA}/node_modules` | ESM resolution works without NODE_PATH tricks | Deps wiped on plugin update (plugin cache refreshed); must reinstall on every update | Acceptable only if the version bump always triggers reinstall correctly |
| Skipping a smoke-test after npm install | Faster hook execution | Broken binary (wrong Node version) undetected until MCP server crashes in a hard-to-diagnose way | Never — smoke-test is a 1-second `node -e` call |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP server `.mcp.json` env `NODE_PATH` | Assuming ESM respects `NODE_PATH` the same as CJS | Use self-healing wrapper script that installs deps into a location ESM can find (filesystem ancestor of the server.js file), or use `createRequire` for native addons |
| `better-sqlite3` in ESM context | Using bare `import Database from 'better-sqlite3'` when it ships as CJS | Use `module.createRequire(import.meta.url)` to load it via CJS path, or verify that the installed version ships an ESM wrapper (better-sqlite3 v9+ has experimental ESM support) |
| npm install in non-interactive hook | `npm install` prompting for confirmation or trying to open a browser (for audit/fund notices) | Always pass `--yes`, `--no-fund`, `--no-audit`, `--prefer-offline` to suppress interactive output; set `npm_config_fund=false` in env |
| Claude Code plugin cache + symlinks | Shipping a `node_modules` symlink in the plugin directory thinking it points to a real location | Symlinks are followed at copy time — the target must exist at copy time. For runtime-created symlinks, create them in the hook script, not in the repo |
| `${CLAUDE_PLUGIN_DATA}` path resolution in `.mcp.json` | Using `${CLAUDE_PLUGIN_DATA}` in the `env` block and assuming it expands at server startup | `${CLAUDE_PLUGIN_DATA}` is expanded by Claude Code's variable substitution before passing to the child process — it is the literal data dir path, not a shell variable. Do not double-expand it in wrapper scripts |
| Version bump triggering cache refresh | Bumping only one of marketplace.json or plugin.json | Claude Code's update mechanism uses the version from the source Claude verified. Both must be bumped; use the automated sync script |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running `npm install` on every session start (no diff check) | Session start takes 30–120 seconds even after deps are installed | Always compare manifest hash before installing; exit immediately if already installed | Every session, from first install onward |
| Cleaning `node_modules` before every install (rm -rf in hook) | SessionStart always takes 60+ seconds | Only clean on detected version change or after failed install sentinel | Every session, from first install onward |
| Not caching `npm` downloads | Each install on a new machine re-downloads all packages | Pass `--cache ${CLAUDE_PLUGIN_DATA}/.npm-cache` to use a persistent cache dir | On machines without npm's default cache populated |
| Running `npm install` synchronously in SessionStart (blocking) | Entire Claude Code session start blocked for 60+ seconds on first run | Spawn install in background; MCP wrapper does the blocking install only if deps missing at server start | First run and after each plugin update |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Installing deps from `runtime-deps.json` without lockfile | Dependency confusion or supply chain attack via version range resolution | Ship `package-lock.json` alongside `runtime-deps.json` and pass `--ci` instead of `--install` to npm for deterministic installs |
| Writing to `${CLAUDE_PLUGIN_DATA}` without checking the path | Path traversal if `CLAUDE_PLUGIN_DATA` is set to an unexpected value by a malicious config | Validate `CLAUDE_PLUGIN_DATA` starts with a known prefix (e.g., `~/.claude/plugins/data/`) before writing |
| Running `npm install` with scripts enabled in a hook | `postinstall` scripts in npm packages can execute arbitrary code at install time | Use `--ignore-scripts` for install, then `npm rebuild` separately for native addons that require build steps |
| Exposing `CLAUDE_PLUGIN_DATA` path in MCP tool output | Leaks local filesystem structure to AI context | Never return raw filesystem paths from MCP tools; return relative or opaque references |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failure on first session (MCP tools missing) | User thinks the plugin is broken; files issue | Log an explicit message via hook stdout: "Installing runtime deps (first run)... this may take 60 seconds" |
| No progress indication during native compilation | User sees frozen terminal during `node-gyp rebuild` | Print periodic progress lines from the install script; even just "Installing deps..." and "Done." is better than silence |
| Unhelpful error when build tools are missing | "node-gyp failed" with no actionable guidance | Detect `xcode-select` / `build-essential` absence before attempting compilation; print explicit install instructions |
| Plugin update installs new version but MCP server still uses old binary | User sees inconsistent behavior; old tools still present | Implement version-aware restart: detect version mismatch in `worker-start.sh` pattern (already exists for HTTP worker) and kill + restart MCP server |

---

## "Looks Done But Isn't" Checklist

- [ ] **ESM resolution verified:** After installation, `node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js` starts without `ERR_MODULE_NOT_FOUND` for `better-sqlite3`, `fastify`, `@modelcontextprotocol/sdk`, or `zod`
- [ ] **Native binary matches runtime Node:** `node -e "require('better-sqlite3')"` succeeds using the SAME `node` that Claude Code uses for MCP servers (may differ from system `node`)
- [ ] **MCP wrapper is self-healing:** Delete `${CLAUDE_PLUGIN_DATA}/node_modules`, start Claude Code — MCP server still comes up (wrapper installs deps before launching)
- [ ] **SessionStart timeout is sufficient:** Time a full `npm install` including `better-sqlite3` from source; set timeout at least 2x that value
- [ ] **Partial install recovery works:** Kill the install hook mid-way through, verify next session detects and completes the installation
- [ ] **Version bump triggers reinstall:** Bump `runtime-deps.json` version, update plugin version, verify `claude plugin update` + next session re-installs deps
- [ ] **All four version files in sync:** After version bump, assert `marketplace.json`, `plugin.json`, `package.json`, and `runtime-deps.json` all carry the same version string
- [ ] **ChromaDB optional dep failure is isolated:** Delete `@chroma-core/default-embed` from node_modules, verify MCP server still starts and non-ChromaDB tools work
- [ ] **npm install is non-interactive:** Run install in a non-TTY context (`node -e "execSync(...)"`) and verify no prompts hang the process
- [ ] **Hook stdout is valid JSON or empty:** Verify SessionStart hook still outputs valid `hookSpecificOutput` JSON even when the install branch runs — not polluted by npm progress output

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| ESM + NODE_PATH resolution failure | MEDIUM | Switch to self-healing MCP wrapper or symlink approach; update .mcp.json to use wrapper; re-test |
| Wrong Node version binary for better-sqlite3 | LOW | `rm -rf ${CLAUDE_PLUGIN_DATA}/node_modules && npm install --prefix ${CLAUDE_PLUGIN_DATA}` using correct node; restart Claude Code |
| Partial install / corrupt node_modules | LOW | `rm -rf ${CLAUDE_PLUGIN_DATA}/node_modules ${CLAUDE_PLUGIN_DATA}/runtime-deps.json`; restart Claude Code to trigger full reinstall |
| Hook timeout kills install mid-way | LOW | Increase timeout in hooks.json; or move install to MCP wrapper; restart Claude Code |
| Version sync drift (manifests out of sync) | MEDIUM | Run version sync script; bump all four files to same version; `claude plugin update`; test update path end-to-end |
| Cache refresh not triggered (version not bumped) | LOW | Bump version in all manifest files; push; user runs `claude plugin update ligamen` |
| ChromaDB breaking MCP server startup | LOW | Verify try/catch wrapping in chroma.js covers module load; add dynamic import with catch if not |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| NODE_PATH ignored by ESM (Pitfall 1) | Phase 1: Runtime dep installation | `node worker/mcp/server.js` starts without module not found errors |
| Native binary Node version mismatch (Pitfall 2) | Phase 1: Runtime dep installation | Smoke-test `require('better-sqlite3')` with Claude Code's node after install |
| Hook / MCP server startup race condition (Pitfall 3) | Phase 1: Runtime dep installation | Delete node_modules, start fresh session — MCP tools appear |
| SessionStart 10s timeout too short (Pitfall 4) | Phase 1: Runtime dep installation | Full native install completes within hook timeout window |
| Version sync drift (Pitfall 5) | Phase 3: Version sync | All four manifest files carry identical version strings; CI check enforces this |
| Plugin cache not refreshed without version bump (Pitfall 6) | Phase 3: Version sync | Test update flow: N → N+1 version triggers cache refresh and dep reinstall |
| Partial install leaves corrupt node_modules (Pitfall 7) | Phase 1: Runtime dep installation | Sentinel file approach tested with mid-install kill; next session recovers cleanly |
| ChromaDB optional dep isolation (Pitfall 8) | Phase 1: Runtime dep installation | MCP server starts with ChromaDB absent; non-ChromaDB tools fully operational |

---

## Sources

- [Claude Code Plugins Reference — CLAUDE_PLUGIN_DATA, NODE_PATH pattern, diff-check example](https://code.claude.com/docs/en/plugins-reference) (HIGH confidence — official documentation)
- [Node.js ESM docs — NODE_PATH not supported in ESM](https://nodejs.org/api/esm.html) (HIGH confidence — official Node.js docs)
- [Node.js ESM docs — native addons via createRequire](https://nodejs.org/api/esm.html#commonjs-namespaces) (HIGH confidence — official Node.js docs)
- [better-sqlite3 Node.js v24 prebuilt binary unavailability — Issue #1384](https://github.com/WiseLibs/better-sqlite3/issues/1384) (MEDIUM confidence — issue tracker)
- [better-sqlite3 NODE_MODULE_VERSION mismatch — Issue #549](https://github.com/WiseLibs/better-sqlite3/issues/549) (MEDIUM confidence — issue tracker)
- [Claude Code Issue #10997 — SessionStart hooks don't fire on first run with marketplace plugins](https://github.com/anthropics/claude-code/issues/10997) (MEDIUM confidence — issue tracker; may be resolved in newer versions)
- [Claude Code Issue #19491 — SessionStart hooks run before plugins fully loaded](https://github.com/anthropics/claude-code/issues/19491) (MEDIUM confidence — issue tracker)
- Codebase inspection: `plugins/ligamen/hooks/hooks.json` — confirmed `"timeout": 10` on SessionStart
- Codebase inspection: `plugins/ligamen/.mcp.json` — confirmed ESM MCP server launch pattern, no NODE_PATH env set yet
- Codebase inspection: `plugins/ligamen/package.json` — confirmed `"type": "module"`, making all worker/*.js files ESM
- Codebase inspection: `plugins/ligamen/runtime-deps.json` — confirmed native dep `better-sqlite3` and optional `@chroma-core/default-embed`
- Codebase inspection: `plugins/ligamen/worker/mcp/server.js` — confirmed ESM imports of `better-sqlite3`, `@modelcontextprotocol/sdk`, and internal worker modules

---

*Pitfalls research for: Ligamen v5.2 — Runtime dependency installation, MCP server distribution, native deps (better-sqlite3), ESM module resolution, and version sync*
*Researched: 2026-03-21*
