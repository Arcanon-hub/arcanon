# Phase 107: Install Architecture Cleanup — Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated combined plan-context (discuss skipped — well-scoped install-layer cleanup, all 12 REQs already specified in REQUIREMENTS.md)

<domain>
## Phase Boundary

Strictly the install path. Three files in scope:

- `plugins/arcanon/runtime-deps.json` — DELETED outright
- `plugins/arcanon/scripts/install-deps.sh` — REWRITTEN around a sha256 sentinel + binding-load validation + npm rebuild fallback
- `plugins/arcanon/scripts/mcp-wrapper.sh` — TRIMMED to CLAUDE_PLUGIN_ROOT resolution + `exec node worker/mcp/server.js`

Plus the bats test suite for the rewritten install-deps.sh (`tests/install-deps.bats`).

**Out of scope (NOT this phase):**
- Worker startup, MCP server logic, scan pipeline, hub-sync, UI — none touched.
- `package.json` content (deps already correct from prior phases — Phase 107 just adopts it as the single source of truth).
- `hooks/hooks.json` SessionStart ordering — already correct (install-deps before session-start), no edits needed.
- Migration tooling for `runtime-deps.json` users — none needed; sentinel mismatch on first session post-upgrade silently triggers a single npm install.
- Latent issues in `worker/db/query-engine.js` `_stmtUpsertConnection` / `_stmtUpsertService` silent catches — separate cleanup ticket, not Phase 107.
- Other v0.1.3 phases (108-113) — independent.

**Requirements covered (12):** INST-01 through INST-12, mapped 1-to-1 from REQUIREMENTS.md.

</domain>

<decisions>
## Implementation Decisions (locked)

### D-01 — Hash-based sentinel preferred over file-diff
**Decision:** Sentinel = `sha256(jq -c -S '.dependencies + .optionalDependencies' package.json)`, computed each run. Stored at `${CLAUDE_PLUGIN_DATA}/.arcanon-deps-sentinel` as a single 64-char hex line.

**Rationale:**
- Robust to whitespace, key reordering, comment-style differences in `package.json` that don't actually change deps.
- `jq -S` (sort keys recursively) gives canonical ordering — semantic-equivalent JSON produces identical hash.
- `jq -c` removes pretty-print whitespace.
- Restricting to `.dependencies + .optionalDependencies` ignores devDependencies (already filtered by `--omit=dev` at install time anyway) and irrelevant manifest churn (description, scripts, etc.).
- File-diff (current approach) would re-trigger install on every cosmetic edit to `package.json` — wasteful and slow.

**Rejected alternative:** `package-lock.json` checksum. Rejected because we deliberately install with `--package-lock=false` (lockfile-less for plugin distribution).

### D-02 — Sentinel filename rename: `.arcanon-deps-installed.json` → `.arcanon-deps-sentinel`
The current sentinel filename implies "JSON copy of the manifest". The new sentinel is a 64-char hex hash, not JSON. Renaming makes that explicit. Existing users on upgrade see the old `.arcanon-deps-installed.json` go ignored; the new `.arcanon-deps-sentinel` is created on first run; one extra `npm install` on the first post-upgrade session is the cost. No migration logic.

### D-03 — Binding-load validation, not file-existence
**Decision:** After sentinel match (or after install), run a 5-second-timeout `node -e "require('better-sqlite3'); new (require('better-sqlite3'))(':memory:').close()"`. Exit 0 if the binding loads and instantiates a connection. Otherwise treat as broken.

**Rationale:** The Node 25 prebuild-install silent failure (Phase 59-62 lineage) leaves `node_modules/better-sqlite3/` populated but with a broken or missing native binding under `build/Release/`. File-existence checks pass; `require()` fails. Binding-load is the only check that catches this class of failure.

### D-04 — Single npm rebuild attempt on broken binding
**Decision:** If validation fails after install (or on a previously-installed tree with broken binding), run `npm rebuild better-sqlite3 --prefix "${PLUGIN_ROOT}"` exactly once, re-validate. If the second validation fails, log to stderr `[arcanon] better-sqlite3 binding still broken after rebuild — surface via worker startup` and exit 0.

**Rationale:** A single rebuild fixes the silent-prebuild-failure case. Looping or chaining `rm -rf node_modules` + reinstall is too aggressive and risks cascading failures (see D-05). The runtime path (worker + MCP server) will surface the binding error if the user actually invokes a feature that needs SQLite — that's the correct surfacing point, not the SessionStart hook.

### D-05 — No `rm -rf node_modules` on failure
**Decision:** On install failure or post-rebuild validation failure, log to stderr and exit 0. Do NOT delete `node_modules`. Do NOT delete the sentinel.

**Rationale:** Current `install-deps.sh` does `rm -rf "${_R}/node_modules"` on install failure. This is too aggressive — a partial install may still serve the worker for some operations, and wholesale deletion guarantees the next session must re-install from scratch (potentially also failing). Leaving the partial tree in place lets the next session's sentinel comparison + binding validation re-test reality without re-paying the install cost.

### D-06 — Non-blocking on every path
**Decision:** Every code path in `install-deps.sh` exits 0 (modulo `set -euo pipefail` plus `trap 'exit 0' ERR` for unexpected errors). Genuine install failures are logged to stderr only — they never fail the SessionStart hook.

**Rationale:** Per the existing Bash-hook convention (CONVENTIONS.md "Hooks are warn-only: they always `exit 0`"). The error must surface at runtime through the worker / MCP server when the user actually invokes a feature. That's where the user can act on it.

### D-07 — `mcp-wrapper.sh` trimmed, NOT deleted
**Decision:** `mcp-wrapper.sh` reduces to ~5 lines:
```bash
#!/usr/bin/env bash
# Arcanon — mcp-wrapper.sh
# Resolves CLAUDE_PLUGIN_ROOT and execs the MCP server.
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
exec node "${PLUGIN_ROOT}/worker/mcp/server.js"
```
The wrapper still exists because `.mcp.json` registers it as the MCP server command — Claude Code spawns this script, not `node` directly. Deleting the wrapper would break MCP server registration. Removing the self-heal block is the only change.

**Rationale:** The self-heal in `mcp-wrapper.sh` was a Phase 59-62 belt-and-suspenders fix for the first-session race. With install-deps.sh now running on SessionStart (and the binding-load validation catching the silent-failure class), the wrapper-level self-heal is duplicative.

### D-08 — bats test threshold: hard 100ms requirement, CI ceiling 500ms
**Decision:** Per INST-04, the happy-path early-exit MUST complete in <100ms. The bats test asserts this at the 100ms threshold (the hard requirement). On shared CI runners (GitHub Actions, etc.) we tolerate up to 500ms (5× headroom) using the same pattern as the existing PreToolUse hook latency tests (`tests/impact-hook-latency.sh`).

**Rationale:** The hard 100ms requirement is the user-visible target. The 5× CI ceiling absorbs runner variance without weakening the spec. The test makes both thresholds explicit so a failing test on a developer machine flags a real regression, while CI flake on shared runners doesn't.

### D-09 — Test "no npm process spawned" assertion
**Decision:** The happy-path bats test asserts that no `npm` process was spawned during the run. Implementation: prepend a stub `npm` to `PATH` in the test that writes a marker file when invoked; assert the marker file does NOT exist after running install-deps.sh.

**Rationale:** Latency alone is a weak assertion (a test could be fast for unrelated reasons). Combined with "no npm process spawned" we get a strong assertion that the early-exit path actually skipped install.

</decisions>

<code_context>
## Existing Code Insights

### Why two manifests exist historically (Phase 59 lineage)
`runtime-deps.json` was introduced in Phase 59 (v5.2.0 Plugin Distribution Fix, shipped 2026-03-21) as a stripped-down dep manifest installed into `CLAUDE_PLUGIN_ROOT` separately from the plugin's own `package.json`. The reasoning at the time:
- The plugin's `package.json` had dev/test dependencies that weren't needed at runtime.
- Marketplace install copies the plugin tree into `~/.claude/plugins/marketplaces/.../plugins/arcanon/`; running `npm install` against the full `package.json` was slow.
- A separate `runtime-deps.json` let the install hook target only the runtime subset.

This was correct at the time. It became redundant once `--omit=dev` matured in npm 9+ (which is now the floor — Node 20 ships with npm 10). With `npm install --prefix ROOT --omit=dev --no-fund --no-audit --package-lock=false` against `package.json`, devDependencies are skipped automatically. Two manifests = a sync surface that drifted (the v0.1.2 cosmetic rename had to touch both, and the version bump scripts had to keep them aligned). Phase 107 collapses the redundancy.

### Current `install-deps.sh` structure (the file being rewritten)
- 57 lines total, ~30 lines of logic.
- Resolves `CLAUDE_PLUGIN_ROOT` (env var or `$0/..` fallback) — keep this pattern.
- Guards on `CLAUDE_PLUGIN_DATA`, `jq`, `npm` — keep all three (they're sound).
- Sentinel comparison via `diff -q "$MANIFEST" "$SENTINEL"` — REPLACE with hash comparison.
- File-existence check `[ -d "${_R}/node_modules/better-sqlite3" ]` — REPLACE with `validate_binding()` function.
- `npm install` invocation with the right flags (`--omit=dev --no-fund --no-audit --package-lock=false`) — keep.
- On install failure: `rm -rf "${_R}/node_modules"; rm -f "$SENTINEL"` — REMOVE per D-05.

### Current `mcp-wrapper.sh` structure (the file being trimmed)
- 31 lines total.
- Resolves `CLAUDE_PLUGIN_ROOT` (env var or `BASH_SOURCE` fallback) — keep this.
- Self-heal block lines 12-28 (`if [ ! -d "${_R}/node_modules/better-sqlite3" ]; then ... fi`) — DELETE entirely.
- `exec node "${_R}/worker/mcp/server.js"` line 30 — keep.

### Current `tests/install-deps.bats` (the test suite being expanded)
- 146 lines, 8 tests covering DEPS-01..04 (Phase 59 REQs).
- Uses a mock `runtime-deps.json` + matching `package.json` in `setup()`. After Phase 107, must drop runtime-deps.json mocking and rely on `package.json` only.
- Uses `is-number` as a tiny real npm package for fast install — preserve that pattern in the rewrite.
- Tests assert sentinel writing, idempotency, hooks.json ordering. Hooks.json ordering tests (DEPS-04) are still valid post-rewrite — keep them as-is.
- The 8 existing tests will break post-rewrite (sentinel filename change, manifest source change, binding-validation logic). The Phase 107-03 plan rewrites them in place plus adds the 5 INST-07..11 scenarios.

### Sentinel path mismatch latent bug (THE-1028 finding)
The current `install-deps.sh` writes `${CLAUDE_PLUGIN_DATA}/.arcanon-deps-installed.json` but does NOT `mkdir -p` the parent directory first. If `CLAUDE_PLUGIN_DATA` exists but is fresh (no prior session), the write succeeds (the directory itself is the data dir, which Claude Code creates). If the path were ever deeper, the write would silently fail under `set -e + trap 'exit 0' ERR`, leaving the install in "succeeded but sentinel never written" state — which means EVERY subsequent session would re-run npm install. The new install-deps.sh adds explicit `mkdir -p "$(dirname "$SENTINEL")"` to harden against future path changes.

### Hooks.json registration (no changes needed)
`plugins/arcanon/hooks/hooks.json` already has `install-deps.sh` registered as the first SessionStart hook with timeout 120 and `session-start.sh` second with timeout 10. Phase 107 does NOT modify hooks.json — the registration is correct. The bats tests covering DEPS-03 (timeout >= 120) and DEPS-04 (ordering) remain valid and should be preserved.

</code_context>

<specifics>
## Specifics

### Platform sha256 detection (canonical pattern)
Match the pattern already in `plugins/arcanon/scripts/session-start.sh` lines 95-101 and `plugins/arcanon/lib/db-path.sh` lines 39-46:

```bash
if command -v shasum >/dev/null 2>&1; then
  HASHER="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  HASHER="sha256sum"
else
  exit 0  # Non-blocking: no hasher → skip silently
fi
```

`shasum -a 256` is preferred (available on macOS + most Linux distros). `sha256sum` is the GNU coreutils fallback (Linux-only by default).

### Hash computation (canonical form)
```bash
COMPUTE_HASH() {
  jq -c -S '.dependencies + .optionalDependencies' "${PLUGIN_ROOT}/package.json" \
    | $HASHER \
    | awk '{print $1}'
}
```

- `-c` compact (no pretty-print whitespace)
- `-S` sort keys recursively (canonical ordering)
- `awk '{print $1}'` strips the trailing filename that `shasum` appends (sha256sum has no filename when reading stdin, but awk strips it harmlessly either way)

If `package.json` has no `optionalDependencies` field, `jq` evaluates `null + null` → emits `null`. That's still a deterministic hash. Idempotent.

### Binding validation function (canonical form)
```bash
validate_binding() {
  # 5-second timeout to avoid hang on weird filesystem states
  timeout 5 node --prefix "${PLUGIN_ROOT}" -e \
    "const D=require('better-sqlite3'); new D(':memory:').close()" \
    >/dev/null 2>&1
}
```

Note: `node` does NOT accept `--prefix` (that's `npm`'s flag). The correct invocation is to set `NODE_PATH` or to invoke node from within `${PLUGIN_ROOT}`:

```bash
validate_binding() {
  ( cd "${PLUGIN_ROOT}" && timeout 5 node -e \
      "const D=require('better-sqlite3'); new D(':memory:').close()" ) \
    >/dev/null 2>&1
}
```

`cd` puts CWD inside `${PLUGIN_ROOT}` so `require('better-sqlite3')` resolves through `${PLUGIN_ROOT}/node_modules/`. The subshell `( ... )` keeps the CWD change scoped.

**macOS note:** `timeout` is not in the default macOS toolchain; it's commonly installed via Homebrew coreutils as `gtimeout`. The detection pattern: prefer `timeout`, fall back to `gtimeout`, fall back to no-timeout (acceptable — the node invocation rarely hangs).

### Happy-path early-exit ordering (critical)
```
1. Resolve PLUGIN_ROOT (env var or $0/..)
2. Guard CLAUDE_PLUGIN_DATA, jq, npm, hasher
3. Compute current_hash from package.json
4. Read sentinel_hash from $CLAUDE_PLUGIN_DATA/.arcanon-deps-sentinel (empty if absent)
5. IF current_hash == sentinel_hash:
     IF validate_binding succeeds:
       exit 0  ← this is the <100ms path
     ELSE:
       fall through to rebuild path (skip npm install)
6. ELSE (hash mismatch):
     run npm install
     IF install succeeds:
       run validate_binding
       IF validate succeeds:
         write current_hash to sentinel
         exit 0
       ELSE:
         run npm rebuild better-sqlite3 once
         re-validate
         IF re-validate succeeds:
           write current_hash to sentinel
           exit 0
         ELSE:
           log "binding still broken after rebuild" to stderr
           exit 0  (do NOT delete node_modules; do NOT delete sentinel)
     ELSE (install failed):
       log "npm install failed" to stderr
       exit 0  (do NOT delete node_modules; do NOT delete sentinel)
```

### Test threshold: <100ms hard requirement
Per INST-04 + D-08:
- Test asserts elapsed time is `< 100` (ms) on the developer's machine.
- CI tolerance ceiling: `< 500` (ms) using `${CI:-}` env var detection in the test (`if [[ -n "${CI:-}" ]]; then THRESHOLD_MS=500; else THRESHOLD_MS=100; fi`).
- Latency measurement: capture `EPOCHREALTIME` before and after the call, multiply delta by 1000, integer-compare. Bash 5+ supports `EPOCHREALTIME` (microseconds as decimal). macOS Bash 4 → use `gdate +%s%N` (Homebrew GNU date) or fall back to `python3 -c 'import time; print(int(time.time()*1000))'`. The CI environment provides Bash 5+ via Homebrew.

### Test "no npm process spawned" assertion (INST-04 strong form)
```bash
# In test setup:
STUB_NPM_DIR="$(mktemp -d)"
cat > "$STUB_NPM_DIR/npm" <<'EOF'
#!/usr/bin/env bash
touch "${NPM_INVOKED_MARKER}"
exit 0
EOF
chmod +x "$STUB_NPM_DIR/npm"

# In test body:
export NPM_INVOKED_MARKER="$(mktemp)"
rm -f "$NPM_INVOKED_MARKER"

PATH="$STUB_NPM_DIR:$PATH" \
  CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
  CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
  bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"

# Assert no marker:
[ ! -f "$NPM_INVOKED_MARKER" ]
```

This combined with the latency assertion is the authoritative INST-04 / INST-07 test.

### Bats test scenario coverage (5 INST-07..11)
| Test | Setup | Assertion |
|------|-------|-----------|
| INST-07 happy-path-skip | sentinel matches package.json hash + binding loads | <100ms; no npm process; exit 0 |
| INST-08 broken-binding | sentinel matches but `node_modules/better-sqlite3/build/Release/` deleted | rebuild invoked once; binding loads after; exit 0 |
| INST-09 prebuild-silent-fail | mock `npm` that wipes `build/Release/` after install | install runs, validate fails, rebuild invoked, binding loads; exit 0 |
| INST-10 fresh-install | empty `node_modules/`, no sentinel | install runs, sentinel written, validate passes, exit 0 |
| INST-11 sentinel-mismatch | sentinel has bogus hex string | install runs, sentinel updated, validate passes, exit 0 |

Plus integration smoke (INST-12): full `make install` cycle (or `claude plugin marketplace add` + `claude plugin install`) → first session start → `/arcanon:status` succeeds. This is a higher-tier test — if not feasible in CI sandbox, document as a manual smoke step in the SUMMARY.

### Commit prefixes (per CONVENTIONS.md)
- `feat(107-NN): ...` — new features
- `refactor(107-NN): ...` — install-deps.sh / mcp-wrapper.sh rewrites (no behavior change at the user-facing level — the install path still installs deps; only the implementation changes)
- `test(107-NN): ...` — bats test additions/updates
- `docs(107-NN): ...` — CHANGELOG / README touches if any (probably none in this phase — the release pin is Phase 113)

REQ references go in the commit body or in parentheses: `refactor(107-02): rewrite install-deps.sh with sha256 sentinel + binding-load validation (INST-02, INST-03, INST-04, INST-05)`.

### Source artifacts inventory (for executor reference)
- `plugins/arcanon/runtime-deps.json` — DELETE
- `plugins/arcanon/scripts/install-deps.sh` — REWRITE
- `plugins/arcanon/scripts/mcp-wrapper.sh` — TRIM
- `tests/install-deps.bats` — REWRITE (current 8 tests covering DEPS-01..04 are stale; replace with INST-07..11 plus preserved hooks.json ordering tests)
- `plugins/arcanon/hooks/hooks.json` — NOT TOUCHED (registration is already correct)
- `plugins/arcanon/package.json` — NOT TOUCHED (deps already correct; `--omit=dev` keeps runtime-only)
- `plugins/arcanon/CHANGELOG.md` — NOT TOUCHED (release pin is Phase 113)

</specifics>

<deferred>
## Deferred Ideas

### Silent catches in `_stmtUpsertConnection` and `_stmtUpsertService` (logger.warn)
The query-engine has silent `try/catch` blocks around prepared-statement upserts that swallow column-mismatch errors. Reviewer noted these should be `logger.warn` instead of silent — but that's a query-engine concern, not install architecture. Tracked for a separate cleanup ticket; not Phase 107 scope.

### Migration tooling for `runtime-deps.json` users
Per CONTEXT.md decision: none needed. install-deps.sh handles the upgrade silently via sentinel mismatch. No code path needs to read or migrate the old `runtime-deps.json`. The orchestrator should NOT spawn a Phase 107 plan for migration tooling.

### `npm rebuild --build-from-source` path
If `npm rebuild better-sqlite3` itself fails (e.g., user has no C compiler), we could fall back to `npm rebuild better-sqlite3 --build-from-source`. Not in scope for Phase 107 — the failure path correctly logs to stderr and exits 0; runtime self-surfaces. If users hit this in practice, file a follow-up.

### CI integration smoke test (INST-12)
If the CI sandbox cannot run `claude plugin marketplace add` + `claude plugin install` (likely — Claude Code may not be installed on GitHub Actions), document the smoke as a manual step in the Phase 107 SUMMARY. Phase 113 (Verification Gate) covers the manual fresh-install run on Node 25 explicitly.

</deferred>
