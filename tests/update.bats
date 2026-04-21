#!/usr/bin/env bats
# tests/update.bats — /arcanon:update command and scripts/update.sh (Phase 98, plan 98-01).
# Covers UPD-01 (installed vs remote read), UPD-02/UPD-13 (semver matrix),
# UPD-03 (latest release path), UPD-04 (changelog preview), UPD-11 (offline fallback).

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"

setup() {
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  # Isolate marketplaces dir so we can control remote version under test.
  TEST_FAKE_HOME="$(mktemp -d)"
  export HOME="$TEST_FAKE_HOME"
  mkdir -p "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin"
}

teardown() {
  rm -rf "$TEST_FAKE_HOME"
}

write_remote_manifest() {
  local version="$1"
  local changelog="${2:-}"
  cat > "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json" <<EOF
{"version":"${version}"}
EOF
  if [[ -n "$changelog" ]]; then
    printf '%s\n' "$changelog" > "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/CHANGELOG.md"
  fi
}

# Skip the `claude plugin marketplace update` refresh for test isolation — write
# the manifest directly and shim `claude` to a no-op. Otherwise tests hit the network.
shim_claude() {
  mkdir -p "$TEST_FAKE_HOME/bin"
  cat > "$TEST_FAKE_HOME/bin/claude" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$TEST_FAKE_HOME/bin/claude"
  export PATH="$TEST_FAKE_HOME/bin:$PATH"
}

# ─── UPD-02 / UPD-13: semver comparison matrix ──────────────────────────────
@test "UPD-13: node+semver says 0.10.0 > 0.9.0 (not lexicographic)" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.gt('0.10.0','0.9.0')?0:1)"
  assert_success
}

@test "UPD-13: node+semver says 0.10.0 is NOT less than 0.9.0 (anti-lex proof)" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.lt('0.10.0','0.9.0')?0:1)"
  # If lexical compare was used, "0.10.0" < "0.9.0" would be TRUE and exit 0.
  # semver.lt('0.10.0','0.9.0') is FALSE, so this must exit 1 (assert_failure).
  assert_failure
}

@test "UPD-13: node+semver says 0.1.1 > 0.1.0" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.gt('0.1.1','0.1.0')?0:1)"
  assert_success
}

@test "UPD-13: node+semver says 1.0.0 == 1.0.0" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.eq('1.0.0','1.0.0')?0:1)"
  assert_success
}

# ─── UPD-01 / UPD-03: update.sh --check, installed==remote path ──────────────
@test "UPD-03: --check emits status=equal when installed matches remote" {
  shim_claude
  INSTALLED=$(jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")
  write_remote_manifest "$INSTALLED"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.status'"
  assert_success
  assert_output "equal"
}

# ─── UPD-04: changelog preview when newer ─────────────────────────────────────
@test "UPD-04: --check emits non-empty changelog_preview when remote is newer" {
  shim_claude
  write_remote_manifest "99.99.99" "$(cat <<'CHG'
# Changelog

## [Unreleased]

- Fix something critical
- Add helpful feature
CHG
)"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.changelog_preview'"
  assert_success
  [[ "$output" == *"Fix something critical"* ]] || { echo "preview missing expected bullet: $output"; return 1; }
}

@test "UPD-04: --check marks update_available=true when remote is newer" {
  shim_claude
  write_remote_manifest "99.99.99"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.update_available'"
  assert_success
  assert_output "true"
}

# ─── UPD-11: offline graceful fallback ────────────────────────────────────────
@test "UPD-11: --check exits 0 with status=offline when marketplace manifest is absent" {
  shim_claude
  # Do NOT write the manifest — simulate "could not reach update server"
  rm -rf "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.status'"
  assert_success
  assert_output "offline"
}

# ─── Output shape validation ──────────────────────────────────────────────────
@test "--check emits valid JSON with all required keys" {
  shim_claude
  write_remote_manifest "99.99.99"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -e 'has(\"status\") and has(\"installed\") and has(\"remote\") and has(\"update_available\") and has(\"changelog_preview\")'"
  assert_success
}

# ─── UPD-07 / UPD-08: --kill mode tests (Phase 98, plan 98-02) ───────────────

# UPD-07: scan-lock abort (live lock)
@test "UPD-07: --kill emits scan_in_progress when scan.lock has a live PID" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  # Create a scan.lock containing a live PID (use $$ — the current shell)
  echo "$$" > "${ARCANON_DATA_DIR}/scan.lock"
  # Also create a worker.pid (so --kill would be tempted to act without the lock guard)
  echo "$$" > "${ARCANON_DATA_DIR}/worker.pid"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.status'"
  assert_success
  assert_output "scan_in_progress"

  # worker.pid must still exist — we did NOT kill
  [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker.pid was removed despite scan_in_progress"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-07: stale scan.lock is cleared and kill proceeds
@test "UPD-07: --kill clears stale scan.lock (dead PID) and proceeds" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  # PID 999999 is virtually guaranteed not to exist on a test machine
  echo "999999" > "${ARCANON_DATA_DIR}/scan.lock"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.status'"
  assert_success
  assert_output "killed"

  # scan.lock should be gone now
  [[ ! -f "${ARCANON_DATA_DIR}/scan.lock" ]] || { echo "stale scan.lock was not cleared"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-08: sigterm path with live worker
@test "UPD-08: --kill sends SIGTERM and removes worker.pid/worker.port on live worker" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export ARCANON_WORKER_PORT="37999"

  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null
  # shellcheck source=../plugins/arcanon/lib/worker-client.sh
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker never started"; return 1; }
  local pre_pid; pre_pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.status'"
  assert_success
  assert_output "killed"

  # worker.pid and worker.port must be gone
  [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker.pid survived --kill"; return 1; }
  [[ ! -f "${ARCANON_DATA_DIR}/worker.port" ]] || { echo "worker.port survived --kill"; return 1; }

  # Worker process must be gone (give kernel 0.5s to reap)
  sleep 0.5
  ! kill -0 "$pre_pid" 2>/dev/null || { echo "worker PID $pre_pid still alive after --kill"; kill -9 "$pre_pid"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-08: no-pid path
@test "UPD-08: --kill emits reason=no_pid_file when worker not running" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.reason'"
  assert_success
  assert_output "no_pid_file"

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-08: update.sh never references restart_worker_if_stale or worker_start_background (Anti-Pattern 2 regression guard)
@test "UPD-08: scripts/update.sh does not reference restart_worker_if_stale or worker_start_background" {
  run grep -E 'restart_worker_if_stale|worker_start_background' "$PLUGIN_ROOT/scripts/update.sh"
  # grep exits 1 when no match — that's success for us
  assert_failure
}

# UPD-08: after --kill, no new Arcanon worker has been started
@test "UPD-08: --kill does not spawn a new worker (kill-only semantics)" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export ARCANON_WORKER_PORT="37999"

  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  bash "$PLUGIN_ROOT/scripts/update.sh" --kill >/dev/null
  sleep 0.5

  # No worker.pid file means no new worker started (--kill is kill-only, 98-03 starts the new one)
  [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker.pid reappeared — --kill spawned a new worker"; return 1; }

  # No Node process listening on 37999
  ! lsof -i :37999 >/dev/null 2>&1 || { echo "something is listening on 37999 after --kill"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# ─── UPD-09 / UPD-10 / UPD-12: --prune-cache and --verify (Phase 98, plan 98-03) ───

# UPD-09: current version is kept, not pruned
@test "UPD-09: --prune-cache never prunes the current version dir" {
  TEST_CACHE_HOME="$(mktemp -d)"
  export HOME="$TEST_CACHE_HOME"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  CURRENT_VER=$(jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")

  # Synthesize a fake cache layout with the current version present
  mkdir -p "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$CURRENT_VER"
  touch "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$CURRENT_VER/marker"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --prune-cache | jq -r '.kept | length'"
  assert_success
  [[ "$output" -ge 1 ]] || { echo "kept list is empty"; return 1; }

  # Current dir must still exist
  [[ -f "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$CURRENT_VER/marker" ]] || {
    echo "current-version dir was wrongly deleted"; return 1;
  }

  rm -rf "$TEST_CACHE_HOME"
}

# UPD-09: old version is pruned
@test "UPD-09: --prune-cache deletes non-current version dirs" {
  TEST_CACHE_HOME="$(mktemp -d)"
  export HOME="$TEST_CACHE_HOME"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  CURRENT_VER=$(jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")
  OLD_VER="0.0.1-test"

  mkdir -p "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$CURRENT_VER"
  mkdir -p "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$OLD_VER"
  touch "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$OLD_VER/old-marker"

  run bash "$PLUGIN_ROOT/scripts/update.sh" --prune-cache
  assert_success

  # Old dir must be gone
  [[ ! -d "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$OLD_VER" ]] || {
    echo "old-version dir was not pruned"; return 1;
  }
  # Current dir must still exist
  [[ -d "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$CURRENT_VER" ]] || {
    echo "current-version dir was wrongly deleted"; return 1;
  }

  rm -rf "$TEST_CACHE_HOME"
}

# UPD-09: lsof guard keeps dirs with active handles
@test "UPD-09: --prune-cache skips dirs with active file handles (lsof guard)" {
  # Skip if lsof is unavailable (CI without lsof).
  command -v lsof >/dev/null 2>&1 || skip "lsof not available"

  TEST_CACHE_HOME="$(mktemp -d)"
  export HOME="$TEST_CACHE_HOME"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  CURRENT_VER=$(jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")
  OLD_VER="0.0.2-test"

  mkdir -p "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$CURRENT_VER"
  mkdir -p "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$OLD_VER"

  # Hold an open directory handle via a background subshell cd'ing into the old dir.
  # lsof +D detects open *directory* handles (cwd of a process), not just open files.
  # This matches the real-world scenario: a worker process running from inside a cache dir.
  OLD_CACHE_DIR="$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$OLD_VER"
  ( cd "$OLD_CACHE_DIR" && sleep 10 ) &
  HOLD_PID=$!
  sleep 0.3  # let the subshell establish the directory handle

  run bash "$PLUGIN_ROOT/scripts/update.sh" --prune-cache
  assert_success

  # Kill the holder BEFORE assertions — so teardown always cleans up even on failure
  kill "$HOLD_PID" 2>/dev/null || true

  # Old dir must still exist (locked, not pruned)
  [[ -d "$TEST_CACHE_HOME/.claude/plugins/cache/arcanon/arcanon/$OLD_VER" ]] || {
    echo "locked dir was wrongly pruned"; return 1;
  }

  rm -rf "$TEST_CACHE_HOME"
}

# UPD-10: --verify success path
@test "UPD-10: --verify starts worker and reports status=verified when versions match" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export ARCANON_WORKER_PORT="37997"

  # No worker running — --verify must start one.
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --verify | jq -er '.status'"
  assert_success
  assert_output "verified"

  # Cleanup
  bash "$PLUGIN_ROOT/scripts/worker-stop.sh" >/dev/null 2>&1 || true
  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-10: --verify exits 0 even on failure (graceful fallback per Pitfall 11)
# Sabotage: replace worker-start.sh with a no-op so no worker ever spawns.
# The poll loop times out after 10 iterations and emits verify_failed.
@test "UPD-10: --verify exits 0 on timeout (does not fail the caller)" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export ARCANON_WORKER_PORT="37996"

  # Build a fake PLUGIN_ROOT that has the real lib/ dir but a no-op worker-start.sh.
  FAKE_ROOT="$(mktemp -d)"
  # Symlink lib/ and .claude-plugin/ so version resolution works
  ln -s "$PLUGIN_ROOT/lib"             "$FAKE_ROOT/lib"
  ln -s "$PLUGIN_ROOT/.claude-plugin"  "$FAKE_ROOT/.claude-plugin"
  ln -s "$PLUGIN_ROOT/package.json"    "$FAKE_ROOT/package.json" 2>/dev/null || true
  mkdir -p "$FAKE_ROOT/scripts"
  # No-op worker-start.sh — exits immediately without spawning a worker
  printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_ROOT/scripts/worker-start.sh"
  chmod +x "$FAKE_ROOT/scripts/worker-start.sh"

  export CLAUDE_PLUGIN_ROOT="$FAKE_ROOT"

  # Run the real update.sh (from PLUGIN_ROOT) but with CLAUDE_PLUGIN_ROOT=FAKE_ROOT
  # so it picks up the no-op worker-start.sh and never gets a worker response.
  run bash "$PLUGIN_ROOT/scripts/update.sh" --verify
  assert_success  # exit 0 even on timeout

  VERIFY_STATUS=$(printf '%s' "$output" | jq -r '.status' 2>/dev/null || true)
  [[ "$VERIFY_STATUS" == "verify_failed" ]] || { echo "expected verify_failed, got: $VERIFY_STATUS (output: $output)"; return 1; }

  rm -rf "$ARCANON_DATA_DIR" "$FAKE_ROOT"
}

# UPD-12: final "Restart Claude Code" message is present in commands/update.md
@test "UPD-12: commands/update.md contains 'Restart Claude Code to activate' in a success path" {
  run grep -cE 'Restart Claude Code to activate' "$PLUGIN_ROOT/commands/update.md"
  assert_success
  [[ "$output" -ge 1 ]] || { echo "final message missing from commands/update.md"; return 1; }
}
