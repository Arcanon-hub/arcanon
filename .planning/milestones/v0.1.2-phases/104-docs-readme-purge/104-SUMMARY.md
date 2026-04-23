---
phase: 104-docs-readme-purge
status: complete
completed_at: 2026-04-23
requirements_covered: [DOC-01, DOC-02, DOC-03, README-01, README-02, README-03]
commits: [afd6ab6, 52d2131, cb4e569]
files_modified: 5
---

# Phase 104 Docs & README Purge — Summary

One-liner: swept every user-facing ligamen reference out of `README.md`,
`plugins/arcanon/CHANGELOG.md`, `plugins/arcanon/commands/drift.md`,
`plugins/arcanon/commands/status.md`, and
`plugins/arcanon/skills/impact/SKILL.md`, and added a comprehensive
`### BREAKING` subsection to the `[Unreleased]` CHANGELOG entry
documenting the Phase 101 runtime removals with migration instructions.

## Requirements

| Req | Status | Commit |
|---|---|---|
| DOC-01 | done | cb4e569 |
| DOC-02 | done | cb4e569 |
| DOC-03 | done | 52d2131 |
| README-01 | done | afd6ab6 |
| README-02 | done | afd6ab6 |
| README-03 | done | afd6ab6 |

## Files Modified

- `README.md` — 3 edits (1 paragraph sentence deletion, 1 full section
  deletion, 1 paragraph replacement).
- `plugins/arcanon/CHANGELOG.md` — added `### BREAKING` subsection under
  `[Unreleased]`; rewrote the "Notes on prior versions" paragraph to drop
  the now-false back-compat claim. `[0.1.0] Pre-release fixes` section
  preserved verbatim.
- `plugins/arcanon/commands/drift.md` — renamed `$LIGAMEN_ARGS` → `$ARCANON_ARGS` (3 occurrences).
- `plugins/arcanon/commands/status.md` — dropped 3 legacy-fallback mentions
  (config file, data dir, diagnostic call-out).
- `plugins/arcanon/skills/impact/SKILL.md` — renamed `LIGAMEN_CHROMA_MODE`,
  `LIGAMEN_CHROMA_HOST`, `LIGAMEN_CHROMA_PORT` → `ARCANON_CHROMA_*` in the
  example `~/.arcanon/settings.json` block (fixes user-reported
  inconsistency where the skill documented env var names that the runtime
  no longer reads).

## Commits

| Hash | Message |
|---|---|
| afd6ab6 | refactor(104): purge ligamen refs from README (README-01..03) |
| 52d2131 | docs(104): add BREAKING section to CHANGELOG for v0.1.2 (DOC-03) |
| cb4e569 | refactor(104): rename ligamen → arcanon in command + skill docs (DOC-01, DOC-02) |

## CHANGELOG BREAKING Content

The `### BREAKING` subsection under `[Unreleased]` documents five removals:

1. All `LIGAMEN_*` env var reads (worker, lib, scripts) — recognize only `ARCANON_*` names.
2. `$HOME/.ligamen/` data-dir fallback — resolve state exclusively under `$HOME/.arcanon/`.
3. `ligamen.config.json` config reader — read `arcanon.config.json` only.
4. ChromaDB `COLLECTION_NAME` rename `"ligamen-impact"` → `"arcanon-impact"` (orphans existing collections; rebuild via `/arcanon:map`).
5. `runtime-deps.json` package identity rename `@ligamen/runtime-deps` → `@arcanon/runtime-deps`.

Migration instructions cover renaming the config file, the data dir, and
any shell-profile env vars.

## Deviations from Plan

**1. Removed `### Fixed` duplicate insertion under `[Unreleased]`.**
The plan prompt described "option B: prepend `### BREAKING` subsection
to `[Unreleased]` above the existing `### Fixed`." On inspection, the
existing `### Fixed` block was under `[0.1.1]`, not `[Unreleased]`
(`[Unreleased]` was empty). My initial edit duplicated that `### Fixed`
block under `[Unreleased]`; I corrected this in the same edit session
by removing the duplicate so the `session-start.sh` fix is not listed
twice. Net result: `[Unreleased]` contains only the new `### BREAKING`
block and `[0.1.1]` retains its original `### Fixed`. (Rule 1 — bug.)

**2. Rewrote "Notes on prior versions" CHANGELOG paragraph.**
Original text claimed legacy `~/.ligamen/` data dirs and `LIGAMEN_*`
env vars "are still read for back-compat" — this became factually false
after Phase 101 removed those reads. To satisfy the plan's verification
gate (`grep -ni "ligamen" plugins/arcanon/CHANGELOG.md | grep -v "0.1.0] Pre-release"  # should be 0`)
the paragraph was rewritten to drop the rebrand-history wording and the
false back-compat claim while preserving the version-reset context.
(Rule 2 — auto-corrected missing accuracy requirement.)

**3. Deleted `status.md` "legacy data dir in use" diagnostic line.**
The diagnostic call-out referenced a condition (legacy data dir in use)
that can no longer occur after Phase 101 — there is no code path that
detects legacy dirs. Left in place it would document behaviour the
runtime cannot produce. Removed per Rule 2 (keep docs accurate).

## Verification

See `104-VERIFICATION.md` for full gate results. All three grep gates pass.

## Self-Check: PASSED

- `README.md` exists, 0 ligamen refs.
- `plugins/arcanon/CHANGELOG.md` exists, ligamen refs confined to the
  intentional `### BREAKING` block (lines 11–37).
- `plugins/arcanon/commands/drift.md`, `status.md`, and
  `skills/impact/SKILL.md` exist, 0 ligamen refs each.
- Commits `afd6ab6`, `52d2131`, `cb4e569` exist in `git log`.
