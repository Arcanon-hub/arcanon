# Ligamen

Quality gates, cross-repo impact analysis, and service dependency intelligence for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Installation

```bash
claude plugin marketplace add https://github.com/chilleregeravi/ligamen
claude plugin install ligamen@ligamen --scope user
```

## Commands

- `/ligamen:map` — scan repos and build the service dependency graph
- `/ligamen:cross-impact` — find what breaks when you change something
- `/ligamen:drift` — check dependency version alignment across repos

## Hooks

The following run automatically on every session and edit:

- **Auto-format** on every file edit (Python, Rust, TypeScript, Go)
- **Auto-lint** with issues surfaced directly to Claude
- **Sensitive-file guard** blocks writes to `.env`, lock files, credentials
- **Session context** provides project type detection on start and each prompt
- **Dep install** installs MCP server runtime dependencies on first session

## Environment Variables

| Name | Default | Purpose |
|------|---------|---------|
| `LIGAMEN_DISABLE_GUARD` | unset | Set to `1` to disable sensitive-file write blocking |
| `LIGAMEN_DISABLE_LINT` | unset | Set to `1` to disable auto-lint on edit |
| `LIGAMEN_DISABLE_FORMAT` | unset | Set to `1` to disable auto-format on edit |
| `LIGAMEN_EXTRA_BLOCKED` | unset | Colon-separated list of additional file patterns to block |

## MCP Server

An MCP server is included for impact analysis queries. Runtime dependencies are installed automatically on first session start.

For full documentation see the [repository README](https://github.com/chilleregeravi/ligamen).
