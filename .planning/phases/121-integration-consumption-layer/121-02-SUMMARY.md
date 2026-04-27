---
phase: 121-integration-consumption-layer
plan: 02
subsystem: integration-consumption-layer
tags: [int-07, int-08, int-09, externals, user-extension, list, graph-ui]
requirements_completed: [INT-07, INT-08, INT-09]
dependency_graph:
  requires:
    - "Plan 121-01: loadShippedCatalog/matchActor/runActorLabeling/migration 018/getGraph().actors[].label"
    - "Phase 114-01: /arcanon:list cmdList + tests/list.bats fixture"
    - "worker/lib/config-path.js resolveConfigPath() (existing)"
  provides:
    - "loadUserExtensions(projectRoot, logger) — reads arcanon.config.json#external_labels"
    - "loadMergedCatalog(projectRoot, logger) — shipped + user merge; user wins on collision"
    - "/arcanon:list inline label rendering (human + JSON modes)"
    - "Graph UI canvas + detail-panel label rendering"
    - "tests/externals-labels.bats — 3-test E2E suite for user merge round-trip"
    - "seed.js --actors-named-csv flag + seed-actors.js wrapper"
  affects:
    - "scan pipeline (manager.js): single-call seam swapped from loadShippedCatalog -> loadMergedCatalog"
    - "/graph endpoint consumers (frontend, /arcanon:list): no shape change — still actors[].label"
tech_stack:
  added: []
  patterns:
    - "in-memory Map merge with user-wins-on-collision; shipped Map is never mutated (fresh `new Map(shipped.entries)` then `merged.set` user keys)"
    - "shipped catalog file integrity proven by sha256 before/after assertion (Test 1.7 + bats Test 3)"
    - "graceful-degradation JSON: actors array always present (empty when zero actors)"
    - "label-or-name display fallback at both UI canvas and CLI list — single field source"
key_files:
  created:
    - "plugins/arcanon/worker/scan/enrichment/externals-catalog.user-merge.test.js (9 unit tests)"
    - "plugins/arcanon/tests/fixtures/externals/seed-actors.js (thin wrapper around list seeder)"
    - "tests/externals-labels.bats (3 E2E tests)"
  modified:
    - "plugins/arcanon/worker/scan/enrichment/externals-catalog.js (+loadUserExtensions, +loadMergedCatalog)"
    - "plugins/arcanon/worker/scan/manager.js (loadShippedCatalog -> loadMergedCatalog)"
    - "plugins/arcanon/worker/cli/hub.js (cmdList: actorsArr capture, JSON+human label rendering)"
    - "plugins/arcanon/worker/ui/graph.js (synthetic actor node uses label || name)"
    - "plugins/arcanon/worker/ui/modules/detail-panel.js (heading = label, raw subtitle when distinct)"
    - "plugins/arcanon/tests/fixtures/list/seed.js (mig 017+018, --with-labels/--with-many-labels/--no-actors/--actors-named-csv flags)"
    - "plugins/arcanon/tests/fixtures/list/seed.sh (forwards arbitrary flags to seed.js)"
    - "tests/list.bats (4 new INT-08 tests; 7 existing untouched)"
    - "plugins/arcanon/CHANGELOG.md (INT-07 + INT-08 entries under [Unreleased])"
decisions:
  - "loadMergedCatalog is a SINGLE-CALL SEAM at scanRepos head — manager.js was changed in exactly one place (the catalog load), so future swaps (e.g., remote catalog merge) only touch that line."
  - "Inline label list in /arcanon:list with 5-cap + +N more, NOT a separate --actors flag (per RESEARCH §7 decision; matches the existing 5-line overview spec)."
  - "Shipped YAML byte-integrity asserted at TWO levels — node Test 1.7 (in-process) and bats Test 3 (out-of-process via shasum). The merge is a fresh Map clone + user .set; never touches the shipped file or the cached shipped Map."
  - "Graph UI canvas renders actor.label || actor.name at the synthetic-node creation site (graph.js:166) so the renderer + search filter (which both walk node.name) need no further changes — users searching for 'Stripe' find the labeled Stripe actor."
  - "Detail panel shows the raw URL as a small subtitle ONLY when actor.label !== actor.name. When label is null OR identical to the name, the original NAV-01 single-h3 layout is preserved."
  - "Worker is per-project, so process.cwd() at scanRepos is the project root for the user-config lookup. No new arg-threading through the manager.js call chain."
  - "User config user-extension is re-read on EVERY scanRepos call (not module-cached), so arcanon.config.json edits take effect on the next /arcanon:map without a worker restart. The shipped portion remains module-cached (the YAML is large + ship-only, restart on edit is fine)."
  - "seed-actors.js is a thin wrapper around the canonical list seeder, NOT a duplicate. One source of truth for migration application + repo/service/scan scaffolding. Wrapper exists to satisfy the plan's artifact-naming expectation and to give bats a semantic verb."
metrics:
  duration: ~24 minutes (planning load -> final commit)
  tasks_completed: 5 / 5
  files_created: 3
  files_modified: 9
  tests_added: 9 (node user-merge) + 4 (list.bats INT-08) + 3 (externals-labels.bats) = 16 net new
  tests_passing:
    node_plan_scope: 37 / 37
    bats_plan_scope: 36 / 36 (list.bats 11 + externals-labels.bats 3 + commands-surface.bats 22)
  completed_date: 2026-04-25
---

# Phase 121 Plan 02: User extension + label surfacing (INT-07/INT-08/INT-09) Summary

The consumption layer of the externals catalog ships. Users can extend the shipped catalog via `arcanon.config.json#external_labels` (user wins on collision; shipped YAML never mutated). `/arcanon:list` renders inline labels in human mode (`Actors: 4 external (Stripe API, GitHub API, ...)`) and a structured `actors` array in JSON mode. The graph UI canvas displays the friendly label with the raw URL as a small subtitle in the detail panel. 16 net-new tests; 37 node + 36 bats green.

## Goal

Build the consumption-side glue Plan 121-01's data layer needs:

1. User extension via `arcanon.config.json#external_labels` (INT-07).
2. `/arcanon:list` and graph UI render labels instead of raw URLs (INT-08).
3. Tests cover merge logic + label round-trip end-to-end (INT-09).

This plan does NOT add schema or migrations — it consumes what 121-01 ships.

## Truths Validated

| Truth | Test |
| ----- | ---- |
| Missing `arcanon.config.json` → empty user catalog, no throw | node Test 1.1 |
| Config without `external_labels` key → empty user catalog | node Test 1.2 |
| Valid `external_labels` → normalized via same pipeline as shipped | node Test 1.3 |
| Malformed user entries → WARN + skip, valid entries still load | node Test 1.4 |
| Merge with no overlap → entries.size = shipped + user | node Test 1.5 |
| User wins on key collision (Stripe override) | node Test 1.6, bats Test 2 |
| **Shipped YAML file is byte-identical before/after merge** | node Test 1.7, **bats Test 3** |
| Missing config → merge returns shipped unchanged | node Test 1.8 |
| Malformed JSON → WARN + return shipped (no throw) | node Test 1.9 |
| `/arcanon:list` human mode shows `Actors: N external (label1, ...)` | bats Test 8 |
| `/arcanon:list --json` includes `actors` array of `{name, label}` | bats Test 9 |
| Inline list truncates at 5 with `+N more` suffix | bats Test 10 |
| Zero actors → bare `0 external` line, no parenthetical | bats Test 11 |
| User-only entry labels its actor end-to-end via /graph | bats Test 1 |
| User wins on collision via /graph round-trip | bats Test 2 |

## Artifacts Created

| Path | Purpose |
|------|---------|
| `plugins/arcanon/worker/scan/enrichment/externals-catalog.user-merge.test.js` | 9 unit tests for loadUserExtensions + loadMergedCatalog |
| `plugins/arcanon/tests/fixtures/externals/seed-actors.js` | Thin wrapper exposing bare-actors mode under externals fixture path |
| `tests/externals-labels.bats` | 3-test E2E suite — user merge + /graph round-trip + YAML integrity |

## Files Modified

| File | Change | Reason |
| ---- | ------ | ------ |
| `plugins/arcanon/worker/scan/enrichment/externals-catalog.js` | +69 LOC: `loadUserExtensions`, `loadMergedCatalog`, `resolveConfigPath` import | INT-07 user merge surface |
| `plugins/arcanon/worker/scan/manager.js` | Import + call site: `loadShippedCatalog` → `loadMergedCatalog(process.cwd(), _logger)` | Single-call seam swap |
| `plugins/arcanon/worker/cli/hub.js` | `cmdList`: `actorsArr` capture + JSON `actors` field + human inline list with 5-cap | INT-08 list label display |
| `plugins/arcanon/worker/ui/graph.js` | Synthetic actor node: `name = actor.label \|\| actor.name`; `raw_name` preserved | INT-08 canvas label |
| `plugins/arcanon/worker/ui/modules/detail-panel.js` | `<h3>` = label; new subtle subtitle for raw name when distinct | INT-08 detail panel |
| `plugins/arcanon/tests/fixtures/list/seed.js` | Migrations 017+018 applied; flags `--with-labels`, `--with-many-labels`, `--no-actors`, `--actors-named-csv` | Test infrastructure for INT-08 + INT-09 |
| `plugins/arcanon/tests/fixtures/list/seed.sh` | Forwards arbitrary flags untouched (loosens 3-arg cap) | Pass-through for new flags |
| `tests/list.bats` | +4 INT-08 tests (8-11); existing 1-7 untouched | INT-08 happy paths + truncation + zero-actors |
| `plugins/arcanon/CHANGELOG.md` | INT-07 + INT-08 entries under `[Unreleased] / ### Added` | Keep-a-Changelog discipline |

## Tests Added

| Suite | Tests |
|-------|-------|
| `externals-catalog.user-merge.test.js` (node) | 9 |
| `tests/list.bats` INT-08 additions | 4 |
| `tests/externals-labels.bats` (bats) | 3 |
| **Total** | **16 net new tests** |

Plan-scope verification (all green):

```bash
# Node:
cd plugins/arcanon && node --test \
  worker/scan/enrichment/externals-catalog.test.js \
  worker/scan/enrichment/externals-catalog.user-merge.test.js \
  worker/scan/enrichment/actor-labeler.test.js \
  worker/db/migration-018.test.js \
  worker/db/query-engine-actors-label.test.js
# tests 37 / pass 37 / fail 0

# Bats:
bats tests/list.bats tests/externals-labels.bats tests/commands-surface.bats
# 36 / 36 pass
```

## Decisions Made

See frontmatter `decisions:` for the canonical list. The two non-obvious ones:

1. **Single-call seam at scanRepos head**: `manager.js` swap is exactly one line — `loadShippedCatalog(undefined, _logger)` → `loadMergedCatalog(process.cwd(), _logger)`. The user-extension load is hidden inside `loadMergedCatalog`. Future swaps (remote catalog merge, dynamic reload, etc.) only touch this line.

2. **User-extension re-read every scan, shipped portion module-cached**: the shipped YAML is large and ship-only, so caching is correct (restart worker on edit is acceptable). The user config is small and project-local, so re-reading per scan means edits land on the next `/arcanon:map` without a worker restart. Asymmetric caching matches the asymmetric edit cadence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] _run_label_pass helper hardcoded repo_id=1 → matched 0 actors**
- **Found during:** Task 5 (first run of externals-labels.bats Tests 1+2)
- **Issue:** The bats helper called `runActorLabeling(1, db, ...)` but the seed's actor_connections links the seeded actor to a service in repo_id=2 (services are distributed across 3 repos via `i % 3`). The labeler's `WHERE s.repo_id = ?` JOIN found zero matches.
- **Fix:** Changed `_run_label_pass` to enumerate ALL repos via `SELECT id FROM repos` and run the labeler per repo. Mirrors what manager.js does in production (per-repo loop). Aggregate `{matched, considered}` returned for diagnostic clarity.
- **Files modified:** `tests/externals-labels.bats`
- **Commit:** `3acfea5`

## Threat Surface Coverage

The plan's `<threat_model>` register (T-121-02-01..07) is fully addressed by tests + code patterns:

| Threat | Mitigation | Evidence |
| ------ | ---------- | -------- |
| T-121-02-01 (User config JSON parse) | try/catch in `loadUserExtensions`; returns empty + WARN | Test 1.9 |
| T-121-02-02 (User entry validation) | Reuses `normalizeCatalog` — same skip-with-WARN posture | Test 1.4 |
| T-121-02-03 (User host pattern XSS) | Hosts pass through `matchHost` regex; non-host chars don't match | (passive — no exploit demo needed) |
| T-121-02-04 (User label content in UI) | `escapeHtml()` preserved at every interpolation site | detail-panel.js code review |
| T-121-02-05 (Shipped YAML mutation) | Fresh `new Map(shipped.entries)` + user `.set` | Test 1.7 + bats Test 3 (sha256) |
| T-121-02-06 (name vs label confusion) | Detail panel shows BOTH when distinct | Code review |
| T-121-02-07 (User overrides 1000s of entries) | Merge is O(shipped + user) Map ops | (no benchmark needed — trivial cost) |

## Open Items

None — INT-07, INT-08, INT-09 fully covered by this plan.

Cross-plan handoff to **Plan 121-03** (last in Phase 121):

- 121-03 ships `/arcanon:drift openapi --spec X --spec Y` happy-path bats test (INT-10).
- No code from 121-02 is required by 121-03 — they touch disjoint surfaces (drift vs. externals).
- The `tests/fixtures/externals/` directory is now established (`seed-actors.js` lives there); 121-03 may add `spec-a.yaml` / `spec-b.yaml` fixtures alongside it without conflict.

## Self-Check: PASSED

- [x] FOUND: `plugins/arcanon/worker/scan/enrichment/externals-catalog.user-merge.test.js`
- [x] FOUND: `plugins/arcanon/tests/fixtures/externals/seed-actors.js`
- [x] FOUND: `tests/externals-labels.bats`
- [x] FOUND commit `4fd9e17` (Task 1 RED)
- [x] FOUND commit `fb1f1d5` (Task 1 GREEN)
- [x] FOUND commit `d7e1a2c` (Task 2 manager.js wire-in)
- [x] FOUND commit `0f25d7a` (Task 3 RED)
- [x] FOUND commit `f4ecce4` (Task 3 GREEN)
- [x] FOUND commit `bb038d1` (Task 4 UI changes)
- [x] FOUND commit `3acfea5` (Task 5 E2E bats)
- [x] All 37 node plan-scope tests pass
- [x] All 36 bats plan-scope tests pass
- [x] Shipped YAML byte-integrity proven at two levels (in-process + out-of-process)
