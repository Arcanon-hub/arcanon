---
phase: 49-directory-restructure
plan: 01
subsystem: infra
tags: [git, directory-restructure, marketplace, plugins]

# Dependency graph
requires: []
provides:
  - plugins/ligamen/ directory with all plugin source (commands, hooks, scripts, worker, lib, skills, .claude-plugin)
  - package.json, package-lock.json, ligamen.config.json.example moved to plugins/ligamen/
  - Root cleaned of all plugin source directories
  - .gitignore updated to track plugins/ directory
affects:
  - 50-path-updates — all hardcoded paths referencing scripts/, lib/, hooks/, etc. must be updated to plugins/ligamen/

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plugin source lives under plugins/ligamen/ — required for claude plugin marketplace add distribution model"
    - "git mv used for all moves to preserve file history across the rename"

key-files:
  created:
    - plugins/ligamen/commands/cross-impact.md
    - plugins/ligamen/commands/drift.md
    - plugins/ligamen/commands/map.md
    - plugins/ligamen/commands/quality-gate.md
    - plugins/ligamen/hooks/hooks.json
    - plugins/ligamen/hooks/lint.json
    - plugins/ligamen/scripts/ (all scripts)
    - plugins/ligamen/lib/ (all lib files)
    - plugins/ligamen/worker/ (all worker files)
    - plugins/ligamen/skills/ (impact, quality-gate)
    - plugins/ligamen/.claude-plugin/plugin.json
    - plugins/ligamen/.claude-plugin/marketplace.json
    - plugins/ligamen/package.json
    - plugins/ligamen/package-lock.json
    - plugins/ligamen/ligamen.config.json.example
  modified:
    - .gitignore — removed plugins/ exclusion so git tracks the new directory

key-decisions:
  - "Removed plugins/ from .gitignore before running git mv — required so git does not ignore the destination directory"
  - "Used git mv for all moves to preserve history — files show as renamed not deleted+added"
  - "node_modules/ left at root (gitignored, not relevant to git history)"

patterns-established:
  - "All plugin source now canonical at plugins/ligamen/ — Phase 50 path updates must reflect this"

requirements-completed: [STR-01, STR-02]

# Metrics
duration: 10min
completed: 2026-03-21
---

# Phase 49 Plan 01: Directory Restructure Summary

**All plugin source moved from repo root into plugins/ligamen/ via history-preserving git mv — root now contains only repo-level files**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-21T00:00:00Z
- **Completed:** 2026-03-21
- **Tasks:** 1 of 2 (Task 2 is checkpoint awaiting human verification)
- **Files modified:** 96 files renamed

## Accomplishments

- Removed `plugins/` from `.gitignore` so the destination directory is tracked by git
- Moved all 10 plugin source directories/files via `git mv` (commands/, hooks/, scripts/, worker/, lib/, skills/, .claude-plugin/, package.json, package-lock.json, ligamen.config.json.example)
- Repository root is now clean — contains only README.md, LICENSE, Makefile, docs/, tests/, .planning/, .mcp.json, and dotfiles
- Git history preserved — `git log --follow plugins/ligamen/hooks/hooks.json` shows commits predating this move

## Task Commits

Each task was committed atomically:

1. **Task 1: Create plugins/ligamen/ and move all plugin source via git mv** - `d262407` (feat)

**Plan metadata:** TBD after checkpoint approval

## Files Created/Modified

- `plugins/ligamen/commands/` - All 4 command markdown files (cross-impact, drift, map, quality-gate)
- `plugins/ligamen/hooks/` - hooks.json and lint.json
- `plugins/ligamen/scripts/` - 11 shell scripts (drift-common, drift-openapi, drift-types, drift-versions, file-guard, format, impact, lint, mcp-wrapper, session-start, worker-start, worker-stop)
- `plugins/ligamen/lib/` - config.sh, detect.sh, linked-repos.sh, worker-client.sh
- `plugins/ligamen/worker/` - index.js, db/, server/, ui/
- `plugins/ligamen/skills/` - impact/SKILL.md, quality-gate/SKILL.md
- `plugins/ligamen/.claude-plugin/` - marketplace.json, plugin.json
- `plugins/ligamen/package.json` - Node package manifest
- `plugins/ligamen/package-lock.json` - Lock file
- `plugins/ligamen/ligamen.config.json.example` - Config example
- `.gitignore` - Removed `plugins/` exclusion line

## Decisions Made

- Removed `plugins/` from `.gitignore` before any git mv commands — this was the critical prerequisite since git would otherwise ignore the destination
- Used `git mv` (not shell `mv`) to preserve file rename history in git log
- Did not move `node_modules/` — it is gitignored and irrelevant to git history

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — all git mv commands succeeded cleanly. All three automated verification checks passed:
- ROOT CLEAN: pass
- DEST EXISTS: pass
- HISTORY PRESERVED: pass

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `plugins/ligamen/` is fully populated and git-tracked — Phase 50 (path updates) can proceed
- All hardcoded paths in Makefile, scripts, and plugin config files will need updating to reflect the new `plugins/ligamen/` prefix
- Awaiting human verification checkpoint (Task 2) before marking plan complete

---
*Phase: 49-directory-restructure*
*Completed: 2026-03-21*
