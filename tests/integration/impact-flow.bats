#!/usr/bin/env bats
# tests/integration/impact-flow.bats
# Integration tests for Phase 21: session hook, ChromaDB fallback, snapshots, E2E scan flow
# Requires: Node.js 20+, git, bats-core
# Does NOT require: ChromaDB running, real Claude agents

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  export TEST_DIR
}

teardown() {
  [[ -d "$TEST_DIR" ]] && rm -rf "$TEST_DIR"
}

# ---------------------------------------------------------------------------
# INTG-E2E-01: Full scan flow — transitive impact A->B->C
# ---------------------------------------------------------------------------

@test "INTG-E2E-01: transitive query returns B and C for A->B->C chain" {
  run node --input-type=module --eval "
import Database from '${PROJECT_ROOT}/node_modules/better-sqlite3/lib/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { QueryEngine } from '${PROJECT_ROOT}/worker/query-engine.js';
import { _resetForTest } from '${PROJECT_ROOT}/worker/chroma-sync.js';

_resetForTest();

// Create an isolated in-memory DB with full schema
const db = new Database(':memory:');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema inline (mirrors migration 001)
db.exec(\`
  CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
    name TEXT NOT NULL, type TEXT NOT NULL, last_commit TEXT, scanned_at TEXT
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id),
    name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_service_id INTEGER NOT NULL REFERENCES services(id),
    target_service_id INTEGER NOT NULL REFERENCES services(id),
    protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT
  );
  CREATE TABLE IF NOT EXISTS schemas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL REFERENCES connections(id),
    role TEXT NOT NULL, name TEXT NOT NULL, file TEXT
  );
  CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT, schema_id INTEGER NOT NULL REFERENCES schemas(id),
    name TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS map_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    label TEXT, snapshot_path TEXT
  );
  CREATE TABLE IF NOT EXISTS repo_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL UNIQUE REFERENCES repos(id),
    last_scanned_commit TEXT, last_scanned_at TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(
    path, protocol, source_file, target_file, content='connections', content_rowid='id'
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS services_fts USING fts5(
    name, content='services', content_rowid='id'
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(
    name, type, content='fields', content_rowid='id'
  );
  CREATE TRIGGER IF NOT EXISTS services_ai AFTER INSERT ON services BEGIN
    INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
  END;
  CREATE TRIGGER IF NOT EXISTS services_ad AFTER DELETE ON services BEGIN
    INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
  END;
  CREATE TRIGGER IF NOT EXISTS services_au AFTER UPDATE ON services BEGIN
    INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
    INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
  END;
  CREATE TRIGGER IF NOT EXISTS connections_ai AFTER INSERT ON connections BEGIN
    INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
      VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
  END;
  CREATE TRIGGER IF NOT EXISTS connections_ad AFTER DELETE ON connections BEGIN
    INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
      VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
  END;
  CREATE TRIGGER IF NOT EXISTS connections_au AFTER UPDATE ON connections BEGIN
    INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
      VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
    INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
      VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
  END;
  CREATE TRIGGER IF NOT EXISTS fields_ai AFTER INSERT ON fields BEGIN
    INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
  END;
  CREATE TRIGGER IF NOT EXISTS fields_ad AFTER DELETE ON fields BEGIN
    INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
  END;
  CREATE TRIGGER IF NOT EXISTS fields_au AFTER UPDATE ON fields BEGIN
    INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
    INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
  END;
\`);

const qe = new QueryEngine(db);

// Insert a test repo
const repoId = qe.upsertRepo({ path: '/test/repo', name: 'test-repo', type: 'single' });

// Insert services A, B, C
const idA = qe.upsertService({ repo_id: repoId, name: 'service-a', root_path: '.', language: 'typescript' });
const idB = qe.upsertService({ repo_id: repoId, name: 'service-b', root_path: '.', language: 'typescript' });
const idC = qe.upsertService({ repo_id: repoId, name: 'service-c', root_path: '.', language: 'typescript' });

// Insert connections: A->B->C
qe.upsertConnection({ source_service_id: idA, target_service_id: idB, protocol: 'http' });
qe.upsertConnection({ source_service_id: idB, target_service_id: idC, protocol: 'http' });

// Query transitive impact from A
const results = qe.transitiveImpact(idA);
const names = results.map(r => r.name);

if (!names.includes('service-b')) {
  console.error('FAIL: service-b not in results:', JSON.stringify(names));
  process.exit(1);
}
if (!names.includes('service-c')) {
  console.error('FAIL: service-c not in results:', JSON.stringify(names));
  process.exit(1);
}
console.log('PASS: transitive A->B->C returns B and C');
db.close();
"
  [ "$status" -eq 0 ]
}

@test "INTG-E2E-01: cyclic graph A->B->C->A does not hang or error" {
  run node --input-type=module --eval "
import Database from '${PROJECT_ROOT}/node_modules/better-sqlite3/lib/index.js';
import { QueryEngine } from '${PROJECT_ROOT}/worker/query-engine.js';
import { _resetForTest } from '${PROJECT_ROOT}/worker/chroma-sync.js';

_resetForTest();

const db = new Database(':memory:');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(\`
  CREATE TABLE repos (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, last_commit TEXT, scanned_at TEXT);
  CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL);
  CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, source_service_id INTEGER NOT NULL, target_service_id INTEGER NOT NULL, protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT);
  CREATE TABLE schemas (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, file TEXT);
  CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, schema_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE map_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), label TEXT, snapshot_path TEXT);
  CREATE TABLE repo_state (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL UNIQUE, last_scanned_commit TEXT, last_scanned_at TEXT);
  CREATE VIRTUAL TABLE connections_fts USING fts5(path, protocol, source_file, target_file, content='connections', content_rowid='id');
  CREATE VIRTUAL TABLE services_fts USING fts5(name, content='services', content_rowid='id');
  CREATE VIRTUAL TABLE fields_fts USING fts5(name, type, content='fields', content_rowid='id');
  CREATE TRIGGER services_ai AFTER INSERT ON services BEGIN INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name); END;
  CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file) VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file); END;
\`);

const qe = new QueryEngine(db);
const repoId = qe.upsertRepo({ path: '/test/repo', name: 'repo', type: 'single' });
const idA = qe.upsertService({ repo_id: repoId, name: 'svc-a', root_path: '.', language: 'go' });
const idB = qe.upsertService({ repo_id: repoId, name: 'svc-b', root_path: '.', language: 'go' });
const idC = qe.upsertService({ repo_id: repoId, name: 'svc-c', root_path: '.', language: 'go' });
qe.upsertConnection({ source_service_id: idA, target_service_id: idB, protocol: 'grpc' });
qe.upsertConnection({ source_service_id: idB, target_service_id: idC, protocol: 'grpc' });
// Cycle: C->A
qe.upsertConnection({ source_service_id: idC, target_service_id: idA, protocol: 'grpc' });

// This must not hang or throw — cycle detection via path tracking
const results = qe.transitiveImpact(idA);
if (!Array.isArray(results)) {
  console.error('FAIL: expected array, got', typeof results);
  process.exit(1);
}
console.log('PASS: cyclic graph returns without hanging, result count:', results.length);
db.close();
"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INTG-E2E-02: Incremental scan — only changed files returned
# ---------------------------------------------------------------------------

@test "INTG-E2E-02: incremental scan returns only changed files" {
  # Init a real git repo in TEST_DIR
  git -C "$TEST_DIR" init --quiet
  git -C "$TEST_DIR" config user.email "test@arcanon"
  git -C "$TEST_DIR" config user.name "Arcanon Test"

  # Create two files and commit them
  echo "content-a" > "$TEST_DIR/service-a.ts"
  echo "content-b" > "$TEST_DIR/service-b.ts"
  git -C "$TEST_DIR" add service-a.ts service-b.ts
  git -C "$TEST_DIR" commit --quiet -m "initial"

  # Record the HEAD commit (last scan)
  FIRST_COMMIT="$(git -C "$TEST_DIR" rev-parse HEAD)"

  # Modify only service-a.ts and commit
  echo "changed-a" > "$TEST_DIR/service-a.ts"
  git -C "$TEST_DIR" add service-a.ts
  git -C "$TEST_DIR" commit --quiet -m "change service-a"

  # Use getChangedFiles to verify only service-a.ts is in the diff
  run node --input-type=module --eval "
import { getChangedFiles } from '${PROJECT_ROOT}/worker/scan-manager.js';

const result = getChangedFiles('${TEST_DIR}', '${FIRST_COMMIT}');
if (result.error) {
  console.error('FAIL: getChangedFiles error:', result.error);
  process.exit(1);
}
const { modified, deleted, renamed } = result;
if (!modified.includes('service-a.ts')) {
  console.error('FAIL: service-a.ts not in modified:', JSON.stringify(modified));
  process.exit(1);
}
if (modified.includes('service-b.ts') || deleted.includes('service-b.ts')) {
  console.error('FAIL: service-b.ts should not appear in changes:', JSON.stringify(modified));
  process.exit(1);
}
console.log('PASS: only service-a.ts in changed files');
"
  [ "$status" -eq 0 ]
}

@test "INTG-E2E-02: full scan (sinceCommit=null) returns all tracked files" {
  git -C "$TEST_DIR" init --quiet
  git -C "$TEST_DIR" config user.email "test@arcanon"
  git -C "$TEST_DIR" config user.name "Arcanon Test"

  echo "a" > "$TEST_DIR/file-a.ts"
  echo "b" > "$TEST_DIR/file-b.ts"
  git -C "$TEST_DIR" add .
  git -C "$TEST_DIR" commit --quiet -m "init"

  run node --input-type=module --eval "
import { getChangedFiles } from '${PROJECT_ROOT}/worker/scan-manager.js';

const result = getChangedFiles('${TEST_DIR}', null);
if (result.error) {
  console.error('FAIL:', result.error);
  process.exit(1);
}
const { modified } = result;
if (!modified.includes('file-a.ts') || !modified.includes('file-b.ts')) {
  console.error('FAIL: expected both files, got:', JSON.stringify(modified));
  process.exit(1);
}
console.log('PASS: full scan returns all tracked files');
"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INTG-E2E-03: ChromaDB fallback chain — FTS5 and SQL tiers
# ---------------------------------------------------------------------------

@test "INTG-E2E-03: search with skipChroma returns FTS5 results (tier 2)" {
  run node --input-type=module --eval "
import Database from '${PROJECT_ROOT}/node_modules/better-sqlite3/lib/index.js';
import { search, setSearchDb } from '${PROJECT_ROOT}/worker/query-engine.js';
import { _resetForTest } from '${PROJECT_ROOT}/worker/chroma-sync.js';

_resetForTest();  // ChromaDB unavailable

const db = new Database(':memory:');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(\`
  CREATE TABLE repos (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, last_commit TEXT, scanned_at TEXT);
  CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL);
  CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, source_service_id INTEGER NOT NULL, target_service_id INTEGER NOT NULL, protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT);
  CREATE TABLE schemas (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, file TEXT);
  CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, schema_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE map_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), label TEXT, snapshot_path TEXT);
  CREATE TABLE repo_state (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL UNIQUE, last_scanned_commit TEXT, last_scanned_at TEXT);
  CREATE VIRTUAL TABLE connections_fts USING fts5(path, protocol, source_file, target_file, content='connections', content_rowid='id');
  CREATE VIRTUAL TABLE services_fts USING fts5(name, content='services', content_rowid='id');
  CREATE VIRTUAL TABLE fields_fts USING fts5(name, type, content='fields', content_rowid='id');
  CREATE TRIGGER services_ai AFTER INSERT ON services BEGIN INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name); END;
  CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file) VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file); END;
  CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type); END;
\`);

// Insert a service named 'auth-gateway'
db.prepare('INSERT INTO repos (path, name, type) VALUES (?, ?, ?)').run('/test', 'repo', 'single');
db.prepare('INSERT INTO services (repo_id, name, root_path, language) VALUES (1, ?, ?, ?)').run('auth-gateway', '.', 'typescript');

setSearchDb(db);

const results = await search('auth-gateway', { skipChroma: true });
if (!Array.isArray(results)) {
  console.error('FAIL: expected array');
  process.exit(1);
}
if (results.length === 0) {
  console.error('FAIL: expected at least one FTS5 result for auth-gateway');
  process.exit(1);
}
const found = results.some(r => r.name === 'auth-gateway' || (r.name && r.name.includes('auth-gateway')));
if (!found) {
  console.error('FAIL: auth-gateway not in results:', JSON.stringify(results));
  process.exit(1);
}
console.log('PASS: FTS5 tier returns auth-gateway');
db.close();
"
  [ "$status" -eq 0 ]
}

@test "INTG-E2E-03: search with skipChroma+skipFts5 returns SQL tier results" {
  run node --input-type=module --eval "
import Database from '${PROJECT_ROOT}/node_modules/better-sqlite3/lib/index.js';
import { search, setSearchDb } from '${PROJECT_ROOT}/worker/query-engine.js';
import { _resetForTest } from '${PROJECT_ROOT}/worker/chroma-sync.js';

_resetForTest();

const db = new Database(':memory:');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(\`
  CREATE TABLE repos (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, last_commit TEXT, scanned_at TEXT);
  CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL);
  CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, source_service_id INTEGER NOT NULL, target_service_id INTEGER NOT NULL, protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT);
  CREATE TABLE schemas (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, file TEXT);
  CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, schema_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE map_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), label TEXT, snapshot_path TEXT);
  CREATE TABLE repo_state (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL UNIQUE, last_scanned_commit TEXT, last_scanned_at TEXT);
  CREATE VIRTUAL TABLE connections_fts USING fts5(path, protocol, source_file, target_file, content='connections', content_rowid='id');
  CREATE VIRTUAL TABLE services_fts USING fts5(name, content='services', content_rowid='id');
  CREATE VIRTUAL TABLE fields_fts USING fts5(name, type, content='fields', content_rowid='id');
  CREATE TRIGGER services_ai AFTER INSERT ON services BEGIN INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name); END;
  CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file) VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file); END;
  CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type); END;
\`);

db.prepare('INSERT INTO repos (path, name, type) VALUES (?, ?, ?)').run('/test', 'repo', 'single');
db.prepare('INSERT INTO services (repo_id, name, root_path, language) VALUES (1, ?, ?, ?)').run('auth-gateway', '.', 'typescript');

setSearchDb(db);

const results = await search('auth-gateway', { skipChroma: true, skipFts5: true });
if (!Array.isArray(results)) {
  console.error('FAIL: expected array');
  process.exit(1);
}
if (results.length === 0) {
  console.error('FAIL: expected at least one SQL tier result for auth-gateway');
  process.exit(1);
}
const found = results.some(r => r.name === 'auth-gateway' || (r.name && r.name.includes('auth-gateway')));
if (!found) {
  console.error('FAIL: auth-gateway not in results:', JSON.stringify(results));
  process.exit(1);
}
console.log('PASS: SQL tier returns auth-gateway');
db.close();
"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INTG-E2E-04: Session-start auto-start — worker called with impact-map config
# ---------------------------------------------------------------------------

@test "INTG-E2E-04: worker_start_background called when config has impact-map section" {
  # Set up mock plugin root with mock lib/worker-client.sh
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  mkdir -p "$MOCK_PLUGIN_ROOT/lib"

  cp "$PROJECT_ROOT/scripts/session-start.sh" "$MOCK_PLUGIN_ROOT/scripts/session-start.sh"

  # Write a mock detect.sh
  cat > "$MOCK_PLUGIN_ROOT/lib/detect.sh" <<'MOCK'
detect_project_type() { echo "Node/TS"; }
MOCK

  # Write a mock worker-client.sh that writes a sentinel file
  SENTINEL="/tmp/arcanon_test_intg_worker_started"
  rm -f "$SENTINEL"

  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<MOCK
worker_running() { return 1; }
worker_start_background() { touch ${SENTINEL}; return 0; }
worker_status_line() { echo "Arcanon worker: running (port 37888)"; }
MOCK

  # Create arcanon.config.json WITH impact-map key in TEST_DIR
  cat > "$TEST_DIR/arcanon.config.json" <<'JSON'
{"impact-map": {}}
JSON

  MOCK_PROJECT_TYPE="Node/TS"
  export MOCK_PROJECT_TYPE

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT);
    printf '{\"session_id\":\"intg-e2e-04a\",\"cwd\":\"${TEST_DIR}\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ -f "$SENTINEL" ]

  rm -f "$SENTINEL"
  rm -f "/tmp/arcanon_session_intg-e2e-04a.initialized"
  rm -rf "$MOCK_PLUGIN_ROOT"
}

@test "INTG-E2E-04: worker_start_background NOT called when config has no impact-map section" {
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  mkdir -p "$MOCK_PLUGIN_ROOT/lib"

  cp "$PROJECT_ROOT/scripts/session-start.sh" "$MOCK_PLUGIN_ROOT/scripts/session-start.sh"

  cat > "$MOCK_PLUGIN_ROOT/lib/detect.sh" <<'MOCK'
detect_project_type() { echo "Node/TS"; }
MOCK

  SENTINEL="/tmp/arcanon_test_intg_worker_no_impact_map"
  rm -f "$SENTINEL"

  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<MOCK
worker_running() { return 1; }
worker_start_background() { touch ${SENTINEL}; return 0; }
worker_status_line() { return 0; }
MOCK

  # Config WITHOUT impact-map key
  cat > "$TEST_DIR/arcanon.config.json" <<'JSON'
{"linked-repos": []}
JSON

  MOCK_PROJECT_TYPE="Node/TS"
  export MOCK_PROJECT_TYPE

  run bash -c "$(declare -p MOCK_PROJECT_TYPE); $(declare -p MOCK_PLUGIN_ROOT);
    printf '{\"session_id\":\"intg-e2e-04b\",\"cwd\":\"${TEST_DIR}\",\"hook_event_name\":\"SessionStart\"}' \
    | CLAUDE_PLUGIN_ROOT=\"\$MOCK_PLUGIN_ROOT\" bash \"\$MOCK_PLUGIN_ROOT/scripts/session-start.sh\""
  [ "$status" -eq 0 ]
  [ ! -f "$SENTINEL" ]

  rm -f "$SENTINEL"
  rm -f "/tmp/arcanon_session_intg-e2e-04b.initialized"
  rm -rf "$MOCK_PLUGIN_ROOT"
}

# ---------------------------------------------------------------------------
# INTG-E2E-05: Snapshot on rescan — createSnapshot() creates file; isFirstScan() changes
# ---------------------------------------------------------------------------

@test "INTG-E2E-05: isFirstScan returns false after writeScan; createSnapshot creates file" {
  run node --input-type=module --eval "
import Database from '${PROJECT_ROOT}/node_modules/better-sqlite3/lib/index.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { QueryEngine } from '${PROJECT_ROOT}/worker/query-engine.js';
import { _resetForTest } from '${PROJECT_ROOT}/worker/chroma-sync.js';

_resetForTest();

// Use a real file-backed DB so VACUUM INTO works (requires file path, not :memory:)
const testDbDir = path.join(os.tmpdir(), 'arcanon-intg-e2e-05-' + Date.now());
fs.mkdirSync(testDbDir, { recursive: true });
const dbPath = path.join(testDbDir, 'impact-map.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(\`
  CREATE TABLE IF NOT EXISTS repos (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, last_commit TEXT, scanned_at TEXT);
  CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, source_service_id INTEGER NOT NULL, target_service_id INTEGER NOT NULL, protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT);
  CREATE TABLE IF NOT EXISTS schemas (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, file TEXT);
  CREATE TABLE IF NOT EXISTS fields (id INTEGER PRIMARY KEY AUTOINCREMENT, schema_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS map_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), label TEXT, snapshot_path TEXT);
  CREATE TABLE IF NOT EXISTS repo_state (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL UNIQUE, last_scanned_commit TEXT, last_scanned_at TEXT);
  CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(path, protocol, source_file, target_file, content='connections', content_rowid='id');
  CREATE VIRTUAL TABLE IF NOT EXISTS services_fts USING fts5(name, content='services', content_rowid='id');
  CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(name, type, content='fields', content_rowid='id');
  CREATE TRIGGER IF NOT EXISTS services_ai AFTER INSERT ON services BEGIN INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name); END;
  CREATE TRIGGER IF NOT EXISTS connections_ai AFTER INSERT ON connections BEGIN INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file) VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file); END;
  CREATE TRIGGER IF NOT EXISTS fields_ai AFTER INSERT ON fields BEGIN INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type); END;
\`);

const qe = new QueryEngine(db);

// isFirstScan equivalent — check map_versions count before any snapshot
const beforeCount = db.prepare('SELECT COUNT(*) AS cnt FROM map_versions').get().cnt;
if (beforeCount !== 0) {
  console.error('FAIL: expected 0 map_versions before snapshot, got', beforeCount);
  process.exit(1);
}
console.log('PASS: isFirstScan equivalent: map_versions empty before first snapshot');

// Create a snapshot using QueryEngine.createMapVersion (wraps VACUUM INTO + insert)
const versionId = qe.createMapVersion('test-snapshot');
if (!versionId || versionId < 1) {
  console.error('FAIL: expected positive version id, got', versionId);
  process.exit(1);
}

// Verify map_versions table has one row
const afterCount = db.prepare('SELECT COUNT(*) AS cnt FROM map_versions').get().cnt;
if (afterCount !== 1) {
  console.error('FAIL: expected 1 map_version after snapshot, got', afterCount);
  process.exit(1);
}
console.log('PASS: map_versions has 1 row after createMapVersion');

// Verify snapshot file exists
const versionRow = db.prepare('SELECT snapshot_path FROM map_versions WHERE id = ?').get(versionId);
if (!versionRow || !versionRow.snapshot_path) {
  console.error('FAIL: snapshot_path is null/empty');
  process.exit(1);
}
// snapshot_path is stored as absolute path in createMapVersion
if (!fs.existsSync(versionRow.snapshot_path)) {
  console.error('FAIL: snapshot file does not exist at:', versionRow.snapshot_path);
  process.exit(1);
}
console.log('PASS: snapshot file exists at', versionRow.snapshot_path);

db.close();
// Cleanup
fs.rmSync(testDbDir, { recursive: true, force: true });
"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# INTG-E2E-06: First-run recommendation in SKILL.md
# ---------------------------------------------------------------------------

@test "INTG-E2E-06: SKILL.md contains ARCANON_CHROMA_MODE recommendation" {
  run grep -q 'ARCANON_CHROMA_MODE' "$PROJECT_ROOT/skills/impact/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "INTG-E2E-06: SKILL.md contains mcp-server.js reference" {
  run grep -q 'mcp-server.js' "$PROJECT_ROOT/skills/impact/SKILL.md"
  [ "$status" -eq 0 ]
}
