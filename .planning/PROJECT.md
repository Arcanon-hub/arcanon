# AllClear

## What This Is

An open-source Claude Code plugin that provides automated quality gates, cross-repo awareness, and continuous formatting/linting hooks for multi-repository development workflows. Designed for teams managing multiple repos across Python, Rust, TypeScript, and Go — detects project type automatically and runs the right tools without configuration.

## Core Value

Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Universal quality gate skill (`/allclear`) with auto-detection of project type
- [ ] Cross-repo impact scanning (`/allclear impact`)
- [ ] Cross-repo consistency checking (`/allclear drift`)
- [ ] Live service health checking (`/allclear pulse`)
- [ ] Deploy state verification (`/allclear deploy`)
- [ ] Auto-format hook on edit (PostToolUse)
- [ ] Auto-lint hook on edit (PostToolUse)
- [ ] Sensitive file guard hook (PreToolUse)
- [ ] Session start context hook (SessionStart)
- [ ] `npx @allclear/cli init` installer
- [ ] Plugin registry publication
- [ ] Git clone + symlink installation path
- [ ] Bats test suite for hook scripts

### Out of Scope

- Linear issue enrichment (`/allclear scope`) — other plugins cover this; no external service dependencies
- GitHub Issues integration — same reasoning
- Any issue tracker integration — keep AllClear focused on code and infrastructure
- RamaEdge-specific logic — plugin must remain generic and framework-agnostic

## Context

Born from the Edgeworks ecosystem (8+ repos spanning Python, Rust, TypeScript) where cross-repo quality coordination was manual and error-prone. The v3.0 Governor/Supervisor removal exposed the cost of not having cross-repo impact scanning — cleanup work cascaded across management-api, edgeworks-ui, edgeworks-deploy, and edgeworks-sdk.

Existing Claude Code plugin infrastructure is well-established: official plugins (code-review, code-simplifier, github, rust-analyzer-lsp) and custom plugins (claude-mem) demonstrate the pattern. The plugin-dev toolkit provides skill-development, hook-development, and agent-development skills for creating new plugins.

GSD workflow is the primary orchestration layer — AllClear complements it by providing quality gates that run during and after GSD execution phases, without duplicating planning, execution, or state management.

## Constraints

- **Plugin format**: Must follow Claude Code plugin conventions (SKILL.md files, hooks.json, package.json)
- **Framework-agnostic**: Detect project type from files (pyproject.toml, Cargo.toml, package.json, go.mod), never assume a specific framework
- **No external service deps**: Every skill must work with only local files, git, and optionally kubectl — no Linear, no external APIs
- **License**: Apache 2.0
- **Distribution**: Three channels — git clone + symlink, Claude plugin registry, `npx @allclear/cli init`
- **Testing**: Bats-core for hook shell scripts
- **Detect, don't configure**: Infer everything from project files; zero-config by default with optional overrides via allclear.config.json
- **Non-blocking hooks**: Format/lint hooks must not block edits on failure — warn and continue
- **Cross-repo discovery**: Auto-detect sibling repos from parent directory, override with config file if present

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dedicated repo (not part of claude-code) | Clean separation between private orchestration and open-source plugin | — Pending |
| Drop /allclear scope | Other plugins handle issue enrichment; keeps AllClear zero external deps | — Pending |
| Plugin + CLI structure | Standard plugin for Claude Code + bin/ entry for npx @allclear/cli init | — Pending |
| @allclear/cli npm package name | Scoped package, clean namespace | — Pending |
| Apache 2.0 license | Permissive with patent protection, standard for dev tools | — Pending |
| Auto-detect + config override for sibling repos | Parent dir scan works for flat layouts, config.json for custom setups | — Pending |
| Include pulse/deploy in v1 | Ship with graceful skip if no kubectl — marks them as optional/advanced | — Pending |
| Full plugin scope for v1 | 5 skills + 4 hooks — ambitious but specs are comprehensive | — Pending |

---
*Last updated: 2026-03-15 after initialization*
