#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/doctor/seed.sh — Phase 114-03 (NAV-03).
#
# Thin wrapper that delegates to the existing list-fixture seeder. The doctor
# tests need exactly the same DB shape (3 repos, 8 services, 47 connections,
# scan_versions row, schema_versions populated to current head) as the list
# tests; rather than duplicate the seeder, we re-use it with optional flags.
#
# Usage:
#   seed.sh <project-root> <db-path> [--no-scan] [--schema-version N]
#
#   <project-root>          Absolute path of the simulated Arcanon project.
#   <db-path>               Absolute path where the seeded impact-map.db is written.
#   --no-scan               Skip the scan_versions row (mirrors list seeder).
#   --schema-version N      After seeding, force schema_versions to MAX(version)=N.
#                           Used by Test 7 (schema mismatch FAIL): seed normally
#                           (head=16) then downgrade to 14 by deleting rows >14.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: seed.sh <project-root> <db-path> [--no-scan] [--schema-version N]" >&2
  exit 2
fi

PROJECT_ROOT="$1"
DB_PATH="$2"
shift 2

NO_SCAN=""
SCHEMA_VERSION=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-scan) NO_SCAN="--no-scan"; shift ;;
    --schema-version) SCHEMA_VERSION="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIST_SEED_JS="${SCRIPT_DIR}/../list/seed.js"

mkdir -p "$(dirname "$DB_PATH")"

# Stage 1 — seed the DB via the list-fixture seeder.
if [ -n "$NO_SCAN" ]; then
  node "$LIST_SEED_JS" --project "$PROJECT_ROOT" --db "$DB_PATH" --no-scan >/dev/null
else
  node "$LIST_SEED_JS" --project "$PROJECT_ROOT" --db "$DB_PATH" >/dev/null
fi

# Stage 2 — optional schema downgrade (Test 7).
if [ -n "$SCHEMA_VERSION" ]; then
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "seed.sh: sqlite3 CLI required for --schema-version" >&2
    exit 1
  fi
  sqlite3 "$DB_PATH" "DELETE FROM schema_versions WHERE version > ${SCHEMA_VERSION};"
fi
