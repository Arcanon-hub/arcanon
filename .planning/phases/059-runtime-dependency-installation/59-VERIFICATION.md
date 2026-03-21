---
phase: 59-runtime-dependency-installation
verified: 2026-03-21T18:30:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 59: Runtime Dependency Installation Verification Report

**Phase Goal:** The MCP server's runtime npm dependencies are installed into ${CLAUDE_PLUGIN_ROOT} on every session start, with idempotency to skip unchanged installs and a self-healing wrapper for the first-session race condition
**Verified:** 2026-03-21T18:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | SessionStart hook installs runtime npm deps into CLAUDE_PLUGIN_ROOT on first session | VERIFIED | install-deps.sh line 45: `npm install --prefix "${_R}"` wired as first SessionStart entry in hooks.json |
| 2  | Second session skips install when runtime-deps.json is unchanged | VERIFIED | install-deps.sh line 39: `diff -q "$MANIFEST" "$SENTINEL"` + `better-sqlite3` dir check; bats test 3 confirms skip |
| 3  | Failed npm install deletes sentinel so next session retries | VERIFIED | install-deps.sh lines 52-54: `rm -rf "${_R}/node_modules"` + `rm -f "$SENTINEL"` on failure path |
| 4  | Install runs before SESSION_ID dedup in session-start.sh (separate hook entry) | VERIFIED | hooks.json lines 36-46: install-deps.sh is hooks[0] at timeout 120; session-start.sh is hooks[1] at timeout 10 |
| 5  | Hook timeout is 120 seconds to accommodate native compilation | VERIFIED | hooks.json line 39: `"timeout": 120`; bats test DEPS-03 asserts >= 120 |
| 6  | MCP wrapper checks for better-sqlite3 in node_modules before launching server | VERIFIED | mcp-wrapper.sh line 12: `if [ ! -d "${_R}/node_modules/better-sqlite3" ]` |
| 7  | If deps missing, wrapper runs npm install before exec'ing server.js | VERIFIED | mcp-wrapper.sh lines 13-27: npm install block before line 30 `exec node`; bats test MCP-02 #2 confirms |
| 8  | All wrapper output goes to stderr (stdout reserved for MCP JSON-RPC) | VERIFIED | mcp-wrapper.sh: all `echo` statements have `>&2`; npm redirected to temp log then `>&2`; bats tests MCP-02 #3 and #4 confirm stdout clean |
| 9  | Wrapper still works in dev mode (CLAUDE_PLUGIN_ROOT set, deps already in node_modules) | VERIFIED | mcp-wrapper.sh: script-relative fallback on line 9; bats test MCP-02 #6 confirms with `-u CLAUDE_PLUGIN_ROOT` |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Level 1: Exists | Level 2: Substantive | Level 3: Wired | Status |
|----------|----------|-----------------|----------------------|----------------|--------|
| `plugins/ligamen/scripts/install-deps.sh` | Runtime dep installation script | YES | YES — 57 lines, non-stub implementation with diff sentinel, npm install, failure cleanup | YES — referenced in hooks.json as SessionStart[0].hooks[0] | VERIFIED |
| `plugins/ligamen/hooks/hooks.json` | Hook routing with install-deps.sh first at timeout 120 | YES | YES — valid JSON, 2-entry SessionStart array with correct commands and timeouts | YES — Claude reads hooks.json on session start | VERIFIED |
| `tests/install-deps.bats` | Bats tests for install-deps.sh | YES | YES — 9 tests covering DEPS-01 through DEPS-04 | YES — 9/9 pass via `./tests/bats/bin/bats tests/install-deps.bats` | VERIFIED |
| `plugins/ligamen/scripts/mcp-wrapper.sh` | Self-healing MCP wrapper | YES | YES — extended from 6 to 31 lines with dep check, npm install, stderr routing, exec | YES — wired as command in .mcp.json | VERIFIED |
| `tests/mcp-wrapper.bats` | Bats tests for mcp-wrapper.sh self-healing | YES | YES — 6 tests covering MCP-02 scenarios | YES — 6/6 pass via `./tests/bats/bin/bats tests/mcp-wrapper.bats` | VERIFIED |
| `plugins/ligamen/.mcp.json` | MCP config pointing to wrapper not node directly | YES | YES — command: `${CLAUDE_PLUGIN_ROOT}/scripts/mcp-wrapper.sh` | YES — this is the MCP server launch config read by Claude | VERIFIED |
| `plugins/ligamen/runtime-deps.json` | Dep manifest (sentinel comparison source) | YES | YES — 488 bytes, valid dep manifest with 7 runtime deps | YES — referenced in install-deps.sh as MANIFEST | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `hooks.json` | `scripts/install-deps.sh` | SessionStart hook entry | WIRED | Line 38: `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.sh"` |
| `install-deps.sh` | `runtime-deps.json` | diff sentinel comparison | WIRED | Lines 31, 39: `MANIFEST="${_R}/runtime-deps.json"`, `diff -q "$MANIFEST" "$SENTINEL"` |
| `install-deps.sh` | `${CLAUDE_PLUGIN_DATA}/.ligamen-deps-installed.json` | sentinel write after successful install | WIRED | Line 30: `SENTINEL="${CLAUDE_PLUGIN_DATA}/.ligamen-deps-installed.json"`, line 49: `cp "$MANIFEST" "$SENTINEL"` |
| `mcp-wrapper.sh` | `worker/mcp/server.js` | exec node server.js | WIRED | Line 30: `exec node "${_R}/worker/mcp/server.js"` |
| `mcp-wrapper.sh` | runtime-deps via `npm install` | npm install with --prefix pointing to PLUGIN_ROOT package.json | WIRED | Lines 15-16: `npm install --prefix "${_R}" --omit=dev --no-fund --no-audit --package-lock=false` |
| `.mcp.json` | `scripts/mcp-wrapper.sh` | command field | WIRED | Line 5: `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/mcp-wrapper.sh"` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DEPS-01 | 59-01-PLAN.md | SessionStart hook installs runtime deps into ${CLAUDE_PLUGIN_ROOT} via npm install | SATISFIED | install-deps.sh uses `npm install --prefix "${_R}"` on every SessionStart; bats tests DEPS-01 confirm non-blocking exit 0 and clean stdout |
| DEPS-02 | 59-01-PLAN.md | Install uses diff-based idempotency — skips if runtime-deps.json unchanged | SATISFIED | install-deps.sh uses `diff -q "$MANIFEST" "$SENTINEL"` plus `better-sqlite3` dir double-check; 4 bats tests cover all idempotency branches |
| DEPS-03 | 59-01-PLAN.md | Hook timeout is 120s+ to accommodate better-sqlite3 native compilation | SATISFIED | hooks.json install-deps.sh entry has `"timeout": 120`; bats test DEPS-03 asserts `>= 120` |
| DEPS-04 | 59-01-PLAN.md | Install runs before SESSION_ID dedup guard in session-start.sh | SATISFIED | hooks.json SessionStart hooks[0] is install-deps.sh; hooks[1] is session-start.sh which contains the dedup guard; bats tests DEPS-04 assert ordering |
| MCP-02 | 59-02-PLAN.md | Self-healing MCP wrapper installs deps if missing before server exec | SATISFIED | mcp-wrapper.sh checks for `node_modules/better-sqlite3`, installs if missing, then `exec node server.js`; .mcp.json wired to wrapper; 6 bats tests pass |

No orphaned requirements: all 5 IDs claimed in PLAN frontmatter have REQUIREMENTS.md entries mapped to Phase 59 with status Complete.

---

### Anti-Patterns Found

No anti-patterns found in any phase artifact. No TODO/FIXME/placeholder comments, no empty implementations, no console.log-only stubs.

---

### Commit Verification

All 5 commits documented in SUMMARY files verified in git history:

| Commit | Description |
|--------|-------------|
| `ef040cf` | feat(59-01): create install-deps.sh with diff-based idempotency |
| `d15068a` | feat(59-01): wire install-deps.sh as first SessionStart hook at timeout 120 |
| `8507566` | test(59-01): add bats tests for install-deps.sh covering DEPS-01 through DEPS-04 |
| `b922faa` | feat(59-02): extend mcp-wrapper.sh with self-healing dep installation |
| `45767df` | test(59-02): add bats tests for mcp-wrapper.sh self-healing behavior |

---

### Test Execution Results

**tests/install-deps.bats** (9/9 passed):
- DEPS-01: exits 0 when CLAUDE_PLUGIN_DATA is unset (dev mode)
- DEPS-01: produces no stdout output (hook stdout must be clean)
- DEPS-02: skips install when sentinel matches and better-sqlite3 dir exists
- DEPS-02: installs when sentinel is missing
- DEPS-02: installs when sentinel differs from manifest
- DEPS-02: installs when better-sqlite3 dir missing even if sentinel matches
- DEPS-03: hooks.json install-deps entry has timeout >= 120
- DEPS-04: install-deps.sh runs before session-start.sh in hooks.json
- DEPS-04: session-start.sh is second in SessionStart hooks array

**tests/mcp-wrapper.bats** (6/6 passed):
- MCP-02: wrapper exits 0 when better-sqlite3 already present
- MCP-02: wrapper logs install message to stderr when better-sqlite3 missing
- MCP-02: wrapper produces no stdout when deps are present
- MCP-02: install messages go to stderr not stdout
- MCP-02: .mcp.json command field ends with mcp-wrapper.sh
- MCP-02: wrapper works without CLAUDE_PLUGIN_ROOT using script-relative fallback

---

### Human Verification Required

One item cannot be verified programmatically:

**1. First-Session Race Condition in Live Plugin Context**

**Test:** Install the plugin fresh from marketplace into Claude Code, open a new session, and attempt to use an MCP tool immediately (before SessionStart hook completes).
**Expected:** The mcp-wrapper.sh self-healing installs deps inline and the MCP server starts successfully without user intervention.
**Why human:** Requires a live Claude Code + marketplace installation environment. The timing of the race condition between SessionStart hook and MCP server launch cannot be simulated in unit tests. The CLAUDE_PLUGIN_ROOT writability during live hook execution also requires empirical confirmation (noted as a known blocker in both SUMMARY files).

---

## Gaps Summary

No gaps found. All truths are verified, all artifacts are substantive and wired, all requirements are satisfied, and all 15 bats tests pass.

---

_Verified: 2026-03-21T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
