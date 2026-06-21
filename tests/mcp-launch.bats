#!/usr/bin/env bats
# Arcanon — mcp-launch.bats
# Tests: MCP-01 (server starts from marketplace install), MCP-03 (no NODE_PATH needed)
# Covers: end-to-end MCP server launch verification for v5.2.0 distribution fix

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  cd "$BATS_TEST_DIRNAME/../plugins/arcanon"
}

# ---------------------------------------------------------------------------
# MCP-01: Server starts from plugin root without ERR_MODULE_NOT_FOUND
# ---------------------------------------------------------------------------

@test "MCP-01: server starts and responds to initialize from plugin root" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial '"protocolVersion"'
}

@test "MCP-01: server stderr has no ERR_MODULE_NOT_FOUND" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local stderr_file="$BATS_TMPDIR/mcp-stderr.txt"
  bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>'$stderr_file'" || true
  run grep -c 'ERR_MODULE_NOT_FOUND' "$stderr_file"
  # grep -c returns 0 if found, 1 if not found — we want 0 occurrences
  [ "$output" = "0" ] || [ "$status" -eq 1 ]
  run grep -q 'Cannot find package' "$stderr_file"
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# MCP-01: tools/list returns all 9 MCP tools (was 8 before  )
# ---------------------------------------------------------------------------

@test "MCP-01: tools/list returns all 9 MCP tools" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local list='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  run bash -c "printf '%s\n%s\n' '$init' '$list' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial '"impact_query"'
  assert_output --partial '"impact_changed"'
  assert_output --partial '"impact_graph"'
  assert_output --partial '"impact_search"'
  assert_output --partial '"impact_scan"'
  assert_output --partial '"drift_versions"'
  assert_output --partial '"drift_types"'
  assert_output --partial '"drift_openapi"'
  # impact_audit_log added in   .
  assert_output --partial '"impact_audit_log"'
}

@test "MCP-01: tools/list returns exactly 9 tools" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local list='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  run bash -c "printf '%s\n%s\n' '$init' '$list' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"
  assert_success
  # Extract tools count from the tools/list response (last JSON line of output).
  # Count was 8 before   added impact_audit_log .
  local tool_count
  tool_count=$(echo "$output" | tail -1 | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log(r.result.tools.length)}catch(e){console.log(0)}})")
  [ "$tool_count" = "9" ]
}

# ---------------------------------------------------------------------------
# MCP-03: No NODE_PATH in plugin .mcp.json
# ---------------------------------------------------------------------------

@test "MCP-03: plugin .mcp.json has no NODE_PATH env var" {
  run grep -c 'NODE_PATH' .mcp.json
  # grep -c returns 0 if found, 1 if not found — we want 0 occurrences
  [ "$output" = "0" ] || [ "$status" -eq 1 ]
}

@test "MCP-03: root .mcp.json is empty mcpServers object" {
  run jq -r '.mcpServers | keys | length' "$BATS_TEST_DIRNAME/../.mcp.json"
  assert_output "0"
}

# ---------------------------------------------------------------------------
# MCP-01: Server handles tools/call gracefully when DB absent
# ---------------------------------------------------------------------------

@test "MCP-01: server handles tools/call gracefully when DB absent" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  local call='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"impact_query","arguments":{"service":"nonexistent"}}}'
  run bash -c "printf '%s\n%s\n' '$init' '$call' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 5 node worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial 'results'
  refute_output --partial '"isError"'
}

# ---------------------------------------------------------------------------
# Resilient launcher (worker/mcp/launch.js) — what .mcp.json actually invokes
# ---------------------------------------------------------------------------

@test "LAUNCH: .mcp.json invokes node on worker/mcp/launch.js (node-direct, no bash)" {
  run jq -r '.mcpServers.arcanon.command' .mcp.json
  assert_output "node"
  # args may include flag(s) before the script path; the last element is launch.js
  run bash -c "jq -r '.mcpServers.arcanon.args | last' .mcp.json"
  assert_output --partial "worker/mcp/launch.js"
}

@test "LAUNCH: launcher fast path boots the server and responds to initialize" {
  # Deps are present in this repo, so the launcher takes the direct-import path.
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 8 node worker/mcp/launch.js 2>/dev/null"
  assert_success
  assert_output --partial '"protocolVersion"'
}

@test "LAUNCH: launcher degrades gracefully when deps missing (bounded wait, no crash-loop)" {
  # Mock plugin root with NO node_modules → probe never reports healthy.
  local mock; mock="$(mktemp -d)"
  mkdir -p "$mock/worker/mcp"
  cp worker/mcp/launch.js "$mock/worker/mcp/launch.js"
  # Stub server imports a third-party dep; with no node_modules the import
  # throws (ERR_MODULE_NOT_FOUND), mirroring a real missing-deps server and
  # forcing the launcher into its wait-then-give-up path.
  printf 'import "better-sqlite3";\n' > "$mock/worker/mcp/server.js"

  # Short wait window so the test is fast; assert it returns within a few sec.
  run bash -c "ARCANON_MCP_WAIT_MS=800 timeout 10 node '$mock/worker/mcp/launch.js' < /dev/null"
  assert_failure                                   # exit 1, not a hang/crash-loop
  assert_output --partial 'dependencies are not ready'

  rm -rf "$mock"
}
