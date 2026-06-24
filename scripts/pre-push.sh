#!/usr/bin/env bash
# Pre-push guard — runs the same checks CI runs (.github/workflows/ci.yml) so
# failures surface BEFORE the branch is pushed instead of after the PR opens.
#
# Install once per clone:   make hooks-install
# Bypass in an emergency:   git push --no-verify
#
# Mirrors CI jobs: test-bats, test-worker, lint-manifests, shellcheck.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 1

fail=0
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

# 1. Bats integration suite (mirrors job: test-bats)
step "bats integration tests"
if [ -x tests/bats/bin/bats ]; then
  BATS=tests/bats/bin/bats
elif command -v bats >/dev/null 2>&1; then
  BATS=bats
else
  echo "  bats not found — run 'git submodule update --init' or install bats-core" >&2
  fail=1; BATS=""
fi
if [ -n "$BATS" ]; then
  # HOK-06 is a p99 latency benchmark. CI runs on Linux (threshold 100ms, the
  # authoritative perf gate). macOS has higher BSD fork overhead (p99 baseline
  # ~130-205ms), so a literal 100ms gate false-fails on dev Macs even with no
  # regression. Give Darwin headroom locally — a real regression (e.g. an
  # accidental Node shell-out, +150ms) still trips it; CI catches it precisely.
  if [ -z "${IMPACT_HOOK_LATENCY_THRESHOLD:-}" ]; then
    case "$(uname -s)" in
      Darwin) IMPACT_HOOK_LATENCY_THRESHOLD=300 ;;
      *)      IMPACT_HOOK_LATENCY_THRESHOLD=100 ;;
    esac
  fi
  export IMPACT_HOOK_LATENCY_THRESHOLD
  "$BATS" tests/*.bats || fail=1
fi

# 2. Worker unit tests (mirrors job: test-worker)
step "worker tests"
if command -v node >/dev/null 2>&1; then
  ( cd plugins/arcanon && npm test ) || fail=1
else
  echo "  node not found — cannot run worker tests" >&2; fail=1
fi

# 3. Manifest validation (mirrors job: lint-manifests) — best-effort
step "manifest check"
if command -v jq >/dev/null 2>&1; then
  if jq empty plugins/arcanon/.claude-plugin/plugin.json && jq empty plugins/arcanon/hooks/hooks.json; then
    echo "  JSON valid"
  else
    fail=1
  fi
else
  echo "  jq not found — skipping (CI still runs it)"
fi

# 4. Shellcheck (mirrors job: shellcheck) — best-effort
step "shellcheck"
if command -v shellcheck >/dev/null 2>&1; then
  # Mirror CI exactly: --severity=error (CI does not fail on info/warning).
  shellcheck -x --severity=error -e SC1091 plugins/arcanon/scripts/*.sh plugins/arcanon/lib/*.sh || fail=1
else
  echo "  shellcheck not found — skipping (CI still runs it)"
fi

if [ "$fail" -ne 0 ]; then
  printf '\n\033[31m✗ pre-push checks failed — push aborted.\033[0m Fix the above, or bypass with: git push --no-verify\n' >&2
  exit 1
fi
printf '\n\033[32m✓ all pre-push checks passed\033[0m\n'
