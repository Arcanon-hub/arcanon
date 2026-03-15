---
name: quality-gate
description: Run quality checks for this project. Use when the user invokes /allclear, asks to verify code quality, or wants to confirm code is clean before committing. Both /allclear and /allclear:quality-gate are valid invocation forms depending on plugin namespace resolution.
allowed-tools: Bash
argument-hint: "[lint|format|test|typecheck|quick|fix]"
---

## Project Context

Detect the current project environment before selecting commands:

- **Project type:** !`source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh" && detect_project_type . 2>/dev/null || { for f in pyproject.toml Cargo.toml go.mod package.json; do [ -f "$f" ] && echo "${f%%.*}" | sed 's/pyproject/python/;s/Cargo/rust/;s/go/go/;s/package/node/' && break; done; }`
- **Makefile targets available:** !`[ -f Makefile ] && make -qp 2>/dev/null | grep -E '^[a-zA-Z_-]+:[^=]' | grep -E '^(lint|format|fmt|test|typecheck|check|quick|fix):' | cut -d: -f1 | sort -u | tr '\n' ' ' || echo "none"`
- **Working directory:** !`pwd`

## Subcommand Dispatch

The user invoked `/allclear` with argument: **$ARGUMENTS**

Use the table below to determine which checks to run:

| `$ARGUMENTS` value | Checks to run |
|--------------------|---------------|
| (empty)            | lint, format check, test, typecheck |
| `lint`             | lint only |
| `format`           | format check only (dry-run, no file modification) |
| `test`             | tests only |
| `typecheck`        | type checking only |
| `quick`            | lint + format check (no tests, no typecheck) |
| `fix`              | lint --fix + format --write (applies changes to files) |

If `$ARGUMENTS` does not match any value in this table, treat it as empty and run all checks.

## Command Selection

For each check category below, **prefer the Makefile target** if it appears in the Makefile targets listed in Project Context above. Only use the per-language fallback if the Makefile target is absent or the Makefile does not exist.

### Lint

- **Makefile:** `make lint` (use if "lint" was listed in Makefile targets)
- Python fallback: `ruff check .`
- Rust fallback: `cargo clippy -- -D warnings`
- TypeScript/JavaScript fallback: `npx eslint .`
- Go fallback: `golangci-lint run`

### Lint Fix (used only for `fix` subcommand)

- **Makefile:** `make lint` with fix flag if supported, otherwise proceed to fallback
- Python fallback: `ruff check --fix .`
- Rust fallback: `cargo clippy --fix --allow-dirty`
- TypeScript/JavaScript fallback: `npx eslint --fix .`
- Go fallback: `golangci-lint run --fix`

### Format Check (dry-run — used for default run, `format`, and `quick` subcommands)

- **Makefile:** `make format` or `make fmt` (use if either was listed in Makefile targets)
- Python fallback: `ruff format --check .`
- Rust fallback: `cargo fmt --check`
- TypeScript/JavaScript fallback: `npx prettier --check .`
- Go fallback: `gofmt -l . | grep . && exit 1 || exit 0`

### Format Fix (write mode — used only for `fix` subcommand)

- **Makefile:** `make format` or `make fmt` (use if listed; note this may apply changes)
- Python fallback: `ruff format .`
- Rust fallback: `cargo fmt`
- TypeScript/JavaScript fallback: `npx prettier --write .`
- Go fallback: `gofmt -w .`

### Test

- **Makefile:** `make test` (use if "test" was listed in Makefile targets)
- Python fallback: `pytest` (or `python -m pytest` if `pytest` not on PATH)
- Rust fallback: `cargo test`
- TypeScript/JavaScript fallback: `npm test` (dispatches to configured test runner per package.json)
- Go fallback: `go test ./...`

### Typecheck

- **Makefile:** `make typecheck` or `make check` (use if either was listed in Makefile targets)
- Python fallback: `mypy .` (if mypy is configured or `mypy.ini` / `[tool.mypy]` exists), or `pyright` (if `pyrightconfig.json` exists)
- Rust fallback: `cargo check`
- TypeScript fallback: `npx tsc --noEmit`
- Go fallback: `go vet ./...`

If no tool is found for a check category, skip it and note "skipped — no tool found" in the results table.

## Execution Instructions

Run each applicable check **one at a time** using the Bash tool. For each check:

1. Verify the tool is installed before running: `command -v <tool> >/dev/null 2>&1`. If not found, skip and record "skipped — [tool] not found".
2. Capture start time: `START=$(date +%s)`
3. Run the command and capture both stdout and stderr.
4. Capture end time and elapsed: `END=$(date +%s); ELAPSED=$((END - START))`
5. Record the exit code (0 = PASS, non-zero = FAIL).
6. **Continue running remaining checks even if one fails.** Do not abort early.

For mixed-language projects (multiple types detected in Project Context), run checks for **all detected languages** and group results by language in the report.

## IMPORTANT: Fix Subcommand Scope

**The `fix` subcommand ONLY applies auto-fixes to lint and format. NEVER auto-fix test failures or typecheck errors.**

Test failures and typecheck errors require human review. Auto-fixing them may silently alter code semantics and introduce regressions. If test or typecheck failures exist alongside lint/format issues, fix only lint and format, then report the remaining failures for manual resolution.

This restriction is non-negotiable. Do not attempt to fix tests or type errors even if tools claim to support it.

## Result Reporting

### Quality Gate Results (for all subcommands except `fix`)

After running all requested checks, report results in this exact format:

```
## AllClear Quality Gate Results

| Check      | Status | Time   | Command                    |
|------------|--------|--------|----------------------------|
| lint       | PASS   | 1.2s   | make lint                  |
| format     | FAIL   | 0.4s   | ruff format --check .      |
| test       | PASS   | 8.3s   | cargo test                 |
| typecheck  | PASS   | 2.1s   | npx tsc --noEmit           |

**Summary: X/Y checks passed.**
```

- If any checks failed: append "Run `/allclear fix` to auto-fix lint and format issues."
- If all checks passed: append "All checks passed. Code is clean."
- For skipped checks: include a row with status "SKIP" and the skip reason in the Command column.

### Fix Results (for `fix` subcommand only)

After applying fixes, report in this format:

```
## AllClear Fix Results

Applied auto-fixes:
- lint: [command] ([N] issues fixed)
- format: [command] ([N] files reformatted)

Re-run `/allclear` to verify fixes resolved all issues.
Note: Test and typecheck failures require manual review — auto-fix is not applied to these.
```

## Edge Cases

- **No quality tools detected for project type:** Report "No quality tools detected for this project type." and exit cleanly. Do not error.
- **Tool not installed:** Skip that check. Report "skipped — [tool] not found" in the results table. Use `command -v [tool] >/dev/null 2>&1` to verify before each invocation.
- **Mixed-language project:** Run checks for all detected languages. Group results by language in the report table (e.g., add a "Language" column or use separate tables per language).
- **No Makefile:** Use per-language fallback commands for all checks. Do not attempt `make`.
- **`lib/detect.sh` not found:** The inline fallback in the Project Context block above handles this — it probes for `pyproject.toml`, `Cargo.toml`, `go.mod`, `package.json` directly. If no manifest file is found, report "Could not detect project type" and exit cleanly.
- **Unrecognized `$ARGUMENTS`:** Treat as empty — run all checks (lint, format check, test, typecheck).
