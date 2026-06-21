#!/usr/bin/env bats
# Arcanon — native-sqlite.bats
# Tests: SQLITE-01, SQLITE-04, SQLITE-05, SQLITE-06
# Covers: no-native-dep invariants, engines floor, fresh-install fast-path
#         (launch.js boots with pure-JS deps, never enters a rebuild branch),
#         and clean-stderr assertions (no ExperimentalWarning, no native-binding
#         error text).

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  cd "$BATS_TEST_DIRNAME/../plugins/arcanon"
}

# ---------------------------------------------------------------------------
# SOURCE GUARD: no native toolchain references in install-deps.sh or launch.js
# ---------------------------------------------------------------------------

@test "install-deps.sh has no better-sqlite3 reference" {
  run grep -cE 'better-sqlite3' scripts/install-deps.sh
  assert_output "0"
}

@test "install-deps.sh has no npm-rebuild/prebuild/node-gyp reference" {
  run grep -cE 'npm rebuild|prebuild|node-gyp' scripts/install-deps.sh
  assert_output "0"
}

@test "launch.js has no better-sqlite3/rebuild/prebuild/node-gyp reference" {
  run grep -cE 'better-sqlite3|npm rebuild|prebuild|node-gyp' worker/mcp/launch.js
  assert_output "0"
}

# ---------------------------------------------------------------------------
# NO NATIVE DEP: package.json has no better-sqlite3 dependency
# ---------------------------------------------------------------------------

@test "package.json does not list better-sqlite3 as a dependency" {
  run node --input-type=module -e '
    import fs from "node:fs";
    const pkg = JSON.parse(fs.readFileSync("package.json","utf8"));
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies
    };
    if (deps["better-sqlite3"]) {
      process.stderr.write("better-sqlite3 still in package.json\n");
      process.exit(1);
    }
    process.exit(0);
  '
  assert_success
}

@test "package.json engines.node is >=22.13.0" {
  run node -e "
    const p = require('./package.json');
    if (p.engines.node !== '>=22.13.0') {
      process.stderr.write('engines.node is ' + p.engines.node + '\n');
      process.exit(1);
    }
    process.exit(0);
  "
  assert_success
}

@test "package-lock.json has no better-sqlite3 entry" {
  run grep -c "better-sqlite3" package-lock.json
  assert_output "0"
}

# ---------------------------------------------------------------------------
# FRESH-INSTALL FAST PATH: with node_modules present, launch.js boots server.js
# via the fast path, responds to initialize, and never invokes a rebuild branch.
# ---------------------------------------------------------------------------

@test "launch.js boots server and responds to initialize (fast path)" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  # ARCANON_MCP_WAIT_MS=0 means the slow-path wait loop exits immediately if
  # the fast-path import throws — the fast path is what we are asserting here.
  # We pipe an initialize request so the server has input to respond to.
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' ARCANON_MCP_WAIT_MS=100 timeout 5 node --disable-warning=ExperimentalWarning worker/mcp/launch.js 2>/dev/null"
  assert_success
  assert_output --partial '"protocolVersion"'
}

@test "launch.js fast path: stderr has no rebuild or native-binding error text" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  # Capture stderr only (redirect stdout to /dev/null — it carries MCP JSON-RPC).
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' ARCANON_MCP_WAIT_MS=100 timeout 5 node --disable-warning=ExperimentalWarning worker/mcp/launch.js 2>&1 1>/dev/null"
  # stderr should be empty on a clean fast-path boot with warning suppression
  refute_output --partial 'rebuild'
  refute_output --partial 'better_sqlite3'
  refute_output --partial 'node-gyp'
  refute_output --partial 'better-sqlite3'
}

# ---------------------------------------------------------------------------
# CLEAN STDERR: ExperimentalWarning suppressed, no native-binding noise
# ---------------------------------------------------------------------------

@test "server.js stderr has no ExperimentalWarning when launched with warning flag" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  # Run server.js directly with the suppression flag (as launch.js's slow-path spawn does).
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 3 node --disable-warning=ExperimentalWarning worker/mcp/server.js 2>&1 1>/dev/null"
  refute_output --partial 'ExperimentalWarning'
  refute_output --partial 'better_sqlite3'
  refute_output --partial 'node-gyp'
}

@test "server.js responds to initialize (no ExperimentalWarning on stdout)" {
  local init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  run bash -c "printf '%s\n' '$init' | ARCANON_DB_PATH='.arcanon/nonexistent-test.db' timeout 3 node --disable-warning=ExperimentalWarning worker/mcp/server.js 2>/dev/null"
  assert_success
  assert_output --partial '"protocolVersion"'
  refute_output --partial 'ExperimentalWarning'
}
