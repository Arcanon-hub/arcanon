// Test isolation guard — keeps the suite from writing into the real ~/.arcanon.
//
// resolveDataDir() (worker/lib/data-dir.js) returns $ARCANON_DATA_DIR when set,
// else ~/.arcanon. Several worker modules capture that value at import time
// (e.g. `const dataDir = resolveDataDir()` in db/pool.js), so the override MUST
// be in place BEFORE any worker module loads. This file is wired in via
// `node --import ./worker/test-setup.mjs` (through NODE_OPTIONS in the test
// scripts), which runs in every test process — including the per-file child
// processes node's test runner spawns — before the test files' own imports.
//
// Each process gets a fresh throwaway data dir, so tests can never pollute the
// developer's (or CI runner's) real project database. A test that wants its own
// explicit dir can still set ARCANON_DATA_DIR first; we only fill it if unset.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.ARCANON_DATA_DIR) {
  process.env.ARCANON_DATA_DIR = mkdtempSync(join(tmpdir(), "arcanon-test-"));
}
