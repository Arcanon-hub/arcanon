#!/usr/bin/env bats
# Ligamen — file-guard.bats
# Tests for the PreToolUse sensitive file guard hook.
# Covers TEST-03 (hard blocks and soft warnings) and TEST-08 (exit 2 + permissionDecision deny JSON).
#
# These tests are in RED state until Phase 4 implements scripts/file-guard.sh.
# Run: tests/bats/bin/bats tests/file-guard.bats
#
# CRITICAL: Hard-block tests use assert_failure 2 (not bare assert_failure).
# Exit code 2 is the Claude Code-specific code for PreToolUse tool denial.
# See RESEARCH.md Pitfall 3 and TEST-08 contract.

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  SCRIPT="${BATS_TEST_DIRNAME}/../plugins/arcanon/scripts/file-guard.sh"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/../plugins/arcanon"
}

# ---------------------------------------------------------------------------
# Hard-block tests — Secret / credential files (GRDH-03)
# All use assert_failure 2 per TEST-08 contract (RESEARCH.md Pitfall 3).
# ---------------------------------------------------------------------------

@test "guard hook - exits 2 for .env" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for .env.local" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env.local"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for .env.production" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env.production"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for credentials.json" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/credentials.json"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for secret.yaml" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/config/secret.yaml"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for server.pem" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/certs/server.pem"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for private.key" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/certs/private.key"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

# ---------------------------------------------------------------------------
# Hard-block tests — Lock files (GRDH-02)
# ---------------------------------------------------------------------------

@test "guard hook - exits 2 for package-lock.json" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/package-lock.json"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for Cargo.lock" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/Cargo.lock"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for poetry.lock" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/poetry.lock"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for bun.lock" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/bun.lock"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for yarn.lock" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/yarn.lock"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for Pipfile.lock" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/Pipfile.lock"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

# ---------------------------------------------------------------------------
# Hard-block tests — Generated directories (GRDH-04)
# ---------------------------------------------------------------------------

@test "guard hook - exits 2 for node_modules path" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/node_modules/pkg/index.js"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for .venv path" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.venv/lib/site.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for target path" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/target/debug/main"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

# ---------------------------------------------------------------------------
# JSON schema verification (TEST-08, PITFALLS.md Pitfall 9)
# The guard must output hookSpecificOutput.permissionDecision: "deny" on stdout.
# Required schema:
#   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
#                              "permissionDecision": "deny",
#                              "permissionDecisionReason": "..." } }
# ---------------------------------------------------------------------------

@test "guard hook - stdout contains permissionDecision deny for .env block" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_output --partial '"permissionDecision"'
  assert_output --partial '"deny"'
}

@test "guard hook - stdout contains valid hookSpecificOutput JSON for .env block" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  # Pipe stdout through jq to verify it parses as valid JSON with correct schema
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' | jq -e '.hookSpecificOutput.permissionDecision == \"deny\"'"
  assert_success
}

# ---------------------------------------------------------------------------
# Block message format (GRDH-08)
# Human-readable denial message must carry the Ligamen prefix.
# stderr carries the human-readable message; use 2>&1 to capture it.
# ---------------------------------------------------------------------------

@test "guard hook - block message contains Arcanon prefix" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  assert_output --partial "Arcanon"
}

# ---------------------------------------------------------------------------
# Soft-warn tests — SQL migrations (GRDH-05)
# Must exit 0 (allow write) but surface a warning message.
# ---------------------------------------------------------------------------

@test "guard hook - exits 0 for SQL migration file (GRDH-05)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/migrations/001_init.sql"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "guard hook - outputs warning for SQL migration file" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/migrations/001_init.sql"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  refute_output ""
  assert_output --partial "Arcanon"
}

@test "guard hook - exits 0 for Python migration file (GRDH-05)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/migrations/0002_add_users.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

# ---------------------------------------------------------------------------
# Soft-warn tests — Generated code (GRDH-06)
# Must exit 0 (allow write) for generated code files.
# ---------------------------------------------------------------------------

@test "guard hook - exits 0 for .pb.go generated file (GRDH-06)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/api.pb.go"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "guard hook - exits 0 for _generated.ts file (GRDH-06)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/types_generated.ts"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "guard hook - exits 0 for .gen.go file (GRDH-06)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/models.gen.go"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

# ---------------------------------------------------------------------------
# Soft-warn tests — CHANGELOG (GRDH-07)
# Must exit 0 (allow write) but surface a warning.
# ---------------------------------------------------------------------------

@test "guard hook - exits 0 for CHANGELOG.md (GRDH-07)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/CHANGELOG.md"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "guard hook - outputs warning for CHANGELOG.md" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/CHANGELOG.md"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  refute_output ""
}

# ---------------------------------------------------------------------------
# Safe file tests
# Must exit 0 with no output for regular source files.
# ---------------------------------------------------------------------------

@test "guard hook - exits 0 for safe file src/main.py" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/src/main.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  assert_success
}

@test "guard hook - produces no output for safe file" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/src/main.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  assert_output ""
}

@test "guard hook - exits 0 for safe Go source file" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/src/main.go"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  assert_success
  assert_output ""
}

@test "guard hook - exits 0 for README.md" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/README.md"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  assert_success
  assert_output ""
}

@test "guard hook - exits 0 for input with no file_path (Bash tool)" {
  local json='{"tool_name":"Bash","tool_input":{"command":"ls"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

# ---------------------------------------------------------------------------
# Path normalization (Security, PITFALLS.md — Security Mistakes)
# Guard must use normalized paths to prevent traversal bypasses.
# ---------------------------------------------------------------------------

@test "guard hook - exits 2 for path traversal to .env (Pitfall 3)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"../../.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for path with ../ resolving to .env (Pitfall 3)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/config/../.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

# ---------------------------------------------------------------------------
# Disable guard via env var (CONF-02)
# ARCANON_DISABLE_GUARD=1 bypasses all blocking.
# ---------------------------------------------------------------------------

@test "guard hook - ARCANON_DISABLE_GUARD=1 bypasses block on .env" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "ARCANON_DISABLE_GUARD=1 bash '${SCRIPT}' <<< '${json}'"
  assert_success
}

@test "guard hook - ARCANON_DISABLE_GUARD=1 bypasses block on Cargo.lock" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/Cargo.lock"}}'
  run bash -c "ARCANON_DISABLE_GUARD=1 bash '${SCRIPT}' <<< '${json}'"
  assert_success
}
