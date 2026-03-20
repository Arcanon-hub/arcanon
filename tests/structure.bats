#!/usr/bin/env bats
# Ligamen — structure.bats
# Structural validation tests for plugin layout (PLGN-01, PLGN-04, PLGN-06)

TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
PLUGIN_ROOT="$(cd "$TEST_DIR/.." && pwd)"

load "$TEST_DIR/test_helper.bash"

setup() {
  cd "$PLUGIN_ROOT"
}

# ---------------------------------------------------------------------------
# PLGN-01: Directory structure
# ---------------------------------------------------------------------------

@test "plugin.json exists inside .claude-plugin/" {
  assert [ -f ".claude-plugin/plugin.json" ]
}

@test "plugin.json is valid JSON" {
  run jq empty .claude-plugin/plugin.json
  assert_success
}

@test "plugin.json has required fields" {
  run jq -e '.name and .version and .description' .claude-plugin/plugin.json
  assert_success
}

@test "commands/ directory exists at plugin root" {
  assert [ -d "commands" ]
}

@test "skills/ directory exists at plugin root" {
  assert [ -d "skills" ]
}

@test "hooks/ directory exists at plugin root" {
  assert [ -d "hooks" ]
}

@test "scripts/ directory exists at plugin root" {
  assert [ -d "scripts" ]
}

@test "lib/ directory exists at plugin root" {
  assert [ -d "lib" ]
}

@test "commands/ is NOT inside .claude-plugin/" {
  assert [ ! -d ".claude-plugin/commands" ]
}

@test "skills/ is NOT inside .claude-plugin/" {
  assert [ ! -d ".claude-plugin/skills" ]
}

@test "hooks/ is NOT inside .claude-plugin/" {
  assert [ ! -d ".claude-plugin/hooks" ]
}

@test "all command files exist" {
  for cmd in quality-gate cross-impact drift; do
    assert [ -f "commands/$cmd.md" ]
  done
}

@test "all command files have valid frontmatter" {
  for cmd in quality-gate cross-impact drift; do
    run grep -c "^description:" "commands/$cmd.md"
    assert_success
  done
}

@test "quality-gate skill exists for auto-invocation" {
  assert [ -f "skills/quality-gate/SKILL.md" ]
  run grep -c "^name:" "skills/quality-gate/SKILL.md"
  assert_success
  run grep -c "^description:" "skills/quality-gate/SKILL.md"
  assert_success
}

@test "all hook scripts are executable" {
  assert [ -x "scripts/format.sh" ]
  assert [ -x "scripts/lint.sh" ]
  assert [ -x "scripts/file-guard.sh" ]
  assert [ -x "scripts/session-start.sh" ]
}

@test "all lib scripts are executable" {
  assert [ -x "lib/detect.sh" ]
  assert [ -x "lib/linked-repos.sh" ]
}

# ---------------------------------------------------------------------------
# PLGN-04: Path references
# ---------------------------------------------------------------------------

@test "hooks.json contains no hardcoded absolute paths" {
  run grep -c '/Users/\|/home/' hooks/hooks.json
  assert_failure
}

@test "hooks.json references use CLAUDE_PLUGIN_ROOT" {
  run grep -c 'CLAUDE_PLUGIN_ROOT' hooks/hooks.json
  assert_success
  assert [ "$output" -gt 0 ]
}

@test "hooks.json uses PascalCase event names" {
  run grep -c '"PostToolUse"' hooks/hooks.json
  assert_success
  run grep -c '"PreToolUse"' hooks/hooks.json
  assert_success
  run grep -c '"SessionStart"' hooks/hooks.json
  assert_success
}

# ---------------------------------------------------------------------------
# Structural validity
# ---------------------------------------------------------------------------

@test "hooks.json is valid JSON" {
  run jq empty hooks/hooks.json
  assert_success
}

@test "hooks.json has hooks wrapper object" {
  run jq -e '.hooks' hooks/hooks.json
  assert_success
}
