#!/usr/bin/env bats
# tests/shadow-scan.bats — Phase 119-01 (SHADOW-01).
#
# End-to-end coverage of /arcanon:shadow-scan and the underlying
# getShadowQueryEngine() pool helper. Pairs with the rescan/verify pattern:
# real worker, real on-disk fixtures, real shell wrapper.
#
# Test 1-6 cover Task 1 (getShadowQueryEngine) — pure node smoke harnesses,
# no worker needed.
# Test 7-13 cover Task 2 (POST /scan-shadow + cmdShadowScan + slash command)
# — spawn the worker on port 37995 with ARCANON_TEST_AGENT_RUNNER=1.
#
# Hard constraints from PLAN 119-01:
#   - Live impact-map.db MUST be byte-identical before/after a shadow scan
#     (Test 8 — sha256 assertion).
#   - Shadow data MUST NEVER upload to hub (skipHubSync flag — guarded by the
#     route's options.skipHubSync=true and verified indirectly: Test 8's
#     byte-identity assertion would fail if hub upload mutated state).

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
PLUGIN_ROOT="${REPO_ROOT}/plugins/arcanon"
SEED_SH="${PLUGIN_ROOT}/tests/fixtures/shadow/seed.sh"

# ---------------------------------------------------------------------------
# Helpers (kept local — ZERO additions to test_helper.bash)
# ---------------------------------------------------------------------------
# This file used to also drive POST /scan-shadow against a real worker with
# ARCANON_TEST_AGENT_RUNNER=1 installed; that route + stub were deleted along
# with /api/rescan when the rescan/shadow-scan flows were re-architected as
# markdown-orchestrated commands (Claude Code agent-runtime lives on the host,
# not inside the worker). The remaining tests cover only Task 1 — the
# getShadowQueryEngine() pool helper, which is still exercised directly by the
# new commands/shadow-scan.md persistence step.

# Compute sha256(input)[0:12] — matches plugins/arcanon/worker/db/pool.js's
# projectHashDir(). Must match exactly or the helper won't find the DB.
_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

setup() {
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"
  HASH="$(_arcanon_project_hash "$PROJECT_ROOT")"
  PROJECT_DIR="$ARC_DATA_DIR/projects/$HASH"
  LIVE_DB="$PROJECT_DIR/impact-map.db"
  SHADOW_DB="$PROJECT_DIR/impact-map-shadow.db"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
}

# Latest migration version — derived from the migrations dir at runtime so the
# assertion is future-proof. Migration 017 currently shipped (Phase 117-01).
_latest_migration_version() {
  ls "${PLUGIN_ROOT}/worker/db/migrations/"*.js \
    | grep -v '\.test\.js$' \
    | xargs -n1 basename \
    | sed -E 's/^0*([0-9]+)_.*$/\1/' \
    | sort -n \
    | tail -1
}

# ===========================================================================
# Task 1 — getShadowQueryEngine() (no worker required)
# ===========================================================================

# ---------------------------------------------------------------------------
# Test 1 — fresh-open returns valid QE.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 1: getShadowQueryEngine returns a valid QE for an existing shadow DB" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null

  run node --input-type=module -e "
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}');
    if (!qe) { console.log(JSON.stringify({ok:false, reason:'null'})); process.exit(1); }
    const out = {
      ok: true,
      dbOpen: qe._db.open === true,
      hasUpsertRepo: typeof qe.upsertRepo === 'function',
      dbName: qe._db.name,
    };
    qe._db.close();
    console.log(JSON.stringify(out));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":true'* ]]
  [[ "$output" == *'"dbOpen":true'* ]]
  [[ "$output" == *'"hasUpsertRepo":true'* ]]
  [[ "$output" == *"impact-map-shadow.db"* ]]
}

# ---------------------------------------------------------------------------
# Test 2 — uncached: separate calls return separate instances.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 2: getShadowQueryEngine is uncached — two calls return DIFFERENT instances" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null

  run node --input-type=module -e "
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe1 = getShadowQueryEngine('${PROJECT_ROOT}');
    const qe2 = getShadowQueryEngine('${PROJECT_ROOT}');
    if (!qe1 || !qe2) { console.log(JSON.stringify({ok:false, reason:'null-qe'})); process.exit(1); }
    const sameInstance = qe1 === qe2;
    const sameDbHandle = qe1._db === qe2._db;
    // Close qe1; qe2 must still be usable.
    qe1._db.close();
    let qe2StillOpen = qe2._db.open === true;
    let qe2CanQuery = false;
    try {
      qe2._db.prepare('SELECT 1 as x').get();
      qe2CanQuery = true;
    } catch {}
    qe2._db.close();
    console.log(JSON.stringify({ok:true, sameInstance, sameDbHandle, qe2StillOpen, qe2CanQuery}));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"sameInstance":false'* ]]
  [[ "$output" == *'"sameDbHandle":false'* ]]
  [[ "$output" == *'"qe2StillOpen":true'* ]]
  [[ "$output" == *'"qe2CanQuery":true'* ]]
}

# ---------------------------------------------------------------------------
# Test 3 — live and shadow are independent (different files).
# ---------------------------------------------------------------------------
@test "Task 1 — Test 3: live and shadow QE point at different DB files" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null

  run node --input-type=module -e "
    import { getQueryEngine, getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const liveQe = getQueryEngine('${PROJECT_ROOT}');
    const shadowQe = getShadowQueryEngine('${PROJECT_ROOT}');
    if (!liveQe || !shadowQe) { console.log(JSON.stringify({ok:false, reason:'null-qe'})); process.exit(1); }
    const out = {
      liveDb: liveQe._db.name,
      shadowDb: shadowQe._db.name,
      liveEndsLive: liveQe._db.name.endsWith('impact-map.db'),
      shadowEndsShadow: shadowQe._db.name.endsWith('impact-map-shadow.db'),
      different: liveQe._db.name !== shadowQe._db.name,
    };
    shadowQe._db.close();
    console.log(JSON.stringify(out));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"liveEndsLive":true'* ]]
  [[ "$output" == *'"shadowEndsShadow":true'* ]]
  [[ "$output" == *'"different":true'* ]]
}

# ---------------------------------------------------------------------------
# Test 4 — create=true builds dir + applies migrations.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 4: create=true creates the project dir and opens with migrations" {
  # Do NOT seed — let getShadowQueryEngine create everything from scratch.
  [ ! -e "$PROJECT_DIR" ]

  run node --input-type=module -e "
    import fs from 'node:fs';
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}', { create: true });
    if (!qe) { console.log(JSON.stringify({ok:false, reason:'null'})); process.exit(1); }
    const dirExists = fs.existsSync('${PROJECT_DIR}');
    const dbExists = fs.existsSync('${SHADOW_DB}');
    const ver = qe._db.prepare('SELECT MAX(version) as v FROM schema_versions').get().v;
    qe._db.close();
    console.log(JSON.stringify({ok:true, dirExists, dbExists, ver}));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"dirExists":true'* ]]
  [[ "$output" == *'"dbExists":true'* ]]
  # Migration head should equal the latest migration on disk (currently 17).
  LATEST=$(_latest_migration_version)
  [[ "$output" == *"\"ver\":${LATEST}"* ]]
}

# ---------------------------------------------------------------------------
# Test 5 — create=false (default) returns null when shadow DB absent.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 5: getShadowQueryEngine returns null and creates nothing when shadow DB absent" {
  # Do NOT seed.
  [ ! -e "$SHADOW_DB" ]

  run node --input-type=module -e "
    import fs from 'node:fs';
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}');
    const dbExistsAfter = fs.existsSync('${SHADOW_DB}');
    console.log(JSON.stringify({qeIsNull: qe === null, dbExistsAfter}));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"qeIsNull":true'* ]]
  [[ "$output" == *'"dbExistsAfter":false'* ]]
}

# ---------------------------------------------------------------------------
# Test 6 — migrations applied (schema_versions head matches latest on disk).
# Already partly covered by Test 4; this version asserts the schema head
# explicitly via the disk-derived LATEST helper so the test is future-proof.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 6: fresh-open with create=true applies all migrations on disk" {
  run node --input-type=module -e "
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}', { create: true });
    const ver = qe._db.prepare('SELECT MAX(version) as v FROM schema_versions').get().v;
    // scan_overrides table exists (mig 017) — direct table-existence probe.
    const tbl = qe._db.prepare(
      \"SELECT name FROM sqlite_master WHERE type='table' AND name='scan_overrides'\"
    ).get();
    qe._db.close();
    console.log(JSON.stringify({ver, hasScanOverrides: !!tbl}));
  "
  [ "$status" -eq 0 ]
  LATEST=$(_latest_migration_version)
  [[ "$output" == *"\"ver\":${LATEST}"* ]]
  [[ "$output" == *'"hasScanOverrides":true'* ]]
}

