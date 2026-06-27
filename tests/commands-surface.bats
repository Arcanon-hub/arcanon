#!/usr/bin/env bats
#
# commands-surface.bats —  regression: the seven surviving commands
# of v0.1.1 are present with valid frontmatter, /arcanon:cross-impact has
# been fully removed, and /arcanon:upload has been fully removed
# ( regression guard against accidental re-add).

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
}

@test "all surviving command files exist" {
  # Iteration list extended (114-01 / NIT 8) to cover the full v0.1.4-WIP
  # command surface. The original  list was the seven v0.1.1 survivors;
  # `verify` and `update` shipped in v0.1.3, `list` ships in v0.1.4 ,
  # `view` ships in v0.1.4, `doctor` ships in v0.1.4 ( — Plan
  # 114-03), `correct` ships in v0.1.4 ( — ), and
  # `rescan` ships in v0.1.4 ( — ).
  for cmd in map drift impact sync login status export verify update list view doctor diff correct rescan; do
    [ -f "$PLUGIN_DIR/commands/$cmd.md" ] || {
      echo "MISSING: commands/$cmd.md"
      return 1
    }
  done
}

@test "all surviving commands have description frontmatter" {
  for cmd in map drift impact sync login status export verify update list view doctor diff correct rescan; do
    run grep -c '^description:' "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

# (114-01): /arcanon:list must declare allowed-tools: Bash so the
# slash-command runtime grants the bash block in the body the right to
# invoke hub.sh. Mirrors the same assertion implicit in  above for the
# other commands.
@test "/arcanon:list declares allowed-tools: Bash" {
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/list.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/list.md"
}

@test "/arcanon:cross-impact command file has been removed" {
  [ ! -f "$PLUGIN_DIR/commands/cross-impact.md" ]
}

@test "/arcanon:upload command file has been removed (regression guard)" {
  [ ! -f "$PLUGIN_DIR/commands/upload.md" ]
}

@test "/arcanon:sync advertises --drain, --repo, --dry-run, --force in argument-hint" {
  run grep -E '^argument-hint:' "$PLUGIN_DIR/commands/sync.md"
  [ "$status" -eq 0 ]
  # All four flag names must appear in the hint or flag table
  grep -q -- '--drain' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--repo' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--dry-run' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--force' "$PLUGIN_DIR/commands/sync.md"
}

@test "/arcanon:sync default behaviour documents upload-then-drain" {
  # The flag table must describe the no-flag path
  run grep -E '\*\(none\)\*|no flags' "$PLUGIN_DIR/commands/sync.md"
  [ "$status" -eq 0 ]
  grep -q 'upload' "$PLUGIN_DIR/commands/sync.md"
  grep -q -i 'drain' "$PLUGIN_DIR/commands/sync.md"
}

# (114-02): /arcanon:view is a top-level slash-command alias for the
# graph UI. Pure markdown command — NO Node-side handler. Frontmatter must
# declare allowed-tools: Bash so the body's bash block can run; body must
# contain the worker-start auto-launch substring (cloned verbatim from
# map.md:22-32) so the command actually opens the UI.
@test "/arcanon:view exists with frontmatter and worker-start block" {
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

# (114-02): regression guard — the existing `/arcanon:map view`
# keystroke MUST keep working. `commands/map.md` still routes the `view`
# subcommand inline. RESEARCH §2 dispatch-precedence finding: Claude resolves
# slash commands by exact filename (so `/arcanon:view` → view.md, never map.md);
# the `view` subcommand inside map.md is interpreted via $ARGUMENTS narrative.
@test "/arcanon:map still contains the inline 'If \`view\` flag' block" {
  grep -q 'If `view` flag' "$PLUGIN_DIR/commands/map.md"
}

# (114-02): defensive negative — `worker/cli/hub.js` MUST NOT register
# `view: cmdView` in HANDLERS. The dispatch-precedence finding (RESEARCH §2)
# says Claude resolves `/arcanon:view` by filename to commands/view.md; adding
# a Node handler would create a phantom dispatch ambiguity that the v0.1.3
# audit warned about. This test guards against a future contributor re-adding
# such a handler.
@test "worker/cli/hub.js does NOT register a view handler" {
  ! grep -q 'view: cmdView' "$PLUGIN_DIR/worker/cli/hub.js"
}

# (114-03): /arcanon:doctor must declare allowed-tools: Bash so the
# slash-command runtime grants the bash block in the body the right to
# invoke hub.sh. Mirrors the same assertion made for /arcanon:list.
@test "/arcanon:doctor declares allowed-tools: Bash" {
  [ -f "$PLUGIN_DIR/commands/doctor.md" ]
  run grep -E '^description:' "$PLUGIN_DIR/commands/doctor.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/doctor.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/doctor.md"
}

# (114-03): /arcanon:doctor command body must invoke hub.sh doctor
# (the Node-side handler does the real work). Counterpart to the 
# negative test — the doctor command DOES register a Node handler, so we
# positively assert the dispatch path is intact.
@test "worker/cli/hub.js registers doctor: cmdDoctor" {
  grep -q 'doctor: cmdDoctor' "$PLUGIN_DIR/worker/cli/hub.js"
}

# (115-02): /arcanon:diff must declare allowed-tools: Bash and
# the Node-side handler must be registered.
@test "/arcanon:diff declares allowed-tools: Bash" {
  [ -f "$PLUGIN_DIR/commands/diff.md" ]
  run grep -E '^description:' "$PLUGIN_DIR/commands/diff.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/diff.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/diff.md"
}

@test "worker/cli/hub.js registers diff: cmdDiff" {
  grep -q 'diff: cmdDiff' "$PLUGIN_DIR/worker/cli/hub.js"
}

# (118-01): /arcanon:correct must declare allowed-tools: Bash and
# the Node-side handler must be registered in HANDLERS.
@test "/arcanon:correct declares allowed-tools: Bash" {
  [ -f "$PLUGIN_DIR/commands/correct.md" ]
  run grep -E '^description:' "$PLUGIN_DIR/commands/correct.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/correct.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/correct.md"
}

@test "worker/cli/hub.js registers correct: cmdCorrect" {
  grep -q 'correct: cmdCorrect' "$PLUGIN_DIR/worker/cli/hub.js"
}

# (118-02): /arcanon:rescan must declare allowed-tools: Bash and
# the markdown body must orchestrate the scan directly via the Agent tool +
# QueryEngine — NOT by POSTing to a worker HTTP route. The earlier 118-02
# shape (cmdRescan POSTing to /api/rescan and a worker-side ARCANON_TEST_AGENT_RUNNER
# stub) was reverted because the worker has no agent runtime in production;
# Claude agents only run from markdown commands. See plan 118-02 SUMMARY.
@test "/arcanon:rescan declares allowed-tools: Bash, Read, AskUserQuestion, Agent" {
  [ -f "$PLUGIN_DIR/commands/rescan.md" ]
  run grep -E '^description:' "$PLUGIN_DIR/commands/rescan.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/rescan.md"
  [ "$status" -eq 0 ]
  # Must allow Agent invocations — markdown command drives scan agents directly.
  grep -q 'Agent' "$PLUGIN_DIR/commands/rescan.md"
}

@test "/arcanon:rescan body invokes Agent + applyPendingOverrides directly (no worker HTTP)" {
  # The markdown command must call the discovery + deep prompts as Agents
  # (mirrors map.md). Prove the prompt-template paths are referenced.
  # Stage 2 reads shared common rules + a per-type template (service/library/
  # infra) selected by detectRepoType() — the old monolithic agent-prompt-deep.md
  # was removed (issue #39).
  grep -q 'agent-prompt-discovery.md' "$PLUGIN_DIR/commands/rescan.md"
  grep -q 'agent-prompt-common.md' "$PLUGIN_DIR/commands/rescan.md"
  grep -q 'agent-prompt-service.md' "$PLUGIN_DIR/commands/rescan.md"
  # Regression guard: the removed monolithic template must NOT reappear.
  ! grep -q 'agent-prompt-deep.md' "$PLUGIN_DIR/commands/rescan.md"
  # 's apply-hook must fire between persistFindings and endScan.
  grep -q 'applyPendingOverrides' "$PLUGIN_DIR/commands/rescan.md"
  # Regression guard: must NOT shell out to hub.sh rescan and must NOT POST
  # to /api/rescan — both routes have been deleted.
  ! grep -q 'hub.sh rescan' "$PLUGIN_DIR/commands/rescan.md"
  ! grep -q '/api/rescan' "$PLUGIN_DIR/commands/rescan.md"
}

@test "worker/cli/hub.js does NOT register a rescan handler" {
  # cmdRescan + the HANDLERS["rescan"] entry were deleted along with /api/rescan.
  # Future regressions would re-introduce them; this guard catches that.
  ! grep -q 'rescan: cmdRescan' "$PLUGIN_DIR/worker/cli/hub.js"
  ! grep -q 'fastify.post.*"/api/rescan"' "$PLUGIN_DIR/worker/server/http.js"
}
