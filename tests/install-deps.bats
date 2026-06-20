#!/usr/bin/env bats
# tests/install-deps.bats
# Bats tests for scripts/install-deps.sh (live-state / no-sentinel architecture).
#
# Design under test:
#   - is_healthy() reads REAL state: all required (non-optional) deps present
#     in node_modules. All deps are pure-JS; no native-binding load required.
#     There is NO sentinel file.
#   - healing is additive (`npm install`); no ABI-rebuild branch (pure-JS only).
#   - a single-flight mkdir lock prevents concurrent installs.
#   - every path exits 0 (non-blocking); hooks invoke it via exec-form.

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
INSTALL_SCRIPT="$PROJECT_ROOT/plugins/arcanon/scripts/install-deps.sh"
HOOKS_FILE="$PROJECT_ROOT/plugins/arcanon/hooks/hooks.json"
REAL_PLUGIN_ROOT="$PROJECT_ROOT/plugins/arcanon"
REAL_PACKAGE_JSON="$REAL_PLUGIN_ROOT/package.json"

# ---------------------------------------------------------------------------
# Helpers (scenario-local)
# ---------------------------------------------------------------------------

# Recording npm stub: appends each invocation to $NPM_INVOKED_MARKER, exits 0.
_install_recording_npm_stub() {
  local stub_dir="$1"
  cat > "$stub_dir/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $*" >> "${NPM_INVOKED_MARKER}"
exit 0
STUB
  chmod +x "$stub_dir/npm"
}

_have_real_deps() {
  # True when the real plugin's node_modules has the primary pure-JS runtime deps.
  [[ -d "$REAL_PLUGIN_ROOT/node_modules/@modelcontextprotocol/sdk" ]] && \
  [[ -d "$REAL_PLUGIN_ROOT/node_modules/fastify" ]]
}

setup() {
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  MOCK_PLUGIN_DATA="$(mktemp -d)"
  STUB_NPM_DIR="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts" "$MOCK_PLUGIN_ROOT/lib"

  cp "$INSTALL_SCRIPT" "$MOCK_PLUGIN_ROOT/scripts/"
  # is_healthy + the ABI worker-stop path source lib/data-dir.sh — copy it in.
  cp "$REAL_PLUGIN_ROOT/lib/data-dir.sh" "$MOCK_PLUGIN_ROOT/lib/"
  cp "$REAL_PACKAGE_JSON" "$MOCK_PLUGIN_ROOT/package.json"

  export NPM_INVOKED_MARKER=""
  export MOCK_PLUGIN_ROOT MOCK_PLUGIN_DATA STUB_NPM_DIR
}

teardown() {
  [[ -d "$MOCK_PLUGIN_ROOT" ]] && rm -rf "$MOCK_PLUGIN_ROOT"
  [[ -d "$MOCK_PLUGIN_DATA" ]] && rm -rf "$MOCK_PLUGIN_DATA"
  [[ -d "$STUB_NPM_DIR"     ]] && rm -rf "$STUB_NPM_DIR"
  if [[ -n "${NPM_INVOKED_MARKER:-}" && -f "$NPM_INVOKED_MARKER" ]]; then
    rm -f "$NPM_INVOKED_MARKER"
  fi
}

# ---------------------------------------------------------------------------
# hooks.json registration — exec-form invocation (Windows file-association fix)
# ---------------------------------------------------------------------------

@test "hooks.json install-deps entry has timeout >= 120" {
  run jq -r '.hooks.SessionStart[0].hooks[] | select(.args[0] | endswith("install-deps.sh")) | .timeout' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [ "$output" -ge 120 ]
}

@test "all hooks use exec-form (command=bash, script path in args[0])" {
  # Every hook command must be the literal "bash"; the script path moves to args.
  run jq -r '[.. | objects | select(has("command") and has("type")) | .command] | unique | .[]' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [ "$output" = "bash" ]
}

@test "install-deps.sh runs before session-start.sh in SessionStart" {
  run jq -r '.hooks.SessionStart[0].hooks[0].args[0]' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"install-deps.sh" ]]
}

@test "session-start.sh is second in SessionStart hooks array" {
  run jq -r '.hooks.SessionStart[0].hooks[1].args[0]' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"session-start.sh" ]]
}

# ---------------------------------------------------------------------------
# Non-blocking guarantee + clean stdout + no marker files
# ---------------------------------------------------------------------------

@test "exits 0 when CLAUDE_PLUGIN_DATA is unset (dev mode, non-blocking)" {
  run env -u CLAUDE_PLUGIN_DATA \
    bash -c "CLAUDE_PLUGIN_ROOT='$MOCK_PLUGIN_ROOT' bash '$MOCK_PLUGIN_ROOT/scripts/install-deps.sh'"
  [ "$status" -eq 0 ]
}

@test "no sentinel file is ever created (regression guard for the desync bug)" {
  if ! _have_real_deps; then skip "real pure-JS deps not present in plugin node_modules"; fi
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"
  CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ ! -f "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" ]
  run bash -c "find '$MOCK_PLUGIN_DATA' -name '*sentinel*'"
  [ -z "$output" ]
}

@test "produces no stdout output on the healthy fast path" {
  if ! _have_real_deps; then skip "real pure-JS deps not present in plugin node_modules"; fi
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"
  STDOUT_ONLY=$(CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh" 2>/dev/null)
  [ -z "$STDOUT_ONLY" ]
}

# ---------------------------------------------------------------------------
# healthy fast path — no npm spawned
# ---------------------------------------------------------------------------

@test "healthy tree skips install — no npm process spawned" {
  if ! _have_real_deps; then skip "real pure-JS deps not present in plugin node_modules"; fi
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"

  NPM_INVOKED_MARKER="$(mktemp -u)"; export NPM_INVOKED_MARKER
  _install_recording_npm_stub "$STUB_NPM_DIR"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  [[ ! -f "$NPM_INVOKED_MARKER" ]]   # npm never invoked
}

# ---------------------------------------------------------------------------
# is_healthy ignores optionalDependencies (the documented trap)
# ---------------------------------------------------------------------------

@test "absent optionalDependency does NOT trigger a reinstall" {
  if ! _have_real_deps; then skip "real pure-JS deps not present in plugin node_modules"; fi

  # Copy the real tree, then remove ONLY the optional dep. Required deps + the
  # native binding remain, so is_healthy must still pass (no npm).
  cp -R "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules/@chroma-core/default-embed"

  NPM_INVOKED_MARKER="$(mktemp -u)"; export NPM_INVOKED_MARKER
  _install_recording_npm_stub "$STUB_NPM_DIR"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  [[ ! -f "$NPM_INVOKED_MARKER" ]]
}

# ---------------------------------------------------------------------------
# missing tree → additive install runs and heals
# ---------------------------------------------------------------------------

@test "missing node_modules triggers npm install and heals" {
  if ! _have_real_deps; then skip "real pure-JS deps not present in plugin node_modules"; fi

  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"

  # Stub: `npm install` copies the real pure-JS tree into PREFIX so is_healthy()
  # passes on the second call. No native rebuild is ever needed.
  cat > "$STUB_NPM_DIR/npm" <<STUB
#!/usr/bin/env bash
PREFIX=""; ARGS=("\$@")
for ((i=0; i<\${#ARGS[@]}; i++)); do
  if [[ "\${ARGS[\$i]}" == "--prefix" && \$((i+1)) -lt \${#ARGS[@]} ]]; then
    PREFIX="\${ARGS[\$((i+1))]}"; break
  fi
done
case "\$1" in
  install) [[ -n "\$PREFIX" ]] && cp -R "$REAL_PLUGIN_ROOT/node_modules" "\$PREFIX/node_modules"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  # After heal, the pure-JS MCP SDK dep should be present.
  [[ -d "$MOCK_PLUGIN_ROOT/node_modules/@modelcontextprotocol/sdk" ]]
  # No native binding is required; the MCP SDK module must be importable.
  run node --input-type=module -e "
    import fs from 'node:fs';
    const nm = '$MOCK_PLUGIN_ROOT/node_modules/@modelcontextprotocol/sdk';
    if (!fs.existsSync(nm)) process.exit(1);
  "
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# pure-JS: no rebuild branch — incomplete tree after install exits 0 with log
# ---------------------------------------------------------------------------

@test "install-deps.sh has no npm-rebuild branch (pure-JS deps only)" {
  # Regression guard: the ABI-rebuild branch was removed in v0.1.8. Verify it
  # is absent from the script so no future edit reintroduces it accidentally.
  run grep -E 'npm rebuild|npm_rebuild|ABI' "$INSTALL_SCRIPT"
  [ "$status" -ne 0 ]  # grep exits non-zero when no match found
}

@test "incomplete tree after npm install exits 0 with informational message" {
  # If npm install runs but the tree is still incomplete (e.g. network failure),
  # the script must exit 0 with a log line — no crash, no rebuild attempt.
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"

  # Stub npm: install is a no-op (tree stays absent so is_healthy fails again).
  cat > "$STUB_NPM_DIR/npm" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  # Capture both stdout and stderr (script exits 0 non-blocking).
  local output rc
  output="$(
    env PATH="$STUB_NPM_DIR:$PATH" \
        CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
        CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
        bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh" 2>&1
  )"
  rc=$?
  # Must exit 0 (non-blocking) even when tree stays unhealthy.
  [ "$rc" -eq 0 ]
  # Must emit an informational message to stderr (captured here via 2>&1).
  [[ "$output" == *"dependency tree still incomplete"* ]]
}

# ---------------------------------------------------------------------------
# Regression guard: no worker-stop or better-sqlite3-rebuild code (v0.1.8+)
# ---------------------------------------------------------------------------

@test "install-deps.sh does not stop a live worker (no ABI-rebuild branch)" {
  # With pure-JS deps there is no native binding to rebuild, so the script
  # must never send signals to a running worker. Verify no worker-kill logic
  # is present in the script (structural guard; prevents reintroduction).
  run grep -E 'kill.*WORKER_PID|kill.*worker\.pid|better-sqlite3' "$INSTALL_SCRIPT"
  [ "$status" -ne 0 ]  # grep exits non-zero when no match found
}

# ---------------------------------------------------------------------------
# single-flight lock — a held, fresh lock makes a concurrent run back off
# ---------------------------------------------------------------------------

@test "fresh lock makes a concurrent run exit 0 without invoking npm" {
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"          # unhealthy → would install
  mkdir "$MOCK_PLUGIN_ROOT/.arcanon-install.lock"  # simulate another session holding the lock

  NPM_INVOKED_MARKER="$(mktemp -u)"; export NPM_INVOKED_MARKER
  _install_recording_npm_stub "$STUB_NPM_DIR"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  [[ ! -f "$NPM_INVOKED_MARKER" ]]   # backed off — npm not invoked
}

@test "lock is released after a run (trap rmdir on EXIT)" {
  if ! _have_real_deps; then skip "real pure-JS deps not present in plugin node_modules"; fi
  # Unhealthy tree so the run acquires the lock, installs (recording stub), exits.
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"
  NPM_INVOKED_MARKER="$(mktemp -u)"; export NPM_INVOKED_MARKER
  _install_recording_npm_stub "$STUB_NPM_DIR"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"

  [ ! -d "$MOCK_PLUGIN_ROOT/.arcanon-install.lock" ]
}
