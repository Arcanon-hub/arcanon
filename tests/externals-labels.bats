#!/usr/bin/env bats
# tests/externals-labels.bats — Phase 121 Plan 02 (INT-07, INT-08, INT-09).
#
# E2E coverage of the external-labels merge + UI/list label rendering. Each
# test seeds a bare-actor DB, writes an arcanon.config.json with an
# external_labels block, runs the actor-labeling pass via a small node
# one-liner (avoids spawning a full Claude scan), and asserts the labels
# survive round-trip through the worker's /graph endpoint.
#
# Tests:
#   1. user-only entry labels its actor end-to-end ('My Custom Service')
#   2. user wins on collision with shipped catalog (Stripe overridden)
#   3. shipped YAML byte-integrity (sha256 unchanged before/after merge)

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
WORKER_INDEX="${REPO_ROOT}/plugins/arcanon/worker/index.js"
SEED_ACTORS_JS="${REPO_ROOT}/plugins/arcanon/tests/fixtures/externals/seed-actors.js"
SHIPPED_YAML="${REPO_ROOT}/plugins/arcanon/data/known-externals.yaml"
WORKER_PORT=37999

# ---------------------------------------------------------------------------
# Helpers — cloned verbatim from tests/list.bats:25-77.
# ---------------------------------------------------------------------------

_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

_start_worker() {
  ARCANON_DATA_DIR="$ARC_DATA_DIR" \
    node "$WORKER_INDEX" --port "$WORKER_PORT" --data-dir "$ARC_DATA_DIR" \
      >"$BATS_TEST_TMPDIR/worker.log" 2>&1 &
  WORKER_PID=$!
  echo "$WORKER_PID" > "$BATS_TEST_TMPDIR/worker.pid"
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${WORKER_PORT}/api/readiness" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo "worker failed to start; log:" >&2
  cat "$BATS_TEST_TMPDIR/worker.log" >&2 || true
  return 1
}

_stop_worker() {
  if [ -f "$BATS_TEST_TMPDIR/worker.pid" ]; then
    local pid
    pid="$(cat "$BATS_TEST_TMPDIR/worker.pid")"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

setup() {
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"
}

teardown() {
  _stop_worker 2>/dev/null || true
}

# Run the actor-labeling pass directly against the seeded DB with the merged
# catalog (shipped + $PROJECT_ROOT/arcanon.config.json#external_labels).
# Iterates ALL repos so any actor connected via actor_connections to any
# service in any repo gets considered (matches what manager.js does for a
# real /arcanon:map run, which loops every linked repo).
_run_label_pass() {
  cd "$REPO_ROOT/plugins/arcanon"
  node -e "
    import('./worker/db/database.js').then(async (dbMod) => {
      const db = dbMod.openDb('${PROJECT_ROOT}');
      const lab = await import('./worker/scan/enrichment/actor-labeler.js');
      const cat = await import('./worker/scan/enrichment/externals-catalog.js');
      cat._clearCatalogCache();
      const merged = cat.loadMergedCatalog('${PROJECT_ROOT}');
      const repos = db.prepare('SELECT id FROM repos').all();
      const totals = { matched: 0, considered: 0 };
      for (const r of repos) {
        const out = await lab.runActorLabeling(r.id, db, null, merged);
        totals.matched += out.matched;
        totals.considered += out.considered;
      }
      process.stdout.write(JSON.stringify(totals) + '\n');
      db.close();
      dbMod._resetDbSingleton();
    }).catch((e) => { console.error(e); process.exit(1); });
  "
}

# ---------------------------------------------------------------------------
# Test 1 — User-only entry labels its actor end-to-end.
# ---------------------------------------------------------------------------
@test "INT-07: user external_labels entry labels its actor end-to-end" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  mkdir -p "$(dirname "$db_path")"

  # Seed 1 repo / 8 services / 1 scan / 1 bare actor named "custom.example.com".
  node "$SEED_ACTORS_JS" \
    --project "$PROJECT_ROOT" \
    --db "$db_path" \
    --actors custom.example.com >/dev/null

  # Write a user config that labels custom.example.com via external_labels.
  cat > "$PROJECT_ROOT/arcanon.config.json" <<EOF
{
  "external_labels": {
    "custom-svc": {
      "label": "My Custom Service",
      "hosts": ["custom.example.com"]
    }
  }
}
EOF

  # Run the labeling pass against the seeded DB + merged catalog.
  _run_label_pass 1

  _start_worker

  # Round-trip via /graph and assert the actor row carries the label.
  local proj_qs
  proj_qs="$(printf '%s' "$PROJECT_ROOT" | jq -sRr @uri)"
  run curl -sf "http://127.0.0.1:${WORKER_PORT}/graph?project=${proj_qs}"
  [ "$status" -eq 0 ]

  echo "$output" | jq -e '
    [.actors[] | select(.name == "custom.example.com")][0].label == "My Custom Service"
  ' >/dev/null
}

# ---------------------------------------------------------------------------
# Test 2 — User wins on collision (Stripe override).
# ---------------------------------------------------------------------------
@test "INT-07: user wins on key collision with shipped catalog" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  mkdir -p "$(dirname "$db_path")"

  node "$SEED_ACTORS_JS" \
    --project "$PROJECT_ROOT" \
    --db "$db_path" \
    --actors api.stripe.com >/dev/null

  # User overrides "stripe" with a project-specific label.
  cat > "$PROJECT_ROOT/arcanon.config.json" <<EOF
{
  "external_labels": {
    "stripe": {
      "label": "Stripe (Prod)",
      "hosts": ["api.stripe.com"]
    }
  }
}
EOF

  _run_label_pass 1

  _start_worker

  local proj_qs
  proj_qs="$(printf '%s' "$PROJECT_ROOT" | jq -sRr @uri)"
  run curl -sf "http://127.0.0.1:${WORKER_PORT}/graph?project=${proj_qs}"
  [ "$status" -eq 0 ]

  # User label wins — NOT the shipped "Stripe API" string.
  echo "$output" | jq -e '
    [.actors[] | select(.name == "api.stripe.com")][0].label == "Stripe (Prod)"
  ' >/dev/null
}

# ---------------------------------------------------------------------------
# Test 3 — Shipped YAML byte-integrity (file MUST NOT mutate during merge).
# ---------------------------------------------------------------------------
@test "INT-07: shipped known-externals.yaml is byte-identical after merge" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  mkdir -p "$(dirname "$db_path")"

  # Capture the canonical shipped catalog hash before any merge work.
  local before_hash
  before_hash="$(shasum -a 256 "$SHIPPED_YAML" | awk '{print $1}')"

  node "$SEED_ACTORS_JS" \
    --project "$PROJECT_ROOT" \
    --db "$db_path" \
    --actors api.stripe.com,custom.example.com >/dev/null

  # User config writes BOTH an override (stripe) and a net-new entry — the
  # merge code path exercises both Map operations.
  cat > "$PROJECT_ROOT/arcanon.config.json" <<EOF
{
  "external_labels": {
    "stripe": { "label": "Stripe (Override)", "hosts": ["api.stripe.com"] },
    "custom": { "label": "Custom Svc",        "hosts": ["custom.example.com"] }
  }
}
EOF

  _run_label_pass 1

  local after_hash
  after_hash="$(shasum -a 256 "$SHIPPED_YAML" | awk '{print $1}')"

  [[ "$before_hash" == "$after_hash" ]] || {
    echo "shipped YAML MUTATED during merge — before=$before_hash after=$after_hash" >&2
    return 1
  }
}
