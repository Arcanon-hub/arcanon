---
phase: 108-update-timeout-and-deprecated-removal
type: context
linear_tickets: [THE-1027]
requirements: [UPD-01, UPD-02, UPD-03, UPD-04, UPD-05, UPD-06, DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06]
last_updated: 2026-04-25
---

# Phase 108 — Context: Update-check Timeout Fix + `/arcanon:upload` Removal

## Domain

Two unrelated cleanups bundled into one phase because both are small, both share a "cleanup before the trust phases" theme, and both touch the bats commands-surface / scripts surface (no overlap with phase 107's install-deps work, no overlap with phases 109+ migration work). They are mechanically independent — different files, different tests — so they decompose into two parallel plans.

**Workstream A — UPD (THE-1027):** Decouple the `/arcanon:update --check` offline-decision from the 5-second `claude plugin marketplace update arcanon` refresh-process outcome. The bug today: when `claude plugin marketplace update` takes longer than 5s (slow network, throttling, big mirror diff), the script flags `OFFLINE=true` and reports `status: "offline"` — even when the mirror file is sitting on disk with a valid newer version. Users get told they're offline when in fact they have an upgrade waiting.

**Workstream B — DEP:** Remove the `/arcanon:upload` deprecated stub entirely. It was added in v0.1.1 with a v0.2.0 removal anchor. Since v0.1.2 already shipped a breaking change (LIGAMEN_* purge), one more removal in the same wave is consistent. Brought forward to v0.1.3 per zero-tolerance policy on stale deprecations.

## Decisions

- **D-01 — File-existence is the offline source of truth, not refresh-process success.** `update.sh --check` returns `status: "offline"` ONLY when `${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json` is missing. Refresh failure (timeout, transient network error, throttling) is a *staleness* signal, not an *offline* signal — the mirror file from a prior refresh is still authoritative. (Locks UPD-01..03.)

- **D-02 — Preserve the existing 5s background-timer pattern.** The timer becomes "give up *waiting* for refresh" not "give up entirely." After the timer expires, proceed regardless: read the mirror file if it exists, return `equal` / `ahead` / `newer` based on semver comparison; only return `offline` when the mirror file is genuinely absent. macOS lacks `timeout(1)` so the existing background-subshell + 25 × 0.2s polling pattern in lines 209-225 stays.

- **D-03 — `/arcanon:upload` removal brought forward from v0.2.0 to v0.1.3.** v0.1.2 already broke `LIGAMEN_*` env vars; users on v0.1.2+ have already adapted to BREAKING removals. One more removal in the same wave is consistent. CHANGELOG entry calls this out explicitly so CI scripts hardcoded to `/arcanon:upload` get a clear failure with a sync-pointer fix.

- **D-04 — Regression-guard test for re-add.** A new bats assertion that `commands/upload.md` does NOT exist guards against accidental re-add (e.g., a future cherry-pick or stash apply pulling the deprecated stub back in). This is the long-tail value of the test deletion — without the regression guard, the file could silently return.

- **D-05 — Scope of `/arcanon:upload` reference scrubbing limited to README.md + SKILL.md per REQ.** REQ DEP-04/DEP-05 explicitly scope the reference scrub to `README.md` and `plugins/arcanon/skills/impact/SKILL.md`. Other files in the repo (`docs/commands.md`, `docs/getting-started.md`, `plugins/arcanon/README.md`, `commands/login.md`, `scripts/session-start.sh`) also contain `/arcanon:upload` strings but are NOT in this phase's REQ scope — they are deferred to a follow-up cleanup phase OR will be handled organically as those files are touched in v0.1.4/v0.1.5 work. Phase 113 (VER-04) only checks for `commands/upload.md` file absence, not the verb anywhere in docs. Document this scope boundary so the executor doesn't over-scrub.

- **D-06 — CHANGELOG entry pinned to `[Unreleased]` for now, retargeted to `[0.1.3]` in Phase 113.** The CHANGELOG already has an `[Unreleased]` section. Append a `### BREAKING` subsection there for this phase's removal entry. Phase 113 (verification gate) will rename `[Unreleased]` → `[0.1.3] - 2026-04-XX` when the milestone ships. Do not invent a new top-level section in this phase.

- **D-07 — Commit prefixes.** UPD work uses `fix(108-01): ...` (bug fix). DEP work uses `refactor(108-02): ...` (cleanup, no behavior change for non-deprecated callers). REQ IDs referenced in commit message bodies as `(UPD-NN)` / `(DEP-NN)`.

## Code Context

### `scripts/update.sh` — current state (lines 197-231 are the relevant `--check` mode block)

```bash
# ─── --check mode ───────────────────────────────────────────────────────────
# 1. Read installed version (prefer plugin.json, fallback package.json)
INSTALLED_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || true)
...

# 2. Refresh marketplace with 5s cap (REQ UPD-11 — Pitfall 10)
#    Uses background-subshell+timer because timeout(1) is not on macOS by default.
MARKETPLACE_DIR="${HOME}/.claude/plugins/marketplaces/arcanon"
OFFLINE=false
{
  (claude plugin marketplace update arcanon >/dev/null 2>&1) &
  refresh_pid=$!
  elapsed=0
  while kill -0 "$refresh_pid" 2>/dev/null; do
    sleep 0.2
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge 25 ]]; then  # 25 * 0.2s = 5s
      kill -TERM "$refresh_pid" 2>/dev/null || true
      sleep 0.1
      kill -KILL "$refresh_pid" 2>/dev/null || true
      OFFLINE=true            # ← BUG: this conflates timeout with offline
      break
    fi
  done
  wait "$refresh_pid" 2>/dev/null || true
} 2>/dev/null

if [[ "$OFFLINE" == "true" ]] || [[ ! -f "${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json" ]]; then
  # ← BUG: short-circuits to offline even when the mirror file is present
  printf '{"status":"offline","installed":"%s","remote":null,...}\n' "$INSTALLED_VER"
  exit 0
fi
```

**The fix:** stop setting `OFFLINE=true` on timeout (the timer becomes informational only; rename the variable to `REFRESH_TIMED_OUT` or drop it). The single offline gate becomes file-existence:

```bash
if [[ ! -f "${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json" ]]; then
  printf '{"status":"offline",...}\n' "$INSTALLED_VER"
  exit 0
fi
```

The existing semver comparison (lines 234-257) is correct and reusable as-is — no changes needed below the offline gate.

### `tests/commands-surface.bats` — current line ranges

```
Lines  1-7:   Header comment
Lines  8-10:  setup() — sets PLUGIN_DIR
Lines 12-19:  CLN-09 test 1: all 7 surviving command files exist  (KEEP)
Lines 21-27:  CLN-09 test 2: all 7 commands have description frontmatter  (KEEP)
Lines 29-31:  CLN-01 test: cross-impact.md removed  (KEEP — same regression-guard pattern)
Lines 33-38:  CLN-05 test 1: upload.md exists as deprecated stub  (DELETE — DEP-02)
Lines 40-43:  CLN-05 test 2: upload.md description starts with [DEPRECATED]  (DELETE — DEP-02)
Lines 45-48:  CLN-05 test 3: upload.md emits stderr deprecation warning  (DELETE — DEP-02)
Lines 50-53:  CLN-05 test 4: upload.md forwards args to hub.sh upload  (DELETE — DEP-02)
Lines 55-58:  CLN-05 test 5: upload.md carries v0.2.0 removal anchor  (DELETE — DEP-02)
Lines 60-68:  CLN-03 test: sync.md advertises --drain, --repo, --dry-run, --force  (KEEP)
Lines 70-77:  CLN-04 test: sync.md default behaviour documents upload-then-drain  (KEEP)
```

The 5 CLN-05 tests are the contiguous block at lines 33-58. Replace the block with a single new regression-guard test (DEP-03 pattern): `@test "DEP-03: /arcanon:upload command file has been removed" { [ ! -f "$PLUGIN_DIR/commands/upload.md" ]; }`.

The 7-command list in lines 13-14 and 22-23 (`for cmd in map drift impact sync login status export`) does NOT include `upload` — it was already excluded when the deprecation stub was added. No update needed there.

### `README.md` — current `/arcanon:upload` references (line numbers exact)

- **Line 40** (Quick start code block): `/arcanon:upload           # push the latest scan`
- **Line 54** (Commands table): `| `/arcanon:upload` | Upload the latest scan to the hub. |`

DEP-04 fix:
- **Line 40:** delete this line entirely. The Quick start flow becomes: `/arcanon:login` → `/arcanon:status`. (Hub upload is implicit in `/arcanon:sync` and the post-scan auto-sync; no manual `upload` step needed in a quick-start.)
- **Line 54:** delete this row. `/arcanon:sync` (line 55) is the canonical verb and remains.

### `plugins/arcanon/skills/impact/SKILL.md` — `/arcanon:upload` references

Verified clean (`grep -n 'arcanon:upload' plugins/arcanon/skills/impact/SKILL.md` returns no matches as of 2026-04-25). DEP-05 reduces to a verification step: re-grep and confirm no references; if any are found, scrub them. Likely a no-op edit.

### `plugins/arcanon/CHANGELOG.md` — current state (line 7-8)

```markdown
## [Unreleased]

## [0.1.2] - 2026-04-24
```

The `[Unreleased]` section is empty as of 2026-04-25. DEP-06 adds:

```markdown
## [Unreleased]

### BREAKING

- Removed `/arcanon:upload` deprecated stub. Use `/arcanon:sync` (canonical since v0.1.1). CI scripts hardcoded to `/arcanon:upload` will fail with "command not found"; migrate to `/arcanon:sync`.
```

Phase 113 will pin `[Unreleased]` → `[0.1.3] - 2026-04-XX` when the milestone ships. Do not pre-emptively rename in this phase.

## Out-of-scope `/arcanon:upload` references (DO NOT TOUCH in Phase 108)

These files contain `/arcanon:upload` references but are NOT in the REQ DEP-04/DEP-05 scope:

| File | Line(s) | Defer reason |
|---|---|---|
| `docs/commands.md` | 33, 75, 118 | Doc cleanup pass — out of REQ scope; still references the deprecated verb in walkthroughs that haven't been refreshed |
| `docs/getting-started.md` | 30 | Same — doc walkthrough mentions upload command |
| `plugins/arcanon/README.md` | 24 | Plugin-internal README still lists `/arcanon:upload` in commands list |
| `plugins/arcanon/commands/login.md` | 38, 46 | login.md uses `/arcanon:upload` as the canonical "validate-key" call; needs reword to `/arcanon:sync` but is its own change |
| `plugins/arcanon/scripts/session-start.sh` | 208 | Session banner CONTEXT line lists `/arcanon:upload` in the command list — banner regen work |

These are intentionally left for a follow-up cleanup phase or organic touch in v0.1.4/v0.1.5 work. Phase 113 (VER-04) only verifies `commands/upload.md` file absence, not the verb in arbitrary docs. **Do not over-scrub** — the executor must stop at the REQ-named files.

## Specifics

- **Mirror file path** (used in two REQs and three places): `${HOME}/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json`. The path is already constructed as `${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json` in `update.sh`. Re-use the existing variable; do not re-derive.
- **The 5s timer must remain.** Do not remove it — slow refresh in the foreground would hold up the user-visible `/arcanon:update --check` call. The fix is to make the timer informational ("we waited 5s, refresh didn't finish, proceeding anyway") instead of decisional ("we waited 5s, declaring offline").
- **Bats fixture for slow-refresh simulation.** Use a per-test PATH override + a stub `claude` script that `sleep 10` then exits 0. The existing bats suite has fixture patterns in `tests/bats-helpers.sh` (or similar — check) for stubbing `claude` invocations. Pattern: `export PATH="$BATS_TEST_TMPDIR/stubs:$PATH"; cat > "$BATS_TEST_TMPDIR/stubs/claude" <<'EOF'; #!/bin/sh; sleep 10; EOF; chmod +x "$BATS_TEST_TMPDIR/stubs/claude"`.
- **Bats fixture for mirror file presence.** Set `HOME=$BATS_TEST_TMPDIR` and pre-create `${HOME}/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json` with a known version string (e.g., `{"version": "0.1.4"}` for "newer" tests, `{"version": "0.1.3"}` for "equal" tests).
- **No worker / no MCP touch.** This phase is shell + bats + markdown only. No node code changes, no migrations, no MCP tool registrations. Two plans, both shell + tests + docs.

## Test Strategy

- **UPD plan (108-01):** 3 new bats tests (UPD-04, UPD-05, UPD-06) covering the three states: slow-refresh + mirror present + remote ahead → `newer` (the bug-fix case); missing mirror dir → `offline` (the regression guard); mirror present + same version → `equal` regardless of refresh outcome. Tests use `HOME` override + stub `claude` binary.
- **DEP plan (108-02):** 1 new regression-guard bats test (DEP-03) asserting `commands/upload.md` absence; deletion of 5 CLN-05 tests (DEP-02). Plus implicit verification that the existing CLN-09 / CLN-03 / CLN-04 tests still pass after the surrounding edits.
- **Both plans run the full bats suite at task close.** No bats test outside this phase's scope should regress.

## Linear / GitHub references

- Linear ticket: THE-1027 (Update-check timeout fix) — covers UPD-01..06
- DEP work: scope addition to v0.1.3 (no Linear ticket; tracked via REQ DEP-01..06 in REQUIREMENTS.md)
- No GitHub issues currently filed for these — both are internal scope additions discovered during v0.1.3 planning

## Why two plans, parallel

Plans 108-01 (UPD) and 108-02 (DEP) touch entirely disjoint file sets:

| Plan | Files modified |
|---|---|
| 108-01 | `plugins/arcanon/scripts/update.sh`, `tests/update-check.bats` (new) |
| 108-02 | `plugins/arcanon/commands/upload.md` (delete), `tests/commands-surface.bats`, `README.md`, `plugins/arcanon/CHANGELOG.md`, `plugins/arcanon/skills/impact/SKILL.md` (verify-only) |

Zero file overlap → both run in Wave 1 with `depends_on: []`. The executor can dispatch them concurrently or sequentially with no merge conflict.
