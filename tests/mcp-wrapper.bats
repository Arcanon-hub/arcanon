#!/usr/bin/env bats
# tests/mcp-wrapper.bats
# Bats tests for scripts/mcp-wrapper.sh self-healing behavior
# Covers: MCP-02

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup() {
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  mkdir -p "$MOCK_PLUGIN_ROOT/worker/mcp"

  # Copy the wrapper into mock plugin root
  cp "$PROJECT_ROOT/plugins/arcanon/scripts/mcp-wrapper.sh" "$MOCK_PLUGIN_ROOT/scripts/"

  # Create a mock server.js that just exits 0 (avoids actually starting the server)
  printf 'process.exit(0)\n' > "$MOCK_PLUGIN_ROOT/worker/mcp/server.js"

  # Create a minimal package.json for npm install (uses a trivially small dep)
  printf '{"name":"test","version":"0.0.1","dependencies":{"is-number":"^7.0.0"}}\n' \
    > "$MOCK_PLUGIN_ROOT/package.json"

  export MOCK_PLUGIN_ROOT
}

teardown() {
  [[ -d "$MOCK_PLUGIN_ROOT" ]] && rm -rf "$MOCK_PLUGIN_ROOT"
}

# ---------------------------------------------------------------------------
# MCP-02: wrapper exits 0 when deps already installed
# ---------------------------------------------------------------------------

@test "MCP-02: wrapper exits 0 when better-sqlite3 already present" {
  # Simulate deps already installed by creating the sentinel directory
  mkdir -p "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  run env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# MCP-02: wrapper logs to stderr and attempts npm install when deps missing
# ---------------------------------------------------------------------------

@test "MCP-02: wrapper logs install message to stderr when better-sqlite3 missing" {
  # Ensure node_modules/better-sqlite3 does NOT exist
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"

  run env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh"

  # Wrapper should still exit 0 (exec node server.js succeeds with mock)
  [ "$status" -eq 0 ]
  # All install messages go to stderr (captured in $output by bats for stderr)
  [[ "$output" == *"[arcanon]"* ]]
}

# ---------------------------------------------------------------------------
# MCP-02: wrapper produces no stdout output before exec
# ---------------------------------------------------------------------------

@test "MCP-02: wrapper produces no stdout when deps are present" {
  # Simulate deps already installed
  mkdir -p "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  # Capture stdout and stderr separately
  STDOUT=$(env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh" 2>/dev/null)

  # Stdout must be empty (server.js mock calls process.exit(0) with no output)
  [ -z "$STDOUT" ]
}

@test "MCP-02: install messages go to stderr not stdout" {
  # Remove deps to trigger install path
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"

  # Capture stdout only; stderr goes to /dev/null
  STDOUT=$(env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh" 2>/dev/null)

  # Stdout must be empty regardless of install path
  [ -z "$STDOUT" ]
}

# ---------------------------------------------------------------------------
# MCP-02: .mcp.json uses mcp-wrapper.sh as command
# ---------------------------------------------------------------------------

@test "MCP-02: .mcp.json command field ends with mcp-wrapper.sh" {
  local mcp_json="$PROJECT_ROOT/plugins/arcanon/.mcp.json"
  [ -f "$mcp_json" ]

  COMMAND=$(python3 -c "
import json, sys
with open('$mcp_json') as f:
    d = json.load(f)
print(d['mcpServers']['arcanon']['command'])
")

  [[ "$COMMAND" == *"mcp-wrapper.sh" ]]
}

# ---------------------------------------------------------------------------
# MCP-02: wrapper works without CLAUDE_PLUGIN_ROOT (script-relative fallback)
# ---------------------------------------------------------------------------

@test "MCP-02: wrapper works without CLAUDE_PLUGIN_ROOT using script-relative fallback" {
  # Simulate deps present so install isn't triggered
  mkdir -p "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3"

  # Run WITHOUT setting CLAUDE_PLUGIN_ROOT — wrapper must resolve via BASH_SOURCE
  # Copy wrapper to a known path so dirname works correctly
  run env -u CLAUDE_PLUGIN_ROOT \
    bash "$MOCK_PLUGIN_ROOT/scripts/mcp-wrapper.sh"

  [ "$status" -eq 0 ]
}
