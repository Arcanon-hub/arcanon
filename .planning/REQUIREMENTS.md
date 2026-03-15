# Requirements: AllClear

**Defined:** 2026-03-15
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v1 Requirements

### Plugin Foundation

- [ ] **PLGN-01**: Plugin follows Claude Code plugin format with plugin.json manifest, skills/, hooks/, and scripts/ directories at the plugin root
- [ ] **PLGN-02**: Plugin detects project type from manifest files (pyproject.toml → Python, Cargo.toml → Rust, package.json → Node/TS, go.mod → Go)
- [ ] **PLGN-03**: Plugin supports mixed-language projects by detecting all applicable project types in a directory
- [ ] **PLGN-04**: Plugin uses `${CLAUDE_PLUGIN_ROOT}` for all internal path references to survive cache-copy installation
- [ ] **PLGN-05**: Plugin provides shared bash library functions in lib/ for project detection and sibling repo discovery
- [ ] **PLGN-06**: Plugin can be installed via git clone and symlink into ~/.claude/plugins/
- [ ] **PLGN-07**: Hook scripts use jq for JSON parsing (same pattern as GSD: `printf '%s\n' "$JSON" | jq -r '.field // empty'`)
- [ ] **PLGN-08**: All hook scripts route debug output to stderr only — stdout is reserved for structured JSON responses

### Auto-Format Hook

- [ ] **FMTH-01**: Auto-format hook fires on PostToolUse for Edit and Write tool events
- [ ] **FMTH-02**: Hook formats Python files with ruff format (fallback: black)
- [ ] **FMTH-03**: Hook formats Rust files with rustfmt
- [ ] **FMTH-04**: Hook formats TypeScript/JavaScript files with prettier (fallback: eslint --fix)
- [ ] **FMTH-05**: Hook formats Go files with gofmt
- [ ] **FMTH-06**: Hook formats JSON/YAML files with prettier
- [ ] **FMTH-07**: Hook is silent on success (no output cluttering conversation)
- [ ] **FMTH-08**: Hook skips formatting if formatter is not installed (no nag)
- [ ] **FMTH-09**: Hook skips files in virtual envs, node_modules, and generated directories
- [ ] **FMTH-10**: Hook never blocks edits on formatter failure — exits 0 always

### Auto-Lint Hook

- [ ] **LNTH-01**: Auto-lint hook fires on PostToolUse for Edit and Write tool events
- [ ] **LNTH-02**: Hook lints Python files with ruff check
- [ ] **LNTH-03**: Hook lints Rust files with cargo clippy (throttled to max once per 30 seconds)
- [ ] **LNTH-04**: Hook lints TypeScript/JavaScript files with eslint
- [ ] **LNTH-05**: Hook lints Go files with golangci-lint
- [ ] **LNTH-06**: Hook outputs lint warnings to conversation so Claude can see and address them
- [ ] **LNTH-07**: Hook never blocks edits — informational only, exits 0 always
- [ ] **LNTH-08**: Hook skips if linter is not installed

### Sensitive File Guard Hook

- [ ] **GRDH-01**: Guard hook fires on PreToolUse for Edit and Write tool events
- [ ] **GRDH-02**: Hook hard-blocks edits to lock files (*.lock, Cargo.lock, poetry.lock, package-lock.json, bun.lock) using PreToolUse permissionDecision: "deny" schema
- [ ] **GRDH-03**: Hook hard-blocks edits to secret/credential files (.env, .env.*, *credentials*, *secret*, *.pem, *.key) with path normalization via realpath
- [ ] **GRDH-08**: Hook provides clear explanation in block messages ("AllClear: blocked write to .env — sensitive file protected")
- [ ] **GRDH-04**: Hook hard-blocks edits to generated directories (node_modules/, .venv/, target/)
- [ ] **GRDH-05**: Hook warns but allows edits to SQL migration files with immutability notice
- [ ] **GRDH-06**: Hook warns but allows edits to generated code files (*.pb.go, *_generated.*, *.gen.*)
- [ ] **GRDH-07**: Hook warns but allows edits to CHANGELOG.md with auto-generation notice

### Session Start Hook

- [ ] **SSTH-01**: Session start hook fires on SessionStart event with UserPromptSubmit fallback for brand-new sessions (upstream bug #10373)
- [ ] **SSTH-02**: Hook detects project type and displays available allclear commands
- [ ] **SSTH-03**: Hook is lightweight — checks files only, no tool execution
- [ ] **SSTH-04**: Hook can be disabled via ALLCLEAR_DISABLE_SESSION_START environment variable
- [ ] **SSTH-05**: Hook deduplicates — if both SessionStart and UserPromptSubmit fire, context is injected only once

### Quality Gate Skill

- [ ] **GATE-01**: `/allclear` skill runs all quality checks (lint, format, test, typecheck) appropriate to detected project type
- [ ] **GATE-02**: Skill supports subcommands: lint, format, test, typecheck, quick (lint+format only), fix (auto-fix lint+format)
- [ ] **GATE-03**: Skill prefers Makefile targets (make lint, make format, etc.) over direct tool invocation when Makefile exists
- [ ] **GATE-04**: Skill reports results with pass/fail status, timing, and command used for each check
- [ ] **GATE-05**: Skill offers auto-fix for lint/format failures only (never auto-fix test or typecheck)

### Cross-Repo Impact Skill

- [ ] **IMPT-01**: `/allclear impact` skill scans sibling repos for references to specified search terms
- [ ] **IMPT-02**: Skill auto-detects sibling repos by scanning parent directory for .git/ directories
- [ ] **IMPT-03**: Skill supports `--changed` flag to auto-detect symbols from git diff HEAD~1
- [ ] **IMPT-04**: Skill classifies matches by type: code, config, documentation, test
- [ ] **IMPT-05**: Skill groups results by repo with match counts and file locations
- [ ] **IMPT-06**: Skill supports config override for sibling repo paths via allclear.config.json
- [ ] **IMPT-07**: Skill supports --exclude flag to skip specific repos

### Cross-Repo Drift Skill

- [ ] **DRFT-01**: `/allclear drift` skill checks version alignment of shared dependencies across sibling repos
- [ ] **DRFT-02**: Skill checks type definition consistency for shared models across repos
- [ ] **DRFT-03**: Skill checks OpenAPI spec consistency for shared endpoints
- [ ] **DRFT-04**: Skill supports subcommands: versions, types, openapi
- [ ] **DRFT-05**: Skill reports drift with specific divergences and which repos are affected
- [ ] **DRFT-06**: Skill output uses severity levels and defaults to actionable differences only (not wall of text)

### Service Health Skill

- [ ] **PULS-01**: `/allclear pulse` skill checks health of running services via kubectl or ingress
- [ ] **PULS-02**: Skill parses /health endpoint responses (alive, ready, status, components)
- [ ] **PULS-03**: Skill compares running version to latest git tag
- [ ] **PULS-04**: Skill gracefully skips if kubectl is not available with clear message
- [ ] **PULS-05**: Skill supports targeting specific environments (dev, staging, prod)

### Deploy Verification Skill

- [ ] **DPLY-01**: `/allclear deploy` skill compares expected state (kustomize/helm) to actual cluster state
- [ ] **DPLY-02**: Skill checks image tags match between code and deployed pods
- [ ] **DPLY-03**: Skill checks configmap values match between overlays and cluster
- [ ] **DPLY-04**: Skill gracefully skips if kubectl is not available with clear message
- [ ] **DPLY-05**: Skill supports --diff flag to show specific differences

### Configuration

- [ ] **CONF-01**: Plugin supports allclear.config.json for overriding sibling repo paths
- [ ] **CONF-02**: Plugin supports environment variables for hook toggles (ALLCLEAR_DISABLE_FORMAT, ALLCLEAR_DISABLE_LINT, ALLCLEAR_DISABLE_GUARD)
- [ ] **CONF-03**: Plugin supports ALLCLEAR_LINT_THROTTLE for configuring clippy throttle interval
- [ ] **CONF-04**: Plugin supports ALLCLEAR_EXTRA_BLOCKED for additional blocked file patterns

### Testing

- [ ] **TEST-01**: Bats test suite covers auto-format hook for each language (Python, Rust, TS, Go)
- [ ] **TEST-02**: Bats test suite covers auto-lint hook for each language
- [ ] **TEST-03**: Bats test suite covers sensitive file guard hook (hard blocks and soft warnings)
- [ ] **TEST-04**: Bats test suite covers session start hook
- [ ] **TEST-05**: Bats test suite covers project type detection library
- [ ] **TEST-06**: Bats test suite covers sibling repo discovery library
- [ ] **TEST-07**: Bats tests verify non-blocking guarantee (PostToolUse hooks always exit 0)
- [ ] **TEST-08**: Bats tests verify correct exit codes for PreToolUse blocking (exit 2)

## v2 Requirements

### Distribution

- **DIST-01**: `npx @allclear/cli init` installer copies plugin files and sets up symlinks
- **DIST-02**: Plugin published to Claude plugin registry / marketplace
- **DIST-03**: @allclear npm org reserved

### Enhanced Features

- **ENHN-01**: LSP server bundling for real-time diagnostics beyond PostToolUse hooks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Issue tracker integration (Linear, GitHub Issues) | Other plugins handle this; keeps AllClear zero external deps |
| Blocking hooks for format/lint failures | Anti-pattern — blocks Claude's flow; warn and continue is correct |
| Per-language config files (.allclear-python.json) | Config sprawl; delegate to underlying tools (ruff.toml, etc.) |
| CI/CD pipeline integration | Separate concern; focus on local dev loop |
| Monorepo support (Nx, Turborepo, Bazel) | AllClear targets multi-repo teams; monorepo orchestrators already solve this |
| Real-time file watcher daemon | PostToolUse hooks already fire on every Claude edit |
| Framework-specific rules | Violates framework-agnostic constraint; run native linters instead |
| Auto-fix for test/typecheck failures | Unsafe — may silently alter code semantics |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLGN-01 | Phase 1 | Pending |
| PLGN-04 | Phase 1 | Pending |
| PLGN-06 | Phase 1 | Pending |
| PLGN-02 | Phase 2 | Pending |
| PLGN-03 | Phase 2 | Pending |
| PLGN-05 | Phase 2 | Pending |
| PLGN-07 | Phase 2 | Pending |
| PLGN-08 | Phase 2 | Pending |
| FMTH-01 | Phase 3 | Pending |
| FMTH-02 | Phase 3 | Pending |
| FMTH-03 | Phase 3 | Pending |
| FMTH-04 | Phase 3 | Pending |
| FMTH-05 | Phase 3 | Pending |
| FMTH-06 | Phase 3 | Pending |
| FMTH-07 | Phase 3 | Pending |
| FMTH-08 | Phase 3 | Pending |
| FMTH-09 | Phase 3 | Pending |
| FMTH-10 | Phase 3 | Pending |
| LNTH-01 | Phase 4 | Pending |
| LNTH-02 | Phase 4 | Pending |
| LNTH-03 | Phase 4 | Pending |
| LNTH-04 | Phase 4 | Pending |
| LNTH-05 | Phase 4 | Pending |
| LNTH-06 | Phase 4 | Pending |
| LNTH-07 | Phase 4 | Pending |
| LNTH-08 | Phase 4 | Pending |
| GRDH-01 | Phase 5 | Pending |
| GRDH-02 | Phase 5 | Pending |
| GRDH-03 | Phase 5 | Pending |
| GRDH-04 | Phase 5 | Pending |
| GRDH-05 | Phase 5 | Pending |
| GRDH-06 | Phase 5 | Pending |
| GRDH-07 | Phase 5 | Pending |
| GRDH-08 | Phase 5 | Pending |
| SSTH-01 | Phase 6 | Pending |
| SSTH-02 | Phase 6 | Pending |
| SSTH-03 | Phase 6 | Pending |
| SSTH-04 | Phase 6 | Pending |
| SSTH-05 | Phase 6 | Pending |
| GATE-01 | Phase 7 | Pending |
| GATE-02 | Phase 7 | Pending |
| GATE-03 | Phase 7 | Pending |
| GATE-04 | Phase 7 | Pending |
| GATE-05 | Phase 7 | Pending |
| CONF-01 | Phase 8 | Pending |
| CONF-02 | Phase 8 | Pending |
| CONF-03 | Phase 8 | Pending |
| CONF-04 | Phase 8 | Pending |
| IMPT-01 | Phase 9 | Pending |
| IMPT-02 | Phase 9 | Pending |
| IMPT-03 | Phase 9 | Pending |
| IMPT-04 | Phase 9 | Pending |
| IMPT-05 | Phase 9 | Pending |
| IMPT-06 | Phase 9 | Pending |
| IMPT-07 | Phase 9 | Pending |
| DRFT-01 | Phase 10 | Pending |
| DRFT-02 | Phase 10 | Pending |
| DRFT-03 | Phase 10 | Pending |
| DRFT-04 | Phase 10 | Pending |
| DRFT-05 | Phase 10 | Pending |
| DRFT-06 | Phase 10 | Pending |
| PULS-01 | Phase 11 | Pending |
| PULS-02 | Phase 11 | Pending |
| PULS-03 | Phase 11 | Pending |
| PULS-04 | Phase 11 | Pending |
| PULS-05 | Phase 11 | Pending |
| DPLY-01 | Phase 12 | Pending |
| DPLY-02 | Phase 12 | Pending |
| DPLY-03 | Phase 12 | Pending |
| DPLY-04 | Phase 12 | Pending |
| DPLY-05 | Phase 12 | Pending |
| TEST-01 | Phase 13 | Pending |
| TEST-02 | Phase 13 | Pending |
| TEST-03 | Phase 13 | Pending |
| TEST-04 | Phase 13 | Pending |
| TEST-05 | Phase 13 | Pending |
| TEST-06 | Phase 13 | Pending |
| TEST-07 | Phase 13 | Pending |
| TEST-08 | Phase 13 | Pending |

**Coverage:**
- v1 requirements: 79 total
- Mapped to phases: 79
- Unmapped: 0

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 after roadmap revision to parallel structure*
