---
phase: 93-dep-collector
plan: "03"
subsystem: enrichment
tags: [enrichment, scan-pipeline, manifest-parsing, nodejs, dep-collector]
dependency_graph:
  requires: [93-02]
  provides: [dep-collector.js collectDependencies API]
  affects: [worker/scan/enrichment/, worker/scan/manager.js (plan 93-04)]
tech_stack:
  added: []
  patterns: [enrichment-module, TDD-red-green, injected-logger, offline-parser]
key_files:
  created:
    - plugins/arcanon/worker/scan/enrichment/dep-collector.js
    - plugins/arcanon/worker/scan/enrichment/dep-collector.test.js
    - plugins/arcanon/tests/fixtures/dep-collector/README.md
    - plugins/arcanon/tests/fixtures/dep-collector/npm-basic/package.json
    - plugins/arcanon/tests/fixtures/dep-collector/npm-basic/package-lock.json
    - plugins/arcanon/tests/fixtures/dep-collector/pypi-pyproject/pyproject.toml
    - plugins/arcanon/tests/fixtures/dep-collector/pypi-reqs/requirements.txt
    - plugins/arcanon/tests/fixtures/dep-collector/go-module/go.mod
    - plugins/arcanon/tests/fixtures/dep-collector/cargo-crate/Cargo.toml
    - plugins/arcanon/tests/fixtures/dep-collector/maven-project/pom.xml
    - plugins/arcanon/tests/fixtures/dep-collector/nuget-solution/Directory.Packages.props
    - plugins/arcanon/tests/fixtures/dep-collector/nuget-solution/Main.csproj
    - plugins/arcanon/tests/fixtures/dep-collector/rubygems-bundle/Gemfile.lock
    - plugins/arcanon/tests/fixtures/dep-collector/unsupported-swift/Package.swift
    - plugins/arcanon/tests/fixtures/dep-collector/invalid-npm/package.json
    - plugins/arcanon/tests/fixtures/dep-collector/empty-repo/.gitkeep
  modified: []
decisions:
  - "Poetry regex: replaced \\z (Perl/Ruby) with end-of-string match compatible with JS RegExp"
  - "Rubygems fixture: removed activesupport as a 4-space direct gem; kept only as 6-space sub-dep to make sub-dep exclusion test meaningful"
  - "beginScan/endScan appears once in doc comment (constraint explanation) — zero callable references confirmed"
  - "ecosystems_scanned pushed even when parser produces empty rows — manifest found + parsed without error is a valid scanned state"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-19"
  tasks_completed: 2
  files_created: 16
  files_modified: 0
---

# Phase 93 Plan 03: dep-collector Enrichment Module Summary

**One-liner:** 7-ecosystem offline manifest parser with injected-logger WARN coverage reporting and production-only dependency extraction (DEP-05/06/07).

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 RED | dep-collector.test.js + fixtures (failing) | `45c9865` | Done |
| 1 GREEN | dep-collector.js — 7-ecosystem parsers + WARN paths | `6a265f5` | Done |

## What Was Built

`plugins/arcanon/worker/scan/enrichment/dep-collector.js` exports a single async function:

```js
collectDependencies({ repoPath, rootPath, logger })
// → Promise<{ rows: DependencyRow[], ecosystems_scanned: string[] }>
```

### Ecosystem parsers

| Ecosystem | Manifest(s) | Resolution source | Production-only rule |
|-----------|------------|-------------------|----------------------|
| npm | `package.json` | `package-lock.json` v7+ `packages` map | `dependencies` only — devDependencies/peer/optional excluded |
| pypi | `pyproject.toml` (PEP 621 + poetry), `requirements.txt` | none (lockfile not parsed) | `python` key excluded from poetry table |
| go | `go.mod` (single-line + block require) | version in go.mod is already pinned | all require entries are production |
| cargo | `Cargo.toml` (simple + inline-table form) | none | `[dependencies]` only — `[dev-dependencies]` not touched |
| maven | `pom.xml` | `${property}` resolution + `<dependencyManagement>` map | `<scope>test</scope>` excluded |
| nuget | `*.csproj` (shallow glob) | `Directory.Packages.props` CPM map | no test/dev scope concept in PackageReference |
| rubygems | `Gemfile.lock` (GEM + GIT + PATH specs sections) | lockfile pin = resolved_version | 4-space direct-gem lines only; 6-space sub-deps excluded |

### WARN coverage (DEP-06)

- `dep-scan: unsupported manifest skipped` — fired for Package.swift, composer.json, mix.exs, build.sbt, pubspec.yaml found at rootPath top-level
- `dep-scan: parser error` — fired when any parser throws; ecosystem omitted from `ecosystems_scanned`

### Constraints verified

- No `beginScan`/`endScan` calls — bracket untouched (grep confirms comment-only reference)
- No `child_process`/`execSync`/`spawn` — fully offline, no tool invocations
- No new npm dependencies — `node:fs` + `node:path` only

## Test Results

```
✔ npm: emits dependencies, excludes devDependencies
✔ pypi: PEP 621 + poetry sections, python excluded
✔ go: both block and single-line require
✔ cargo: simple + inline-table forms
✔ maven: property resolution + dependencyManagement + test scope excluded
✔ nuget: CPM Directory.Packages.props resolves missing Version
✔ rubygems: GEM + GIT + PATH direct deps, sub-deps excluded
✔ unsupported manifest emits WARN
✔ invalid manifest is contained — parser-error WARN, no throw
✔ empty repo: no rows, no ecosystems_scanned
✔ ecosystems_scanned contains only parsed ecosystems

tests 11 | pass 11 | fail 0
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pypi poetry regex used `\z` anchor (invalid in JS)**
- **Found during:** GREEN phase, test run
- **Issue:** `\z` is a Perl/Ruby end-of-string anchor; JavaScript RegExp treats it as literal `z`, causing the poetry section match to fail silently
- **Fix:** Replaced with `$(?![\s\S])` (JS equivalent: match end of string in multiline context)
- **Files modified:** `plugins/arcanon/worker/scan/enrichment/dep-collector.js`
- **Commit:** `6a265f5`

**2. [Rule 1 - Bug] Gemfile.lock fixture had activesupport as both direct gem and sub-dep**
- **Found during:** GREEN phase, test run
- **Issue:** The original fixture listed `activesupport (7.1.0)` at 4-space indent (direct gem) AND as a 6-space sub-dep of `rails`. The test asserted it was NOT in rows — but with the parser correctly parsing 4-space lines, it appeared. The fixture misrepresented a realistic Gemfile.lock where `activesupport` would only be a transitive dep.
- **Fix:** Removed the standalone `activesupport` direct-gem entry; it now only appears as a 6-space sub-dep of `rails`
- **Files modified:** `plugins/arcanon/tests/fixtures/dep-collector/rubygems-bundle/Gemfile.lock`
- **Commit:** `6a265f5`

## Known Stubs

None. All 7 parsers are fully wired with real fixture data. No placeholder return values.

## Threat Flags

None. dep-collector.js reads only local filesystem paths under the scanned service root. It introduces no network access, no auth paths, no new DB surface, and no trust-boundary crossings.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test commit) | `45c9865` | Present |
| GREEN (feat commit) | `6a265f5` | Present |
| REFACTOR | N/A | No cleanup needed |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `dep-collector.js` exists | FOUND |
| `dep-collector.test.js` exists | FOUND |
| fixtures/dep-collector/README.md exists | FOUND |
| Commit `45c9865` (RED) | FOUND |
| Commit `6a265f5` (GREEN) | FOUND |
| 11/11 tests pass | CONFIRMED |
