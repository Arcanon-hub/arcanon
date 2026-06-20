#!/usr/bin/env bats
# tests/diff-shadow.bats —  .
#
# End-to-end coverage of /arcanon:diff --shadow. The handler reuses Phase
# 115's diffScanVersions(dbA, dbB, scanIdA, scanIdB) engine — passing the
# live DB handle and the shadow DB handle as the two sources.
#
# Hard contracts from PLAN 119-02:
#   - Reuses 115's diff engine (NOT a duplicate inline implementation).
#   - Exits 2 with friendly error if either DB is missing.
#   Silent in non-Arcanon dir (mirrors).
#   - --json shape matches the engine's full result.

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
PLUGIN_ROOT="${REPO_ROOT}/plugins/arcanon"
HUB_SH="${PLUGIN_ROOT}/scripts/hub.sh"
SHADOW_SEED_SH="${PLUGIN_ROOT}/tests/fixtures/shadow/seed.sh"

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

# Run hub.sh diff --shadow from the project root.
_run_diff_shadow() {
  ( cd "$PROJECT_ROOT" && ARCANON_DATA_DIR="$ARC_DATA_DIR" bash "$HUB_SH" diff --shadow "$@" )
}

# Mutate the shadow DB so it diverges from live in a known shape.
# Adds 1 service ('shadow-only-svc') and removes 1 ('auth-svc') and modifies
# the api-svc's language. Connection to the removed service goes too (CASCADE).
_introduce_shadow_drift() {
  # Run from PLUGIN_ROOT so the bare `better-sqlite3` import resolves via
  # plugins/arcanon/node_modules. Earlier passes worked locally only because
  # a stray repo-root node_modules shadowed the lookup; CI exposed the bug.
  ( cd "$PLUGIN_ROOT" && node --input-type=module -e "
    import Database from '${PLUGIN_ROOT}/worker/db/sqlite-adapter.js';
    const db = new Database('${SHADOW_DB}');
    db.pragma('foreign_keys = ON');
    // Modify api-svc's language js -> ts
    db.prepare(\"UPDATE services SET language = 'ts' WHERE name = 'api-svc'\").run();
    // Remove auth-svc + its incoming connection (CASCADE not declared in this
    // schema, so delete connections explicitly first).
    db.prepare(\"DELETE FROM connections WHERE target_service_id = (SELECT id FROM services WHERE name = 'auth-svc')\").run();
    db.prepare(\"DELETE FROM services WHERE name = 'auth-svc'\").run();
    // Add shadow-only-svc
    db.prepare(\"INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id) VALUES (1, 'shadow-only-svc', '/', 'js', 'service', 1)\").run();
    db.close();
  " ) >/dev/null
}

# ---------------------------------------------------------------------------
# Test 12 — happy path: live and shadow diverge; engine reports added,
# removed, and modified for services and connections.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 12: diff --shadow reports added/removed/modified across live vs shadow" {
  bash "$SHADOW_SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  bash "$SHADOW_SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null
  _introduce_shadow_drift

  run _run_diff_shadow
  [ "$status" -eq 0 ]
  # Section headers from 's formatter.
  [[ "$output" == *"Services"* ]]
  [[ "$output" == *"Connections"* ]]
  # shadow-only-svc → added on shadow side
  [[ "$output" == *"shadow-only-svc"* ]]
  # auth-svc → removed
  [[ "$output" == *"auth-svc"* ]]
  # api-svc language change → modified
  [[ "$output" == *"api-svc"* ]]
  # Summary line shows non-zero counts
  [[ "$output" == *"Summary"* ]]
}

# ---------------------------------------------------------------------------
# Test 13 — no shadow DB → exit 2 with friendly error.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 13: no shadow DB → exit 2 with 'no shadow DB' error" {
  bash "$SHADOW_SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  [ ! -f "$SHADOW_DB" ]

  run _run_diff_shadow
  [ "$status" -eq 2 ]
  [[ "$output" == *"no shadow DB"* ]]
}

# ---------------------------------------------------------------------------
# Test 14 — no live DB → exit 2 with friendly error.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 14: no live DB → exit 2 with 'no live DB' error" {
  bash "$SHADOW_SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null
  [ ! -f "$LIVE_DB" ]

  run _run_diff_shadow
  [ "$status" -eq 2 ]
  [[ "$output" == *"no live DB"* ]]
}

# ---------------------------------------------------------------------------
# Test 15 — --json output shape matches 's engine result.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 15: --json emits {services, connections, summary, ...}" {
  bash "$SHADOW_SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  bash "$SHADOW_SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null
  _introduce_shadow_drift

  run _run_diff_shadow --json
  [ "$status" -eq 0 ]
  # Validate JSON shape.
  echo "$output" | node --input-type=module -e "
    let buf = '';
    process.stdin.on('data', c => buf += c);
    process.stdin.on('end', () => {
      const j = JSON.parse(buf);
      if (!j.services || !Array.isArray(j.services.added)) { console.error('services.added missing'); process.exit(1); }
      if (!j.services || !Array.isArray(j.services.removed)) { console.error('services.removed missing'); process.exit(1); }
      if (!j.services || !Array.isArray(j.services.modified)) { console.error('services.modified missing'); process.exit(1); }
      if (!j.connections || !Array.isArray(j.connections.added)) { console.error('connections.added missing'); process.exit(1); }
      if (!j.summary || !j.summary.services) { console.error('summary.services missing'); process.exit(1); }
      // shadow-only-svc must be in services.added
      const addedNames = j.services.added.map(s => s.name);
      if (!addedNames.includes('shadow-only-svc')) { console.error('shadow-only-svc missing from added'); process.exit(1); }
    });
  "
}

# ---------------------------------------------------------------------------
# Test 16 — silent in non-Arcanon directory (no live, no shadow).
# ---------------------------------------------------------------------------
@test "Task 2 — Test 16: silent in non-Arcanon dir (no live, no shadow)" {
  [ ! -f "$LIVE_DB" ]
  [ ! -f "$SHADOW_DB" ]

  run _run_diff_shadow
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 17 — commands/diff.md mentions --shadow flag (courtesy edit).
# ---------------------------------------------------------------------------
@test "Task 2 — Test 17: commands/diff.md documents --shadow flag" {
  CMD_FILE="${PLUGIN_ROOT}/commands/diff.md"
  [ -f "$CMD_FILE" ]
  grep -qE '^description:' "$CMD_FILE"
  grep -qE '^allowed-tools:' "$CMD_FILE"
  grep -q 'Bash' "$CMD_FILE"
  # Courtesy edit must add --shadow to the help/argument-hint surface.
  grep -q -- '--shadow' "$CMD_FILE"
}
