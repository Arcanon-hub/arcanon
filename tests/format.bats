#!/usr/bin/env bats
# AllClear — format.bats
# Tests: TEST-01 (per-language formatter invocation), TEST-07 (non-blocking guarantee)
# Covers: FMTH-07 (silent success), FMTH-09 (skip generated directories)

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  SCRIPT="${BATS_TEST_DIRNAME}/../scripts/format.sh"
  STUB_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

teardown() {
  rm -rf "${STUB_DIR}"
}

# ---------------------------------------------------------------------------
# Non-blocking guarantee (TEST-07)
# ---------------------------------------------------------------------------

@test "format hook - exits 0 when ruff absent (python)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - exits 0 when rustfmt absent (rust)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.rs"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - exits 0 when prettier absent (typescript)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.ts"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - exits 0 when gofmt absent (go)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.go"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - exits 0 when ruff crashes (python)" {
  printf '#!/usr/bin/env bash\nexit 1\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - exits 0 when prettier crashes (typescript)" {
  printf '#!/usr/bin/env bash\nexit 1\n' > "${STUB_DIR}/prettier"
  chmod +x "${STUB_DIR}/prettier"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.ts"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

# ---------------------------------------------------------------------------
# Per-language formatter invocation (TEST-01)
# ---------------------------------------------------------------------------

@test "format hook - runs ruff format for .py file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/ruff_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/ruff_called" ]
}

@test "format hook - runs rustfmt for .rs file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/rustfmt_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/rustfmt"
  chmod +x "${STUB_DIR}/rustfmt"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.rs"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/rustfmt_called" ]
}

@test "format hook - runs prettier for .ts file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/prettier_called_ts"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/prettier"
  chmod +x "${STUB_DIR}/prettier"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.ts"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/prettier_called_ts" ]
}

@test "format hook - runs prettier for .js file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/prettier_called_js"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/prettier"
  chmod +x "${STUB_DIR}/prettier"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.js"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/prettier_called_js" ]
}

@test "format hook - runs gofmt for .go file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/gofmt_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/gofmt"
  chmod +x "${STUB_DIR}/gofmt"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.go"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/gofmt_called" ]
}

@test "format hook - runs prettier for .json file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/prettier_called_json"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/prettier"
  chmod +x "${STUB_DIR}/prettier"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.json"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/prettier_called_json" ]
}

# ---------------------------------------------------------------------------
# Silent success (FMTH-07)
# ---------------------------------------------------------------------------

@test "format hook - produces no stdout on successful format (python)" {
  printf '#!/usr/bin/env bash\nexit 0\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}

# ---------------------------------------------------------------------------
# Skip generated directories (FMTH-09)
# ---------------------------------------------------------------------------

@test "format hook - skips node_modules path" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/node_modules/lib/index.js"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}

@test "format hook - skips .venv path" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.venv/lib/python3.11/site-packages/foo.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}

@test "format hook - skips target path" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/target/debug/build/foo.rs"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}
