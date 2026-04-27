---
phase: 121-integration-consumption-layer
plan: 03
subsystem: drift-openapi
tags: [INT-10, drift, openapi, bats, e2e, explicit-spec]
requires:
  - "Phase 120 (ships /arcanon:drift openapi --spec flag in drift-common.sh + drift-openapi.sh)"
  - "yq (or oasdiff) installed for OpenAPI structural comparison"
provides:
  - "INT-10 happy-path E2E coverage: /arcanon:drift openapi --spec A --spec B detects User.name -> User.full_name rename and exits 0"
  - "Realistic OpenAPI 3.0 test fixtures with a one-field breaking-change delta (4 path-level diffs via yq fallback)"
  - "Control test that proves the explicit-spec code path is exercised (not auto-discovery)"
affects:
  - tests/drift-openapi-explicit-spec.bats (appended 4 tests; 5 prior INT-04 tests preserved)
  - plugins/arcanon/CHANGELOG.md (Unreleased / Added entry)
  - plugins/arcanon/tests/fixtures/externals/openapi-spec-a.yaml (NEW)
  - plugins/arcanon/tests/fixtures/externals/openapi-spec-b.yaml (NEW)
tech-stack:
  added: []
  patterns:
    - "Tolerant substring match for tool-version-portable assertions: same test green under both oasdiff (rich diff) and yq (path-level structural diff)"
    - "Control test pinned alongside happy-path tests to prove the right code branch ran (deflects 'always-green' false confidence)"
    - "Public dispatcher invocation (drift.sh openapi) instead of direct script (drift-openapi.sh): exercises real user-facing entry-point including the dispatcher routing layer"
key-files:
  created:
    - plugins/arcanon/tests/fixtures/externals/openapi-spec-a.yaml
    - plugins/arcanon/tests/fixtures/externals/openapi-spec-b.yaml
  modified:
    - tests/drift-openapi-explicit-spec.bats
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Tolerant substring match (drift|differ|break|incompatible|rename|full_name) — wording differs between oasdiff and the yq fallback, both are valid in production. A strict match would over-couple the test to oasdiff's exact phrasing."
  - "Control test pinned in to prove tests 1-3 exercise the explicit-spec path. Without it, a future regression that silently routes --spec through auto-discovery could still pass tests 1-3 by coincidence (both fixtures live alongside other fixtures yq might find)."
  - "Public dispatcher (drift.sh openapi) used as the test's command surface, not direct invocation of drift-openapi.sh. Matches what /arcanon:drift openapi resolves to and ensures the dispatcher routing for 'openapi' is also covered."
  - "Append rather than replace: the existing tests/drift-openapi-explicit-spec.bats already shipped 5 INT-04 tests in Phase 120-02. Appending 4 INT-10 tests preserves the negative-path coverage (exit 2 on missing file, exit 2 on single --spec) instead of regressing to a smaller test set. Plan author wrote the file as if it didn't exist; this is the correct integration."
metrics:
  tasks: 2
  duration: "~10 minutes"
  commits:
    - "81ad3e8 (Task 1 — fixtures)"
    - "6504feb (Task 2 — bats + CHANGELOG)"
  tests-added: 4
  tests-total-in-file: 9
  files-changed: 4
completed: 2026-04-27
---

# Phase 121 Plan 03: INT-10 OpenAPI Drift E2E Test Summary

One-liner: Lands the bats happy-path E2E for `/arcanon:drift openapi --spec A --spec B` with two real OpenAPI 3.0 fixtures whose `User` schema differs by one breaking field rename (`name` → `full_name`), proving Phase 120's explicit-spec entry point detects the drift end-to-end through the public dispatcher.

## Goal

Validate Phase 120's `--spec` flag implementation against realistic OpenAPI input — not just the negative paths Phase 120's own bats file covers (which is mostly arg-validation: missing files, single-spec rejections). INT-10 is the consumer-side proof that the feature actually detects a real backward-incompatible API change.

## Truths Validated

1. `/arcanon:drift openapi --spec specA --spec specB` exits 0 when given two valid spec paths (Test 6).
2. The output reports the rename — substring match against `openapi` AND one of `drift|differ|break|incompatible|rename|full_name` (Test 7). On this machine without oasdiff installed, the yq fallback emits `[ WARN  ] openapi-spec ... Structural differences found (4 paths differ)` — both required substrings present.
3. The discovery code path is bypassed (Test 8 — output never contains "Fewer than 2 repos have OpenAPI specs", which is what discovery emits when nothing is found).
4. Control: without `--spec`, in an empty dir with no linked-repos config, the auto-discovery path runs and reports no specs (Test 9). This guarantees Tests 6-8 are NOT trivially passing through the discovery branch.
5. Phase 120's INT-04 negative-path tests (5 of them) all still pass — no regression to the existing arg-validation coverage.

## Artifacts Created

### Fixtures (`plugins/arcanon/tests/fixtures/externals/`)

- **`openapi-spec-a.yaml`** — Baseline OpenAPI 3.0.3 spec. `GET /users` returns `User[]` with `User = {id: int64, name: string}`, both fields required.
- **`openapi-spec-b.yaml`** — Drifted spec. Identical to spec-a EXCEPT the `User.name` field is renamed to `User.full_name` (in both the `properties` map and the `required` list). This is a backward-incompatible client break — clients reading `user.name` will see `undefined` after this change ships.

### Bats tests (`tests/drift-openapi-explicit-spec.bats`)

4 tests appended after the existing 5 INT-04 tests. All 9 tests green.

| # | Test | Asserts |
|---|---|---|
| 6 | INT-10 exit code | `drift.sh openapi --spec A --spec B` exits 0 |
| 7 | INT-10 drift-detect | output mentions openapi AND a difference signal |
| 8 | INT-10 bypass proof | output does NOT contain "Fewer than 2 repos..." |
| 9 | INT-10 control | without `--spec`, the no-spec discovery message appears |

## Files Modified

| File | Change |
|---|---|
| `tests/drift-openapi-explicit-spec.bats` | +71 lines (4 new tests + INT-10 fixture path constants + comment header amendment) |
| `plugins/arcanon/CHANGELOG.md` | +1 line under `## [Unreleased] / ### Added` referencing INT-10 |

## Tests Added

4 bats tests, all using the **public dispatcher** `plugins/arcanon/scripts/drift.sh openapi` (matches `/arcanon:drift openapi` slash-command surface).

Test 7 uses tolerant substring matching:
```bash
[[ "$output" == *openapi* ]] && \
  ([[ "$output" == *drift* ]] || [[ "$output" == *differ* ]] || \
   [[ "$output" == *break* ]] || [[ "$output" == *incompatible* ]] || \
   [[ "$output" == *rename* ]] || [[ "$output" == *full_name* ]])
```
This handles two valid output paths:
- **oasdiff installed:** emits structured diff including `breaking` and field names like `full_name`.
- **yq fallback only (this machine):** emits `[ WARN  ] openapi-spec ... Structural differences found (4 paths differ)` — matches `openapi` + `differ`.

## Decisions

1. **Tolerant substring match.** Two production code paths (oasdiff + yq fallback) produce different wording. The plan-spec'd alternation list (`drift|differ|break|incompatible|rename|full_name`) covers both with no over-fitting to either tool's exact phrasing. A strict match against oasdiff output would silently fail in environments without oasdiff (CI included if not provisioned).

2. **Control test (Test 9) pinned in.** Without it, a future regression that silently routes `--spec` through the auto-discovery branch (e.g. `parse_drift_args` failing to populate `EXPLICIT_SPECS`) could still pass Tests 6-8 if discovery happened to find compatible fixtures. The control proves discovery's emit signature (`Fewer than 2 repos have OpenAPI specs` or non-zero status) and Tests 6-8's output are mutually exclusive — so the bypass branch must be the one running.

3. **Public dispatcher (`drift.sh openapi`) used in INT-10 tests.** Phase 120's INT-04 tests invoke `drift-openapi.sh` directly (lower-level, also valid). INT-10 deliberately tests one level higher — through `drift.sh` — to also cover the dispatcher's `openapi)` case branch. If the dispatcher ever drops or renames `openapi`, INT-10 tests fail loudly.

4. **Append, not replace.** The plan was written assuming `tests/drift-openapi-explicit-spec.bats` did not exist, but Phase 120-02 already shipped it with 5 INT-04 tests covering negative paths (exit-2 on missing file, exit-2 on single `--spec`). Replacing would have regressed that coverage. Appending preserves both layers — INT-04 (arg validation) + INT-10 (real-world drift detection) — in one file.

## Open Items

None. INT-10 is a single-test plan and all success criteria are met.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Existing bats file with INT-04 tests would have been overwritten**

- **Found during:** Task 2 (preparing to write `tests/drift-openapi-explicit-spec.bats`).
- **Issue:** Plan instructed `Create tests/drift-openapi-explicit-spec.bats`. The file already existed (Phase 120-02 shipped 5 INT-04 tests in it). A literal `Write` would have destroyed the prior coverage.
- **Fix:** Appended the 4 new INT-10 tests to the existing file (with a comment-header divider explaining the file now contains both INT-04 + INT-10 coverage). Renamed test descriptors with `INT-10:` and `INT-10 control:` prefixes to keep the suite navigable. Used distinct local-scope variable names (`DRIFT_SH_DISPATCHER`, `INT10_SPEC_A`, `INT10_SPEC_B`) to avoid colliding with the existing INT-04 setup variables (`DRIFT_OPENAPI`, `SPEC_A`, `SPEC_B`).
- **Files modified:** `tests/drift-openapi-explicit-spec.bats`
- **Commit:** `6504feb`
- **Result:** All 9 tests in the file pass (5 INT-04 preserved + 4 INT-10 new).

**2. [Rule 3 - Blocker] Plan-spec'd Test 4 wording assumed dispatcher emits "no specs found"; actual emission is "Fewer than 2 repos have OpenAPI specs"**

- **Found during:** Task 2 verification (smoke-test of the dispatcher in an empty tmpdir).
- **Issue:** Plan's Test 2.3 asserted `output != *"no openapi specs found"*` and `output != *"No OpenAPI spec found"*`. Inspection of `drift-openapi.sh:146` showed the actual no-specs message is `"Fewer than 2 repos have OpenAPI specs — nothing to compare."` So the plan's negative assertion would always pass (vacuously) because neither plan-spec'd substring is ever emitted by the script. The bypass test would not actually catch a bypass-failure regression.
- **Fix:** Substituted the real no-specs string. INT-10 Test 8 now asserts `output != *"Fewer than 2 repos have OpenAPI specs"*`, which is the actual signal that the discovery path ran. The control test (Test 9) confirms this string IS produced when discovery runs — closing the proof loop.
- **Files modified:** `tests/drift-openapi-explicit-spec.bats`
- **Commit:** `6504feb`

### Scope confirmations (no deviation)

- Plan was test-only (no production code touched). Confirmed: zero changes under `plugins/arcanon/scripts/`, `plugins/arcanon/worker/`, or `plugins/arcanon/lib/`.
- Phase 120's INT-04 tests (5 of them) and the unrelated drift bats suites (`drift-dispatcher.bats`, `drift-versions.bats`, `drift-types.bats` — 48 tests total) pass unchanged.
- No CLAUDE.md `gitnexus_impact` run for this plan: changes are test fixtures + bats file (not Node symbols indexed by gitnexus); no functions extended, renamed, or refactored.

## Self-Check: PASSED

- `plugins/arcanon/tests/fixtures/externals/openapi-spec-a.yaml`: FOUND
- `plugins/arcanon/tests/fixtures/externals/openapi-spec-b.yaml`: FOUND
- `tests/drift-openapi-explicit-spec.bats`: FOUND, contains `INT-10:` test descriptors
- `plugins/arcanon/CHANGELOG.md`: FOUND, contains "INT-10" entry under `[Unreleased]` / `### Added`
- Commit `81ad3e8` (Task 1 — fixtures): FOUND
- Commit `6504feb` (Task 2 — bats + CHANGELOG): FOUND
- Bats execution: 9/9 green (5 INT-04 + 4 INT-10)
- Regression: 48/48 green across drift-dispatcher.bats, drift-versions.bats, drift-types.bats
