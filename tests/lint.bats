#!/usr/bin/env bats
# Arcanon — lint.bats
# Tests: TEST-02 (per-language linter invocation), TEST-07 (non-blocking guarantee)
# Covers: LNTH-06 (systemMessage output when issues found), LNTH-08 (silent skip when absent)

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  SCRIPT="${BATS_TEST_DIRNAME}/../plugins/arcanon/scripts/lint.sh"
  STUB_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/../plugins/arcanon"
}

teardown() {
  rm -rf "${STUB_DIR}"
}

# ---------------------------------------------------------------------------
# Non-blocking guarantee (TEST-07)
# ---------------------------------------------------------------------------

@test "lint hook - exits 0 when ruff absent (python)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "lint hook - exits 0 when eslint absent (typescript)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.ts"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "lint hook - exits 0 when golangci-lint absent (go)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.go"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "lint hook - exits 0 when cargo absent (rust)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.rs"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "lint hook - exits 0 when ruff check finds issues" {
  # Linter exits 1 (issues found) and outputs warnings — hook must not block
  printf '#!/usr/bin/env bash\necho "E501 line too long" >&2\nexit 1\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "lint hook - exits 0 when eslint finds issues" {
  # Linter exits 1 (issues found) and outputs warnings — hook must not block
  printf '#!/usr/bin/env bash\necho "no-unused-vars: error" >&2\nexit 1\n' > "${STUB_DIR}/eslint"
  chmod +x "${STUB_DIR}/eslint"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.ts"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

# ---------------------------------------------------------------------------
# Per-language linter invocation (TEST-02)
# ---------------------------------------------------------------------------

@test "lint hook - runs ruff check for .py file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/ruff_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local testfile="${STUB_DIR}/test.py"
  touch "$testfile"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/ruff_called" ]
}

@test "lint hook - runs eslint for .ts file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/eslint_called_ts"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/eslint"
  chmod +x "${STUB_DIR}/eslint"
  local testfile="${STUB_DIR}/test.ts"
  touch "$testfile"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/eslint_called_ts" ]
}

@test "lint hook - runs eslint for .js file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/eslint_called_js"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/eslint"
  chmod +x "${STUB_DIR}/eslint"
  local testfile="${STUB_DIR}/test.js"
  touch "$testfile"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/eslint_called_js" ]
}

@test "lint hook - runs golangci-lint for .go file when present" {
  printf '#!/usr/bin/env bash\ntouch "%s/golangci_lint_called"\nexit 0\n' "${STUB_DIR}" > "${STUB_DIR}/golangci-lint"
  chmod +x "${STUB_DIR}/golangci-lint"
  local testfile="${STUB_DIR}/test.go"
  touch "$testfile"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/golangci_lint_called" ]
}

@test "lint hook - runs cargo clippy for .rs file when present" {
  # Cargo stub must handle locate-project (returns Cargo.toml path) and clippy (touches marker)
  cat > "${STUB_DIR}/cargo" <<STUBEOF
#!/usr/bin/env bash
if [[ "\$1" == "locate-project" ]]; then
  echo "${STUB_DIR}/Cargo.toml"
elif [[ "\$1" == "clippy" ]]; then
  touch "${STUB_DIR}/cargo_called"
fi
exit 0
STUBEOF
  chmod +x "${STUB_DIR}/cargo"
  touch "${STUB_DIR}/Cargo.toml"
  local testfile="${STUB_DIR}/test.rs"
  touch "$testfile"
  # Clear any throttle file so clippy actually runs
  rm -f /tmp/arcanon_clippy_*
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  [ -f "${STUB_DIR}/cargo_called" ]
}

# ---------------------------------------------------------------------------
# Lint output in conversation (LNTH-06, TEST-02)
# ---------------------------------------------------------------------------

@test "lint hook - outputs systemMessage JSON when linter finds issues" {
  # Linter exits 1 with error output — hook must surface a systemMessage for Claude
  printf '#!/usr/bin/env bash\necho "E501 line too long (found 2 issues)"\nexit 1\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local testfile="${STUB_DIR}/test.py"
  touch "$testfile"
  local json='{"tool_name":"Write","tool_input":{"file_path":"'"${testfile}"'"}}'
  run bash -c "export PATH='${STUB_DIR}:${PATH}'; printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output --partial "systemMessage"
}

# ---------------------------------------------------------------------------
# Silent skip when absent (LNTH-08)
# ---------------------------------------------------------------------------

@test "lint hook - produces no stdout when linter is absent" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}
