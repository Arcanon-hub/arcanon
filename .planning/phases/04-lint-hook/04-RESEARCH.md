# Phase 4: Lint Hook - Research

**Researched:** 2026-03-15
**Domain:** PostToolUse hook shell script — multi-language linting (Python/Rust/TS/Go), cargo clippy throttling, Claude Code systemMessage protocol
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LNTH-01 | Auto-lint hook fires on PostToolUse for Edit and Write tool events | hooks.json PostToolUse matcher pattern; confirmed stdin JSON format delivers tool_input.file_path |
| LNTH-02 | Hook lints Python files with ruff check | ruff check exits 1 on violations, output on stdout by default; single-file syntax: `ruff check path/to/file.py` |
| LNTH-03 | Hook lints Rust files with cargo clippy (throttled to max once per 30 seconds) | cargo clippy is project-wide (not single-file); throttle via /tmp timestamp file + `date +%s` arithmetic |
| LNTH-04 | Hook lints TypeScript/JavaScript files with eslint | eslint accepts single file; exits 1 on errors; must guard for missing eslint config (exits 2) |
| LNTH-05 | Hook lints Go files with golangci-lint | golangci-lint run accepts file path arguments; single-file has compilation dependency caveat; exit code 1 on issues |
| LNTH-06 | Hook outputs lint warnings to conversation so Claude can see and address them | PostToolUse systemMessage JSON field surfaces text to the model; captured via stdout JSON on exit 0 |
| LNTH-07 | Hook never blocks edits — informational only, exits 0 always | PostToolUse cannot block; exit 0 always; systemMessage is the correct output channel |
| LNTH-08 | Hook skips if linter is not installed | `command -v <linter>` guard before invocation; silent skip on missing tool |
</phase_requirements>

---

## Summary

Phase 4 implements `scripts/lint.sh`, a PostToolUse hook script that fires on every Edit and Write tool event. The hook reads the edited file path from stdin JSON, detects the file language, runs the appropriate linter, and surfaces any warnings to Claude via the `systemMessage` JSON field on stdout. The hook must always exit 0 — PostToolUse hooks cannot block, and a non-zero exit interferes with Claude's workflow without preventing the edit.

The most novel requirement in this phase is the cargo clippy throttle. Unlike `ruff check` (< 1s) or `eslint` (< 2s), `cargo clippy` rebuilds the entire Rust project and routinely takes 5-30 seconds. Running it on every Rust file edit would make the session unusable. The correct approach is a /tmp timestamp file: record the last run time and skip if fewer than 30 seconds have elapsed. The throttle interval is configurable via `ALLCLEAR_LINT_THROTTLE` (CONF-03).

The lint hook is architecturally parallel to the format hook from Phase 3, but with an important behavioral difference: the format hook is silent on success, while the lint hook must surface warnings to Claude. The `systemMessage` JSON field in the PostToolUse output schema is the correct channel for this — it injects the warning into Claude's active conversation context without blocking.

**Primary recommendation:** Use `systemMessage` in the stdout JSON for lint warnings. Keep all linter output captures to `stderr` redirection during the actual linter run, then format captured output into the JSON response on exit.

---

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| ruff check | >= 0.4 | Python linting | Replaces flake8/pylint; orders of magnitude faster; same install as ruff format from Phase 3 |
| cargo clippy | Bundled with Rust toolchain | Rust linting | The only supported lint layer for Rust; no separate install needed if Rust is present |
| eslint | >= 8.x (v9 config migration active) | TypeScript/JS linting | De facto standard; most TS projects already have it configured |
| golangci-lint | >= 1.60 (v2 released 2025-03-24) | Go linting | Meta-linter that wraps staticcheck, vet, and 100+ others; single binary |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| jq | any | Parse stdin JSON in hook scripts | Required; same pattern used throughout all AllClear hooks (PLGN-07) |
| date +%s | POSIX | Throttle timestamp comparison | Used only for cargo clippy throttle |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ruff check | pylint, flake8 | ruff is 10-100x faster and already installed for format hook |
| golangci-lint | go vet + staticcheck separately | golangci-lint covers more ground with one binary; preferred by Go community |
| eslint (local) | npx eslint | Local install preferred; npx adds 2-5s startup overhead per hook invocation |

**Installation (dev context — plugin users already have their linters):**
```bash
# Python
pip install ruff
# Rust — clippy ships with rustup
rustup component add clippy
# TypeScript
npm install --save-dev eslint
# Go
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

---

## Architecture Patterns

### Recommended Script Structure
```
scripts/
└── lint.sh          # PostToolUse: reads stdin, detects language, runs linter, emits systemMessage
lib/
└── detect.sh        # Shared: detect_language() function — sourced by lint.sh
```

### Pattern 1: PostToolUse stdin → systemMessage stdout

**What:** Hook reads Claude Code's stdin JSON event, extracts `tool_input.file_path`, runs the linter, and emits a `systemMessage` JSON object to stdout if warnings are found.

**When to use:** Every PostToolUse hook that needs to surface information to Claude (not just format silently).

**Verified stdin JSON from official docs:**
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.py",
    "content": "..."
  },
  "tool_response": { "success": true }
}
```

**Verified output JSON (PostToolUse):**
```json
{
  "systemMessage": "AllClear lint [ruff]: path/to/file.py\nE501 Line too long (92 > 79)\n..."
}
```

**Source:** https://code.claude.com/docs/en/hooks

**Example — core lint.sh skeleton:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# Route all debug to stderr (PLGN-08)
exec 2>/dev/null

INPUT=$(cat)
FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // empty')

# Nothing to lint
[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

# Source shared detection library
source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
LANG=$(detect_language "$FILE")

LINT_OUTPUT=""

case "$LANG" in
  python)
    if command -v ruff &>/dev/null; then
      LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
    fi
    ;;
  rust)
    # Throttled — see Pattern 3
    LINT_OUTPUT=$(run_clippy_throttled 2>&1 || true)
    ;;
  typescript|javascript)
    if command -v eslint &>/dev/null; then
      LINT_OUTPUT=$(eslint "$FILE" 2>&1 || true)
    fi
    ;;
  go)
    if command -v golangci-lint &>/dev/null; then
      LINT_OUTPUT=$(golangci-lint run "$FILE" 2>&1 || true)
    fi
    ;;
esac

if [[ -n "$LINT_OUTPUT" ]]; then
  MSG=$(printf 'AllClear lint [%s]:\n%s' "$LANG" "$(echo "$LINT_OUTPUT" | head -30)")
  printf '{"systemMessage": %s}\n' "$(printf '%s' "$MSG" | jq -Rs .)"
fi

exit 0   # ALWAYS — PostToolUse is non-blocking
```

### Pattern 2: `command -v` Guard for Missing Linters

**What:** Every linter invocation is wrapped in `command -v <tool>` before calling. Missing linters are silently skipped — no error, no output (LNTH-08).

**When to use:** All four linters in this hook.

**Example:**
```bash
if command -v ruff &>/dev/null; then
  LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
fi
# If ruff not installed: LINT_OUTPUT stays empty, exit 0 — silent skip
```

### Pattern 3: Cargo Clippy 30-Second Throttle

**What:** Record the last clippy execution timestamp in a /tmp file. On each Rust file edit, compare `$(date +%s)` to the stored timestamp. Skip if fewer than ALLCLEAR_LINT_THROTTLE (default 30) seconds have elapsed.

**Why:** cargo clippy compiles the entire Rust project — not just the changed file. It routinely takes 5-30 seconds. Running it on every `.rs` file edit makes the session unusable.

**Important caveat:** cargo clippy cannot lint a single `.rs` file in isolation. It requires a valid Cargo.toml context and lints the package. The throttle file should be keyed per-project (use the repo root path as part of the key) to avoid cross-project collisions.

**Example:**
```bash
THROTTLE_SECS="${ALLCLEAR_LINT_THROTTLE:-30}"
# Key by Cargo.toml dir so multiple projects don't share the same throttle
CARGO_ROOT=$(dirname "$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null || echo "$FILE")")
THROTTLE_FILE="/tmp/allclear_clippy_$(echo "$CARGO_ROOT" | md5sum | cut -c1-8)"

NOW=$(date +%s)
LAST=0
[[ -f "$THROTTLE_FILE" ]] && LAST=$(cat "$THROTTLE_FILE" 2>/dev/null || echo 0)
ELAPSED=$(( NOW - LAST ))

if (( ELAPSED < THROTTLE_SECS )); then
  exit 0  # Skip — too soon
fi

echo "$NOW" > "$THROTTLE_FILE"

# cargo clippy runs from Cargo.toml dir, not the single file
if command -v cargo &>/dev/null; then
  cd "$CARGO_ROOT"
  LINT_OUTPUT=$(cargo clippy 2>&1 || true)
fi
```

### Pattern 4: Lint Output Escaping for JSON systemMessage

**What:** Lint output contains special characters (quotes, backslashes, newlines) that break inline JSON construction. Use `jq -Rs .` to safely encode arbitrary string content into a valid JSON string.

**When to use:** Whenever constructing the `systemMessage` JSON output — never use `printf '{"systemMessage": "...%s..."}'` with raw linter output.

**Example:**
```bash
MSG="AllClear lint [$LANG]:\n$(echo "$LINT_OUTPUT" | head -30)"
# Safe JSON encoding
printf '{"systemMessage": %s}\n' "$(printf '%s' "$MSG" | jq -Rs .)"
```

### Pattern 5: Limiting Output Volume

**What:** Lint output can be long (hundreds of warnings on a large file). Truncate to the first N lines before encoding into systemMessage so Claude's context doesn't get flooded.

**When to use:** All four linters.

**Example:**
```bash
LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
TRIMMED=$(echo "$LINT_OUTPUT" | head -30)
LINE_COUNT=$(echo "$LINT_OUTPUT" | wc -l | tr -d ' ')
if (( LINE_COUNT > 30 )); then
  TRIMMED="${TRIMMED}
... ($(( LINE_COUNT - 30 )) more lines — run \`ruff check $FILE\` to see all)"
fi
```

### Anti-Patterns to Avoid

- **Exiting non-zero:** Never `exit 1` from this hook. PostToolUse cannot block anything and a non-zero exit produces an error in Claude's context. Always `exit 0`.
- **Printing linter output raw to stdout:** Only valid JSON (or no output) goes to stdout. All linter invocations must redirect stderr and capture stdout. Use `LINT_OUTPUT=$(linter cmd 2>&1 || true)` — the `|| true` prevents `set -e` from killing the script.
- **Running cargo clippy without throttle:** Running clippy on every `.rs` write will freeze the user's session. The throttle is mandatory (LNTH-03).
- **Calling eslint without checking for its presence:** ESLint is a project-local install in `node_modules/.bin/`. The PATH may not include it. Prefer `$(npm bin)/eslint` or detect it via `npx --no-install eslint` with a fallback.
- **Linting irrelevant file types:** The hook fires on ALL Edit/Write events. A `.md`, `.json`, or `.sh` file write must exit 0 immediately without invoking any linter. The extension check must happen before any linter is called.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Python lint rule engine | Custom pyflakes/AST walker | `ruff check` | ruff bundles 700+ rules, is maintained, handles edge cases in PEP-8 compliance |
| Rust lint analysis | Custom Rust AST visitor | `cargo clippy` | clippy is the official Rust lint layer; no alternative exists for in-process Rust linting |
| TS/JS lint analysis | Manual regex for common patterns | `eslint` | ESLint is configurable per-project via existing `.eslintrc`; respects project's chosen rules |
| Go lint analysis | `go vet` alone | `golangci-lint` | golangci-lint runs staticcheck, errcheck, govet, and 50+ linters in one invocation |
| JSON encoding of lint output | Manual shell escaping | `jq -Rs .` | Multi-line strings with quotes/backslashes break naive JSON construction; jq handles it safely |
| Project-type detection | Inline manifest checks in lint.sh | `lib/detect.sh` sourced function | detect.sh is the single source of truth; duplicating it causes drift (Architecture PITFALL-4) |

**Key insight:** The linters themselves are the product of years of community work covering edge cases no hook script should try to replicate. The hook's only job is invocation, capture, and output routing.

---

## Common Pitfalls

### Pitfall 1: stdout Pollution Breaks JSON Parsing
**What goes wrong:** Any non-JSON output on stdout (debug echo, linter stdout passing through) corrupts the JSON that Claude Code parses. Claude receives a JSON parse error and the systemMessage is lost.
**Why it happens:** Linters write to both stdout and stderr. Capturing with `$(linter)` only captures stdout; stderr passes through to the hook's own stdout unless redirected.
**How to avoid:** Use `$(linter "$FILE" 2>&1 || true)` to capture both streams into the variable. Before the final JSON output, ensure no other stdout has been emitted (no bare `echo` calls).
**Warning signs:** Hook fires but systemMessage never appears in Claude's conversation. Adding `echo "debug"` to the script causes it to stop working.

### Pitfall 2: `set -e` Kills the Script on Linter Findings
**What goes wrong:** `set -euo pipefail` is standard defensive shell practice. But linters exit with code 1 when they find issues. Without `|| true`, the script exits before emitting the systemMessage.
**Why it happens:** Exit code 1 from `ruff check` is not an error — it means "found issues." But `set -e` treats any non-zero exit as fatal.
**How to avoid:** Always append `|| true` to linter invocations inside `$(...)`:
```bash
LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
```
The `|| true` makes the subshell succeed regardless of exit code, so the assignment proceeds.
**Warning signs:** Hook script terminates mid-execution. No systemMessage emitted even when linter would find issues. Silent failure.

### Pitfall 3: ESLint Not Found When Run as `eslint`
**What goes wrong:** `command -v eslint` returns false even though ESLint is installed in `node_modules/.bin/`. The linter is skipped silently.
**Why it happens:** ESLint is typically a project-local npm dependency, not a global install. `node_modules/.bin/eslint` is not in PATH unless the user has set that up.
**How to avoid:** Try multiple resolution paths in order:
1. `$(npm bin 2>/dev/null)/eslint` — project-local via npm bin
2. `node_modules/.bin/eslint` — direct path fallback
3. `command -v eslint` — global install
```bash
ESLINT=""
if [[ -f "$(npm bin 2>/dev/null)/eslint" ]]; then ESLINT="$(npm bin)/eslint"
elif [[ -f "node_modules/.bin/eslint" ]]; then ESLINT="node_modules/.bin/eslint"
elif command -v eslint &>/dev/null; then ESLINT="eslint"
fi
[[ -z "$ESLINT" ]] && exit 0  # not installed
```
**Warning signs:** TypeScript files edited but no lint output ever appears. `command -v eslint` returns nothing but `./node_modules/.bin/eslint --version` works.

### Pitfall 4: Cargo Clippy Runs from Wrong Directory
**What goes wrong:** `cargo clippy` is invoked from the Rust file's directory rather than the project root (where `Cargo.toml` lives). Cargo cannot find the manifest and exits with an error.
**Why it happens:** The hook receives an absolute path to the `.rs` file. Naively running `cargo clippy` in the current directory (which is wherever Claude is working) may not contain `Cargo.toml`.
**How to avoid:** Resolve the Cargo.toml root before running clippy:
```bash
CARGO_ROOT=$(cargo locate-project --message-format plain 2>/dev/null | xargs dirname 2>/dev/null || true)
[[ -z "$CARGO_ROOT" ]] && exit 0  # not in a cargo project
(cd "$CARGO_ROOT" && cargo clippy 2>&1 || true)
```
**Warning signs:** Cargo error "could not find Cargo.toml". Clippy output contains "error: no such file or directory" for cargo itself.

### Pitfall 5: golangci-lint Single-File Compilation Failure
**What goes wrong:** `golangci-lint run specific_file.go` fails because the file has imports from other files in the same package that are not included in the analysis.
**Why it happens:** Go tools require the full package to typecheck. Running lint on a single `.go` file without its package siblings produces "undeclared name" errors.
**How to avoid:** Run golangci-lint on the package directory, not the individual file:
```bash
PKG_DIR=$(dirname "$FILE")
golangci-lint run "$PKG_DIR/..." 2>&1 || true
```
This lints the package that contains the edited file, not just the file in isolation.
**Warning signs:** golangci-lint exits with "undeclared name" errors that are clearly false (the names are declared in sibling files). Lint output is noise rather than real issues.

### Pitfall 6: Throttle Timestamp Race (Low Probability)
**What goes wrong:** Two concurrent PostToolUse events (e.g., a multi-file write batch) both read the old timestamp simultaneously, both decide "30s elapsed", and both run cargo clippy simultaneously — doubling the load.
**Why it happens:** The timestamp check and write are not atomic.
**How to avoid:** Use `flock` for atomic test-and-set, or accept the low-probability double-run (two sequential clippy runs is not a correctness issue, just a minor performance hit). For v1, accept the race.
**Warning signs:** Occasional double clippy invocations in verbose debug output. Not harmful.

---

## Code Examples

Verified patterns from official sources:

### PostToolUse stdin Extraction (Official Schema)
```bash
# Source: https://code.claude.com/docs/en/hooks
INPUT=$(cat)
FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // empty')
TOOL=$(printf '%s\n' "$INPUT" | jq -r '.tool_name // empty')
```

### Safe systemMessage Emission
```bash
# Source: https://code.claude.com/docs/en/hooks (output schema)
# jq -Rs . converts multi-line string to valid JSON string literal
MSG="AllClear lint [ruff]: found issues in ${FILE}\n${LINT_OUTPUT}"
printf '{"systemMessage": %s}\n' "$(printf '%s' "$MSG" | jq -Rs .)"
exit 0
```

### ruff check — Single File
```bash
# Source: https://docs.astral.sh/ruff/linter/
# Exit codes: 0 = clean, 1 = violations found, 2 = abnormal termination
# Default output is human-readable text to stdout
LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
```

### eslint — Single File with Local Resolution
```bash
# Source: https://eslint.org/docs/latest/use/command-line-interface
# Exit codes: 0 = no errors, 1 = lint errors, 2 = config/fatal errors
ESLINT="eslint"
[[ -f "$(npm bin 2>/dev/null)/eslint" ]] && ESLINT="$(npm bin)/eslint"
LINT_OUTPUT=$("$ESLINT" "$FILE" 2>&1 || true)
```

### cargo clippy — Project-Level with Message Format
```bash
# Source: https://doc.rust-lang.org/stable/clippy/usage.html
# clippy runs on the whole project from Cargo.toml directory
# --message-format=short gives compact output suitable for systemMessage
LINT_OUTPUT=$(cargo clippy --message-format=short 2>&1 || true)
```

### golangci-lint — Package Directory
```bash
# Source: https://golangci-lint.run/docs/configuration/cli/
# Run against package dir (not single file) to avoid compilation errors
# Exit code: 1 if issues found, 0 if clean
PKG_DIR=$(dirname "$FILE")
LINT_OUTPUT=$(golangci-lint run "${PKG_DIR}/..." 2>&1 || true)
```

### Timestamp-Based Throttle (30-second gate)
```bash
# POSIX-compatible timestamp throttle — no external deps
THROTTLE_SECS="${ALLCLEAR_LINT_THROTTLE:-30}"
THROTTLE_KEY=$(printf '%s' "$CARGO_ROOT" | md5sum 2>/dev/null | cut -c1-8 || printf '%s' "$CARGO_ROOT" | cksum | cut -d' ' -f1)
THROTTLE_FILE="/tmp/allclear_clippy_${THROTTLE_KEY}"

NOW=$(date +%s)
LAST=0
[[ -f "$THROTTLE_FILE" ]] && LAST=$(cat "$THROTTLE_FILE" 2>/dev/null || echo 0)

if (( (NOW - LAST) < THROTTLE_SECS )); then
  exit 0  # throttled — too soon since last clippy run
fi

printf '%s' "$NOW" > "$THROTTLE_FILE"
# ... now run cargo clippy
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pylint + flake8 for Python lint | ruff check | 2023 | Single tool, 10-100x faster, same rules; skip installing pylint |
| `--out-format` flag in golangci-lint | `--output.text.path` (v2 syntax) | 2025-03-24 | v2 removed `--out-format`; use default text output or new flag syntax |
| ESLint v8 flat config | ESLint v9 flat config (eslint.config.js) | 2024 | Some projects still on v8; hook must not fail if config format differs |
| `cargo clippy -- -D warnings` | `cargo clippy` (warn only) | N/A | In hook context, never use `-D warnings` — it causes non-zero exit on warnings, blocking the project build if hook logic is wrong |

**Deprecated/outdated:**
- `pylint` / `flake8` as primary Python linters: replaced by ruff for speed; still valid to support as fallback if ruff absent
- `golangci-lint --out-format=<format>`: removed in v2 (March 2025); use `--output.text.path=stdout` or rely on default output

---

## Open Questions

1. **ESLint v9 flat config detection**
   - What we know: ESLint v9 uses `eslint.config.js`; v8 uses `.eslintrc.*`. The hook doesn't need to handle config files directly — eslint discovers them automatically.
   - What's unclear: If a project has no eslint config at all, `eslint` may exit with code 2 (config error). Should the hook treat exit code 2 as "not configured, skip silently"?
   - Recommendation: Treat eslint exit code 2 as a skip condition (same as "not installed") and emit no output. Only exit code 1 (lint findings) produces a systemMessage.

2. **golangci-lint v1 vs v2 compatibility**
   - What we know: v2 was released 2025-03-24 with breaking CLI changes (`--out-format` removed). Users may have either version.
   - What's unclear: Whether the `golangci-lint run <dir>/...` syntax is identical in both versions.
   - Recommendation: Rely on default text output (no `--output` flag) — this works in both v1 and v2 since both default to human-readable text to stdout.

3. **ALLCLEAR_DISABLE_LINT environment variable**
   - What we know: CONF-02 requires `ALLCLEAR_DISABLE_LINT` env var support. The lint hook should check this at startup and `exit 0` immediately if set.
   - What's unclear: Whether this is handled in the hook script itself or in hooks.json via a `condition` field.
   - Recommendation: Handle in lint.sh script header with `[[ -n "${ALLCLEAR_DISABLE_LINT:-}" ]] && exit 0`. This is consistent with how other hooks handle their disable vars.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bats (Bash Automated Testing System) |
| Config file | none — see Wave 0 |
| Quick run command | `bats tests/lint.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LNTH-01 | Hook fires for Edit and Write, skips other tools | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-02 | ruff check runs on .py files | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-03 | cargo clippy throttled to 30s | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-04 | eslint runs on .ts/.js files | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-05 | golangci-lint runs on .go files | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-06 | systemMessage JSON emitted when warnings found | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-07 | Exit 0 always (even when linter finds issues) | unit | `bats tests/lint.bats` | ❌ Wave 0 |
| LNTH-08 | Silent skip when linter not installed | unit | `bats tests/lint.bats` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bats tests/lint.bats`
- **Per wave merge:** `bats tests/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/lint.bats` — covers LNTH-01 through LNTH-08
- [ ] `tests/test_helper/bats-support` — bats helper library for readable assertions
- [ ] `tests/test_helper/bats-assert` — assertion helpers for bats
- [ ] Framework install: `npm install --save-dev bats` or `brew install bats-core`
- [ ] `tests/fixtures/lint/` directory with sample .py, .rs, .ts, .go files for test inputs

---

## Sources

### Primary (HIGH confidence)
- https://code.claude.com/docs/en/hooks — PostToolUse stdin/stdout JSON schema, exit code semantics, systemMessage field, confirmed 2026
- https://docs.astral.sh/ruff/linter/ — ruff check exit codes (0/1/2), single-file invocation syntax
- https://doc.rust-lang.org/stable/clippy/usage.html — cargo clippy exit codes, -D warnings behavior
- https://eslint.org/docs/latest/use/command-line-interface — ESLint exit codes (0/1/2), single file syntax, --max-warnings
- https://golangci-lint.run/docs/configuration/cli/ — golangci-lint run flags, issues-exit-code, output format options

### Secondary (MEDIUM confidence)
- https://golangci-lint.run/docs/welcome/faq/ — single-file linting compilation dependency constraint
- https://ldez.github.io/blog/2025/03/23/golangci-lint-v2/ — v2 breaking changes (--out-format removed, March 2025)
- https://github.com/anthropics/claude-code/issues/3983 — PostToolUse hook JSON output processing notes

### Tertiary (LOW confidence)
- https://gist.github.com/niieani/29a054eb29d5306b32ecdfa4678cbb39 — bash throttle/debounce patterns (community gist, not official)

---

## Metadata

**Confidence breakdown:**
- Standard stack (linter tools): HIGH — verified from official docs for each tool
- Hook JSON protocol: HIGH — verified from official Claude Code hooks reference
- Cargo clippy throttle: MEDIUM — timestamp pattern is established shell practice; the 30s default matches CONF-03; atomic race is LOW probability and acceptable in v1
- golangci-lint single-file caveat: HIGH — confirmed via official FAQ and GitHub issue #1574
- ESLint local resolution: MEDIUM — npm bin deprecation means `npm bin` may warn in newer npm; direct `node_modules/.bin/` path is more stable

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (90 days — tools are stable; golangci-lint v2 changes are already reflected above)
