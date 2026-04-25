# Phase 108 — Deferred Items

Discovered during execution; out of REQ scope. Not fixed in this phase.

## Out-of-scope bats failures (logged from plan 108-02 execution, 2026-04-25)

Three bats tests are red on `main` after Wave-1 plan landings (107-02, 108-01, 108-02, 109-01, 109-02). None are caused by 108-02 (which only touches `commands/upload.md`, `tests/commands-surface.bats`, `README.md`, `plugins/arcanon/CHANGELOG.md` — disjoint from the failing tests' files).

| Test ID | File | Owner plan | Symptom | Disposition |
|---|---|---|---|---|
| HOK-06 | `tests/impact-hook.bats:151` | n/a (pre-existing) | "p99 latency < 50ms over 100 iterations" — assert_success failed | Pre-existing macOS timing issue. STATE.md already documents: "PreToolUse hook p99 latency on macOS is 130ms vs the 50ms Linux target — documented caveat, not a regression." |
| INST-08 | `tests/install-deps.bats:174` | 107-02 (`refactor(107-02): rewrite install-deps.sh with sha256 sentinel + binding-load validation`) | "broken binding triggers rebuild and binding loads after" — `CP_RC=$?` failed | Owned by phase 107 install-architecture rewrite. The current install-deps.sh (HEAD) and tests/install-deps.bats are still being iterated — see uncommitted `M tests/install-deps.bats` in working tree. |
| MCP-02 | `tests/mcp-wrapper.bats:208` | 107-02 (mcp-wrapper.sh trim) | "wrapper logs install message to stderr when better-sqlite3 missing" — `[[ "$output" == *"[arcanon]"* ]]` failed | Owned by phase 107 wrapper-rewrite. Test expects a log prefix the new wrapper no longer emits. |

**Action:** None in 108-02. Phase 107's verifier / phase 113 verification gate will surface these before milestone close.

**Rationale for not fixing here:**

Per the executor SCOPE BOUNDARY rule, plan 108-02's auto-fix authority is limited to issues DIRECTLY caused by 108-02's file changes. Plan 108-02 did not touch any source file feeding these three tests. Fixing them would expand scope into 107-02 territory (an in-flight parallel plan) and risk merge conflicts.
