#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/list/seed.sh — Phase 114-01 (NAV-01).
#
# Thin wrapper around seed.js. Invoked from tests/list.bats setup() to
# populate a fresh SQLite DB at the path the Arcanon worker computes for the
# bats project root (sha256[0:12] under $ARCANON_DATA_DIR/projects/<hash>/impact-map.db).
#
# Mirrors the verify-fixture pattern (plugins/arcanon/tests/fixtures/verify/seed.sh).
#
# Usage: seed.sh <project-root> <db-path> [--no-scan]
#
#   <project-root>   Absolute path of the simulated Arcanon project.
#   <db-path>        Absolute path where the seeded impact-map.db will be written.
#   --no-scan        Optional. Skip inserting the scan_versions row, so the DB
#                    has services/connections/repos but no completed scan —
#                    Test 7 (scan_versions empty) uses this mode.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: seed.sh <project-root> <db-path> [--no-scan|--with-labels|--with-many-labels|--no-actors]" >&2
  exit 2
fi

PROJECT_ROOT="$1"
DB_PATH="$2"
shift 2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$(dirname "$DB_PATH")"

# Forward all remaining flags untouched. seed.js's parser accepts
# --no-scan, --with-labels, --with-many-labels, --no-actors as boolean flags
# (no value follows). Phase 121-02 INT-08.
exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH" "$@"
