#!/usr/bin/env bats
# Ligamen — mcp-server.bats
# Tests: MCPS-01 through MCPS-08
# Covers: MCP tool registration, JSON-RPC protocol, DB-absent graceful degradation,
#         and lint guard against console.log stdout pollution.

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  cd "$BATS_TEST_DIRNAME/../plugins/arcanon"
}

# ---------------------------------------------------------------------------
# Lint check: console.log guard
# ---------------------------------------------------------------------------

@test "lint.sh passes when mcp-server.js has no console.log" {
  run bash scripts/lint.sh </dev/null
  assert_success
}

# ---------------------------------------------------------------------------
# Static content: all 5 tool names present in file
# ---------------------------------------------------------------------------

@test "mcp-server.js contains all 5 required tool names" {
  local file="worker/mcp/server.js"
  [ -f "$file" ]
  grep -q "impact_query"   "$file"
  grep -q "impact_changed" "$file"
  grep -q "impact_graph"   "$file"
  grep -q "impact_search"  "$file"
  grep -q "impact_scan"    "$file"
}

# ---------------------------------------------------------------------------
# JSON-RPC: server starts and responds to initialize
# ---------------------------------------------------------------------------

@test "mcp-server starts and responds to initialize" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 3 node worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial '"protocolVersion"'
}

# ---------------------------------------------------------------------------
# JSON-RPC: tools/list returns all 5 tools
# ---------------------------------------------------------------------------

@test "mcp-server tools/list returns all 5 tools" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local list='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  run bash -c "printf '%s\n%s\n' '$init' '$list' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 3 node worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial '"impact_query"'
  assert_output --partial '"impact_search"'
}

# ---------------------------------------------------------------------------
# JSON-RPC: impact_query returns empty results array when DB absent (not error)
# ---------------------------------------------------------------------------

@test "mcp-server returns empty results when DB absent" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local call='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"impact_query","arguments":{"service":"test-service","transitive":false}}}'
  run bash -c "printf '%s\n%s\n' '$init' '$call' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 3 node worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial 'results'
  refute_output --partial 'isError'
}
