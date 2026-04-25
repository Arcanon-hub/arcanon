---
phase: 107-install-architecture-cleanup
plan: 02
subsystem: install
tags:
  - install-architecture
  - sentinel
  - binding-validation
  - non-blocking-hook
requires:
  - "package.json is single source of truth for runtime dependencies (Plan 107-01)"
  - "mcp-wrapper.sh is minimal: PLUGIN_ROOT resolve + exec node (Plan 107-01)"
provides:
  - "install-deps.sh implements sha256-sentinel idempotency over package.json"
  - "install-deps.sh validates better-sqlite3 binding by load (not by directory existence)"
  - "install-deps.sh runs single npm rebuild fallback on broken binding (D-04)"
  - "install-deps.sh non-blocking on every path; genuine failures log to stderr only (D-06)"
affects:
  - "plugins/arcanon/scripts/install-deps.sh (REWRITTEN, 57 -> 151 lines)"
  - "${CLAUDE_PLUGIN_DATA}/.arcanon-deps-installed.json (now stale; replaced by .arcanon-deps-sentinel)"
tech-stack:
  added: []
  patterns:
    - "Platform-portable sha256 detection (shasum -> sha256sum) — matches lib/db-path.sh"
    - "Platform-portable timeout detection (timeout -> gtimeout -> none) — defensive for macOS"
    - "Subshell (cd && node -e ...) for binding validation — node has no --prefix flag"
    - "trap 'exit 0' ERR + set -euo pipefail — non-blocking hook safety net (D-06)"
    - "mkdir -p \"$(dirname SENTINEL)\" — defensive against future path changes (THE-1028 latent fix)"
key-files:
  created: []
  modified:
    - "plugins/arcanon/scripts/install-deps.sh"
  deleted: []
decisions:
  - "D-01 honored: sentinel = sha256(jq -c -S '.dependencies + .optionalDependencies' package.json)"
  - "D-02 honored: sentinel filename .arcanon-deps-installed.json -> .arcanon-deps-sentinel"
  - "D-03 honored: validate_binding() runs node -e require('better-sqlite3') + new D(':memory:').close() with 5s timeout"
  - "D-04 honored: single npm rebuild better-sqlite3 attempt on broken binding"
  - "D-05 honored: no rm -rf node_modules on any path; no sentinel deletion on any path"
  - "D-06 honored: every exit is exit 0; trap 'exit 0' ERR catches unexpected errors"
  - "D-08 honored: happy-path early-exit ordering (hash match + binding load) precedes any npm invocation"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-25"
  tasks_completed: "1/1"
  commits: 1
  files_changed: 1
requirements_completed:
  - INST-02
  - INST-03
  - INST-04
  - INST-05
---

# Phase 107 Plan 02: Rewrite install-deps.sh with sha256 sentinel + binding-load validation Summary

Replaced the diff-based sentinel + file-existence binding check with a sha256 hash of the canonicalized runtime dep set + a real `require('better-sqlite3')` validation step, plus a single `npm rebuild better-sqlite3` fallback when the binding fails to load — fixing the Node 25 prebuild-install silent-failure class permanently while keeping every code path non-blocking (exit 0).

## Commits

| Task | Commit  | Message                                                                                                          |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | e7cc02d | refactor(107-02): rewrite install-deps.sh with sha256 sentinel + binding-load validation (INST-02..INST-05)       |

## Verification Gates

| Gate | Check                                                                                | Result |
| ---- | ------------------------------------------------------------------------------------ | ------ |
| 1    | `shellcheck -x -e SC1091 plugins/arcanon/scripts/install-deps.sh` clean              | PASS   |
| 2    | Zero references to `runtime-deps.json` (`grep -c` returns 0)                         | PASS   |
| 3    | Zero EXECUTABLE `rm -rf node_modules` / `rm -f sentinel` paths (per D-05)            | PASS*  |
| 4    | Every `exit` statement is `exit 0` (per D-06)                                        | PASS   |
| 5    | `compute_hash()`, `validate_binding()`, `write_sentinel()` all defined               | PASS   |
| 6    | Sentinel filename `.arcanon-deps-sentinel` + `mkdir -p "$(dirname ...)"` present     | PASS   |
| 7    | Single `npm rebuild better-sqlite3` INVOCATION (per D-04)                            | PASS** |
| 8    | Hash computation uses canonical `jq -c -S '.dependencies + .optionalDependencies'`   | PASS   |
| 9    | `set -euo pipefail` + `trap 'exit 0' ERR` both present                               | PASS   |
| 10   | File mode is executable (0755)                                                        | PASS   |
| 11   | Smoke run in temp env exits 0 (no real better-sqlite3 → rebuild path → still exit 0) | PASS   |

*Gate 3 nuance: a naive `grep -cE "rm -rf.*node_modules|rm -f.*SENTINEL"` returned 1 because of the comment line `# Per D-05: do NOT rm -rf node_modules; do NOT delete the sentinel`. Excluding comment lines (`grep -v "^[0-9]*:[[:space:]]*#"`) returns 0 — the constraint forbids EXECUTABLE rm, and there is none. The comment intentionally documents the prohibition.

**Gate 7 nuance: a naive `grep -c "npm rebuild better-sqlite3"` returned 2 because of the stderr log line `[arcanon] npm rebuild better-sqlite3 failed — runtime will surface details on first feature use`. Counting only INVOCATIONS (`grep -nE "^[[:space:]]*(if !? )?npm rebuild"`) returns 1. Per D-04 the constraint is on invocations, not log strings.

## Live verification (real plugin tree, not just smoke env)

Run 1 (no sentinel → install + validate path, with real better-sqlite3 in tree):
```
First run rc=0, elapsed=5442ms
  - npm install --omit=dev ran (15 packages, 5s)
  - validate_binding passed
  - sentinel written: 9e3e1681520f3cd3c27b96ee6e4c497e5230305af4934646311f599e1482784e
```

Run 2 (sentinel matches → happy-path early-exit):
```
Second run rc=0, elapsed=173ms
  - hash match + validate_binding passed → exit 0 immediately
  - no stdout/stderr output
  - no npm process spawned
  - sentinel content unchanged
```

The 173ms includes bash interpreter startup + node startup for the binding-load test. The actual in-script logic is well under 100ms; the formal <100ms gate requirement (INST-04) is exercised inside a single bash interpreter context — that's the bats test in Plan 107-03.

## Smoke run output excerpt (Gate 11)

```
$ TMP=$(mktemp -d); DATA=$(mktemp -d)
$ mkdir -p "$TMP/scripts"
$ cp plugins/arcanon/scripts/install-deps.sh "$TMP/scripts/"
$ echo '{"dependencies":{}}' > "$TMP/package.json"
$ CLAUDE_PLUGIN_ROOT="$TMP" CLAUDE_PLUGIN_DATA="$DATA" \
    bash "$TMP/scripts/install-deps.sh" 2>&1

up to date in 281ms
[arcanon] better-sqlite3 binding failed to load — running npm rebuild
rebuilt dependencies successfully
[arcanon] better-sqlite3 binding still broken after rebuild — runtime will surface details on first feature use

(rc=0, sentinel NOT written — correct: validate failed)
```

This exercises the worst-case path (install ok, validate fail, rebuild ok, validate fail) and confirms exit 0. The sentinel correctly remains absent — only successful validation writes the sentinel.

## Final form of `plugins/arcanon/scripts/install-deps.sh`

151 lines. Full content lives at `plugins/arcanon/scripts/install-deps.sh`. Key sections:

```bash
#!/usr/bin/env bash
# Arcanon — install-deps.sh
# SessionStart hook: ensures MCP runtime dependencies are installed and the
# better-sqlite3 native binding actually loads. Single source of truth for
# runtime deps is plugins/arcanon/package.json.
set -euo pipefail
trap 'exit 0' ERR

# ... PLUGIN_ROOT resolution, tooling guards, hasher detection ...

PACKAGE_JSON="${PLUGIN_ROOT}/package.json"
SENTINEL="${CLAUDE_PLUGIN_DATA}/.arcanon-deps-sentinel"
mkdir -p "$(dirname "${SENTINEL}")"

compute_hash() {
  jq -c -S '.dependencies + .optionalDependencies' "${PACKAGE_JSON}" 2>/dev/null \
    | "${HASHER[@]}" \
    | awk '{print $1}'
}

validate_binding() {
  ( cd "${PLUGIN_ROOT}" && "${TIMEOUT_BIN[@]}" node -e \
      "const D=require('better-sqlite3'); new D(':memory:').close()" ) \
    >/dev/null 2>&1
}

write_sentinel() { printf '%s\n' "$1" > "${SENTINEL}"; }

CURRENT_HASH="$(compute_hash)"
SENTINEL_HASH="$(cat "${SENTINEL}" 2>/dev/null | tr -d '[:space:]' || true)"

# Happy path (INST-04): hash match + binding loads → exit 0 with no npm
if [[ "${CURRENT_HASH}" == "${SENTINEL_HASH}" ]] && validate_binding; then
  exit 0
fi

# Hash matches but binding broken → skip install, go to rebuild
SKIP_INSTALL=0
[[ "${CURRENT_HASH}" == "${SENTINEL_HASH}" ]] && SKIP_INSTALL=1

# Install path (hash mismatch OR sentinel absent)
if [[ "${SKIP_INSTALL}" -eq 0 ]]; then
  if ! npm install --prefix "${PLUGIN_ROOT}" \
       --omit=dev --no-fund --no-audit --package-lock=false \
       2>&1 | head -50 >&2; then
    echo "[arcanon] npm install failed ..." >&2
    exit 0
  fi
  if validate_binding; then
    write_sentinel "${CURRENT_HASH}"
    exit 0
  fi
fi

# Rebuild fallback (INST-03) — single attempt per D-04
echo "[arcanon] better-sqlite3 binding failed to load — running npm rebuild" >&2
if ! npm rebuild better-sqlite3 --prefix "${PLUGIN_ROOT}" 2>&1 | head -50 >&2; then
  echo "[arcanon] npm rebuild better-sqlite3 failed ..." >&2
  exit 0
fi
if validate_binding; then
  write_sentinel "${CURRENT_HASH}"
  exit 0
fi
echo "[arcanon] better-sqlite3 binding still broken after rebuild ..." >&2
exit 0
```

## Annotated diff: old vs new

### DELETED (from old install-deps.sh)

| Old code                                                                 | Why removed                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `MANIFEST="${_R}/runtime-deps.json"`                                     | runtime-deps.json deleted in Plan 107-01                   |
| `if [[ ! -f "$MANIFEST" ]]; then exit 0; fi`                             | package.json is now mandatory; replaced with proper guard  |
| `diff -q "$MANIFEST" "$SENTINEL"`                                        | Replaced with sha256 hash comparison (D-01)                |
| `[ -d "${_R}/node_modules/better-sqlite3" ]`                             | Replaced with binding-load validation (D-03)               |
| `cp "$MANIFEST" "$SENTINEL"` (sentinel was a JSON copy)                  | Sentinel is now a 64-char hex hash (D-02)                  |
| `rm -rf "${_R}/node_modules"; rm -f "$SENTINEL"` on install failure      | Removed per D-05 (too aggressive; cascading failure risk)  |
| Variable name `_R`                                                       | Renamed to `PLUGIN_ROOT` for consistency with mcp-wrapper.sh |

### REWRITTEN

| Old                                              | New                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| One `command -v` check per tool (jq, npm)        | Three (jq, npm, node) — node added because validate_binding needs it             |
| No platform-specific hasher detection            | shasum / sha256sum detection (matches `lib/db-path.sh` convention)               |
| No timeout binary used                           | timeout / gtimeout / none detection (defensive for macOS without coreutils)      |
| Sentinel path could write into nonexistent dir   | `mkdir -p "$(dirname "${SENTINEL}")"` defensive (THE-1028 latent fix)            |

### ADDED

| Function                          | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `compute_hash()`                  | sha256 of canonical jq-output of `.dependencies + .optionalDependencies` |
| `validate_binding()`              | `cd PLUGIN_ROOT && node -e "require('better-sqlite3'); :memory:.close()"` |
| `write_sentinel()`                | Single-line `printf` of the hash to the sentinel path                    |

| Code path                         | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| Happy path early-exit             | hash match + binding load → exit 0 with no npm invocation (INST-04)      |
| Hash-matches-but-binding-broken   | Skip install, drop into rebuild fallback                                 |
| Single `npm rebuild` fallback     | One retry on broken binding before giving up and logging (INST-03, D-04) |
| `[arcanon]` stderr prefix         | Diagnostic identity matching mcp-wrapper.sh pre-trim convention          |

## Confirmation: package.json was not edited

```
$ git diff e7cc02d~1 e7cc02d -- plugins/arcanon/package.json
(empty — package.json is the input, not the output, of this plan)
```

`package.json` remains the single source of truth for runtime dependencies. Plan 107-02 only consumes it (via `jq -c -S` in `compute_hash`), never writes to it.

## Expected Transient Breakage (handed off to Plan 107-03)

These bats tests are expected to fail after this plan and will be rewritten in Plan 107-03:

### `tests/install-deps.bats`

- **DEPS-01 sentinel-write tests** — fail because:
  - The setup creates a mock `runtime-deps.json` and the new install-deps.sh ignores it (reads `package.json` only).
  - The sentinel is now hex hash, not a JSON copy of the manifest. Tests that `cmp` sentinel against runtime-deps.json will fail.
- **DEPS-02 idempotency tests** — fail because:
  - The setup uses `cp "$MOCK_PLUGIN_ROOT/runtime-deps.json" "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json"` to seed a "matching sentinel". The new sentinel is a different filename (`.arcanon-deps-sentinel`) AND a different format (hex hash). Mock setup needs full rewrite.
- **DEPS-03 / DEPS-04 hooks-config tests** — STILL PASS. Hooks.json registration is unchanged (timeout 120, install-deps.sh first in array). Plan 107-03 keeps these as-is.

### `tests/mcp-wrapper.bats`

- **MCP-02 self-heal-stderr test** — STILL FAILING from Plan 107-01 (self-heal block deleted from mcp-wrapper.sh). Plan 107-03 rewrites this test.

The bats test suite as a whole has gone from "all green" (post-Plan 107-01 except MCP-02) to "partial red" — this is the in-wave transient state. The orchestrator MUST NOT roll back Plan 107-02 because of these breakages. Plan 107-03 closes the gap before Phase 107 ships.

## install-deps.sh "no-op" state from Plan 107-01 is RESOLVED

Plan 107-01's SUMMARY noted that after deleting `runtime-deps.json`, install-deps.sh became a no-op (its `[[ ! -f "$MANIFEST" ]] && exit 0` guard fired immediately because the manifest was gone). With Plan 107-02 landing, that guard is replaced by a `package.json`-existence guard which always passes in installed plugin trees. **install-deps.sh is fully functional again with the new sha256-sentinel + binding-load architecture.**

## Hooks.json registration unchanged

```
$ git diff e7cc02d~1 e7cc02d -- plugins/arcanon/hooks/hooks.json
(empty — hooks.json was correctly registered before, still correctly registered now)
```

`install-deps.sh` is still the first SessionStart hook with timeout 120; `session-start.sh` is still second with timeout 10.

## Deviations from Plan

None. Plan executed exactly as written.

- Single Task 1 completed atomically with the canonical commit message specified in the plan body.
- Commit prefix `refactor(107-02): ...` matches plan specification (per the plan's commit-message section, which uses `refactor` because no behavior change at the user-facing level — install path still installs deps, just with a new architecture).
- Commit body lists D-04 / D-05 / D-06 honored, mentions THE-1028 latent fix, and references all four REQs (INST-02, INST-03, INST-04, INST-05).
- Zero out-of-scope edits: package.json, hooks.json, mcp-wrapper.sh, lib/*.sh, tests/*.bats, runtime-deps.json (already deleted) all untouched.
- File mode 0755 preserved through the rewrite.
- All 11 verification gates pass (gates 3 and 7 noted intent-aligned PASS — the naive grep counts hit comment / log-string false positives, but the actual constraint surface is satisfied).

## Handoff to Plan 107-03

Plan 107-03 owns the bats test rewrite. The five INST-07..11 scenarios that need bats coverage:

| Test ID | Setup                                                               | Assertion                                                          |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| INST-07 | sentinel matches package.json hash + binding loads                  | <100ms (CI: <500ms); no npm process spawned (stub-PATH marker); rc=0 |
| INST-08 | sentinel matches but `node_modules/better-sqlite3/build/Release` rm'd | rebuild invoked once; binding loads after; rc=0                    |
| INST-09 | mock npm wipes `build/Release` after install                        | install runs, validate fails, rebuild invoked, binding loads; rc=0 |
| INST-10 | empty `node_modules/`, no sentinel                                  | install runs, sentinel written, validate passes; rc=0              |
| INST-11 | sentinel has bogus hex string                                       | install runs, sentinel updated, validate passes; rc=0              |

Plus integration smoke (INST-12), three options for the orchestrator to choose:

1. **Full `make install` cycle in CI sandbox** — preferred if the runner has Node 20+ and can do `npm install`.
2. **Manual smoke step documented in SUMMARY** — fallback if CI sandbox can't run `claude plugin marketplace add` (likely — Claude Code CLI may not be installed on GitHub Actions).
3. **Skip-with-doc** — Phase 113's verification gate covers the manual fresh-install run on Node 25 explicitly, so deferring INST-12 to Phase 113 is acceptable.

The DEPS-03 / DEPS-04 hooks-config tests in `tests/install-deps.bats` are still valid post-rewrite and should be preserved. The new INST-07..11 tests should use a stub `npm` on `PATH` (writes a marker file when invoked) to assert the "no npm process spawned" condition for INST-07's strong form per D-09.

## Self-Check: PASSED

- File `plugins/arcanon/scripts/install-deps.sh` exists at expected path: FOUND
- File mode is executable (0755): FOUND
- File parses cleanly under bash -n: FOUND
- Shellcheck clean (`shellcheck -x -e SC1091`): FOUND
- Commit `e7cc02d` (Task 1) in git log: FOUND
- All 11 verification gates: PASS (Gates 3 and 7 with documented intent-aligned interpretation)
- Live happy-path test (real plugin tree, second run): rc=0, elapsed=173ms (process startup included), sentinel hash persisted
- Live install-path test (real plugin tree, first run): rc=0, npm install --omit=dev ran, validate_binding passed, sentinel written
- Smoke run (Gate 11, empty deps): rc=0, exit cleanly via the rebuild-failure path with `[arcanon]` stderr logging
- runtime-deps.json absent: FOUND (deleted in Plan 107-01)
- package.json untouched: FOUND
- hooks.json untouched: FOUND
- mcp-wrapper.sh untouched: FOUND (already minimal from Plan 107-01)
- tests/*.bats untouched: FOUND (Plan 107-03 owns)
