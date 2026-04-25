#!/usr/bin/env bats
# update-check.bats — UPD-04/05/06: /arcanon:update --check decouples
# offline-decision from claude-plugin-marketplace-update refresh-process
# outcome. The mirror file is the source of truth.
#
# Refs: THE-1027, plan 108-01.
#
# Strategy (per CONTEXT D-02):
#   - Stub `claude` binary in a per-test PATH prefix so the background refresh
#     either sleeps (slow) or exits fast (offline regression case).
#   - Override HOME to a temp dir so the marketplace mirror file path is
#     entirely under test control.
#   - The 5s timer in update.sh fires regardless; the test asserts that the
#     OUTCOME of the refresh process does NOT determine status — the mirror
#     file existence and its `version` field are the only inputs that matter.

setup() {
  PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
  TEST_HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$TEST_HOME"
  STUB_DIR="$BATS_TEST_TMPDIR/stubs"
  mkdir -p "$STUB_DIR"
  export HOME="$TEST_HOME"
  export PATH="$STUB_DIR:$PATH"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
}

# Helper: stub the `claude` binary to sleep N seconds then exit 0.
# Used by UPD-04 and UPD-06 to simulate a slow `claude plugin marketplace update`
# that exceeds the 5s timer in update.sh.
stub_slow_claude() {
  local sleep_secs="$1"
  cat >"$STUB_DIR/claude" <<EOF
#!/bin/sh
sleep $sleep_secs
exit 0
EOF
  chmod +x "$STUB_DIR/claude"
}

# Helper: stub the `claude` binary to return immediately.
# Used by UPD-05 to keep the test fast — the refresh outcome is irrelevant
# for the missing-mirror regression case.
stub_fast_claude() {
  cat >"$STUB_DIR/claude" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$STUB_DIR/claude"
}

# Helper: write the marketplace mirror file with a given version string.
write_mirror() {
  local version="$1"
  local mirror_dir="$TEST_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin"
  mkdir -p "$mirror_dir"
  printf '{"version":"%s","name":"arcanon"}\n' "$version" > "$mirror_dir/marketplace.json"
}

# Helper: read the installed version from the plugin under test.
installed_version() {
  jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json"
}

# ─── UPD-04 ──────────────────────────────────────────────────────────────────
# Slow `claude plugin marketplace update` (10s sleep, hits the 5s timer) +
# mirror file present with a strictly-newer version → status MUST be "newer",
# NOT "offline". This is the THE-1027 bug-fix case.
@test "UPD-04: slow marketplace refresh with mirror ahead returns status:newer not offline" {
  stub_slow_claude 10

  CUR=$(installed_version)
  # Bump patch by 1 for the mirror version. semver.gt(remote, installed) → newer.
  REMOTE_VER=$(echo "$CUR" | awk -F. '{ printf "%s.%s.%d", $1, $2, ($3 + 1) }')
  write_mirror "$REMOTE_VER"

  run bash "$PLUGIN_ROOT/scripts/update.sh" --check
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.status')" = "newer" ]
  [ "$(echo "$output" | jq -r '.remote')" = "$REMOTE_VER" ]
  [ "$(echo "$output" | jq -r '.update_available')" = "true" ]
}

# ─── UPD-05 ──────────────────────────────────────────────────────────────────
# Genuinely-offline regression guard: HOME has no .claude/plugins tree at all,
# so the mirror file is absent → status MUST be "offline" with remote=null.
# Stub claude exits fast so the test completes in well under 1s.
@test "UPD-05: missing marketplace mirror dir returns status:offline" {
  stub_fast_claude
  # Sanity check: confirm the mirror really is missing.
  [ ! -e "$TEST_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json" ]

  run bash "$PLUGIN_ROOT/scripts/update.sh" --check
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.status')" = "offline" ]
  [ "$(echo "$output" | jq -r '.remote')" = "null" ]
  [ "$(echo "$output" | jq -r '.update_available')" = "false" ]
}

# ─── UPD-06 ──────────────────────────────────────────────────────────────────
# Slow `claude plugin marketplace update` (10s sleep, hits the 5s timer) +
# mirror file present with the SAME version as installed → status MUST be
# "equal" regardless of the refresh-process outcome. Confirms the equal-version
# path is independent of the refresh timer.
@test "UPD-06: slow marketplace refresh with mirror at same version returns status:equal" {
  stub_slow_claude 10

  CUR=$(installed_version)
  write_mirror "$CUR"

  run bash "$PLUGIN_ROOT/scripts/update.sh" --check
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.status')" = "equal" ]
  [ "$(echo "$output" | jq -r '.update_available')" = "false" ]
}
