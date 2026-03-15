# Hooks

AllClear hooks run automatically in the background with zero configuration.

## Auto-Format (PostToolUse)

Every time Claude writes or edits a file, AllClear runs the appropriate formatter:

| Extension | Formatter |
|-----------|-----------|
| `.py` | `ruff format` or `black` |
| `.rs` | `rustfmt` |
| `.ts` `.tsx` `.js` `.jsx` | `prettier` or `eslint --fix` |
| `.go` | `gofmt` |
| `.json` `.yaml` `.yml` | `prettier` |

- If a formatter isn't found, the hook silently skips
- If it crashes, it exits cleanly — never blocks Claude
- Files in `node_modules/`, `.venv/`, `target/` are skipped

## Auto-Lint (PostToolUse)

After every write/edit, AllClear runs your linter and surfaces issues as a system message:

| Language | Linter |
|----------|--------|
| Python | `ruff check` |
| Rust | `cargo clippy` (throttled to once per 30s) |
| TypeScript/JavaScript | `eslint` |
| Go | `golangci-lint` |

Lint output is informational only — never blocks edits.

## File Guard (PreToolUse)

Blocks writes to sensitive files before they happen:

**Hard block (write prevented):**
- `.env`, `.env.*`, `*.pem`, `*.key`, `*credentials*`, `*secret*`
- `package-lock.json`, `Cargo.lock`, `poetry.lock`, `yarn.lock`, `bun.lock`, `Pipfile.lock`
- `node_modules/`, `.venv/`, `target/`

**Soft warn (write allowed with caution):**
- Migration files (`migrations/*.sql`, `migrations/*.py`)
- Generated code (`*.pb.go`, `*_generated.*`, `*.gen.*`)
- `CHANGELOG.md`

## Session Context (SessionStart)

On session start, AllClear detects your project type and injects available commands. Also auto-starts the dependency map worker if configured.

## Disabling Hooks

| Variable | Effect |
|----------|--------|
| `ALLCLEAR_DISABLE_FORMAT=1` | Skip auto-formatting |
| `ALLCLEAR_DISABLE_LINT=1` | Skip auto-linting |
| `ALLCLEAR_DISABLE_GUARD=1` | Skip file guard |
| `ALLCLEAR_DISABLE_SESSION_START=1` | Skip session context |
