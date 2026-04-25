#!/usr/bin/env bats
# tests/mcp-wrapper.bats
# Bats tests for scripts/mcp-wrapper.sh — the trimmed (Phase 107-01) form
# that resolves CLAUDE_PLUGIN_ROOT and execs node. All install/self-heal
# logic now lives in install-deps.sh (covered by tests/install-deps.bats).
# Covers: INST-06

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
WRAPPER="$PROJECT_ROOT/plugins/arcanon/scripts/mcp-wrapper.sh"

setup() {
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  mkdir -p "$MOCK_PLUGIN_ROOT/worker/mcp"

  # Copy the wrapper into mock plugin root
  cp "$WRAPPER" "$MOCK_PLUGIN_ROOT/scripts/"

  # Default mock server.js exits 0 (avoids actually starting the server)
  printf 'process.exit(0)\n' > "$MOCK_PLUGIN_ROOT/worker/mcp/server.js"

  export MOCK_PLUGIN_ROOT
}

teardown() {
  [[ -d "$MOCK_PLUGIN_ROOT" ]] && rm -rf "$MOCK_PLUGIN_ROOT"
}

# ---------------------------------------------------------------------------
# INST-06: wrapper happy path — execs node and exits 0
# ---------------------------------------------------------------------------

@test "INST-06: wrapper exits 0 when better-sqlite3 already present" {
  # Simulate deps already installed by creating the (empty) module dir;
  # the trimmed wrapper does not actually inspect node_modules — the mock
  # server.js handles the success contract.
  mkdir -p "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  run env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INST-06: wrapper file structure — no install logic, single exec, ≤ 12 lines
# ---------------------------------------------------------------------------

@test "INST-06: wrapper has no install logic — it just execs node" {
  # Zero references to install logic in the wrapper file.
  # (The repo's REAL wrapper is the source of truth here, not the mock copy.)
  ! grep -E "npm install|npm rebuild|node_modules/better-sqlite3" "$WRAPPER"

  # Exactly one exec node line
  [[ "$(grep -c '^exec node' "$WRAPPER")" -eq 1 ]]

  # File is short (Phase 107-01 specified a 12-line ceiling)
  [[ "$(wc -l < "$WRAPPER")" -le 12 ]]
}

# ---------------------------------------------------------------------------
# INST-06: wrapper fails fast when binding missing — no self-heal swallowing
# ---------------------------------------------------------------------------

@test "INST-06: wrapper fails fast when better-sqlite3 is missing (no self-heal)" {
  # node_modules absent — wrapper must still exec node, and node will exit
  # nonzero with a Cannot-find-module error. The wrapper MUST surface that
  # failure (exit nonzero), not swallow it via a self-heal block.
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"

  # Replace the mock server.js with one that requires better-sqlite3 — will
  # fail with module-not-found error and exit nonzero
  cat > "$MOCK_PLUGIN_ROOT/worker/mcp/server.js" <<'JS'
require('better-sqlite3');
process.exit(0);
JS

  run env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh"

  # Wrapper exits with node's nonzero status (NOT swallowed by self-heal)
  [ "$status" -ne 0 ]
  # Stderr must NOT contain the deleted self-heal prefix
  ! [[ "$output" == *"[arcanon] installing runtime deps"* ]]
}
