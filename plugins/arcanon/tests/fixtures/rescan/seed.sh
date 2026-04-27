#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/rescan/seed.sh — Phase 118-02 (CORRECT-04, CORRECT-05).
#
# Thin wrapper around seed.js. Invoked from tests/rescan.bats setup() to:
#   1. Create two real git repos under <project-root> (repo-a, repo-b) so
#      manager.js's getCurrentHead() git rev-parse HEAD has real commits to
#      report. Required because the rescan path calls upsertRepo →
#      buildScanContext → getCurrentHead transparently.
#   2. Populate a fresh SQLite DB at the worker's hash dir with two repos
#      registered + one prior scan_versions row each + repo_state pointing
#      at the current HEAD. Without options.full=true the scan would be
#      skipped — the rescan trigger MUST bypass that skip.
#   3. Echo the resolved IDs as JSON on stdout for the test to capture.
#
# Usage: seed.sh <project-root> <db-path>

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: seed.sh <project-root> <db-path>" >&2
  exit 2
fi

PROJECT_ROOT="$1"
DB_PATH="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Create two real git repos under the project root. Each gets a single
#    committed file so getCurrentHead() has a real commit hash to return.
for repo in repo-a repo-b; do
  REPO_DIR="$PROJECT_ROOT/$repo"
  mkdir -p "$REPO_DIR"
  if [ ! -d "$REPO_DIR/.git" ]; then
    (
      cd "$REPO_DIR"
      git init -q -b main
      # Pin a stable identity so commits are reproducible across hosts.
      git config user.email "rescan-fixture@arcanon.local"
      git config user.name "Rescan Fixture"
      echo "// $repo seed" > README.md
      git add README.md
      git commit -q -m "init"
    )
  fi
done

mkdir -p "$(dirname "$DB_PATH")"

exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH"
