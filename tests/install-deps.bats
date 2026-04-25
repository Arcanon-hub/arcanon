#!/usr/bin/env bats
# tests/install-deps.bats
# Bats tests for scripts/install-deps.sh (Phase 107 architecture)
# Covers: INST-04, INST-05, INST-07, INST-08, INST-09, INST-10, INST-11, INST-12

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
INSTALL_SCRIPT="$PROJECT_ROOT/plugins/arcanon/scripts/install-deps.sh"
HOOKS_FILE="$PROJECT_ROOT/plugins/arcanon/hooks/hooks.json"
REAL_PLUGIN_ROOT="$PROJECT_ROOT/plugins/arcanon"
REAL_PACKAGE_JSON="$REAL_PLUGIN_ROOT/package.json"

# ---------------------------------------------------------------------------
# Helpers (scenario-local; no edits to test_helper.bash per scope guardrails)
# ---------------------------------------------------------------------------

# compute_expected_hash: mirrors the canonical compute_hash() in install-deps.sh
_compute_expected_hash() {
  local pkg="$1"
  jq -c -S '.dependencies + .optionalDependencies' "$pkg" 2>/dev/null \
    | shasum -a 256 \
    | awk '{print $1}'
}

# install_npm_stub: writes a fake `npm` to a tmp dir that records every
# invocation as one line into $NPM_INVOKED_MARKER. The stub itself exits 0.
_install_recording_npm_stub() {
  local stub_dir="$1"
  cat > "$stub_dir/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $*" >> "${NPM_INVOKED_MARKER}"
exit 0
STUB
  chmod +x "$stub_dir/npm"
}

setup() {
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  MOCK_PLUGIN_DATA="$(mktemp -d)"
  STUB_NPM_DIR="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"

  # Copy install-deps.sh into the mock plugin root
  cp "$INSTALL_SCRIPT" "$MOCK_PLUGIN_ROOT/scripts/"

  # Write a package.json that mirrors the REAL plugin's runtime deps so
  # tests using the symlink/copy fixture pattern produce a hash that matches
  # whatever node_modules tree we attach.
  cp "$REAL_PACKAGE_JSON" "$MOCK_PLUGIN_ROOT/package.json"

  EXPECTED_HASH="$(_compute_expected_hash "$MOCK_PLUGIN_ROOT/package.json")"

  # NPM_INVOKED_MARKER is the marker file the stub writes to. Tests that
  # need it set their own path; we just export an empty default here.
  export NPM_INVOKED_MARKER=""

  export MOCK_PLUGIN_ROOT MOCK_PLUGIN_DATA STUB_NPM_DIR EXPECTED_HASH
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
# INST-04: hooks.json registration (preserved from former DEPS-03/DEPS-04)
# ---------------------------------------------------------------------------

@test "INST-04: hooks.json install-deps entry has timeout >= 120" {
  run jq -r '.hooks.SessionStart[0].hooks[] | select(.command | endswith("install-deps.sh")) | .timeout' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [ "$output" -ge 120 ]
}

@test "INST-04: install-deps.sh runs before session-start.sh in hooks.json" {
  run jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"install-deps.sh" ]]
}

@test "INST-04: session-start.sh is second in SessionStart hooks array" {
  run jq -r '.hooks.SessionStart[0].hooks[1].command' "$HOOKS_FILE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"session-start.sh" ]]
}

# ---------------------------------------------------------------------------
# INST-05: Non-blocking guarantee + clean stdout (folded from old DEPS-01)
# ---------------------------------------------------------------------------

@test "INST-05: exits 0 when CLAUDE_PLUGIN_DATA is unset (dev mode, non-blocking)" {
  run env -u CLAUDE_PLUGIN_DATA \
    bash -c "CLAUDE_PLUGIN_ROOT='$MOCK_PLUGIN_ROOT' \
      bash '$MOCK_PLUGIN_ROOT/scripts/install-deps.sh'"
  [ "$status" -eq 0 ]
  # Sentinel must NOT have been written — no DATA dir to write to
  [ ! -f "$MOCK_PLUGIN_ROOT/.arcanon-deps-sentinel" ]
}

@test "INST-05: produces no stdout output (hook stdout must stay clean)" {
  # Seed the happy path: matching sentinel + symlinked real node_modules
  echo "$EXPECTED_HASH" > "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel"
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"

  STDOUT_ONLY=$(CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh" 2>/dev/null)
  [ -z "$STDOUT_ONLY" ]
}

# ---------------------------------------------------------------------------
# INST-07: happy-path skip — sentinel matches + binding loads + no npm + <100ms
# ---------------------------------------------------------------------------

@test "INST-07: happy path skips install — no npm process spawned, <threshold ms latency" {
  # Skip if real binding fixture is not available (project must be `npm install`-ed)
  if [[ ! -d "$REAL_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]; then
    skip "Real better-sqlite3 binding not present (run 'npm install --prefix plugins/arcanon' first)"
  fi

  # Pre-write the matching sentinel and symlink the real node_modules tree
  echo "$EXPECTED_HASH" > "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel"
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"

  # PATH-stub pattern: any npm invocation appends a line to NPM_INVOKED_MARKER
  NPM_INVOKED_MARKER="$(mktemp -u)"   # path only; file should never be created
  export NPM_INVOKED_MARKER
  _install_recording_npm_stub "$STUB_NPM_DIR"

  # Latency thresholds (CONTEXT D-08): 100ms is the in-script logic budget;
  # the bats subprocess measurement includes bash + node startup overhead
  # (~80-150ms on Apple Silicon for `bash -c` + `node -e` together — see
  # 107-02-SUMMARY live verification: "Second run rc=0, elapsed=173ms ...
  # process startup included"). The wall-clock threshold of 250ms is the
  # regression detector here: any value above this signals the happy-path
  # short-circuit was missed and an npm invocation snuck in. CI ceiling is
  # 5x headroom (500ms) per the v0.1.1 IMPACT_HOOK_LATENCY_THRESHOLD pattern;
  # INSTALL_DEPS_LATENCY_THRESHOLD env override is provided for tuning.
  if [[ -n "${INSTALL_DEPS_LATENCY_THRESHOLD:-}" ]]; then
    THRESHOLD_MS="$INSTALL_DEPS_LATENCY_THRESHOLD"
  elif [[ -n "${CI:-}" ]]; then
    THRESHOLD_MS=500
  else
    THRESHOLD_MS=250
  fi

  # EPOCHREALTIME is bash 5+; fall back to python3 if unavailable
  if [[ -n "${EPOCHREALTIME:-}" ]]; then
    START="${EPOCHREALTIME}"
  else
    START="$(python3 -c 'import time; print(time.time())')"
  fi

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  RC=$?

  if [[ -n "${EPOCHREALTIME:-}" ]]; then
    END="${EPOCHREALTIME}"
  else
    END="$(python3 -c 'import time; print(time.time())')"
  fi

  ELAPSED_MS=$(awk "BEGIN { printf \"%d\", ($END - $START) * 1000 }")

  # Surface measurement to bats output for visibility on failure
  echo "INST-07: elapsed=${ELAPSED_MS}ms threshold=${THRESHOLD_MS}ms"

  [ "$RC" -eq 0 ]
  [[ "$ELAPSED_MS" -lt "$THRESHOLD_MS" ]]

  # No npm process ever spawned → marker file never created
  [[ ! -f "$NPM_INVOKED_MARKER" ]]

  # Sentinel content unchanged (still the canonical hash)
  ACTUAL_SENTINEL="$(cat "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" | tr -d '[:space:]')"
  [[ "$ACTUAL_SENTINEL" == "$EXPECTED_HASH" ]]
}

# ---------------------------------------------------------------------------
# INST-08: broken-binding detection + rebuild restoration
# ---------------------------------------------------------------------------

@test "INST-08: broken binding triggers rebuild and binding loads after" {
  if [[ ! -d "$REAL_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]; then
    skip "Real better-sqlite3 binding not present (run 'npm install --prefix plugins/arcanon' first)"
  fi
  if ! command -v cc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
    skip "C toolchain required for native rebuild (no cc/clang on PATH)"
  fi

  # Mutation-safe: copy the real node_modules into the mock root, then break
  # the binding by deleting build/Release/. The pre-written sentinel matches
  # the canonical hash so the install path is skipped — only rebuild runs.
  run cp -R "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"
  [ "$status" -eq 0 ]
  run rm -rf "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release"
  [ "$status" -eq 0 ]
  printf '%s\n' "$EXPECTED_HASH" > "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel"

  # Confirm validate_binding fails BEFORE running install-deps.sh.
  # Note: bare require('better-sqlite3') succeeds — only the Database
  # constructor triggers the native-binding lookup via the bindings package.
  # validate_binding() in install-deps.sh uses the same instantiation form.
  run bash -c "cd '$MOCK_PLUGIN_ROOT' && node -e \"const D=require('better-sqlite3'); new D(':memory:').close()\" >/dev/null 2>&1"
  [ "$status" -ne 0 ]

  # Run install-deps.sh — must take the rebuild path, not the install path
  run env CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ "$status" -eq 0 ]

  # build/Release restored by `npm rebuild better-sqlite3`
  [[ -d "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]

  # Binding now loads cleanly from the mock root
  run bash -c "cd '$MOCK_PLUGIN_ROOT' && node -e \"const D=require('better-sqlite3'); new D(':memory:').close()\""
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INST-09: prebuild silent-fail — install reports success, binding broken,
# rebuild fixes
# ---------------------------------------------------------------------------

@test "INST-09: prebuild silent-fail — rebuild path engages and fixes binding" {
  if [[ ! -d "$REAL_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]; then
    skip "Real better-sqlite3 binding not present (run 'npm install --prefix plugins/arcanon' first)"
  fi
  if ! command -v cc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
    skip "C toolchain required for native rebuild (no cc/clang on PATH)"
  fi

  # Empty node_modules + missing sentinel → install path will engage
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"
  rm -f  "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel"

  # Resolve the real npm so the stub can delegate `npm rebuild` to it
  REAL_NPM="$(command -v npm)"
  [[ -n "$REAL_NPM" ]]

  # Stub: `npm install` simulates prebuild silent failure (copies a tree but
  # wipes build/Release/); `npm rebuild` delegates to the real npm so the
  # rebuild actually fixes the binding.
  cat > "$STUB_NPM_DIR/npm" <<STUB
#!/usr/bin/env bash
# Find the --prefix value (install-deps.sh always passes --prefix \$PLUGIN_ROOT)
PREFIX=""
ARGS=("\$@")
for ((i=0; i<\${#ARGS[@]}; i++)); do
  if [[ "\${ARGS[\$i]}" == "--prefix" && \$((i+1)) -lt \${#ARGS[@]} ]]; then
    PREFIX="\${ARGS[\$((i+1))]}"
    break
  fi
done

case "\$1" in
  install)
    # Simulate "successful install with broken binding": copy the real tree
    # into PREFIX, then wipe build/Release/ to mimic prebuild-install silent fail.
    if [[ -n "\$PREFIX" ]]; then
      cp -R "$REAL_PLUGIN_ROOT/node_modules" "\$PREFIX/node_modules"
      rm -rf "\$PREFIX/node_modules/better-sqlite3/build/Release"
    fi
    exit 0
    ;;
  rebuild)
    # Delegate to the real npm so the rebuild actually compiles
    exec "$REAL_NPM" "\$@"
    ;;
  *)
    exec "$REAL_NPM" "\$@"
    ;;
esac
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ $? -eq 0 ]

  # Rebuild path engaged → build/Release restored
  [[ -d "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]

  # Sentinel written — install-deps.sh only writes on successful validation
  [[ -f "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" ]]
  ACTUAL_SENTINEL="$(cat "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" | tr -d '[:space:]')"
  [[ "$ACTUAL_SENTINEL" == "$EXPECTED_HASH" ]]
}

# ---------------------------------------------------------------------------
# INST-10: fresh install — empty node_modules + no sentinel
# ---------------------------------------------------------------------------

@test "INST-10: fresh install runs npm install, validates, writes sentinel" {
  if [[ ! -d "$REAL_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]; then
    skip "Real better-sqlite3 binding not present (run 'npm install --prefix plugins/arcanon' first)"
  fi

  # Fresh state: no node_modules, no sentinel
  rm -rf "$MOCK_PLUGIN_ROOT/node_modules"
  rm -f  "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel"

  REAL_NPM="$(command -v npm)"
  [[ -n "$REAL_NPM" ]]

  # Stub: `npm install` copies the pre-built tree into PREFIX (fast — avoids
  # the multi-second native rebuild on every test run); other npm commands
  # delegate to the real npm.
  cat > "$STUB_NPM_DIR/npm" <<STUB
#!/usr/bin/env bash
PREFIX=""
ARGS=("\$@")
for ((i=0; i<\${#ARGS[@]}; i++)); do
  if [[ "\${ARGS[\$i]}" == "--prefix" && \$((i+1)) -lt \${#ARGS[@]} ]]; then
    PREFIX="\${ARGS[\$((i+1))]}"
    break
  fi
done

case "\$1" in
  install)
    if [[ -n "\$PREFIX" ]]; then
      cp -R "$REAL_PLUGIN_ROOT/node_modules" "\$PREFIX/node_modules"
    fi
    exit 0
    ;;
  *)
    exec "$REAL_NPM" "\$@"
    ;;
esac
STUB
  chmod +x "$STUB_NPM_DIR/npm"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ $? -eq 0 ]

  # node_modules populated
  [[ -d "$MOCK_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]

  # Sentinel written with the canonical hash
  [[ -f "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" ]]
  ACTUAL_SENTINEL="$(cat "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" | tr -d '[:space:]')"
  [[ "$ACTUAL_SENTINEL" == "$EXPECTED_HASH" ]]
}

# ---------------------------------------------------------------------------
# INST-11: sentinel mismatch — bogus hex triggers reinstall + sentinel update
# ---------------------------------------------------------------------------

@test "INST-11: sentinel mismatch — install runs, sentinel updated to canonical hash" {
  if [[ ! -d "$REAL_PLUGIN_ROOT/node_modules/better-sqlite3/build/Release" ]]; then
    skip "Real better-sqlite3 binding not present (run 'npm install --prefix plugins/arcanon' first)"
  fi

  # Bogus hex — different from $EXPECTED_HASH
  BOGUS_HASH="0000000000000000000000000000000000000000000000000000000000000000"
  echo "$BOGUS_HASH" > "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel"

  # Symlink the real tree (read-only) so validate_binding succeeds after install
  ln -s "$REAL_PLUGIN_ROOT/node_modules" "$MOCK_PLUGIN_ROOT/node_modules"

  REAL_NPM="$(command -v npm)"

  # Recording stub: writes invocation lines to NPM_INVOKED_MARKER and exits 0
  # (no real install needed — the symlinked node_modules already satisfies
  # validate_binding). This proves the mismatch DID trigger npm.
  NPM_INVOKED_MARKER="$(mktemp -u)"
  export NPM_INVOKED_MARKER
  _install_recording_npm_stub "$STUB_NPM_DIR"

  PATH="$STUB_NPM_DIR:$PATH" \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$MOCK_PLUGIN_DATA" \
    bash "$MOCK_PLUGIN_ROOT/scripts/install-deps.sh"
  [ $? -eq 0 ]

  # The recording stub MUST have been hit (mismatch path → npm install)
  [[ -f "$NPM_INVOKED_MARKER" ]]
  grep -q "^npm install" "$NPM_INVOKED_MARKER"

  # Sentinel updated to the canonical hash
  ACTUAL_SENTINEL="$(cat "$MOCK_PLUGIN_DATA/.arcanon-deps-sentinel" | tr -d '[:space:]')"
  [[ "$ACTUAL_SENTINEL" == "$EXPECTED_HASH" ]]
  [[ "$ACTUAL_SENTINEL" != "$BOGUS_HASH" ]]
}

# ---------------------------------------------------------------------------
# INST-12: integration smoke — auto-skips when claude CLI is unavailable.
# Manual fresh-install smoke is handed off to Phase 113 VER-05.
# ---------------------------------------------------------------------------

@test "INST-12: fresh-install integration smoke (auto-skip if claude unavailable)" {
  if ! command -v claude >/dev/null 2>&1; then
    skip "Claude Code CLI not on PATH — manual smoke required (handed to Phase 113 VER-05)"
  fi

  # Run against the REAL plugin root (this is the real path, not a mock).
  # Use a temp data dir so we don't pollute $HOME/.arcanon on the dev machine.
  TMP_DATA_DIR="$(mktemp -d)"

  # Trigger SessionStart-equivalent: run install-deps.sh as Claude Code would.
  CLAUDE_PLUGIN_ROOT="$REAL_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$TMP_DATA_DIR" \
    bash "$INSTALL_SCRIPT"
  RC=$?

  # Sentinel must exist after a real install run
  [ "$RC" -eq 0 ]
  [[ -f "$TMP_DATA_DIR/.arcanon-deps-sentinel" ]]

  # Binding must load against the real plugin tree
  ( cd "$REAL_PLUGIN_ROOT" && node -e \
      "const D=require('better-sqlite3'); new D(':memory:').close()" )
  [ $? -eq 0 ]

  rm -rf "$TMP_DATA_DIR"
}
