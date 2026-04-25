#!/usr/bin/env bats
#
# commands-surface.bats — CLN-09 regression: the seven surviving commands
# of v0.1.1 are present with valid frontmatter, /arcanon:cross-impact has
# been fully removed (CLN-01), and /arcanon:upload has been fully removed
# (DEP-03 regression guard against accidental re-add).

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
}

@test "CLN-09: all 7 surviving command files exist" {
  for cmd in map drift impact sync login status export; do
    [ -f "$PLUGIN_DIR/commands/$cmd.md" ] || {
      echo "MISSING: commands/$cmd.md"
      return 1
    }
  done
}

@test "CLN-09: all 7 surviving commands have description frontmatter" {
  for cmd in map drift impact sync login status export; do
    run grep -c '^description:' "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

@test "CLN-01: /arcanon:cross-impact command file has been removed" {
  [ ! -f "$PLUGIN_DIR/commands/cross-impact.md" ]
}

@test "DEP-03: /arcanon:upload command file has been removed (regression guard)" {
  [ ! -f "$PLUGIN_DIR/commands/upload.md" ]
}

@test "CLN-03: /arcanon:sync advertises --drain, --repo, --dry-run, --force in argument-hint" {
  run grep -E '^argument-hint:' "$PLUGIN_DIR/commands/sync.md"
  [ "$status" -eq 0 ]
  # All four flag names must appear in the hint or flag table
  grep -q -- '--drain' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--repo' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--dry-run' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--force' "$PLUGIN_DIR/commands/sync.md"
}

@test "CLN-04: /arcanon:sync default behaviour documents upload-then-drain" {
  # The flag table must describe the no-flag path
  run grep -E '\*\(none\)\*|no flags' "$PLUGIN_DIR/commands/sync.md"
  [ "$status" -eq 0 ]
  grep -q 'upload' "$PLUGIN_DIR/commands/sync.md"
  grep -q -i 'drain' "$PLUGIN_DIR/commands/sync.md"
}
