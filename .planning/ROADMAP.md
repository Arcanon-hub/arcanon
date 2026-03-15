# Roadmap: AllClear

## Overview

AllClear is built as independent components that compose when assembled. Every phase targets a single concern — a hook, a skill, a library, or a test suite. Because all outputs are plain files (shell scripts, SKILL.md, hooks.json, bats tests), there are no functional build-order dependencies between phases at development time. All phases can be planned and executed in parallel. They compose automatically when the plugin is loaded.

**Parallelization:** true
**Granularity:** fine

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Plugin Skeleton** - Directory structure, plugin.json manifest, and git-clone installation
- [ ] **Phase 2: Shared Libraries** - Project type detection (detect.sh) and sibling repo discovery (siblings.sh)
- [ ] **Phase 3: Format Hook** - Auto-format on every Claude edit for Python, Rust, TypeScript, Go, JSON, YAML
- [ ] **Phase 4: Lint Hook** - Auto-lint on every Claude edit with per-language linter invocation
- [ ] **Phase 5: Guard Hook** - Hard-block and soft-warn PreToolUse hook for sensitive and generated files
- [ ] **Phase 6: Session Hook** - Session-start context injection with project type and available commands
- [ ] **Phase 7: Quality Gate Skill** - `/allclear` slash-command for full quality checks and subcommands
- [ ] **Phase 8: Config Layer** - allclear.config.json overrides and environment variable toggles
- [ ] **Phase 9: Impact Skill** - `/allclear impact` cross-repo reference scanning
- [ ] **Phase 10: Drift Skill** - `/allclear drift` version and type consistency checking across repos
- [ ] **Phase 11: Pulse Skill** - `/allclear pulse` live service health checking via kubectl
- [ ] **Phase 12: Deploy Skill** - `/allclear deploy` expected-vs-actual cluster state verification
- [ ] **Phase 13: Tests** - Bats test suite for all hooks, exit codes, and library functions

## Phase Details

### Phase 1: Plugin Skeleton
**Goal**: A valid, installable Claude Code plugin directory exists with correct structure and can be installed via git clone and symlink
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: PLGN-01, PLGN-04, PLGN-06
**Success Criteria** (what must be TRUE):
  1. The plugin directory contains plugin.json, skills/, hooks/, scripts/, and lib/ at the root
  2. `claude plugin validate` passes against the plugin directory with no errors
  3. Installing via `git clone` and symlinking into `~/.claude/plugins/` makes the skills directory visible to Claude
  4. All internal path references use `${CLAUDE_PLUGIN_ROOT}` so the plugin works from any installation location
**Plans:** 1 plan
Plans:
- [ ] 02-01-PLAN.md — Create lib/detect.sh and lib/siblings.sh shared libraries

### Phase 2: Shared Libraries
**Goal**: Shell library functions for project type detection and sibling repo discovery are available for all hooks and skills to source
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: PLGN-02, PLGN-03, PLGN-05, PLGN-07, PLGN-08
**Success Criteria** (what must be TRUE):
  1. `lib/detect.sh` correctly returns the project type (Python/Rust/TypeScript/Go/mixed) when sourced from any repo directory containing the relevant manifest files
  2. `lib/detect.sh` returns all applicable types for mixed-language repos (e.g., a repo with both Cargo.toml and package.json)
  3. `lib/siblings.sh` discovers sibling repos by scanning the parent directory for `.git/` directories and outputs their paths
  4. All JSON parsing in hook scripts uses `printf '%s\n' "$JSON" | jq -r '.field // empty'` — no bare `jq` calls
  5. No hook or library script emits anything to stdout except structured JSON responses — debug output goes to stderr only
**Plans:** 1 plan
Plans:
- [ ] 02-01-PLAN.md — Create lib/detect.sh and lib/siblings.sh shared libraries

### Phase 3: Format Hook
**Goal**: Every Claude file edit automatically triggers formatting for the appropriate language without ever blocking the edit or cluttering the conversation on success
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: FMTH-01, FMTH-02, FMTH-03, FMTH-04, FMTH-05, FMTH-06, FMTH-07, FMTH-08, FMTH-09, FMTH-10
**Success Criteria** (what must be TRUE):
  1. Editing a Python file triggers `ruff format` (fallback: `black`); editing a Rust file triggers `rustfmt`; editing TypeScript/JavaScript triggers `prettier` (fallback: `eslint --fix`); editing a Go file triggers `gofmt`; editing JSON/YAML triggers `prettier`
  2. A clean format run produces no output — the conversation is not cluttered
  3. With no formatter installed for the file's language, the hook silently skips with no error or nag message
  4. Files inside `node_modules/`, `.venv/`, `target/`, or other generated directories are never formatted
  5. A formatter crash or non-zero exit never blocks the edit — the hook exits 0 in all cases
**Plans:** 1 plan
Plans:
- [ ] 02-01-PLAN.md — Create lib/detect.sh and lib/siblings.sh shared libraries

### Phase 4: Lint Hook
**Goal**: Every Claude file edit automatically triggers linting for the appropriate language and surfaces any issues to the conversation without blocking the edit
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: LNTH-01, LNTH-02, LNTH-03, LNTH-04, LNTH-05, LNTH-06, LNTH-07, LNTH-08
**Success Criteria** (what must be TRUE):
  1. Editing a Python file triggers `ruff check`; Rust triggers `cargo clippy` (throttled to once per 30 seconds); TypeScript/JavaScript triggers `eslint`; Go triggers `golangci-lint`
  2. Lint warnings and errors appear in the conversation so Claude can see and address them
  3. The hook exits 0 regardless of lint result — lint output is informational, never blocking
  4. With no linter installed for the file's language, the hook silently skips
**Plans:** 1 plan
Plans:
- [ ] 04-01-PLAN.md — Hook manifest and lint script with per-language linter invocation and clippy throttle

### Phase 5: Guard Hook
**Goal**: Claude cannot accidentally overwrite sensitive, lock, or generated files — hard blocks stop writes before they occur, and soft warns flag risky edits with explanations
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: GRDH-01, GRDH-02, GRDH-03, GRDH-04, GRDH-05, GRDH-06, GRDH-07, GRDH-08
**Success Criteria** (what must be TRUE):
  1. An attempt to write `.env`, `.env.*`, `*credentials*`, `*secret*`, `*.pem`, or `*.key` files is hard-blocked before the write occurs with a clear AllClear explanation message
  2. An attempt to write `*.lock`, `Cargo.lock`, `poetry.lock`, `package-lock.json`, or `bun.lock` is hard-blocked with a clear message
  3. An attempt to write into `node_modules/`, `.venv/`, or `target/` is hard-blocked with a clear message
  4. An attempt to write a SQL migration file or generated code file (`*.pb.go`, `*_generated.*`, `*.gen.*`) produces a visible warning but allows the write to proceed
  5. An attempt to write `CHANGELOG.md` produces a visible warning about auto-generation but allows the write to proceed
  6. All block messages follow the format "AllClear: blocked write to X — Y" where Y explains the protection reason
**Plans:** 1 plan
Plans:
- [ ] 05-01-PLAN.md — Guard hook script, hooks.json registration, and bats test suite

### Phase 6: Session Hook
**Goal**: Every Claude session begins with the project's type and available AllClear commands already visible — injected exactly once regardless of which hook event fires
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: SSTH-01, SSTH-02, SSTH-03, SSTH-04, SSTH-05
**Success Criteria** (what must be TRUE):
  1. At session start, Claude receives a message listing the detected project type and all available `/allclear` subcommands
  2. The hook fires on SessionStart; if SessionStart does not fire for a new session (upstream bug #10373), the UserPromptSubmit fallback injects context on the first user message instead
  3. If both SessionStart and UserPromptSubmit fire in the same session, context is injected only once
  4. The hook performs no tool execution — it reads manifest files only
  5. Setting `ALLCLEAR_DISABLE_SESSION_START=1` suppresses the hook entirely
**Plans:** 1 plan
Plans:
- [ ] 02-01-PLAN.md — Create lib/detect.sh and lib/siblings.sh shared libraries

### Phase 7: Quality Gate Skill
**Goal**: Running `/allclear` executes all appropriate quality checks for the detected project type and reports pass/fail with timing; subcommands run targeted subsets; auto-fix applies to safe targets only
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04, GATE-05
**Success Criteria** (what must be TRUE):
  1. `/allclear` with no arguments runs all applicable checks (lint, format, test, typecheck) for the detected project type and reports each with pass/fail status, timing, and the exact command used
  2. `/allclear lint`, `/allclear format`, `/allclear test`, `/allclear typecheck`, `/allclear quick`, and `/allclear fix` each run the appropriate subset of checks
  3. When a `Makefile` exists with matching targets (`make lint`, `make format`, etc.), the skill invokes those instead of direct tool calls
  4. `/allclear fix` applies auto-fixes to lint and format failures; it never auto-fixes test or typecheck failures
**Plans:** 1 plan
Plans:
- [ ] 02-01-PLAN.md — Create lib/detect.sh and lib/siblings.sh shared libraries

### Phase 8: Config Layer
**Goal**: An `allclear.config.json` file and environment variables give users full control over hook behavior and sibling repo paths without touching plugin code
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. An `allclear.config.json` file in the project root overrides sibling repo paths used by impact and drift skills
  2. Setting `ALLCLEAR_DISABLE_FORMAT=1`, `ALLCLEAR_DISABLE_LINT=1`, or `ALLCLEAR_DISABLE_GUARD=1` disables the corresponding hook with no code change required
  3. Setting `ALLCLEAR_LINT_THROTTLE=<seconds>` changes the clippy throttle interval from the default 30 seconds
  4. Setting `ALLCLEAR_EXTRA_BLOCKED=<pattern>` adds additional file patterns to the guard hook's hard-block list
**Plans:** 1 plan
Plans:
- [ ] 08-01-PLAN.md — Config library, env var patterns, and bats test suite





### Phase 9: Impact Skill
**Goal**: Developers can scan all sibling repos for any reference to a symbol or changed file with one command, with results grouped by repo and classified by match type
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: IMPT-01, IMPT-02, IMPT-03, IMPT-04, IMPT-05, IMPT-06, IMPT-07
**Success Criteria** (what must be TRUE):
  1. `/allclear impact <symbol>` returns all matches across sibling repos grouped by repo, with file locations and match type (code, config, docs, test) shown for each match
  2. `/allclear impact --changed` auto-detects changed symbols from `git diff HEAD~1` and scans all sibling repos without manual input
  3. Sibling repos are discovered automatically from the parent directory; `allclear.config.json` can override the list; `--exclude <repo>` skips specific repos from the scan
**Plans:** 1 plan
Plans:
- [ ] 09-01-PLAN.md — Create sibling discovery library, impact scan engine, and SKILL.md

### Phase 10: Drift Skill
**Goal**: Developers can detect version and type inconsistencies across sibling repos with one command, with actionable differences shown by default and severity levels for triage
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05, DRFT-06
**Success Criteria** (what must be TRUE):
  1. `/allclear drift versions` reports which sibling repos have divergent versions of shared dependencies, with specific version values and affected repos shown
  2. `/allclear drift types` reports type definition inconsistencies for shared models across repos
  3. `/allclear drift openapi` reports OpenAPI spec inconsistencies for shared endpoints
  4. Output defaults to actionable differences only (not a wall of text) with severity levels indicating which drifts are breaking vs. informational
**Plans:** 1 plan
Plans:
- [ ] 02-01-PLAN.md — Create lib/detect.sh and lib/siblings.sh shared libraries

### Phase 11: Pulse Skill
**Goal**: Developers with kubectl access can check live service health and compare running image versions to the latest git tag with one command; developers without kubectl get a clean skip message
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: PULS-01, PULS-02, PULS-03, PULS-04, PULS-05
**Success Criteria** (what must be TRUE):
  1. `/allclear pulse` reports health endpoint status (alive, ready, components) for each service and compares running image version to latest git tag
  2. `/allclear pulse --env staging` (or dev/prod) targets the specified environment
  3. `/allclear pulse` with no kubectl available outputs a single clear skip message and exits cleanly with no error
**Plans:** 1 plan
Plans:
- [ ] 11-01-PLAN.md — Pulse skill helper script and SKILL.md orchestration prompt

### Phase 12: Deploy Skill
**Goal**: Developers with kubectl access can verify that deployed cluster state matches the expected kustomize/helm configuration with one command; without kubectl they get a clean skip message
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: DPLY-01, DPLY-02, DPLY-03, DPLY-04, DPLY-05
**Success Criteria** (what must be TRUE):
  1. `/allclear deploy` compares expected state (kustomize/helm overlays) to actual cluster state and reports image tag and configmap mismatches
  2. `/allclear deploy --diff` shows the specific differences between expected and actual state
  3. `/allclear deploy` with no kubectl available outputs a single clear skip message and exits cleanly
**Plans:** 1 plan
Plans:
- [ ] 12-01-PLAN.md — Create deploy-verify SKILL.md with kubectl diff, image tag comparison, configmap checks, and graceful skip




### Phase 13: Tests
**Goal**: Every hook's exit-code contract and library function is verified by an automated bats test suite that runs to completion in a clean environment
**Depends on**: Nothing — write files, no runtime dependencies
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08
**Success Criteria** (what must be TRUE):
  1. `bats tests/` runs to completion with all tests passing in a clean environment
  2. Format hook tests verify silent success and exit 0 for each language (Python, Rust, TypeScript, Go) when the formatter is absent or succeeds
  3. Lint hook tests verify lint output appears in the conversation and the hook always exits 0
  4. Guard hook tests verify that writes to `.env`, lock files, and generated directories produce exit 2 with correct `permissionDecision: "deny"` JSON, and that migration/generated-code writes produce warnings with exit 0
  5. Library tests verify correct project type detection for each manifest type and mixed-language repos, and correct sibling repo discovery from a parent directory
**Plans:** 3 plans
Plans:
- [ ] 13-01-PLAN.md — Bats test infrastructure setup + library tests (detect.bats, siblings.bats)
- [ ] 13-02-PLAN.md — Format and lint hook tests (format.bats, lint.bats)
- [ ] 13-03-PLAN.md — Guard and session hook tests (file-guard.bats, session-start.bats)

## Progress

**Execution Order:**
All phases are independent and can execute in parallel. No ordering constraints.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Plugin Skeleton | 0/TBD | Not started | - |
| 2. Shared Libraries | 0/1 | Planned | - |
| 3. Format Hook | 0/TBD | Not started | - |
| 4. Lint Hook | 0/1 | Planned | - |
| 5. Guard Hook | 0/1 | Planned | - |
| 6. Session Hook | 0/TBD | Not started | - |
| 7. Quality Gate Skill | 0/TBD | Not started | - |
| 8. Config Layer | 0/1 | Planned | - |
| 9. Impact Skill | 0/1 | Planning complete | - |
| 10. Drift Skill | 0/TBD | Not started | - |
| 11. Pulse Skill | 0/1 | Planning complete | - |
| 12. Deploy Skill | 0/1 | Planning complete | - |
| 13. Tests | 0/3 | Planning complete | - |
