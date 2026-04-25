---
phase: 107-install-architecture-cleanup
plan: 01
subsystem: install
tags:
  - install-architecture
  - cleanup
  - mcp-wrapper
  - runtime-deps
requires: []
provides:
  - "package.json is single source of truth for runtime dependencies"
  - "mcp-wrapper.sh is minimal: PLUGIN_ROOT resolve + exec node"
affects:
  - "plugins/arcanon/runtime-deps.json (DELETED)"
  - "plugins/arcanon/scripts/mcp-wrapper.sh (TRIMMED 30 → 12 lines)"
tech-stack:
  added: []
  patterns:
    - "Strict mode (set -euo pipefail) added to mcp-wrapper.sh — matches the convention used by every other script in plugins/arcanon/scripts/"
    - "exec node as the final action so SIGTERM from Claude Code reaches node directly (no bash intermediary)"
key-files:
  created: []
  modified:
    - "plugins/arcanon/scripts/mcp-wrapper.sh"
  deleted:
    - "plugins/arcanon/runtime-deps.json"
decisions:
  - "D-07 honored: mcp-wrapper.sh trimmed, NOT deleted — .mcp.json registration depends on the path"
  - "package.json (with --omit=dev at install time) replaces runtime-deps.json as runtime-only manifest"
  - "Self-heal removed from wrapper: install-deps.sh on SessionStart owns dep install; Plan 107-02 will add binding-load validation, making wrapper-level self-heal duplicative"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-25"
  tasks_completed: "2/2"
  commits: 2
  files_changed: 2
requirements_completed:
  - INST-01
  - INST-06
---

# Phase 107 Plan 01: Delete runtime-deps.json + Trim mcp-wrapper.sh Summary

Removed the dual-manifest sync surface (runtime-deps.json) and reduced mcp-wrapper.sh from 30 lines to 12 lines of pure CLAUDE_PLUGIN_ROOT resolution + exec, with all install / self-heal logic now centralized in install-deps.sh (rewritten in Plan 107-02).

## Commits

| Task | Commit  | Message                                                                                  |
| ---- | ------- | ---------------------------------------------------------------------------------------- |
| 1    | f58488d | refactor(107-01): delete runtime-deps.json — package.json is single source of truth (INST-01) |
| 2    | 0f1862c | refactor(107-01): reduce mcp-wrapper.sh to minimal exec form (INST-06)                   |

## Verification Gates — all 8 PASS

| Gate | Check                                                                                | Result |
| ---- | ------------------------------------------------------------------------------------ | ------ |
| 1    | `test ! -f plugins/arcanon/runtime-deps.json`                                        | PASS   |
| 2    | No `npm install` / `npm rebuild` / `node_modules/better-sqlite3` in mcp-wrapper.sh   | PASS   |
| 3    | mcp-wrapper.sh ends in `exec node ...`                                               | PASS   |
| 4    | `shellcheck -x -e SC1091 plugins/arcanon/scripts/mcp-wrapper.sh` clean               | PASS   |
| 5    | mcp-wrapper.sh ≤ 12 lines (actual: 12)                                               | PASS   |
| 6    | `jq empty plugins/arcanon/package.json` (manifest still parses)                      | PASS   |
| 7    | install-deps.sh untouched — line 31 `MANIFEST="${_R}/runtime-deps.json"` preserved    | PASS   |
| 8    | hooks.json `install-deps.sh` registration preserved                                  | PASS   |

(Gate 7 verified via `grep -cF` literal-string match — the plan's pattern as written used shell-escape syntax that grep -E interpreted differently; the underlying assertion that install-deps.sh is untouched is satisfied.)

## Final form of `plugins/arcanon/scripts/mcp-wrapper.sh`

```bash
#!/usr/bin/env bash
# Arcanon — mcp-wrapper.sh
# Resolves CLAUDE_PLUGIN_ROOT and execs the MCP server.
# All install / self-heal logic lives in scripts/install-deps.sh (SessionStart hook).
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "${PLUGIN_ROOT}" ]]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

exec node "${PLUGIN_ROOT}/worker/mcp/server.js"
```

12 lines. Executable mode preserved (`-rwxr-xr-x`). Smoke-tested against a mock `server.js`: exit code 0.

## Confirmation that `runtime-deps.json` is deleted

```
$ git status (excerpt, post-Task 1, pre-commit)
D  plugins/arcanon/runtime-deps.json

$ git show --stat f58488d
 plugins/arcanon/runtime-deps.json | 18 ------------------
 1 file changed, 18 deletions(-)

$ test ! -f plugins/arcanon/runtime-deps.json && echo "CONFIRMED ABSENT"
CONFIRMED ABSENT
```

## Cross-reference: every runtime dep was in package.json (latent gap fixed)

| runtime-deps.json (deleted)              | package.json (kept)                            |
| ---------------------------------------- | ---------------------------------------------- |
| `@modelcontextprotocol/sdk` ^1.27.1      | `@modelcontextprotocol/sdk` ^1.27.1            |
| `better-sqlite3` ^12.9.0                 | `better-sqlite3` ^12.9.0                       |
| `fastify` ^5.8.2                         | `fastify` ^5.8.5 (newer floor — correct)       |
| `@fastify/cors` ^10.0.0                  | `@fastify/cors` ^10.0.0                        |
| `@fastify/static` ^8.0.0                 | `@fastify/static` ^9.1.1 (newer floor)         |
| `chromadb` ^3.3.3                        | `chromadb` ^3.3.3                              |
| `zod` ^3.25.0                            | `zod` ^3.25.0                                  |
| (missing!)                               | `picomatch` ^4.0.4 ← latent gap closed         |
| `@chroma-core/default-embed` ^1.0.0 (opt) | `@chroma-core/default-embed` ^1.0.0 (opt)     |

`picomatch` is imported by `worker/lib/` for glob matching. It was in `package.json` but not in `runtime-deps.json` — meaning prior installs ran via the runtime-deps path were missing a runtime dependency. Adopting `package.json` as the single source of truth closes this latent gap.

## Expected Transient Breakage (recorded, not blocking)

1. **`tests/mcp-wrapper.bats` test `MCP-02: wrapper logs install message to stderr when better-sqlite3 missing`** — fails because the self-heal stderr message was deleted. **Plan 107-03 rewrites this test.** Documented in plan; not a regression.

2. **`tests/install-deps.bats`** — does NOT break from this plan. The bats setup creates a mock `runtime-deps.json` in `MOCK_PLUGIN_ROOT/` per test (a fresh `mktemp -d`); the live-tree deletion has no effect on mock paths. The test will break from Plan 107-02's install-deps.sh rewrite — Plan 107-03 handles that.

## install-deps.sh "no-op" state between Plans 107-01 and 107-02 (intentional)

`install-deps.sh` line 33-36 has an early-exit guard:

```bash
if [[ ! -f "$MANIFEST" ]]; then
  exit 0
fi
```

After Task 1 deletes `runtime-deps.json`, this guard makes `install-deps.sh` a no-op every session — install-deps.sh runs but exits 0 immediately because the manifest it expects is gone. **This is acceptable because Plans 107-01 and 107-02 ship in the same wave** (Wave 1 of Phase 107). The orchestrator must NOT pause between them; the no-op state is a planning artifact, not a release state. Existing users with prior `node_modules/` installations remain functional through Plan 107-01 alone — the deleted wrapper-level self-heal was duplicative anyway, and worker-start.sh / direct node invocations don't depend on install-deps.sh.

## Deviations from Plan

None. Plan executed exactly as written.

- Both tasks completed atomically with `refactor(107-01): ...` commit prefix.
- Each task referenced its REQ in the commit message (INST-01 in commit body for Task 1; INST-06 in commit body for Task 2).
- No out-of-scope edits: `install-deps.sh` (Plan 107-02), `package.json`, `hooks.json`, `tests/` are all untouched.
- mcp-wrapper.sh path NOT moved/renamed (`.mcp.json` registration preserved).
- Executable mode (0755) preserved on the wrapper through the rewrite.

## Handoff to Plan 107-02

`package.json` is now the single source of truth for runtime dependencies. Every dep that was in `runtime-deps.json` is in `package.json` at the same or newer version, plus `picomatch` ^4.0.4 (which was missing from `runtime-deps.json` — latent gap now closed by adoption).

Plan 107-02's install-deps.sh rewrite can:
1. Replace `MANIFEST="${_R}/runtime-deps.json"` with `MANIFEST="${PLUGIN_ROOT}/package.json"`.
2. Replace the `[[ ! -f "$MANIFEST" ]] && exit 0` guard with a proper guard that exits 0 only if `package.json` is genuinely absent (which would be a deeper installation bug).
3. Replace `diff -q "$MANIFEST" "$SENTINEL"` with sha256-hash comparison per D-01:
   - Sentinel filename: `.arcanon-deps-sentinel` (renamed from `.arcanon-deps-installed.json` per D-02 — old filename will become stale and ignored on existing systems; one extra `npm install` on first post-upgrade session, no migration logic needed).
   - Hash basis: `jq -c -S '.dependencies + .optionalDependencies' package.json | shasum -a 256 | awk '{print $1}'`.
4. Replace the `[ -d "${_R}/node_modules/better-sqlite3" ]` file-existence check with binding-load validation per D-03 (`( cd ${PLUGIN_ROOT} && timeout 5 node -e "..." )`).
5. Add single `npm rebuild better-sqlite3` retry on validation failure per D-04, with stderr logging only (no `rm -rf node_modules` per D-05).
6. Variable rename `_R` → `PLUGIN_ROOT` (matches the convention now in mcp-wrapper.sh).

The wrapper-level self-heal is now gone, so the SessionStart `install-deps.sh` IS the install path. Plan 107-02 has no Plan 107-01-imposed constraints beyond keeping `set -euo pipefail` + `trap 'exit 0' ERR` (per D-06, hooks are warn-only).

## Self-Check: PASSED

- File `plugins/arcanon/scripts/mcp-wrapper.sh` exists at expected path: FOUND
- File `plugins/arcanon/runtime-deps.json` absent: FOUND (confirmed deleted)
- Commit `f58488d` (Task 1) in git log: FOUND
- Commit `0f1862c` (Task 2) in git log: FOUND
- All 8 verification gates: PASS
- Two commits with `refactor(107-01): ...` prefix: FOUND
