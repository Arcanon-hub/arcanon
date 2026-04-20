# Automatic Behaviors

Arcanon runs several things automatically in the background with zero configuration. You don't need to invoke these — they happen every time Claude edits a file or starts a session.

## Formatting After Edits

Every time Claude writes or edits a file, Arcanon runs the appropriate formatter for that file type:

| File type | Formatter used |
|-----------|---------------|
| `.py` | `ruff format` or `black` |
| `.rs` | `rustfmt` |
| `.ts` `.tsx` `.js` `.jsx` | `prettier` or `eslint --fix` |
| `.go` | `gofmt` |
| `.json` `.yaml` `.yml` | `prettier` |

If a formatter isn't installed, the step is silently skipped. If it crashes, it exits cleanly and never blocks Claude from working. Files in `node_modules/`, `.venv/`, and `target/` are always skipped.

## Linting After Edits

After every write or edit, Arcanon also runs your project's linter and surfaces any issues as a system message to Claude:

| Language | Linter used |
|----------|-------------|
| Python | `ruff check` |
| Rust | `cargo clippy` (throttled to once per 30s) |
| TypeScript/JavaScript | `eslint` |
| Go | `golangci-lint` |

Lint output is informational only — it never blocks edits. Claude sees the warnings and can choose to fix them.

## File Guard (Write Protection)

Before Claude writes to a file, Arcanon checks if it's a sensitive file and blocks the write if so. This prevents accidental modifications to files that should be changed manually or not at all.

**Blocked files (write prevented):**

- Secrets and credentials: `.env`, `.env.*`, `*.pem`, `*.key`, `*credentials*`, `*secret*`
- Lock files: `package-lock.json`, `Cargo.lock`, `poetry.lock`, `yarn.lock`, `bun.lock`, `Pipfile.lock`
- Generated directories: `node_modules/`, `.venv/`, `target/`

**Warning-only files (write allowed, but flagged):**

- Migration files (`migrations/*.sql`, `migrations/*.py`)
- Generated code (`*.pb.go`, `*_generated.*`, `*.gen.*`)
- `CHANGELOG.md`

You can add your own blocked patterns with the `ARCANON_EXTRA_BLOCKED` environment variable (colon-separated glob patterns).

## Session Context

When you start a Claude Code session, Arcanon detects your project type and injects the available commands into context. If you've previously built a dependency map, it also starts the background worker automatically so the graph UI and MCP tools are ready.

## Auto-Triggered Skills

In addition to hooks, Arcanon includes two skills that Claude automatically invokes based on context — you don't need to use a slash command:

- **Quality gate skill** — when you ask Claude to run checks, verify code quality, or prepare for a commit, it automatically uses Arcanon's quality gate.
- **Impact skill** — when you ask Claude about service dependencies, impact mapping, or cross-repo scanning, it automatically uses Arcanon's map and impact tools. On first use, it also suggests setting up ChromaDB and the MCP server.

## Disabling Behaviors

| Variable | Effect |
|----------|--------|
| `LIGAMEN_DISABLE_FORMAT=1` | Skip auto-formatting |
| `LIGAMEN_DISABLE_LINT=1` | Skip auto-linting |
| `LIGAMEN_DISABLE_GUARD=1` | Skip file guard |
| `LIGAMEN_DISABLE_SESSION_START=1` | Skip session context |
