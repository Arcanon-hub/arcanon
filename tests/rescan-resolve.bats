#!/usr/bin/env bats
#
# tests/rescan-resolve.bats — TST-01 + TST-02 (Phase 130).
#
# WHY THIS EXISTS
#   The /arcanon:rescan command's Step-1 "resolve repo identifier → row" block
#   is an inline `node --input-type=module` snippet that imports the node:sqlite
#   adapter (default export) and resolveRepoIdentifier. Inline-node command
#   blocks had ZERO test coverage — that is exactly why rescan bit-rotted
#   silently when better-sqlite3 was swapped for node:sqlite (the import path
#   would throw ERR_MODULE_NOT_FOUND at runtime with no CI signal).
#
#   This test EXECUTES that exact import path against a hermetic fixture DB so a
#   future dependency rename (adapter or resolver module) fails CI instead of
#   breaking the command silently.
#
# TST-01 — Test 1 (happy path): resolve a seeded repo row by name; assert id/
#          path/name match the seed.
# TST-01 — Test 2 (regression guard): the resolve block exits 0 and stderr does
#          NOT contain ERR_MODULE_NOT_FOUND.
# TST-02 — Test 3 (reintroduction guard): the shadow command files are absent
#          and commands/diff.md has no --shadow flag.
#
# Hermetic: everything runs under $BATS_TEST_TMPDIR. No worker, no HTTP, no
# ~/.arcanon data dir.

setup() {
  PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
  DB_PATH="$BATS_TEST_TMPDIR/impact-map.db"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR" && pwd -P)"
  REPO_FIXTURE_PATH="$PROJECT_ROOT/fixture-repo"
}

# Build a fixture DB with a `repos(id, path, name)` table + one seeded row,
# using the node:sqlite adapter default export (the same module rescan Step-1
# opens). Called by tests that need a populated DB.
_seed_fixture_db() {
  node --input-type=module --eval "
import Database from '${PLUGIN_ROOT}/worker/db/sqlite-adapter.js';
const db = new Database('${DB_PATH}');
db.exec('CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT, name TEXT)');
db.prepare('INSERT INTO repos (id, path, name) VALUES (?, ?, ?)')
  .run(1, '${REPO_FIXTURE_PATH}', 'fixture-repo');
db.close();
"
}

# ---------------------------------------------------------------------------
# TST-01 Test 1 — happy path: resolve seeded repo by name, fields match seed.
# ---------------------------------------------------------------------------
@test "rescan Step-1 resolve path resolves seeded repo row by name" {
  _seed_fixture_db

  # Mirror rescan.md Step-1 import specifiers byte-for-byte: default-export
  # Database from worker/db/sqlite-adapter.js + named resolveRepoIdentifier
  # from worker/lib/repo-resolver.js.
  run node --input-type=module --eval "
import Database from '${PLUGIN_ROOT}/worker/db/sqlite-adapter.js';
import { resolveRepoIdentifier } from '${PLUGIN_ROOT}/worker/lib/repo-resolver.js';
const db = new Database('${DB_PATH}', { readonly: true });
try {
  const row = resolveRepoIdentifier('fixture-repo', db, '${PROJECT_ROOT}');
  process.stdout.write(JSON.stringify(row));
} finally {
  db.close();
}
"
  [ "$status" -eq 0 ]

  # Resolved row's id/path/name match the seed.
  echo "$output" | grep -q '"id":1'
  echo "$output" | grep -q "\"path\":\"${REPO_FIXTURE_PATH}\""
  echo "$output" | grep -q '"name":"fixture-repo"'
}

# ---------------------------------------------------------------------------
# TST-01 Test 2 — regression guard: import path intact (no ERR_MODULE_NOT_FOUND).
# A future rename of sqlite-adapter.js or repo-resolver.js — the class of bug
# that broke rescan when better-sqlite3 → node:sqlite — would make this fail.
# ---------------------------------------------------------------------------
@test "rescan Step-1 resolve path imports without ERR_MODULE_NOT_FOUND" {
  _seed_fixture_db

  run node --input-type=module --eval "
import Database from '${PLUGIN_ROOT}/worker/db/sqlite-adapter.js';
import { resolveRepoIdentifier } from '${PLUGIN_ROOT}/worker/lib/repo-resolver.js';
const db = new Database('${DB_PATH}', { readonly: true });
try {
  const row = resolveRepoIdentifier('fixture-repo', db, '${PROJECT_ROOT}');
  process.stdout.write(JSON.stringify(row));
} finally {
  db.close();
}
"
  [ "$status" -eq 0 ]
  # The combined run output (stdout + stderr) must NOT carry a module-resolution
  # failure. This is the assertion that catches a dependency/path rename.
  ! echo "$output" | grep -q 'ERR_MODULE_NOT_FOUND'
}

# ---------------------------------------------------------------------------
# TST-02 Test 3 — reintroduction guard: shadow command files absent, diff.md
# has no --shadow flag.
# ---------------------------------------------------------------------------
@test "shadow command files are absent and diff.md has no --shadow flag" {
  ! [ -f "$PLUGIN_ROOT/commands/shadow-scan.md" ]
  ! [ -f "$PLUGIN_ROOT/commands/promote-shadow.md" ]
  ! grep -q -- '--shadow' "$PLUGIN_ROOT/commands/diff.md"
}
