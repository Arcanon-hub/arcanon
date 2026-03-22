#!/usr/bin/env bats
# tests/session-start.bats
# Bats test suite for scripts/session-start.sh
# Covers: SSTH-01 (event handling + JSON output), SSTH-02 (project type detection),
#         SSTH-03 (lightweight — no tool execution), SSTH-04 (disable env var),
#         SSTH-05 (deduplication)

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup() {
  # Create isolated temp plugin root with mock lib/detect.sh
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  mkdir -p "$MOCK_PLUGIN_ROOT/lib"

  # Copy the real hook script into the isolated root
  cp "$PROJECT_ROOT/plugins/ligamen/scripts/session-start.sh" "$MOCK_PLUGIN_ROOT/scripts/session-start.sh"

  # Write a mock lib/detect.sh that returns MOCK_PROJECT_TYPE
  cat > "$MOCK_PLUGIN_ROOT/lib/detect.sh" <<'MOCK'
# Mock detect.sh for testing
[[ "${BASH_SOURCE[0]}" != "${0}" ]] || exit 0
detect_project_type() {
  echo "${MOCK_PROJECT_TYPE:-}"
}
MOCK

  # Default project type for most tests
  MOCK_PROJECT_TYPE="Python"
  export MOCK_PROJECT_TYPE
  export MOCK_PLUGIN_ROOT

  # Source helpers
  # shellcheck source=tests/helpers/mock_detect.bash
  source "$PROJECT_ROOT/tests/helpers/mock_detect.bash"

  # Clean up any leftover flag files from prior runs
  cleanup_session_flags
}

teardown() {
  # Clean up dedup flag files created during tests
  cleanup_session_flags
  # Remove temp plugin root
  [[ -d "$MOCK_PLUGIN_ROOT" ]] && rm -rf "$MOCK_PLUGIN_ROOT"
}

# ---------------------------------------------------------------------------
# SSTH-01: Event handling and JSON output
# ---------------------------------------------------------------------------

@test "SSTH-01: exits 0 on SessionStart event" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-ss-01\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  rm -f /tmp/ligamen_session_bats-ss-01.initialized
}

@test "SSTH-01: exits 0 on UserPromptSubmit event" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-ss-02\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"UserPromptSubmit\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  rm -f /tmp/ligamen_session_bats-ss-02.initialized
}

@test "SSTH-01: emits additionalContext JSON on SessionStart" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-ss-03\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'hookSpecificOutput' in d, 'missing hookSpecificOutput'
assert 'additionalContext' in d['hookSpecificOutput'], 'missing additionalContext'
"
  rm -f /tmp/ligamen_session_bats-ss-03.initialized
}

@test "SSTH-01: hookEventName matches triggering event — SessionStart" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-ss-04\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['hookSpecificOutput']['hookEventName'] == 'SessionStart', \
    'expected SessionStart, got: ' + d['hookSpecificOutput']['hookEventName']
"
  rm -f /tmp/ligamen_session_bats-ss-04.initialized
}

@test "SSTH-01: hookEventName matches triggering event — UserPromptSubmit" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-ss-05\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"UserPromptSubmit\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['hookSpecificOutput']['hookEventName'] == 'UserPromptSubmit', \
    'expected UserPromptSubmit, got: ' + d['hookSpecificOutput']['hookEventName']
"
  rm -f /tmp/ligamen_session_bats-ss-05.initialized
}

# ---------------------------------------------------------------------------
# SSTH-02: Project type detection in output
# ---------------------------------------------------------------------------

@test "SSTH-02: output includes detected project type" {
  export MOCK_PROJECT_TYPE="Python"
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-pt-01\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ctx = d['hookSpecificOutput']['additionalContext']
assert 'Python' in ctx, 'expected Python in context: ' + ctx
"
  rm -f /tmp/ligamen_session_bats-pt-01.initialized
}

@test "SSTH-02: output includes ligamen command list" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-pt-02\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ctx = d['hookSpecificOutput']['additionalContext']
assert '/ligamen:cross-impact' in ctx, 'expected /ligamen:cross-impact in context: ' + ctx
"
  rm -f /tmp/ligamen_session_bats-pt-02.initialized
}

@test "SSTH-02: handles empty project type gracefully" {
  export MOCK_PROJECT_TYPE=""
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-pt-03\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ctx = d['hookSpecificOutput']['additionalContext']
assert 'Ligamen active.' in ctx, 'expected Ligamen active. in context: ' + ctx
assert 'Detected:' not in ctx, 'should not have Detected: when project type is empty: ' + ctx
"
  rm -f /tmp/ligamen_session_bats-pt-03.initialized
}

@test "SSTH-02: handles mixed project types" {
  export MOCK_PROJECT_TYPE="Python Node/TS"
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-pt-04\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ctx = d['hookSpecificOutput']['additionalContext']
assert 'Python' in ctx, 'expected Python in context: ' + ctx
assert 'Node/TS' in ctx, 'expected Node/TS in context: ' + ctx
"
  rm -f /tmp/ligamen_session_bats-pt-04.initialized
}

# ---------------------------------------------------------------------------
# SSTH-03: Lightweight — no tool subprocess execution
# ---------------------------------------------------------------------------

@test "SSTH-03: script does not fork tool subprocesses" {
  # Verify script source does not contain forbidden tool commands
  run bash -c "! grep -qE '(ruff|black|prettier|eslint|cargo clippy|rustfmt|gofmt|golangci-lint)' \
    '$PROJECT_ROOT/scripts/session-start.sh'"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# SSTH-04: Disable env var
# ---------------------------------------------------------------------------

@test "SSTH-04: LIGAMEN_DISABLE_SESSION_START suppresses hook output" {
  run bash -c "$(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dis-01\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | LIGAMEN_DISABLE_SESSION_START=1 CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "SSTH-04: LIGAMEN_DISABLE_SESSION_START exits 0 with empty value unset" {
  # Without the env var set, output should be present
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dis-02\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  rm -f /tmp/ligamen_session_bats-dis-02.initialized
}

# ---------------------------------------------------------------------------
# SSTH-05: Deduplication
# ---------------------------------------------------------------------------

@test "SSTH-05: second call with same session_id produces no output" {
  # First call: should produce output
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dup-01\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  # Second call with same session_id: should produce empty output
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dup-01\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"UserPromptSubmit\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  rm -f /tmp/ligamen_session_bats-dup-01.initialized
}

@test "SSTH-05: different session_id produces output again" {
  # Call with session A: produces output
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dup-02a\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  # Call with session B: also produces output (different session)
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dup-02b\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  rm -f /tmp/ligamen_session_bats-dup-02a.initialized
  rm -f /tmp/ligamen_session_bats-dup-02b.initialized
}

@test "SSTH-05: dedup flag file created in /tmp after first call" {
  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"session_id\":\"bats-dup-03\",\"cwd\":\"/tmp/test-project\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -f "/tmp/ligamen_session_bats-dup-03.initialized" ]
  rm -f /tmp/ligamen_session_bats-dup-03.initialized
}

# ---------------------------------------------------------------------------
# Non-blocking guarantee — graceful handling of edge-case inputs
# ---------------------------------------------------------------------------

@test "exits 0 with empty stdin (graceful handling of missing event data)" {
  # SessionStart may send empty or minimal stdin in some Claude Code versions.
  # The hook must never block — always exit 0 even with no parseable input.
  run bash -c "$(declare -p MOCK_PLUGIN_ROOT); \
    printf '' | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
}

@test "exits 0 with minimal JSON object (no session_id or cwd)" {
  # Some invocations may send minimal JSON — hook must handle gracefully.
  run bash -c "$(declare -p MOCK_PLUGIN_ROOT); \
    printf '{\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INTG-01: Worker auto-start when impact-map section present
# ---------------------------------------------------------------------------

@test "INTG-01a: worker_start_background called when config has impact-map section" {
  # Set up a temp CWD with ligamen.config.json containing impact-map
  MOCK_CWD="$(mktemp -d)"
  cat > "$MOCK_CWD/ligamen.config.json" <<'JSON'
{"impact-map": {}}
JSON

  # Install mock worker-client.sh that writes a sentinel file
  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<'MOCK'
worker_running() { return 1; }
worker_start_background() { touch /tmp/ligamen_test_worker_started_intg01a; return 0; }
worker_status_line() { echo "Ligamen worker: running (port 37888)"; }
MOCK

  # Clean up sentinel if it exists from a prior run
  rm -f /tmp/ligamen_test_worker_started_intg01a

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); $(declare -p MOCK_CWD); \
    printf '{\"session_id\":\"bats-intg-01a\",\"cwd\":\"'\"$MOCK_CWD\"'\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -f "/tmp/ligamen_test_worker_started_intg01a" ]

  rm -f /tmp/ligamen_test_worker_started_intg01a
  rm -f /tmp/ligamen_session_bats-intg-01a.initialized
  rm -rf "$MOCK_CWD"
}

@test "INTG-01b: worker_start_background NOT called when config has no impact-map section" {
  MOCK_CWD="$(mktemp -d)"
  cat > "$MOCK_CWD/ligamen.config.json" <<'JSON'
{"linked-repos": []}
JSON

  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<'MOCK'
worker_running() { return 1; }
worker_start_background() { touch /tmp/ligamen_test_worker_started_intg01b; return 0; }
worker_status_line() { echo "Ligamen worker: running (port 37888)"; }
MOCK

  rm -f /tmp/ligamen_test_worker_started_intg01b

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); $(declare -p MOCK_CWD); \
    printf '{\"session_id\":\"bats-intg-01b\",\"cwd\":\"'\"$MOCK_CWD\"'\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ ! -f "/tmp/ligamen_test_worker_started_intg01b" ]

  rm -f /tmp/ligamen_session_bats-intg-01b.initialized
  rm -rf "$MOCK_CWD"
}

@test "INTG-01c: hook exits 0 even if worker_start_background fails" {
  MOCK_CWD="$(mktemp -d)"
  cat > "$MOCK_CWD/ligamen.config.json" <<'JSON'
{"impact-map": {}}
JSON

  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<'MOCK'
worker_running() { return 1; }
worker_start_background() { return 1; }
worker_status_line() { return 0; }
MOCK

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); $(declare -p MOCK_CWD); \
    printf '{\"session_id\":\"bats-intg-01c\",\"cwd\":\"'\"$MOCK_CWD\"'\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]

  rm -f /tmp/ligamen_session_bats-intg-01c.initialized
  rm -rf "$MOCK_CWD"
}

@test "INTG-01d: hook exits 0 even if lib/worker-client.sh is absent" {
  MOCK_CWD="$(mktemp -d)"
  cat > "$MOCK_CWD/ligamen.config.json" <<'JSON'
{"impact-map": {}}
JSON

  # Remove worker-client.sh from mock plugin root
  rm -f "$MOCK_PLUGIN_ROOT/lib/worker-client.sh"

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); $(declare -p MOCK_CWD); \
    printf '{\"session_id\":\"bats-intg-01d\",\"cwd\":\"'\"$MOCK_CWD\"'\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]

  rm -f /tmp/ligamen_session_bats-intg-01d.initialized
  rm -rf "$MOCK_CWD"
}

@test "INTG-02: hook still outputs additionalContext JSON when impact-map present" {
  MOCK_CWD="$(mktemp -d)"
  cat > "$MOCK_CWD/ligamen.config.json" <<'JSON'
{"impact-map": {}}
JSON

  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<'MOCK'
worker_running() { return 1; }
worker_start_background() { return 0; }
worker_status_line() { return 0; }
MOCK

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT); $(declare -p MOCK_CWD); \
    printf '{\"session_id\":\"bats-intg-02\",\"cwd\":\"'\"$MOCK_CWD\"'\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'hookSpecificOutput' in d, 'missing hookSpecificOutput'
assert 'additionalContext' in d['hookSpecificOutput'], 'missing additionalContext'
ctx = d['hookSpecificOutput']['additionalContext']
assert 'Ligamen active' in ctx, 'expected Ligamen active in context: ' + ctx
assert '/ligamen:cross-impact' in ctx, 'expected commands in context: ' + ctx
"

  rm -f /tmp/ligamen_session_bats-intg-02.initialized
  rm -rf "$MOCK_CWD"
}
