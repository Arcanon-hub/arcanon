# Project Research Summary

**Project:** Arcanon v0.1.1 — Command Cleanup + Update + Ambient Hooks
**Domain:** Claude Code plugin — CLI surface, self-update command, PreToolUse ambient hooks, SessionStart enrichment
**Researched:** 2026-04-21
**Confidence:** HIGH (all CLI surface and codebase integration points verified live against shipped code)

---

## Executive Summary

Arcanon v0.1.1 is a focused housekeeping + ambient-awareness milestone. Three of the four workstreams are subtraction or additive-only changes with no new failure modes: command cleanup removes `/arcanon:cross-impact` and folds `/arcanon:upload` into a unified `/arcanon:sync`, the new `/arcanon:update` command adds a deterministic self-update flow using the already-shipped `lib/worker-restart.sh` patterns, and SessionStart enrichment extends an existing script with a handful of `sqlite3` queries. The fourth workstream — the PreToolUse impact hook — carries the most implementation risk because it fires synchronously on every file edit and a latency regression is immediately perceptible to users.

The recommended approach across all four workstreams is to use what already ships: `worker-client.sh` for HTTP calls, `file-guard.sh` patterns for hook output contracts, `worker-restart.sh` kill semantics (not reused wholesale for update — the update path needs kill-only, not kill-then-restart), `better-sqlite3` via inline Node or `sqlite3` CLI for DB queries, and `jq` + shell for JSON handling. No new npm dependencies are required. The impact hook must query the already-running worker daemon over its local HTTP socket rather than spawning Node cold — the difference is ~5ms vs 300ms per edit. The three researchers independently converged on the same phase order: command cleanup first (pure subtraction), update command second (additive, standalone), SessionStart enrichment third (extends code Phase 1 touches), PreToolUse hook last (highest risk, needs stable DB path resolver).

The top open risks are: (1) `claude plugin update` requires a Claude Code session restart after it runs — the update command must communicate this clearly to the user; (2) the `root_path` prefix matching in the impact hook must normalize trailing slashes to avoid `services/auth` spuriously matching `services/auth-legacy`; (3) version comparison must use Node's `semver` package, not shell string comparison, to handle `0.9.x < 0.10.x` correctly; (4) four open questions require empirical validation during Phase 4 — most critically, whether PreToolUse hook output should use `systemMessage` or `additionalContext` (current evidence favors `systemMessage`). All four of these are schedulable and none blocks starting Phase 1.

---

## Key Findings

### Recommended Stack

No new runtime dependencies are required for any v0.1.1 feature. All shell tooling (`jq`, `curl`, `sqlite3` CLI) is already required by the existing plugin. `better-sqlite3` is already installed by `install-deps.sh`. The update command uses the existing `claude plugin marketplace update` + `claude plugin update` CLI surface, verified live against `claude plugin --help`. The only new file artifacts are: `commands/update.md`, `scripts/update.sh`, `scripts/impact-hook.sh`, and `lib/db-path.sh`.

**Core technologies (all pre-existing):**
- `claude plugin marketplace update` / `claude plugin update`: CLI for remote manifest refresh and plugin reinstall — no equivalent filesystem operation exists for either step
- `better-sqlite3` (inline Node) or `sqlite3` CLI: DB queries in hook hot path — `sqlite3` CLI preferred at <5ms vs 80–200ms Node cold-start; inline Node acceptable in session-start.sh where startup cost is amortized once per session
- `lib/worker-restart.sh` + `lib/worker-client.sh`: Worker lifecycle management and HTTP API calls — re-use patterns, do not duplicate; update path needs kill-only subset (not full restart-if-stale)
- `jq` + bash: JSON parsing for all hook I/O and manifest version reads — already used in every existing hook

**Critical version/path facts:**
- Installed version: `~/.claude/plugins/installed_plugins.json` → `.plugins["arcanon@arcanon"][0].version` (or `$CLAUDE_PLUGIN_ROOT/package.json` → `.version`)
- Remote version after refresh: `~/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json` → `.version`
- Hook registration lives in `hooks/hooks.json` (subdirectory `hooks/`, not a top-level file) — adding hooks to `plugin.json` does nothing
- `CLAUDE_PLUGIN_ROOT` (immutable, version-stamped cache) vs `CLAUDE_PLUGIN_DATA` (mutable, survives updates) — DB lives under `ARCANON_DATA_DIR` derived from `CLAUDE_PLUGIN_DATA`

### Expected Features

All four features are P1 for v0.1.1. Nothing from this milestone should slip to v0.2.0.

**Must ship (table stakes for this milestone):**
- `/arcanon:update` shows installed vs remote version before acting, asks for confirmation (default No), shows 2-4 CHANGELOG lines, kills stale worker, then tells user "restart Claude Code to activate" — every mature CLI tool does this
- `/arcanon:update` must gracefully handle offline/rate-limited marketplace fetch with `curl --max-time 5` and exit 0 with a "could not reach update server, current version is X.Y.Z" message
- `/arcanon:sync` default behavior (no flags) must upload current repo then drain queue — users typing `/arcanon:sync` after finishing work want both; keep a deprecated `/arcanon:upload` stub that exits 0 and forwards to sync for one version
- `auto_upload` → `auto_sync` config migration must read both keys with explicit one-release fallback; emit deprecation warning to stderr; silence on the old key without warning breaks CI

**Should ship (differentiators):**
- PreToolUse impact hook with warn-only `systemMessage` + exit 0 — hard-block (exit 2) is an anti-feature that kills agentic multi-file refactors and has a documented VS Code bug (GH #13339)
- Two-tier file classification: Tier 1 is pure bash pattern match for `.proto`, `openapi.yaml/yml/json`, `swagger.yaml/yml/json` at ~0ms; Tier 2 is SQLite `root_path` prefix match for service entry-points at ~5–15ms
- Impact hook self-exclusion: skip when the edited file is inside `$CLAUDE_PLUGIN_ROOT`
- `ARCANON_IMPACT_DEBUG=1` env var writing one-line JSONL trace to `$DATA_DIR/logs/impact-hook.jsonl`
- SessionStart enrichment capped at ~120–200 chars: "N services mapped, K load-bearing files, last scan: date, hub: status" — no full service names list, no JSON dump
- Staleness guard: surface `age_hours` from worker daemon, prepend `[stale map — last scanned Xd ago]` when > 48h

**Defer to v0.2.0:**
- Skills layer on top of hooks — observe real firing behavior first
- `permissionDecision: "ask"` blocking — wait for GH #37420 and VS Code parity bug resolution
- Threshold-based consumer-count blocking
- Auto-update-on-session-start
- `/arcanon:rollback` command — plugin dir is a git clone; `git checkout <sha>` is the recovery path

### Architecture Approach

All four workstreams slot cleanly into the existing layered architecture (commands/ → scripts/ → lib/ → worker/) without requiring any new design patterns. The update command follows the orchestration split already established by map.md/worker-start.sh. The impact hook follows the file-guard.sh pattern precisely. SessionStart enrichment is three `sqlite3` calls and one `hub.sh status` call inserted between lines 83 and 110 of the existing `session-start.sh`.

**Major new/changed components:**

| Component | Type | Responsibility |
|-----------|------|----------------|
| `commands/update.md` | NEW | Self-update UX orchestration: version check → confirm → reinstall → kill → prune → verify |
| `scripts/update.sh` | NEW | Deterministic shell: `--check`, `--kill` (kill-only, NOT restart), `--prune-cache`, `--verify` |
| `scripts/impact-hook.sh` | NEW | PreToolUse: file classification (Tier 1 bash, Tier 2 SQLite), consumer query, `systemMessage` output |
| `lib/db-path.sh` | NEW | Shell helper: resolves per-project DB path from CWD via data-dir.sh + project hash |
| `scripts/session-start.sh` | EDIT (lines 83–115) | Add stats query block; update CONTEXT string; remove cross-impact/upload from banner; add update |
| `hooks/hooks.json` | EDIT | Add `impact-hook.sh` entry to `PreToolUse` array AFTER `file-guard.sh` |
| `commands/sync.md` | REWRITE | Absorb upload preflight; add `--dry-run`, `--repo`, `--force`, `--drain` |
| `commands/upload.md` | DELETE (stub kept) | Deprecated stub for one version |
| `commands/cross-impact.md` | DELETE | Markdown-only; no JS worker routes |
| `worker/cli/hub.js` | EDIT (lines 114, 131, 144) | Two-read: `auto-sync` ?? `auto-upload` |
| `worker/scan/manager.js` | EDIT (lines 55, 859, 863, 867) | Same two-read pattern |
| `.claude-plugin/plugin.json` | EDIT (lines 34–40) | Rename `auto_upload` → `auto_sync` in userConfig |

### Critical Pitfalls

Top six the roadmapper must schedule explicit prevention work for:

1. **`auto_upload` silent config break (Phase 1)** — Two-read pattern (`auto-sync` ?? `auto-upload`) in hub.js line 114 + manager.js line 55; emit deprecation warning to stderr. Ship migration logic in the same commit as the key rename.

2. **`/arcanon:upload` breaks CI (Phase 1)** — Keep deprecated stub that exits 0 and forwards to sync. This is P1-blocking. Mark `# DEPRECATED: remove in v0.2.0`.

3. **Semver string compare (Phase 2)** — Use `node -e "const s=require('semver'); process.exit(s.gt(latest,installed)?0:1)"`. Add bats test matrix: `0.9.0 < 0.10.0`, `0.1.0 < 0.1.1`, `1.0.0 == 1.0.0`.

4. **Worker killed mid-scan during update (Phase 2)** — Before stopping: check `$DATA_DIR/scan.lock` or worker HTTP for `{"status":"scanning"}`; abort with user prompt if scan is in progress. Do NOT call `restart_worker_if_stale` from update — it immediately restarts the old binary.

5. **Node cold-start in PreToolUse hook (Phase 4)** — Pure bash + worker HTTP call only. No `node` subprocess in hot path. If worker is down: exit 0 silently. Benchmark requirement: p99 < 50ms.

6. **Root-path prefix false positive (Phase 4)** — Always normalize: `[[ "$FILE" == "${root_path%/}/"* ]]`. Bats fixture: repo with `services/auth/` and `services/auth-legacy/` — auth-legacy must not fire an auth warning.

---

## Implications for Roadmap

### Phase 1: Command Cleanup

**Rationale:** Pure subtraction plus config rename — zero new failure modes. Establishes the clean command surface that Phases 2–4 reference in tests and documentation.

**Delivers:** `/arcanon:cross-impact` removed; `/arcanon:sync` absorbs upload with full flag set; deprecated `/arcanon:upload` stub; `auto_upload` → `auto_sync` with two-read legacy fallback; `session-start.sh` line 114 updated.

**Files to change:** DELETE `commands/cross-impact.md`, `commands/upload.md`; REWRITE `commands/sync.md`; EDIT `worker/cli/hub.js` (lines 114, 131, 144), `worker/scan/manager.js` (lines 55, 859, 863, 867), `.claude-plugin/plugin.json` (lines 34–40), `commands/status.md`, `commands/login.md`, `scripts/session-start.sh` (line 114).

**Avoids:** Pitfall 1 (silent auto_upload break), Pitfall 2 (CI break on upload removal)

**Research flags:** Standard patterns — no deeper research needed. Line numbers confirmed in ARCHITECTURE.md.

---

### Phase 2: `/arcanon:update` Command

**Rationale:** Additive-only; cannot break existing behavior. Standalone — does not touch any file Phase 1 modified.

**Delivers:** `/arcanon:update` command with version check, confirmation prompt (default No), 2-4 CHANGELOG lines, kill-only worker stop, cache prune with `lsof` check, 10s post-update health poll, "Restart Claude Code to activate v{newver}" message.

**Files to change:** NEW `commands/update.md`, NEW `scripts/update.sh`.

**Must NOT:** call `restart_worker_if_stale` from `--kill` step (it restarts the old binary prematurely).

**Avoids:** Pitfall 3 (semver), Pitfall 4 (mid-scan kill), Pitfall 10 (offline fetch), Pitfall 11 (post-update worker failure), Pitfall 12 (CLI syntax change), Pitfall 17 (cache prune race)

**Research flags:** One open question — check `claude plugin update --help` at Phase 2 start: does it support `--yes` for non-interactive invocation?

---

### Phase 3: SessionStart Enrichment

**Rationale:** Edits `session-start.sh` which Phase 1 also touches (line 114); doing this after Phase 1 prevents a textual conflict. Three `sqlite3` calls add ~15ms; `hub.sh status` adds ~50–100ms — total overhead well within the 10s hook timeout.

**Delivers:** When `impact-map.db` exists, is < 7 days old, and worker is up: enrichment suffix "N services mapped. K load-bearing files. Last scan: date. Hub: status." Graceful fallback to existing banner on any error. Caps at ~120–200 chars.

**Files to change:** EDIT `scripts/session-start.sh` — insert stats query block after line 83, update CONTEXT assembly at line 114.

**Avoids:** Pitfall 8 (noise in non-Arcanon dirs), Pitfall 9 (large map wall of text), Pitfall 15 (context injection collision)

**Research flags:** Empirically verify that multiple hooks emitting `additionalContext` in the same `SessionStart` event are concatenated (not last-wins) before finalizing the implementation.

---

### Phase 4: PreToolUse Impact Hook

**Rationale:** Highest risk — fires on every Edit/Write. Latency regression is immediately perceptible. `hooks.json` syntax errors silently break all PreToolUse hooks. Placed last because it depends on `lib/db-path.sh` (Phase 4 creates it) and requires four empirical validations before implementation.

**Delivers:** `scripts/impact-hook.sh` with Tier 1 bash classification (`.proto`, OpenAPI filenames) + Tier 2 SQLite root_path prefix match; worker HTTP query for consumer count; `{"systemMessage": "Arcanon: N consumers: svc-a, svc-b. Run /arcanon:impact for details."}` + exit 0; self-exclusion for `$CLAUDE_PLUGIN_ROOT`; `ARCANON_IMPACT_DEBUG=1` JSONL trace log; staleness signal in warning text.

**Files to change:** NEW `scripts/impact-hook.sh`, NEW `lib/db-path.sh`; EDIT `hooks/hooks.json` (add impact-hook.sh AFTER file-guard.sh in PreToolUse array).

**Avoids:** Pitfall 5 (Node cold-start), Pitfall 6 (root-path false positive), Pitfall 7 (stale map), Pitfall 16 (hook invisible in transcripts)

**Research flags:** NEEDS pre-implementation validation on four points before writing a line of code:

1. **`additionalContext` vs `systemMessage` for PreToolUse** — Write a scratch hook and test empirically. Current evidence favors `systemMessage` (ARCHITECTURE.md Anti-Pattern 5).
2. **`db-path.sh` hash algorithm** — Read `worker/lib/data-dir.js` and copy the exact hash function. Wrong hash = hook always queries empty/wrong DB.
3. **`root_path` absolute vs relative in production DB** — Run `SELECT DISTINCT root_path FROM services LIMIT 20` on a real DB to confirm convention.
4. **`/impact` endpoint parameter** — Check `worker/server/http.js` to confirm the endpoint accepts `?change=<service_name>` before assuming that call signature.

---

### Phase Ordering Rationale

- Phase 1 first: pure subtraction, establishes clean command surface, no new failure modes
- Phase 2 second: additive-only, standalone, no file overlap with Phase 1
- Phase 3 third: edits `session-start.sh` line 114 which Phase 1 also touches — sequencing prevents textual conflict
- Phase 4 last: highest latency risk, `hooks.json` syntax risk, depends on `lib/db-path.sh`, four empirical open questions must be resolved first

### Research Flags

**Needs deeper research / empirical validation before implementation:**
- Phase 4: `additionalContext` vs `systemMessage` output format for PreToolUse (scratch hook test required)
- Phase 4: `db-path.sh` hash algorithm (read `worker/lib/data-dir.js`)
- Phase 4: `/impact` HTTP endpoint parameter signature (read `worker/server/http.js`)
- Phase 2: `claude plugin update --yes` flag existence (check `--help` at Phase 2 start)

**Standard patterns (skip research-phase):**
- Phase 1: all patterns are subtract/rename on confirmed file:line locations
- Phase 3: three `sqlite3` calls and one `hub.sh status` call — patterns already established in existing scripts

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All CLI surface verified live (`claude plugin --help`); all file paths confirmed by filesystem inspection; hook contracts verified against shipped `file-guard.sh` and `session-start.sh`; no new deps required |
| Features | HIGH | Hook mechanics verified against official Claude Code docs and confirmed bugs (GH #13339, GH #37420); anti-features are well-reasoned not speculative |
| Architecture | HIGH | Integration points specified to file:line (hub.js lines 114/131/144; manager.js lines 55/859/863/867; session-start.sh after line 83 before line 109); data flows confirmed by direct code inspection |
| Pitfalls | HIGH | Grounded in existing codebase patterns and domain knowledge with concrete numbers; Node cold-start and SQLite WAL behavior are measurable facts not estimates |

**Overall confidence: HIGH**

### Gaps to Address

Four open questions require empirical validation at Phase 4 start (none block Phase 1–3):

- **`additionalContext` vs `systemMessage` for PreToolUse** — Test with a scratch hook before implementing impact-hook.sh. Current evidence favors `systemMessage`.
- **`claude plugin update --yes` flag** — Check `claude plugin update --help` at Phase 2 start. Affects whether the reinstall step in `commands/update.md` can be automated.
- **`root_path` absolute vs relative in production DB** — Query a real DB before implementing Tier 2 classification. The defensive two-OR SQL handles both cases but confirming the convention removes uncertainty.
- **`db-path.sh` hash algorithm** — Read `worker/lib/data-dir.js` before implementing `lib/db-path.sh`. Wrong hash means hook silently queries empty DB on every invocation.

---

## Sources

### Primary (HIGH confidence — verified live against shipped code)
- `plugins/arcanon/hooks/hooks.json` — hook registration schema, matcher syntax, timeout values
- `plugins/arcanon/scripts/file-guard.sh` — PreToolUse exit code contracts, `systemMessage` output format, `ARCANON_DISABLE_GUARD` pattern
- `plugins/arcanon/scripts/session-start.sh` — `additionalContext` injection format, dedup guard, exact line numbers
- `plugins/arcanon/lib/worker-restart.sh` — worker kill semantics, PID file pattern
- `plugins/arcanon/worker/cli/hub.js` — `cmdUpload`, `cmdSync`, `auto-upload` config key at line 114
- `plugins/arcanon/worker/scan/manager.js` — `auto-upload` config key at lines 55, 859, 863, 867
- `plugins/arcanon/.claude-plugin/plugin.json` — `auto_upload` userConfig key at line 34
- `~/.claude/plugins/installed_plugins.json` — installed version path, `installPath` field structure
- Live `claude plugin --help` output (April 2026) — all plugin management commands and flags

### Secondary (HIGH confidence — official documentation)
- Claude Code Hooks Reference — PreToolUse exit codes, `permissionDecision` values, `additionalContext` 10,000-char cap
- GitHub issue #13339 — VS Code ignores `permissionDecision: "ask"` — drives Option A (warn-only) for impact hook
- GitHub issue #37420 — `permissionDecision: "ask"` resets bypass mode

---

*Research completed: 2026-04-21*
*Ready for roadmap: yes*
