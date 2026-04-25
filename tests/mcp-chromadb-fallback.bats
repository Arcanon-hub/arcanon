#!/usr/bin/env bats
# Arcanon — mcp-chromadb-fallback.bats
# Tests: MCP-01 (ChromaDB graceful degradation)
# Covers: server starts when @chroma-core/default-embed is absent,
#         search fallback activates, non-search tools still work

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  cd "$BATS_TEST_DIRNAME/../plugins/arcanon"
}

teardown() {
  cd "$BATS_TEST_DIRNAME/../plugins/arcanon"
  local embed_dir="node_modules/@chroma-core/default-embed"
  if [ -d "${embed_dir}.bak" ]; then
    mv "${embed_dir}.bak" "$embed_dir"
  fi
}

# ---------------------------------------------------------------------------
# MCP-01: Server starts without @chroma-core/default-embed
# ---------------------------------------------------------------------------

@test "MCP-01: server starts when @chroma-core/default-embed is absent" {
  local embed_dir="node_modules/@chroma-core/default-embed"
  local renamed=false
  if [ -d "$embed_dir" ]; then
    mv "$embed_dir" "${embed_dir}.bak"
    renamed=true
  fi

  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"

  if [ "$renamed" = true ]; then
    mv "${embed_dir}.bak" "$embed_dir"
  fi

  assert_success
  assert_output --partial '"protocolVersion"'
}

@test "MCP-01: all 9 tools still listed when @chroma-core/default-embed is absent" {
  local embed_dir="node_modules/@chroma-core/default-embed"
  local renamed=false
  if [ -d "$embed_dir" ]; then
    mv "$embed_dir" "${embed_dir}.bak"
    renamed=true
  fi

  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local list='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  run bash -c "printf '%s\n%s\n' '$init' '$list' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"

  if [ "$renamed" = true ]; then
    mv "${embed_dir}.bak" "$embed_dir"
  fi

  assert_success
  assert_output --partial '"impact_query"'
  assert_output --partial '"impact_changed"'
  assert_output --partial '"impact_graph"'
  assert_output --partial '"impact_search"'
  assert_output --partial '"impact_scan"'
  assert_output --partial '"drift_versions"'
  assert_output --partial '"drift_types"'
  assert_output --partial '"drift_openapi"'
  # impact_audit_log added in Phase 111 Plan 03 (TRUST-06 / TRUST-14).
  assert_output --partial '"impact_audit_log"'
}

@test "MCP-01: impact_query works when ChromaDB unavailable" {
  local embed_dir="node_modules/@chroma-core/default-embed"
  local renamed=false
  if [ -d "$embed_dir" ]; then
    mv "$embed_dir" "${embed_dir}.bak"
    renamed=true
  fi

  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local call='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"impact_query","arguments":{"service":"nonexistent"}}}'
  run bash -c "printf '%s\n%s\n' '$init' '$call' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"

  if [ "$renamed" = true ]; then
    mv "${embed_dir}.bak" "$embed_dir"
  fi

  assert_success
  assert_output --partial 'results'
  refute_output --partial '"isError"'
}
