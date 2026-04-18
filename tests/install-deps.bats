#!/usr/bin/env bats
# tests/install-deps.bats
# Bats tests for scripts/install-deps.sh
# Covers: DEPS-01, DEPS-02, DEPS-03, DEPS-04

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup() {
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  MOCK_PLUGIN_DATA="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"

  cp "$PROJECT_ROOT/plugins/arcanon/scripts/install-deps.sh" "$MOCK_PLUGIN_ROOT/scripts/"

  # Create a minimal runtime-deps.json with a tiny real package (is-number) for fast install
  cat > "$MOCK_PLUGIN_ROOT/runtime-deps.json" <<'JSON'
{"name":"@arcanon/runtime-deps","version":"5.1.2","private":true,"dependencies":{"is-number":"^7.0.0"}}
JSON

  # Create matching package.json (npm install --prefix reads package.json in the prefix dir)
  cp "$MOCK_PLUGIN_ROOT/runtime-deps.json" "$MOCK_PLUGIN_ROOT/package.json"

  export MOCK_PLUGIN_ROOT MOCK_PLUGIN_DATA
}

teardown() {
  [[ -d "$MOCK_PLUGIN_ROOT" ]] && rm -rf "$MOCK_PLUGIN_ROOT"
  [[ -d "$MOCK_PLUGIN_DATA" ]] && rm -rf "$MOCK_PLUGIN_DATA"
}

# ---------------------------------------------------------------------------
# DEPS-01: Non-blocking guarantee — always exits 0
# ---------------------------------------------------------------------------

@test "DEPS-01: exits 0 when CLAUDE_PLUGIN_DATA is unset (dev mode)" {
  run bash -c "CLAUDE_PLUGIN_ROOT=\"$MOCK_PLUGIN_ROOT\" \
    bash \"$MOCK_PLUGIN_ROOT/scripts/install-deps.sh\""
  [ "$status" -eq 0 ]
  # node_modules must NOT have been created
  [ ! -d "$MOCK_PLUGIN_ROOT/node_modules" ]
}

@test "DEPS-01: produces no stdout output (hook stdout must be clean)" {
  # Run with sentinel already matching so no npm install happens (fast path)
  # Test stdout cleanliness by capturing stdout and stderr separately
  cp "$MOCK_PLUGIN_ROOT/runtime-deps.json" "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json"
  mkdir -p "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  STDOUT_ONLY=$(CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh" 2>/dev/null)
  [ -z "$STDOUT_ONLY" ]
}

# ---------------------------------------------------------------------------
# DEPS-02: Idempotency — sentinel-based skip and install logic
# ---------------------------------------------------------------------------

@test "DEPS-02: skips install when sentinel matches and better-sqlite3 dir exists" {
  # Set up matching sentinel
  cp "$MOCK_PLUGIN_ROOT/runtime-deps.json" "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json"
  # Create mock better-sqlite3 dir (simulating already-installed state)
  mkdir -p "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  run bash -c "CLAUDE_PLUGIN_ROOT=\"$MOCK_PLUGIN_ROOT\" \
    CLAUDE_PLUGIN_DATA=\"$MOCK_PLUGIN_DATA\" \
    bash \"$MOCK_PLUGIN_ROOT/scripts/install-deps.sh\""
  [ "$status" -eq 0 ]

  # node_modules should still only have better-sqlite3 (no new installs)
  # is-number would only appear if npm actually ran
  [ ! -d "$MOCK_PLUGIN_ROOT/node_modules/is-number" ]
}

@test "DEPS-02: installs when sentinel is missing" {
  # Ensure no sentinel exists
  rm -f "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json"

  run bash -c "CLAUDE_PLUGIN_ROOT=\"$MOCK_PLUGIN_ROOT\" \
    CLAUDE_PLUGIN_DATA=\"$MOCK_PLUGIN_DATA\" \
    bash \"$MOCK_PLUGIN_ROOT/scripts/install-deps.sh\""
  [ "$status" -eq 0 ]

  # Sentinel must have been written on success
  [ -f "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json" ]

  # node_modules directory must exist (npm install ran)
  [ -d "$MOCK_PLUGIN_ROOT/node_modules" ]
}

@test "DEPS-02: installs when sentinel differs from manifest" {
  # Write an old/different version to sentinel
  echo '{"name":"@arcanon/runtime-deps","version":"5.0.0"}' > "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json"

  run bash -c "CLAUDE_PLUGIN_ROOT=\"$MOCK_PLUGIN_ROOT\" \
    CLAUDE_PLUGIN_DATA=\"$MOCK_PLUGIN_DATA\" \
    bash \"$MOCK_PLUGIN_ROOT/scripts/install-deps.sh\""
  [ "$status" -eq 0 ]

  # Sentinel must be updated to match current manifest
  diff -q "$MOCK_PLUGIN_ROOT/runtime-deps.json" "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json" >/dev/null 2>&1
}

@test "DEPS-02: installs when better-sqlite3 dir missing even if sentinel matches" {
  # Set up matching sentinel but no node_modules/better-sqlite3
  cp "$MOCK_PLUGIN_ROOT/runtime-deps.json" "$MOCK_PLUGIN_DATA/.arcanon-deps-installed.json"
  # Explicitly ensure no better-sqlite3 dir
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  run bash -c "CLAUDE_PLUGIN_ROOT=\"$MOCK_PLUGIN_ROOT\" \
    CLAUDE_PLUGIN_DATA=\"$MOCK_PLUGIN_DATA\" \
    bash \"$MOCK_PLUGIN_ROOT/scripts/install-deps.sh\""
  [ "$status" -eq 0 ]

  # npm install must have run — node_modules directory should now exist
  [ -d "$MOCK_PLUGIN_ROOT/node_modules" ]
}

# ---------------------------------------------------------------------------
# DEPS-03: Hook timeout
# ---------------------------------------------------------------------------

@test "DEPS-03: hooks.json install-deps entry has timeout >= 120" {
  HOOKS_FILE="$PROJECT_ROOT/plugins/arcanon/hooks/hooks.json"
  run jq -r '.hooks.SessionStart[0].hooks[] | select(.command | endswith("install-deps.sh")) | .timeout' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [ "$output" -ge 120 ]
}

# ---------------------------------------------------------------------------
# DEPS-04: Hook ordering
# ---------------------------------------------------------------------------

@test "DEPS-04: install-deps.sh runs before session-start.sh in hooks.json" {
  HOOKS_FILE="$PROJECT_ROOT/plugins/arcanon/hooks/hooks.json"
  run jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"install-deps.sh" ]]
}

@test "DEPS-04: session-start.sh is second in SessionStart hooks array" {
  HOOKS_FILE="$PROJECT_ROOT/plugins/arcanon/hooks/hooks.json"
  run jq -r '.hooks.SessionStart[0].hooks[1].command' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"session-start.sh" ]]
}
