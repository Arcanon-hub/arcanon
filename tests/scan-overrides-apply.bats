#!/usr/bin/env bats
# tests/scan-overrides-apply.bats -  .
#
# End-to-end coverage of the scan-overrides apply-hook. Drives the same
# applyPendingOverrides function the scan pipeline calls between
# persistFindings and endScan, against a fresh on-disk SQLite DB seeded
# with services + connections + 3 pending overrides.
#
# Why not invoke a real scan via the worker CLI?
#   The scan pipeline depends on a Claude agent runner. Production scans
#   call out to Claude; bats tests must be hermetic and free of network /
#   API-key dependencies. Mirroring tests/integration/impact-flow.bats:
#   we wrap the apply-hook in a node --input-type=module --eval block
#   that opens the seeded DB, builds a real QueryEngine, and invokes the
#   exact same applyPendingOverrides function the scan pipeline uses.
#   This validates the full module surface end-to-end against on-disk
#   SQLite (not :memory:) without scaffolding a fake agent.
#
# Pairs with the in-process unit tests in
# plugins/arcanon/worker/scan/overrides.test.js (15 cases).

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.sh"
PLUGIN_ROOT="${REPO_ROOT}/plugins/arcanon"

setup() {
  # Use $BATS_TEST_TMPDIR (auto-cleaned by bats).
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR" && pwd -P)"
  DB_PATH="$BATS_TEST_TMPDIR/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >"$BATS_TEST_TMPDIR/seed.json"
}

# ---------------------------------------------------------------------------
# apply-hook applies all 3 pending overrides and stamps each.
# ---------------------------------------------------------------------------
@test "apply-hook deletes connection, renames service, stamps all 3 overrides" {
  # Drive applyPendingOverrides against the seeded DB. The scan_version_id
  # used for stamping (42) is arbitrary - in production it is r.scanVersionId
  # from the manager's Phase B loop; here we pass any positive integer to
  # exercise the same code path.
  run node --input-type=module --eval "
import Database from '${PLUGIN_ROOT}/worker/db/sqlite-adapter.js';
import { QueryEngine } from '${PLUGIN_ROOT}/worker/db/query-engine.js';
import { applyPendingOverrides } from '${PLUGIN_ROOT}/worker/scan/overrides.js';

const db = new Database('${DB_PATH}');
db.pragma('foreign_keys = ON');
const qe = new QueryEngine(db);

// Insert a fresh scan_versions row to stamp into (mimics the new bracket
// the scan pipeline opens before calling persistFindings).
const newSvId = db.prepare(
  'INSERT INTO scan_versions (repo_id, started_at) VALUES (1, datetime(\\'now\\'))'
).run().lastInsertRowid;

const slogCalls = [];
const slog = (level, msg, extra = {}) => slogCalls.push({ level, msg, extra });

const counters = await applyPendingOverrides(newSvId, qe, slog);

console.log(JSON.stringify({
  counters,
  warnCount: slogCalls.filter(c => c.level === 'WARN').length,
  warnMsgs: slogCalls.filter(c => c.level === 'WARN').map(c => c.msg),
  newSvId,
}));
db.close();
"
  [ "$status" -eq 0 ]

  # Counters: 3 applied (connection delete + rename + dangling-stamp).
  echo "$output" | grep -q '"applied":3'
  echo "$output" | grep -q '"skipped":0'
  echo "$output" | grep -q '"errors":0'

  # Exactly one WARN (the dangling delete on service id 999).
  echo "$output" | grep -q '"warnCount":1'
  echo "$output" | grep -q 'target missing'

  # DB state: connection gone, web renamed to frontend, all 3 overrides stamped.
  CONN_COUNT="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM connections WHERE id = 1')"
  [ "$CONN_COUNT" -eq 0 ]

  WEB_NAME="$(sqlite3 "$DB_PATH" "SELECT name FROM services WHERE id = 2")"
  [ "$WEB_NAME" = "frontend" ]

  STAMPED_COUNT="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM scan_overrides WHERE applied_in_scan_version_id IS NOT NULL')"
  [ "$STAMPED_COUNT" -eq 3 ]

  PENDING_COUNT="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM scan_overrides WHERE applied_in_scan_version_id IS NULL')"
  [ "$PENDING_COUNT" -eq 0 ]
}

# ---------------------------------------------------------------------------
# idempotency: a second invocation processes 0 overrides (all
# stamped from the first pass).
# ---------------------------------------------------------------------------
@test "re-invoking apply-hook is a no-op (already-applied filtered)" {
  run node --input-type=module --eval "
import Database from '${PLUGIN_ROOT}/worker/db/sqlite-adapter.js';
import { QueryEngine } from '${PLUGIN_ROOT}/worker/db/query-engine.js';
import { applyPendingOverrides } from '${PLUGIN_ROOT}/worker/scan/overrides.js';

const db = new Database('${DB_PATH}');
db.pragma('foreign_keys = ON');
const qe = new QueryEngine(db);

const sv1 = db.prepare(
  'INSERT INTO scan_versions (repo_id, started_at) VALUES (1, datetime(\\'now\\'))'
).run().lastInsertRowid;
const slog = () => {};
const c1 = await applyPendingOverrides(sv1, qe, slog);

const sv2 = db.prepare(
  'INSERT INTO scan_versions (repo_id, started_at) VALUES (1, datetime(\\'now\\'))'
).run().lastInsertRowid;
const c2 = await applyPendingOverrides(sv2, qe, slog);

console.log(JSON.stringify({ first: c1, second: c2 }));
db.close();
"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"first":{"applied":3,"skipped":0,"errors":0}'
  echo "$output" | grep -q '"second":{"applied":0,"skipped":0,"errors":0}'
}
