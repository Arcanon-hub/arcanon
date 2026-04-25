#!/usr/bin/env bats
#
# commands-surface.bats — CLN-09 regression: the seven surviving commands
# of v0.1.1 are present with valid frontmatter, /arcanon:cross-impact has
# been fully removed (CLN-01), and /arcanon:upload has been fully removed
# (DEP-03 regression guard against accidental re-add).

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
}

@test "CLN-09: all surviving command files exist" {
  # Iteration list extended (114-01 / NIT 8) to cover the full v0.1.4-WIP
  # command surface. The original CLN-09 list was the seven v0.1.1 survivors;
  # `verify` and `update` shipped in v0.1.3, `list` ships in v0.1.4 (NAV-01),
  # `view` ships in v0.1.4 (NAV-02), and `doctor` ships in v0.1.4 (NAV-03 —
  # this plan, 114-03).
  for cmd in map drift impact sync login status export verify update list view doctor; do
    [ -f "$PLUGIN_DIR/commands/$cmd.md" ] || {
      echo "MISSING: commands/$cmd.md"
      return 1
    }
  done
}

@test "CLN-09: all surviving commands have description frontmatter" {
  for cmd in map drift impact sync login status export verify update list view doctor; do
    run grep -c '^description:' "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

# NAV-01 (114-01): /arcanon:list must declare allowed-tools: Bash so the
# slash-command runtime grants the bash block in the body the right to
# invoke hub.sh. Mirrors the same assertion implicit in CLN-09 above for the
# other commands.
@test "NAV-01: /arcanon:list declares allowed-tools: Bash" {
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/list.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/list.md"
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

# NAV-02 (114-02): /arcanon:view is a top-level slash-command alias for the
# graph UI. Pure markdown command — NO Node-side handler. Frontmatter must
# declare allowed-tools: Bash so the body's bash block can run; body must
# contain the worker-start auto-launch substring (cloned verbatim from
# map.md:22-32) so the command actually opens the UI.
@test "NAV-02: /arcanon:view exists with frontmatter and worker-start block" {
  [ -f "$PLUGIN_DIR/commands/view.md" ]
  run grep -E '^description:' "$PLUGIN_DIR/commands/view.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/view.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/view.md"
  # Proves the auto-start block is present (cloned from map.md:22-32).
  grep -q 'worker-start.sh' "$PLUGIN_DIR/commands/view.md"
  # Proves no Node-side handler is invoked — there is no `cmdView` in hub.js.
  ! grep -q 'bash hub.sh view' "$PLUGIN_DIR/commands/view.md"
}

# NAV-02 (114-02): regression guard — the existing `/arcanon:map view`
# keystroke MUST keep working. `commands/map.md` still routes the `view`
# subcommand inline. RESEARCH §2 dispatch-precedence finding: Claude resolves
# slash commands by exact filename (so `/arcanon:view` → view.md, never map.md);
# the `view` subcommand inside map.md is interpreted via $ARGUMENTS narrative.
@test "NAV-02: /arcanon:map still contains the inline 'If \`view\` flag' block" {
  grep -q 'If `view` flag' "$PLUGIN_DIR/commands/map.md"
}

# NAV-02 (114-02): defensive negative — `worker/cli/hub.js` MUST NOT register
# `view: cmdView` in HANDLERS. The dispatch-precedence finding (RESEARCH §2)
# says Claude resolves `/arcanon:view` by filename to commands/view.md; adding
# a Node handler would create a phantom dispatch ambiguity that the v0.1.3
# audit warned about. This test guards against a future contributor re-adding
# such a handler.
@test "NAV-02: worker/cli/hub.js does NOT register a view handler" {
  ! grep -q 'view: cmdView' "$PLUGIN_DIR/worker/cli/hub.js"
}

# NAV-03 (114-03): /arcanon:doctor must declare allowed-tools: Bash so the
# slash-command runtime grants the bash block in the body the right to
# invoke hub.sh. Mirrors the same assertion made for /arcanon:list.
@test "NAV-03: /arcanon:doctor declares allowed-tools: Bash" {
  [ -f "$PLUGIN_DIR/commands/doctor.md" ]
  run grep -E '^description:' "$PLUGIN_DIR/commands/doctor.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/doctor.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/doctor.md"
}

# NAV-03 (114-03): /arcanon:doctor command body must invoke hub.sh doctor
# (the Node-side handler does the real work). Counterpart to the NAV-02
# negative test — the doctor command DOES register a Node handler, so we
# positively assert the dispatch path is intact.
@test "NAV-03: worker/cli/hub.js registers doctor: cmdDoctor" {
  grep -q 'doctor: cmdDoctor' "$PLUGIN_DIR/worker/cli/hub.js"
}
