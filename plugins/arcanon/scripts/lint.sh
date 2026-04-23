#!/usr/bin/env bash
set -euo pipefail

# ── Header guards ──────────────────────────────────────────────────────────────

# 1. Bail immediately if lint is disabled (ARCANON_DISABLE_LINT)
[[ -n "${ARCANON_DISABLE_LINT:-}" ]] && exit 0

# 2. Read stdin JSON and extract file path / tool name (PLGN-07 pattern)
INPUT=$(cat)
FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // empty')

# ── MCP server stdout-pollution guard ──────────────────────────────────────────
# console.log in worker/mcp-server.js silently corrupts the MCP JSON-RPC session.
# This check runs on every lint invocation so CI catches the violation immediately.
MCP_SERVER_FILE="worker/mcp/server.js"
if [[ -f "$MCP_SERVER_FILE" ]]; then
  if grep -n "console\.log" "$MCP_SERVER_FILE" &>/dev/null; then
    printf 'ERROR: console.log found in %s — MCP stdout pollution risk. Use console.error() instead.\n' "$MCP_SERVER_FILE" >&2
    exit 1
  else
    printf 'OK: no console.log in %s\n' "$MCP_SERVER_FILE" >&2
  fi
fi

# 4. Nothing to do if file_path is absent or the file doesn't exist
[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

# 5. Skip generated/vendor directories
case "$FILE" in
  *node_modules/*|*.venv/*|*target/*|*/dist/*|*/build/*|*__pycache__/*) exit 0 ;;
esac

# ── Language detection ─────────────────────────────────────────────────────────

LANG=""

# Prefer shared detect.sh when Phase 2 has been executed
if [[ -f "${CLAUDE_PLUGIN_ROOT:-}/lib/detect.sh" ]]; then
  # shellcheck source=/dev/null
  source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
  LANG=$(detect_language "$FILE" 2>/dev/null || true)
fi

# Inline fallback: extension-based detection
if [[ -z "$LANG" ]]; then
  case "$FILE" in
    *.py)                  LANG="python" ;;
    *.rs)                  LANG="rust" ;;
    *.ts|*.tsx|*.js|*.jsx) LANG="typescript" ;;
    *.go)                  LANG="go" ;;
    *)                     exit 0 ;;
  esac
fi

# ── Linter invocation ──────────────────────────────────────────────────────────

LINT_OUTPUT=""
LINTER_NAME=""

case "$LANG" in

  # ── Python: ruff check ─────────────────────────────────────────────────────
  python)
    if command -v ruff &>/dev/null; then
      LINT_OUTPUT=$(ruff check "$FILE" 2>&1 || true)
      LINTER_NAME="ruff"
    fi
    ;;

  # ── Rust: cargo clippy with 30-second throttle ─────────────────────────────
  rust)
    # Locate the Cargo.toml root; skip if not in a cargo project
    CARGO_ROOT=$(cargo locate-project --message-format plain 2>/dev/null | xargs dirname 2>/dev/null || true)
    [[ -z "$CARGO_ROOT" ]] && exit 0

    # Throttle key: cksum is POSIX-available (unlike md5sum on macOS)
    THROTTLE_KEY=$(printf '%s' "$CARGO_ROOT" | cksum | cut -d' ' -f1)
    THROTTLE_FILE="/tmp/arcanon_clippy_${THROTTLE_KEY}"
    THROTTLE_SECS="${ARCANON_LINT_THROTTLE:-30}"

    NOW=$(date +%s)
    LAST=0
    [[ -f "$THROTTLE_FILE" ]] && LAST=$(cat "$THROTTLE_FILE" 2>/dev/null || echo 0)

    if (( (NOW - LAST) < THROTTLE_SECS )); then
      exit 0  # throttled — too soon since last clippy run
    fi

    # Record timestamp BEFORE running so concurrent events are also throttled
    printf '%s' "$NOW" > "$THROTTLE_FILE"

    if command -v cargo &>/dev/null; then
      LINT_OUTPUT=$(cd "$CARGO_ROOT" && cargo clippy --message-format=short 2>&1 || true)
      LINTER_NAME="clippy"
    fi
    ;;

  # ── TypeScript / JavaScript: eslint with local resolution ─────────────────
  typescript|javascript)
    ESLINT=""
    # 1. Local node_modules/.bin/eslint (most common for project installs)
    if [[ -f "node_modules/.bin/eslint" ]]; then
      ESLINT="node_modules/.bin/eslint"
    # 2. Global install
    elif command -v eslint &>/dev/null; then
      ESLINT="eslint"
    fi

    [[ -z "$ESLINT" ]] && exit 0  # eslint not found — silent skip (LNTH-08)

    LINT_OUTPUT=$("$ESLINT" "$FILE" 2>&1 || true)
    LINTER_NAME="eslint"

    # Treat config errors as a skip — clear output
    if printf '%s' "$LINT_OUTPUT" | grep -qE "Oops!|ESLint couldn't find|No eslint configuration"; then
      LINT_OUTPUT=""
    fi
    ;;

  # ── Go: golangci-lint on package directory ─────────────────────────────────
  go)
    if command -v golangci-lint &>/dev/null; then
      PKG_DIR=$(dirname "$FILE")
      LINT_OUTPUT=$(golangci-lint run "${PKG_DIR}/..." 2>&1 || true)
      LINTER_NAME="golangci-lint"
    fi
    ;;

  # ── Unknown language ────────────────────────────────────────────────────────
  *)
    exit 0
    ;;

esac

# ── Output formatting (LNTH-06) ────────────────────────────────────────────────

# Nothing to report — clean or linter not installed
[[ -z "${LINT_OUTPUT// }" ]] && exit 0

# Truncate to first 30 lines; append summary if output was longer
TRIMMED=$(printf '%s' "$LINT_OUTPUT" | head -30)
LINE_COUNT=$(printf '%s\n' "$LINT_OUTPUT" | wc -l | tr -d ' ')

if (( LINE_COUNT > 30 )); then
  TRIMMED="${TRIMMED}
... ($(( LINE_COUNT - 30 )) more lines — run \`${LINTER_NAME} ${FILE}\` to see all)"
fi

MSG="Arcanon lint [${LINTER_NAME}]: ${FILE}
${TRIMMED}"

# Safe JSON emission via jq — handles quotes, backslashes, newlines (Pattern 4)
printf '{"systemMessage": %s}\n' "$(printf '%s' "$MSG" | jq -Rs .)"

# ── Final exit (LNTH-07: always 0) ────────────────────────────────────────────
exit 0
