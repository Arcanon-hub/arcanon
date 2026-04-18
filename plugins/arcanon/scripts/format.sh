#!/usr/bin/env bash
# Arcanon: Auto-format hook
# Event: PostToolUse (Write|Edit|MultiEdit)
# Non-blocking: always exits 0 (FMTH-10)

# Disable toggle — ARCANON_DISABLE_FORMAT=1; legacy alias LIGAMEN_DISABLE_FORMAT
[[ "${ARCANON_DISABLE_FORMAT:-${LIGAMEN_DISABLE_FORMAT:-}}" == "1" ]] && exit 0

# Read stdin once (it's a stream — can only be read once)
INPUT=$(cat)

# Extract file path using null-coalescing // empty to avoid literal "null" (Pitfall 5)
FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file or file doesn't exist (e.g., Bash tool PostToolUse)
[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

# Skip generated/dependency directories (FMTH-09)
for SKIP_PAT in "/node_modules/" "/.venv/" "/venv/" "/env/" "/target/" "/.git/" "/__pycache__/" "/.tox/"; do
  [[ "$FILE" == *"$SKIP_PAT"* ]] && exit 0
done

# Dispatch by file extension
EXT="${FILE##*.}"

case "$EXT" in
  py)
    if command -v ruff &>/dev/null; then
      ruff format "$FILE" >/dev/null 2>&1 || true
    elif command -v black &>/dev/null; then
      black "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  rs)
    if command -v rustfmt &>/dev/null; then
      rustfmt "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  ts|tsx|js|jsx|mjs|cjs)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE" >/dev/null 2>&1 || true
    elif [[ -x "./node_modules/.bin/prettier" ]]; then
      ./node_modules/.bin/prettier --write "$FILE" >/dev/null 2>&1 || true
    elif command -v eslint &>/dev/null; then
      eslint --fix "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  json|yaml|yml)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE" >/dev/null 2>&1 || true
    elif [[ -x "./node_modules/.bin/prettier" ]]; then
      ./node_modules/.bin/prettier --write "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
esac

# Non-blocking guarantee — always exit 0 (FMTH-10)
exit 0
