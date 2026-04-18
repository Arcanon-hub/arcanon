#!/usr/bin/env bash
# Mock lint hook — tests CONF-02 disable + CONF-03 throttle
if [[ -n "${ARCANON_DISABLE_LINT:-}" ]]; then
  exit 0
fi
LINT_THROTTLE="${LIGAMEN_LINT_THROTTLE:-30}"
[[ "$LINT_THROTTLE" =~ ^[0-9]+$ ]] || LINT_THROTTLE=30
echo "throttle=$LINT_THROTTLE"
