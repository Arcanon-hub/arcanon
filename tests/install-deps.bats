#!/usr/bin/env bats
# tests/install-deps.bats
# Bats tests for scripts/install-deps.sh (live-state / no-sentinel architecture).
#
# Design under test:
#   - is_healthy() reads REAL state (required deps present + better-sqlite3
#     binding loads). There is NO sentinel file.
#   - healing is additive (`npm install`); ABI mismatch falls back to rebuild.
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

_have_real_binding() {
  [[ -d "$REAL_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]
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
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"
  CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ ! -f "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" ]
  run bash -c "find '$MOCK_PLUGIN_DATA' -name '*sentinel*'"
  [ -z "$output" ]
}

@test "produces no stdout output on the healthy fast path" {
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi
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
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi
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
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi

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
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi

  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"
  REAL_NPM="$(command -v npm)"; [[ -n "$REAL_NPM" ]]

  # Stub: `npm install` copies the prebuilt tree into PREFIX (fast); anything
  # else delegates to the real npm.
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
  *) exec "$REAL_NPM" "\$@" ;;
esac
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  [[ -d "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]
  run bash -c "cd '$MOCK_PLUGIN_ROOT' && node --input-type=module -e \"const D=(await import('better-sqlite3')).default; new D(':memory:').close()\""
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# broken binding (tree present) → rebuild path heals
# ---------------------------------------------------------------------------

@test "broken binding triggers rebuild and binding loads after" {
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi
  if ! command -v cc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
    skip "C toolchain required for native rebuild"
  fi

  cp -R "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release"
  REAL_NPM="$(command -v npm)"

  # Stub: `npm install` is a no-op (tree already present, binding still broken
  # → forces the rebuild branch); `npm rebuild` delegates to real npm so the
  # native binding actually recompiles.
  cat > "$STUB_NPM_DIR/npm" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install) exit 0 ;;
  rebuild) exec "$REAL_NPM" "\$@" ;;
  *) exec "$REAL_NPM" "\$@" ;;
esac
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  [[ -d "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]
  run bash -c "cd '$MOCK_PLUGIN_ROOT' && node --input-type=module -e \"const D=(await import('better-sqlite3')).default; new D(':memory:').close()\""
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# ABI branch stops the live worker via the CORRECT data dir
# (regression guard: worker.pid lives under resolve_arcanon_data_dir(), i.e.
# $ARCANON_DATA_DIR / ~/.arcanon — NOT CLAUDE_PLUGIN_DATA).
# ---------------------------------------------------------------------------

@test "ABI branch kills the worker named in <data-dir>/worker.pid" {
  # Empty tree + a no-op npm stub: install never heals, so the script is forced
  # all the way to the rebuild branch (Step 5), which is where the worker stop
  # lives. No real binding or C toolchain needed.
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"

  cat > "$STUB_NPM_DIR/npm" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  # Worker data dir (resolve_arcanon_data_dir honours ARCANON_DATA_DIR first).
  WORKER_DATA="$(mktemp -d)"
  sleep 30 &
  local wpid=$!
  echo "$wpid" > "$WORKER_DATA/worker.pid"

  PATH="$STUB_NPM_DIR:$PATH" \
    ARCANON_DATA_DIR="$WORKER_DATA" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$?" -eq 0 ]

  # The worker process named in <data-dir>/worker.pid must have been killed.
  run kill -0 "$wpid"
  [ "$status" -ne 0 ]

  kill "$wpid" 2>/dev/null || true   # safety net if the assertion above failed
  rm -rf "$WORKER_DATA"
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
  if ! _have_real_binding; then skip "real better-sqlite3 binding not present"; fi
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
