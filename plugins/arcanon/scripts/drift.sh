#!/usr/bin/env bash
# scripts/drift.sh — Unified drift subcommand dispatcher.
# Usage: bash scripts/drift.sh <subcommand> [flags...]
# Subcommands: versions | types | openapi | all | licenses | security
#   licenses and security are reserved (print TBD, exit 2).
# This dispatcher calls subcommands as SUBPROCESSES via `bash`, never `source`.
# Each subcommand continues to source drift-common.sh itself — no coupling here.
set -euo pipefail

# DSP-04: Bash 4+ plugin floor. drift-types.sh uses declare -A which
# silently produces wrong output on macOS system Bash 3.2. Guard at the top.
if (( ${BASH_VERSINFO[0]:-0} < 4 )); then
  echo "arcanon drift requires Bash 4+. Install with: brew install bash" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUBCOMMAND="${1:-all}"
shift || true

case "$SUBCOMMAND" in
  versions)
    exec bash "${SCRIPT_DIR}/drift-versions.sh" "$@"
    ;;
  types)
    exec bash "${SCRIPT_DIR}/drift-types.sh" "$@"
    ;;
  openapi)
    exec bash "${SCRIPT_DIR}/drift-openapi.sh" "$@"
    ;;
  all)
    # Sequential, not parallel. Aggregate exit code = last non-zero.
    _rc=0
    bash "${SCRIPT_DIR}/drift-versions.sh" "$@" || _rc=$?
    bash "${SCRIPT_DIR}/drift-types.sh"    "$@" || _rc=$?
    bash "${SCRIPT_DIR}/drift-openapi.sh"  "$@" || _rc=$?
    exit $_rc
    ;;
  licenses|security)
    # DSP-01: reserved slots. Exit 2 distinguishes "reserved" from "unknown"=1.
    echo "drift: subcommand '${SUBCOMMAND}' is not yet implemented" >&2
    exit 2
    ;;
  -h|--help|help)
    cat <<'EOF'
Usage: bash scripts/drift.sh <subcommand> [flags...]

Subcommands:
  versions   Library version drift across linked repos
  types      Type-definition drift across same-language linked repos
  openapi    OpenAPI spec drift across linked repos
  all        Run versions, types, and openapi sequentially (default)
  licenses   (reserved — not yet implemented)
  security   (reserved — not yet implemented)

Flags are passed through unchanged to subcommand scripts.
Direct invocation of `bash scripts/drift-*.sh` remains supported.
EOF
    exit 0
    ;;
  *)
    echo "drift: unknown subcommand '${SUBCOMMAND}' (valid: versions|types|openapi|all|licenses|security)" >&2
    exit 1
    ;;
esac
