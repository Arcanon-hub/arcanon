---
phase: 97-command-cleanup
verified: 2026-04-19T00:00:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
---

# Phase 97: Command Cleanup — Verification Report

**Phase Goal:** Users face a clean command surface — `/arcanon:cross-impact` is gone, `/arcanon:sync` is the canonical upload+drain verb, and the `auto_upload` config key silently migrates to `auto_sync` without breaking existing users
**Verified:** 2026-04-19
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `commands/cross-impact.md` deleted; 0 refs in source/banner/docs | VERIFIED | File absent; grep across plugin/ finds only `agent-prompt-infra.md` (read-only agent prompt, out-of-scope per 97-01 SUMMARY) and `commands/impact.md` (prose reference to "legacy cross-impact command" for user context, not a surface reference) |
| 2  | `/arcanon:impact` has `--exclude`, `--changed` flags | VERIFIED | `impact.md` argument-hint: `[target] [--direction downstream|upstream] [--hops N] [--changed] [--exclude <repo>]`; both flags documented and exercised by 14 bats assertions |
| 3  | `/arcanon:impact` has 3-state degradation (A=no-worker→grep, B=worker+no-data→prompt+grep, C=worker+data→graph) | VERIFIED | impact.md Step 0 state table documents all three states; grep fallback delegates to `scripts/impact.sh`; bats tests 7-11 confirm each branch |
| 4  | `/arcanon:sync` supports `--drain`, `--repo`, `--dry-run`, `--force`; default = upload-then-drain | VERIFIED | sync.md argument-hint lists all four flags; Step 0-3 orchestration documents flag semantics; `--drain` skips Step 2, `--force` skips preflight |
| 5  | `/arcanon:upload` is a deprecated stub with stderr warning and v0.2.0 removal anchor | VERIFIED | upload.md description starts `[DEPRECATED]`; `printf '...' >&2` emits warning; `# DEPRECATED: remove in v0.2.0` anchor present; bats tests 18-22 confirm each marker |
| 6  | `auto_upload` renamed to `auto_sync` in plugin.json userConfig | VERIFIED | plugin.json line 34: `"auto_sync": { "title": "Auto-sync scans to hub", ... }` — no `auto_upload` key present |
| 7  | `hub.js` two-read `_readHubAutoSync` helper with legacy fallback | VERIFIED | hub.js lines 54-69: explicit `typeof newKey !== "undefined"` check; `auto-sync` beats `auto-upload`; documented CLN-07 comment |
| 8  | `manager.js` two-read `_readHubAutoSync` helper with legacy fallback | VERIFIED | manager.js lines 59-74: identical helper to hub.js; all `hubAutoUpload` variable references updated to `hubAutoSync` |
| 9  | Stderr deprecation warning when legacy `auto-upload` key is read (one-time per process) | VERIFIED | Both hub.js and manager.js have module-level `_autoUploadDeprecationWarned` flag; `process.stderr.write(...)` fires exactly once; CLN-08 unit test passes |
| 10 | bats `impact-merged-features.bats` 14 tests green | VERIFIED | 14/14 pass (confirmed live run) |
| 11 | bats `commands-surface.bats` 10 tests green | VERIFIED | 10/10 pass (confirmed live run) |
| 12 | bats `structure.bats` tests green | VERIFIED | 16/16 pass (confirmed live run) |
| 13 | bats `session-start.bats` tests green | VERIFIED | 26/26 pass (confirmed live run) |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `plugins/arcanon/commands/cross-impact.md` | DELETED | VERIFIED | File does not exist |
| `plugins/arcanon/commands/impact.md` | --exclude, --changed, 3-state model | VERIFIED | 217 lines; all capabilities present and wired to `scripts/impact.sh` and `lib/worker-client.sh` |
| `plugins/arcanon/commands/sync.md` | --drain, --repo, --dry-run, --force; upload-then-drain default | VERIFIED | Fully rewritten Step 0-3 orchestration |
| `plugins/arcanon/commands/upload.md` | Deprecated stub, stderr warning, v0.2.0 anchor | VERIFIED | Reduced to 32-line stub with all required markers |
| `plugins/arcanon/.claude-plugin/plugin.json` | `auto_sync` key in userConfig | VERIFIED | `auto_sync` present; `auto_upload` absent |
| `plugins/arcanon/worker/cli/hub.js` | `_readHubAutoSync` two-read helper | VERIFIED | Lines 54-69; one-time deprecation guard at module level |
| `plugins/arcanon/worker/scan/manager.js` | `_readHubAutoSync` two-read helper | VERIFIED | Lines 59-74; identical semantics to hub.js |
| `plugins/arcanon/scripts/session-start.sh` | No `/arcanon:cross-impact` reference | VERIFIED | Line 114 banner omits cross-impact; `/arcanon:upload` remains (intentional — upload stub still exists in v0.1.1) |
| `tests/impact-merged-features.bats` | 14 structural assertions gating CLN-10/11/12/13 | VERIFIED | 14 tests, all pass |
| `tests/commands-surface.bats` | 10 regression assertions for CLN-01/03/04/05/09 | VERIFIED | 10 tests, all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `commands/impact.md` | `lib/worker-client.sh` | `source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh` in Step 0 | WIRED | Explicit source call documented |
| `commands/impact.md` | `scripts/impact.sh` | `bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]` in Legacy Fallback | WIRED | Explicit bash call; no grep logic inlined |
| `commands/sync.md` | `scripts/hub.sh` | `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload/sync` in Steps 2/3 | WIRED | Both upload and drain steps explicitly shelled |
| `commands/upload.md` | `scripts/hub.sh upload` | `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $ARGUMENTS` | WIRED | Forwards with full $ARGUMENTS passthrough |
| `worker/cli/hub.js` | `_readHubAutoSync` | `_readHubAutoSync(cfg?.hub)` in cmdStatus | WIRED | Confirmed in hub.js cmdStatus handler |
| `worker/scan/manager.js` | `_readHubAutoSync` | `hubAutoSync: _readHubAutoSync(cfg?.hub)` in `_readHubConfig()` | WIRED | Used by all sync conditional branches |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `_readHubAutoSync` precedence: auto-sync beats auto-upload | `node --test plugins/arcanon/worker/cli/hub.test.js` | 1/1 pass | PASS |
| CLN-07/08 unit tests (4 branches) | `node --test plugins/arcanon/worker/scan/manager.test.js` (CLN tests) | 4/4 pass | PASS |
| 4-suite bats (66 tests) | `bats tests/impact-merged-features.bats tests/commands-surface.bats tests/structure.bats tests/session-start.bats` | 66/66 pass | PASS |
| Pre-existing failing test in manager.test.js | `incremental scan prompt...` | 1 fail (pre-existing, unrelated to Phase 97) | PASS (not a Phase 97 regression) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CLN-01 | 97-01 | `/arcanon:cross-impact` command file deleted | SATISFIED | `commands/cross-impact.md` absent; bats CLN-01 asserts it |
| CLN-02 | 97-01 | Banner/doc references to cross-impact removed | SATISFIED | session-start.sh line 114, README.md, docs/commands.md all scrubbed |
| CLN-03 | 97-02 | `/arcanon:sync` absorbs upload semantics with four flags | SATISFIED | sync.md argument-hint + Step 0-3 orchestration |
| CLN-04 | 97-02 | Default `/arcanon:sync` (no flags) = upload-then-drain | SATISFIED | sync.md Step 2 (upload) → Step 3 (drain) documented |
| CLN-05 | 97-02 | `/arcanon:upload` deprecated stub with stderr warning | SATISFIED | upload.md: `[DEPRECATED]` description, `printf >&2`, v0.2.0 anchor |
| CLN-06 | 97-03 | `auto_upload` → `auto_sync` in plugin.json userConfig | SATISFIED | plugin.json line 34: `"auto_sync"` key present |
| CLN-07 | 97-03 | Two-read `cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]` pattern | SATISFIED | hub.js + manager.js `_readHubAutoSync`; `typeof` check (not `??`) for `false`-beats-`true` semantics |
| CLN-08 | 97-03 | One-time stderr deprecation when legacy key read | SATISFIED | Module-level `_autoUploadDeprecationWarned` guard in both files; unit test confirms exactly 1 write |
| CLN-09 | 97-02 | bats regression: 7 surviving commands work | SATISFIED | commands-surface.bats 10/10; structure.bats 16/16 |
| CLN-10 | 97-04 | `/arcanon:impact` absorbs `--exclude <repo>` flag | SATISFIED | impact.md argument-hint + filter applied in both State C and Legacy Fallback paths |
| CLN-11 | 97-04 | `/arcanon:impact --changed` auto-detects from git diff | SATISFIED | impact.md Step 1 `--changed` auto-detect + bare-invocation implicit `--changed` |
| CLN-12 | 97-04 | `/arcanon:impact` 3-state degradation model | SATISFIED | impact.md Step 0 state table; States A/B/C all documented with correct fallback sequence |
| CLN-13 | 97-04 | Delete-cross-impact runs AFTER merge; features work before deletion | SATISFIED | Plan 97-04 (Wave 1) ran before 97-01 (Wave 2); 14-test serialization guard gated deletion |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/session-start.sh` | 114 | `/arcanon:upload` still in the session banner commands list | Info | Intentional — upload stub exists as a valid deprecated command in v0.1.1; Plan 97-01 SUMMARY explicitly deferred this token to Plan 97-02, and 97-02 made the deliberate decision to keep it since the stub is still user-callable. Not a blocker. |

### Human Verification Required

None. All success criteria are verifiable programmatically and all 66 bats tests pass.

## Gaps Summary

No gaps. All 13 CLN requirements are satisfied, all four bats suites pass (66/66), and the one failing Node test (`incremental scan prompt`) is a pre-existing failure documented in Plan 97-03 SUMMARY as unrelated to this phase.

**Notable decision: `/arcanon:upload` in session banner.** The banner on `session-start.sh` line 114 still lists `/arcanon:upload`. This is intentional — the upload stub is a valid deprecated command in v0.1.1, and Plan 97-01 SUMMARY explicitly records that it left the token for Plan 97-02, which then decided to keep it since the stub remains user-callable. CLN-02 specifically scopes to removing `/arcanon:cross-impact` references, not `/arcanon:upload`.

**Notable decision: upload stub shells to `hub.sh upload` (not `hub.sh sync`).** Plan 97-02 SUMMARY documents this as a deliberate choice to preserve the exact v0.1.0 Node CLI code path for one release. The functional outcome (upload occurs, stderr warning emitted, $ARGUMENTS passed through) satisfies CLN-05.

---

_Verified: 2026-04-19_
_Verifier: Claude (gsd-verifier)_
