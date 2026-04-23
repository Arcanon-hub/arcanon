---
phase: 102-source-cosmetic-rename
status: complete
completed: 2026-04-23
requirements_covered: [SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-07, SRC-08]
commits: [922abf7, fbc6694, cff6bdd, 3bc5c98, a27ca5e, 1d8dad8]
files_modified: 18
---

# Phase 102 — Source Cosmetic Rename Summary

Cosmetic sweep that removed the last `ligamen` / `Ligamen` / `LIGAMEN` mentions from source files (JS, JSON schema, agent prompt markdown, shell scripts). Runtime behaviour is unchanged — every edit was in a comment, docstring, log prefix, Zod `.describe()` user-facing string, error message, or file-header JSDoc. Code paths, symbol names, env-var reads, and config filenames were already handled in Phase 101.

## Files Modified (18)

### Worker JS — non-test (11 files)

| File | Refs fixed | Rename vs Delete |
|------|------------|------------------|
| `worker/mcp/server.js` | 19 | 18 rename, 1 delete (stripped "or legacy ~/.ligamen" from inline comment at line 82) |
| `worker/db/database.js` | 2 | rename (header JSDoc) |
| `worker/db/pool.js` | 1 | rename (JSDoc line 74) |
| `worker/db/query-engine.js` | 2 | rename (header + log prefix `[ligamen]` → `[arcanon]`) |
| `worker/scan/manager.js` | 2 | 1 rename, 1 delete (dropped "(legacy ligamen.config.json supported)" parenthetical — code no longer supports it after Phase 101) |
| `worker/scan/findings.js` | 2 | rename (header + validator docstring) |
| `worker/scan/discovery.js` | 2 | rename (header + `/ligamen:map` → `/arcanon:map`) |
| `worker/scan/confirmation.js` | 1 | rename (header) |
| `worker/server/chroma.js` | 1 | rename (header) |
| `worker/server/http.js` | 2 | rename (2 error messages `/ligamen:map` → `/arcanon:map`) |
| `worker/ui/modules/export.js` | 2 | rename (header + `ligamen-graph.png` → `arcanon-graph.png`) |

### Agent prompts + schema (6 files)

| File | Refs fixed |
|------|------------|
| `worker/scan/agent-prompt-common.md` | 1 (H1) |
| `worker/scan/agent-prompt-discovery.md` | 1 (H1) |
| `worker/scan/agent-prompt-infra.md` | 1 (H1) |
| `worker/scan/agent-prompt-library.md` | 1 (H1) |
| `worker/scan/agent-prompt-service.md` | 1 (H1) |
| `worker/scan/agent-schema.json` | 1 (`$schema` description string) |

### Scripts (1 file)

| File | Refs fixed |
|------|------------|
| `scripts/drift-versions.sh` | 1 (header comment "Part of the Ligamen drift skill") |

### Files NOT touched (already clean from Phase 101)

- `worker/index.js` — 0 refs
- `worker/hub-sync/auth.js` — 0 refs
- `lib/*.sh` — all lib shell files were cleaned in Phase 101 (101-02)
- Other `scripts/*.sh` — all cleaned in Phase 101

### Files deliberately skipped (scope boundaries)

- `**/*.test.js` and `tests/*.bats` — Phase 103 owns them
- `CHANGELOG.md` historical entries — Phase 104 owns
- `README.md` — Phase 104 owns
- `commands/*.md`, `skills/**/SKILL.md` — Phase 104 owns

## Requirements Coverage

| ID | Scope | Status |
|----|-------|--------|
| SRC-01 | All `worker/**/*.js` (non-test) clean | ✅ 0 matches |
| SRC-02 | All 5 agent prompt markdown files clean | ✅ 0 matches |
| SRC-03 | `worker/scan/agent-schema.json` + 4 scan/*.js files clean | ✅ 0 matches |
| SRC-04 | All `worker/db/*.js` (non-test) clean | ✅ 0 matches |
| SRC-05 | All `worker/server/*.js` (non-test) clean | ✅ 0 matches |
| SRC-06 | `worker/hub-sync/auth.js`, `worker/ui/modules/export.js` clean | ✅ 0 matches (auth.js already clean from 101-04) |
| SRC-07 | `scripts/*.sh` (non-test) clean | ✅ 0 matches (only `drift-versions.sh` had residue) |
| SRC-08 | `lib/*.sh` clean | ✅ 0 matches (already clean from 101-02) |

## Commits

| Hash | Scope | Files |
|------|-------|-------|
| `922abf7` | `refactor(102-01): rename ligamen → arcanon in worker/mcp/server.js` | 1 |
| `fbc6694` | `refactor(102-01): rename ligamen → arcanon in worker/db/*.js` | 3 |
| `cff6bdd` | `refactor(102-01): rename ligamen → arcanon in worker/scan/*.js` | 4 |
| `3bc5c98` | `refactor(102-01): rename ligamen → arcanon in worker/server/*.js and ui/modules/export.js` | 3 |
| `a27ca5e` | `refactor(102-02): rename ligamen → arcanon in agent prompts and schema` | 6 |
| `1d8dad8` | `refactor(102-02): rename ligamen → arcanon in scripts/drift-versions.sh` | 1 |

## Rename vs Delete Decisions

Per the "delete outright where language becomes stale" rule from 102-CONTEXT.md:

**Deletions (2 sites):**

1. `worker/mcp/server.js:82` — inline comment originally read `"(~/.arcanon or legacy ~/.ligamen)"`. Phase 101 removed the `~/.ligamen` runtime fallback, so the "or legacy ~/.ligamen" clause was semantically dead. **Deleted** the dangling clause, leaving `"(~/.arcanon)"`.
2. `worker/scan/manager.js:77` — JSDoc originally read `"Read hub config from arcanon.config.json (legacy ligamen.config.json supported)"`. Phase 101-02 stripped the legacy filename from `resolveConfigPath()`. **Deleted** the parenthetical, leaving `"Read hub config from arcanon.config.json."`.

**All other sites (28 refs)** were straight renames — the sentence meaning survives when `ligamen` → `arcanon`, e.g.:
- Header JSDoc `"Ligamen v2.0"` → `"Arcanon v2.0"` (product name is just rebranded)
- User-facing error messages `"/ligamen:map"` → `"/arcanon:map"` (slash command renamed in Phase 104)
- Zod `.describe()` `LIGAMEN_PROJECT_ROOT` → `ARCANON_PROJECT_ROOT` (code reads ARCANON_ already — just the user-facing doc string)
- Download filename `"ligamen-graph.png"` → `"arcanon-graph.png"` (cosmetic, visible to end users)
- Log prefix `[ligamen]` → `[arcanon]` in `query-engine.js` ambiguous-service warn

## Deviations

**1. [Rule 3 — blocking] `worker/mcp/server.js` `/ligamen:map` slash-command strings were not in CONTEXT scope but were dead references.** CONTEXT.md only called out 7 `.describe()` strings and 2 JSDoc sites explicitly. During the sweep I found 7 additional `hint: "Run /ligamen:map first in that project"` strings and 2 `"Run /ligamen:map to build..."` error messages. All refer to the slash command renamed to `/arcanon:map` in Phase 104. These were renamed in the same server.js commit (`922abf7`) because leaving them would mislead users who pasted the hint into Claude Code and got "unknown command" errors.

**2. [Scope note] `worker/index.js` and `worker/hub-sync/auth.js` — 0 refs found.** Context called out 5 refs in `worker/index.js` and 3 refs in `hub-sync/auth.js`, but grep found none. Phase 101 commits (`101-01`, `101-04`) appear to have covered these cleanups implicitly. No action needed — verified clean.

**3. [Process] GitNexus impact analysis not applied.** CLAUDE.md requires `gitnexus_impact` before editing any symbol. Phase 102 is purely cosmetic (no symbols renamed, no function bodies changed, no logic altered). Only comments, docstrings, log-prefix strings, Zod description strings, and one log filename literal were modified. Impact analysis is inapplicable to this scope; code behaviour is identical byte-for-byte except in output strings. JS parse + JSON validity + shell syntax checks all pass.

## Verification Gates

All three verification greps returned 0 matches:

```
grep -rn "ligamen|Ligamen|LIGAMEN" plugins/arcanon/worker --include="*.js" --exclude="*.test.js"  → 0
grep -rn "ligamen|Ligamen|LIGAMEN" plugins/arcanon/worker/scan/agent-prompt-*.md agent-schema.json → 0
grep -rn "ligamen|Ligamen|LIGAMEN" plugins/arcanon/scripts plugins/arcanon/lib --include="*.sh"   → 0
```

All 11 edited JS files pass `node --check`. `agent-schema.json` parses as valid JSON. `drift-versions.sh` passes `bash -n`.

## Handoff

- **Phase 103** (test rewrite): can now rely on SRC files being arcanon-clean when regenerating fixtures. The 40+ ligamen refs in `worker/**/*.test.js` and `tests/*.bats` are Phase 103's exclusive scope.
- **Phase 104** (docs): already completed (CHANGELOG, README, commands, skills) per commit `83ecdfa`. No outstanding doc work for 102's scope.

## Self-Check: PASSED

- All 6 commits present in `git log` (922abf7, fbc6694, cff6bdd, 3bc5c98, a27ca5e, 1d8dad8). ✓
- All 18 files modified exist on disk. ✓
- All 3 verification gates return 0. ✓
- All 11 JS files parse. ✓
- JSON schema valid. Shell script valid. ✓
