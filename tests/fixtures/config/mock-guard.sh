#!/usr/bin/env bash
# Mock guard hook — tests CONF-02 disable + CONF-04 extra blocked
# ARCANON_DISABLE_GUARD: exit 0 = allow all writes (guard disabled)
if [[ -n "${ARCANON_DISABLE_GUARD:-}" ]]; then
  exit 0
fi
FILE="${1:-}"
# CONF-04: extra blocked patterns
if [[ -n "${LIGAMEN_EXTRA_BLOCKED:-}" ]]; then
  IFS=':' read -ra _EXTRA_PATTERNS <<< "$LIGAMEN_EXTRA_BLOCKED"
  BASENAME=$(basename "$FILE")
  for _pat in "${_EXTRA_PATTERNS[@]}"; do
    if [[ "$BASENAME" == $_pat ]]; then
      echo "blocked:$FILE"
      exit 2
    fi
  done
fi
echo "allowed:$FILE"
