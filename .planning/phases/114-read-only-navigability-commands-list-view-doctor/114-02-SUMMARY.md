---
phase: 114-read-only-navigability-commands-list-view-doctor
plan: 02
subsystem: arcanon-plugin / cli
tags: [nav-02, read-only, command-surface, navigability, graph-ui]
requirements_completed: [NAV-02]
dependency_graph:
  requires:
    - "plugins/arcanon/lib/worker-client.sh worker_running (existing — no edits)"
    - "plugins/arcanon/scripts/worker-start.sh (existing — no edits)"
    - "Claude Code filename-based slash-command resolution (host runtime)"
  provides:
    - "plugins/arcanon/commands/view.md — top-level /arcanon:view slash command"
    - "tests/commands-surface.bats NAV-02 regression suite (3 new @test blocks)"
  affects:
    - "tests/commands-surface.bats iteration list — extended from 10 to 11 commands (added `view`); 114-03 will append `doctor` additively"
tech_stack:
  added: []
  patterns:
    - "filename-based slash-command resolution (cited from RESEARCH §2)"
    - "negative-regression test for absent symbol — guards future contributors against re-adding a phantom Node handler"
key_files:
  created:
    - "plugins/arcanon/commands/view.md (slash-command markdown wrapper, 60 lines)"
  modified:
    - "tests/commands-surface.bats (iteration list +view; +3 NAV-02 @test blocks)"
    - "plugins/arcanon/CHANGELOG.md (Added entry under [Unreleased])"
decisions:
  - "NO Node handler in worker/cli/hub.js. RESEARCH §2 dispatch-precedence finding (verbatim above) confirmed Claude Code resolves slash commands by exact filename — adding cmdView would create a phantom dispatch ambiguity the v0.1.3 audit warned about. Negative regression test is the contract."
  - "Worker-start block cloned VERBATIM from map.md:22-32, including the 2-3s cold-start cost. RESEARCH §7 Q4 recommended matching map.md exactly; doing so means the existing /arcanon:map view UX and the new /arcanon:view UX are identical, making the alias truthful."
  - "Iteration list in tests/commands-surface.bats extended additively (10 → 11 commands). Same single-token edit pattern 114-01 used. 114-03 will append `doctor` the same way — no merge friction."
  - "CHANGELOG entry under [Unreleased] with no version pin — Phase 122 owns the v0.1.4 cut and will demote [Unreleased] then."
metrics:
  duration: "~10 minutes of execution work (wall clock 116 min including a side-quest where I accidentally fanned out three parallel bats invocations and had to pkill them)"
  tasks_completed: 1 / 1
  files_created: 1
  files_modified: 2
  tests_added: 3 (NAV-02 regression block in commands-surface.bats)
  tests_passing: 10 / 10 (bats tests/commands-surface.bats)
  full_suite: 325 / 326 (sole failure is pre-existing macOS HOK-06 p99 latency — documented platform constraint in STATE.md, not a regression)
  completed_date: 2026-04-26
---

# Phase 114 Plan 02: `/arcanon:view` (NAV-02) Summary

`/arcanon:view` ships — a top-level slash-command alias for the graph UI launcher previously hidden under `/arcanon:map view`. Pure markdown command; no Node handler; no router collision. The existing `/arcanon:map view` keystroke is preserved.

## Goal

NAV-02: new users discover the graph UI without needing to know the `view` subcommand. The smallest plan in Phase 114 by a wide margin — one new markdown file, one additive iteration-list extension, three regression tests, one CHANGELOG line.

## Truths Validated

| Truth | How |
| ----- | --- |
| Typing `/arcanon:view` resolves to `commands/view.md` (not `commands/map.md`) | Filename-based resolution per RESEARCH §2 — `commands/view.md` exists; the host runtime matches by filename. The bats test asserts the file exists with frontmatter + worker-start body. |
| `view.md` auto-starts the worker if it is not running, then opens the graph UI in the user's default browser | `grep -q 'worker-start.sh' commands/view.md` (Test "NAV-02: /arcanon:view exists with frontmatter and worker-start block"). The block is cloned verbatim from `map.md:22-32`. |
| `view.md` does NOT add `view: cmdView` to `worker/cli/hub.js` HANDLERS | `! grep -q 'view: cmdView' worker/cli/hub.js` (Test "NAV-02: worker/cli/hub.js does NOT register a view handler"). |
| `/arcanon:map view` continues to work — the existing inline branch in `map.md` is untouched | `grep -q 'If \`view\` flag' commands/map.md` (Test "NAV-02: /arcanon:map still contains the inline 'If \`view\` flag' block"). `git diff` confirms `commands/map.md` is unchanged in this commit. |

## Artifacts Created

- **`plugins/arcanon/commands/view.md`** (60 lines). Frontmatter (`description`, `argument-hint: ""`, `allowed-tools: Bash`) + body containing the cloned worker-start + browser-open bash block from `map.md:22-32` plus a `## When to use`, `## Usage`, `## Read-only guarantee`, and `## See also` section.

## Files Modified

| File | Change | Reason |
| ---- | ------ | ------ |
| `tests/commands-surface.bats` | Iteration list `for cmd in ...` extended `list` → `list view` (in two places, both `@test` blocks); +3 new `@test` blocks for NAV-02 | NIT 8 (additive surface coverage) + the three NAV-02 contracts: file-exists+frontmatter+body, map.md preservation, hub.js negative regression. |
| `plugins/arcanon/CHANGELOG.md` | `### Added` line under `[Unreleased]` for `/arcanon:view` | Keep-a-Changelog discipline. Phase 122 owns the v0.1.4 version cut. |

## Tests Added

| # | Test | Asserts |
| --- | ---- | ------- |
| 1 | NAV-02: `/arcanon:view` exists with frontmatter and worker-start block | File exists, has `description:` and `allowed-tools: Bash`, body contains literal `worker-start.sh`, body does NOT contain `bash hub.sh view` (no Node handler invoked). |
| 2 | NAV-02: `/arcanon:map` still contains the inline ``If `view` flag`` block | Regression guard for the existing `/arcanon:map view` keystroke. |
| 3 | NAV-02: `worker/cli/hub.js` does NOT register a view handler | Defensive negative — guards future contributors from re-adding a phantom `view: cmdView` HANDLERS entry. |

Plus the iteration list in the two pre-existing `CLN-09` tests now covers `view` (was 10 commands, now 11).

`bats tests/commands-surface.bats` → 10/10 green. (Note: the @test count is 10, not 11 — the new "view exists" test consolidates frontmatter checks into a single block; the iteration-list extension reused the existing CLN-09 loops rather than adding new ones.)

`bats tests/` (full suite) → 325/326. The single failure is `impact-hook HOK-06: p99 latency < 50ms over 100 iterations` — a documented macOS platform constraint already in `STATE.md` "Blockers/Concerns". CI uses `IMPACT_HOOK_LATENCY_THRESHOLD=100` to mask this; the local-machine result is not a regression introduced by this plan.

## Decisions

1. **NO Node handler ships.** Quoting RESEARCH §2 verbatim so a future maintainer does not re-litigate this:

   > Claude Code resolves slash commands by exact filename match against `commands/<name>.md`.
   > The "subcommand" `/arcanon:map view` is not a separate dispatched route — it is inline narrative
   > inside `map.md` that Claude interprets via `$ARGUMENTS`.
   >
   > Evidence:
   > 1. `commands/map.md:21` reads `## If \`view\` flag: ...` — markdown heading, not a dispatcher.
   > 2. There is NO grep hit for `case.*\$ARGUMENTS|switch.*subcommand|\$1.*view` against `map.md`.
   > 3. `scripts/hub.sh` does not know about `view`. `worker/cli/hub.js HANDLERS` does not have a `view` key.
   > 4. Today, typing `/arcanon:view <anything>` returns "command not found" — there is no `commands/view.md`.
   >
   > When `commands/view.md` is added, Claude Code resolves `/arcanon:view` to that file directly.
   > `commands/map.md` is never consulted for `/arcanon:view`. The user's existing keystroke
   > `/arcanon:map view` continues to work (still resolves to `map.md`).

   The defensive negative regression test (`! grep -q 'view: cmdView' worker/cli/hub.js`) is the contract that prevents a future contributor from accidentally creating the dispatch ambiguity the v0.1.3 audit warned about.

2. **Worker-start block cloned VERBATIM from `map.md:22-32`** (RESEARCH §7 Q4). The 2-3s cold-start cost is identical to the existing `/arcanon:map view` UX, which makes the alias truthful — both keystrokes have the same side effects.

3. **Iteration list extended additively** in `tests/commands-surface.bats` (10 → 11 commands). Same single-token edit pattern 114-01 used; 114-03 will append `doctor` the same way. No coordination friction.

4. **CHANGELOG entry under `[Unreleased]` with no version pin.** Phase 122 owns the v0.1.4 cut and will demote `[Unreleased]` to `[0.1.4] - YYYY-MM-DD` then.

## Open Items

None. Plan 114-02 is fully landed and verified.

Cross-plan handoff for 114-03 (`/arcanon:doctor`):

- 114-03 should append `doctor` to the iteration lists in `tests/commands-surface.bats` `CLN-09` `@test` blocks (same single-token edit). Final list will be `map drift impact sync login status export verify update list view doctor` (12 commands).
- 114-03 owns its own Node handler (`cmdDoctor` in `hub.js`) per RESEARCH §4 — orthogonal to this plan's "no Node handler" stance.

## Threat Flags

None. This plan introduces no new HTTP routes, no new auth surface, no new file access patterns, no new schema. The browser-open `xdg-open|open "http://localhost:${PORT}"` reads `~/.arcanon/worker.port` (worker-managed file, local FS); the only new attack-surface consideration is the dispatch-precedence one that the negative regression test mitigates.

## Self-Check: PASSED

- File created on disk:
  - `plugins/arcanon/commands/view.md` — FOUND
- Commit present in `git log --oneline --all`:
  - `51b4cc9` (feat(114-02): /arcanon:view top-level command (NAV-02)) — FOUND
- Key landmarks verified:
  - `commands/view.md` contains `worker-start.sh` substring (auto-start block present)
  - `commands/view.md` does NOT contain `bash hub.sh view` (no Node handler invoked)
  - `commands/map.md` still contains ``If `view` flag`` (existing route preserved — file unchanged in this commit)
  - `worker/cli/hub.js` HANDLERS map does NOT contain `view: cmdView` (file unchanged in this commit; defensive test passes)
- `bats tests/commands-surface.bats` → 10/10 green.
- `bats tests/` → 325/326 (sole failure is pre-existing macOS HOK-06 platform constraint, not introduced by this plan).
