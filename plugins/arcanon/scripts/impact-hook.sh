#!/usr/bin/env bash
# scripts/impact-hook.sh — PreToolUse ambient cross-repo consumer warning
#
# Fires AFTER file-guard.sh in hooks.json PreToolUse array. Pure bash + jq + (later) curl + sqlite3 CLI.
# Never blocks (never exit 2). On any error: exit 0 silently to preserve edit flow.
#
# Exit codes:
#   0 = allow (with optional {"systemMessage": "..."} on stdout for the warning)
#   0 = also used for silent paths (self-exclusion, no classification, worker down, internal error)
#
# Environment:
#   ARCANON_DISABLE_HOOK=1   — escape hatch; exit 0 silently (HOK-11)
#   ARCANON_IMPACT_DEBUG=1   — append JSONL trace to $DATA_DIR/logs/impact-hook.jsonl (HOK-10)
#
# Flags:
#   --self-test              — runs skeleton smoke test without reading stdin, exits 0

# Defensive: never `set -e`. Every exit must be explicit.

# ---------------------------------------------------------------------------
# t0 — begin latency clock (for debug trace)
# ---------------------------------------------------------------------------
# macOS BSD date returns "17768000553N" for +%s%3N (%3N is not supported and
# exits 0 with garbage). Validate the result is purely numeric before using it;
# fall back to python3 (which is always available on macOS) otherwise.
_ms_now() {
  local _v
  _v=$(date +%s%3N 2>/dev/null)
  if [[ "$_v" =~ ^[0-9]+$ ]]; then
    printf '%s' "$_v"
  else
    python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo 0
  fi
}
_t0_ms=$(_ms_now)

# ---------------------------------------------------------------------------
# ARCANON_DISABLE_HOOK (HOK-11) — escape hatch, short-circuit
# ---------------------------------------------------------------------------
if [[ "${ARCANON_DISABLE_HOOK:-0}" == "1" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Self-test mode — skeleton smoke check, no stdin read
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--self-test" ]]; then
  echo "impact-hook.sh self-test: ok" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Source library helpers — silently swallow errors (HOK-09)
# ---------------------------------------------------------------------------
_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LIB_DIR="${_HOOK_DIR}/../lib"

# shellcheck source=../lib/data-dir.sh
source "${_LIB_DIR}/data-dir.sh" 2>/dev/null || exit 0
# shellcheck source=../lib/db-path.sh
source "${_LIB_DIR}/db-path.sh" 2>/dev/null || exit 0

DATA_DIR=$(resolve_arcanon_data_dir 2>/dev/null) || exit 0

# ---------------------------------------------------------------------------
# Debug trace helper (HOK-10)
# ---------------------------------------------------------------------------
_debug_trace() {
  [[ "${ARCANON_IMPACT_DEBUG:-0}" == "1" ]] || return 0
  local ts file classified service consumer_count latency_ms
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "unknown")
  file="${1:-}"
  classified="${2:-false}"
  service="${3:-null}"
  consumer_count="${4:-null}"
  local _t1_ms
  _t1_ms=$(_ms_now)
  latency_ms=$(( _t1_ms - _t0_ms ))
  local log_dir="${DATA_DIR}/logs"
  mkdir -p "$log_dir" 2>/dev/null || return 0
  # Service/consumer_count may be null; wrap non-null strings in quotes via jq
  printf '{"ts":"%s","file":%s,"classified":%s,"service":%s,"consumer_count":%s,"latency_ms":%d}\n' \
    "$ts" \
    "$(jq -Rn --arg v "$file" '$v' 2>/dev/null || echo '""')" \
    "$classified" \
    "$(if [[ "$service" == "null" ]]; then echo null; else jq -Rn --arg v "$service" '$v' 2>/dev/null || echo '""'; fi)" \
    "$consumer_count" \
    "$latency_ms" \
    >> "${log_dir}/impact-hook.jsonl" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Read stdin exactly once
# ---------------------------------------------------------------------------
INPUT=$(cat 2>/dev/null || echo "")
if [[ -z "$INPUT" ]]; then
  _debug_trace "" false null null
  exit 0
fi

RAW_FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
if [[ -z "$RAW_FILE" ]]; then
  # Not a file op (e.g. Bash tool) — allow silently
  _debug_trace "" false null null
  exit 0
fi

# ---------------------------------------------------------------------------
# Path normalization (mirror file-guard.sh lines 34-42)
# ---------------------------------------------------------------------------
if command -v realpath &>/dev/null && realpath -m / &>/dev/null 2>&1; then
  FILE=$(realpath -m "$RAW_FILE" 2>/dev/null || printf '%s' "$RAW_FILE")
else
  _dir=$(dirname "$RAW_FILE")
  _base=$(basename "$RAW_FILE")
  _resolved_dir=$(cd "$_dir" 2>/dev/null && pwd || printf '%s' "$_dir")
  FILE="${_resolved_dir}/${_base}"
fi
BASENAME=$(basename "$FILE")

# ---------------------------------------------------------------------------
# HOK-07 — Self-exclusion: skip if file is inside $CLAUDE_PLUGIN_ROOT
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  # Normalize plugin root for stable prefix match
  _PLUGIN_ROOT_NORM="${CLAUDE_PLUGIN_ROOT%/}"
  if [[ "$FILE" == "${_PLUGIN_ROOT_NORM}/"* ]]; then
    _debug_trace "$FILE" false null null
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# HOK-02 Tier 1 — Pure bash pattern match (~0ms)
# Fires warning for: *.proto, openapi.{yaml,yml,json}, swagger.{yaml,yml,json}
# ---------------------------------------------------------------------------
_tier1_match="false"
case "$BASENAME" in
  *.proto) _tier1_match="true" ;;
  openapi.yaml|openapi.yml|openapi.json) _tier1_match="true" ;;
  swagger.yaml|swagger.yml|swagger.json) _tier1_match="true" ;;
esac

if [[ "$_tier1_match" == "true" ]]; then
  # Emit a SKELETON warning. Plan 03 will enrich this with real consumer data.
  # For now: exit 0 with a generic message proving the hook fires.
  # Plan 03 replaces this block with the consumer query + staleness check.
  printf '{"systemMessage": "Arcanon: schema file %s edited — cross-repo consumers may be impacted. Run /arcanon:impact for details."}\n' "$BASENAME"
  _debug_trace "$FILE" true null null
  exit 0
fi

# ---------------------------------------------------------------------------
# Tier 2 SQLite classification — IMPLEMENTED IN PLAN 03
# Anchor marker so Plan 03 knows where to insert its block.
# ---------------------------------------------------------------------------
# <TIER_2_ANCHOR — do not delete; Plan 03 inserts Tier 2 + consumer query here>

# ---------------------------------------------------------------------------
# Default: allow silently
# ---------------------------------------------------------------------------
_debug_trace "$FILE" false null null
exit 0
