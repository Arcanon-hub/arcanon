# Phase 48: MCP Drift Tools - Research

**Researched:** 2026-03-20
**Domain:** Node.js MCP server extension, SQLite query patterns, cross-repo drift analysis
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Add `drift_versions` MCP tool — query dependency version mismatches across scanned repos | Existing repos table has repo paths; drift logic must scan manifest files (package.json, go.mod etc.) from those paths at query time or from a new `drift_results` table |
| MCP-02 | Add `drift_types` MCP tool — query shared type/struct/interface mismatches across repos | Existing services table has language; fields/schemas tables have type data. Type-name extraction requires file scanning (not in DB) or a new `drift_results` table |
| MCP-03 | Add `drift_openapi` MCP tool — query OpenAPI spec breaking changes across repos | OpenAPI specs are files on disk; oasdiff comparison must happen at query time or be cached in a `drift_results` table |
</phase_requirements>

---

## Summary

Phase 48 adds three MCP query tools to `worker/mcp/server.js`: `drift_versions`, `drift_types`, and `drift_openapi`. The MCP server is Node.js (ES modules, `@modelcontextprotocol/sdk` ^1.27.1) and all existing tools follow a strict pattern: export a pure `queryXxx(db, params)` function, register it via `server.tool(name, description, zodSchema, handler)`, and test the query function in isolation using an in-memory SQLite database.

The key architectural decision is **how to produce drift data**. The existing drift scripts are bash and run at `/ligamen:drift` command time. The MCP server is long-running and stdio-based. The three viable approaches differ significantly in their tradeoffs — this research determines which approach fits the existing architecture.

The existing SQLite database contains `repos` (with absolute `path` fields), `services` (with `language`), `schemas`, `fields`, and `connections`. This schema is service/connection-oriented, not manifest/type-oriented — it does not store raw dependency versions, raw type definitions, or OpenAPI spec content. Drift data must either be generated at query time (by shelling out or re-implementing logic in JS) or cached in new tables after a scan.

**Primary recommendation:** Port the drift logic to JS and query manifest files directly at tool-call time. This avoids shell-out complexity, keeps MCP server self-contained, and mirrors the pattern used for `queryChanged` (which already calls `execSync` for git commands). Use a `drift_results` table only as a cache when oasdiff comparison cost is high.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP server and tool registration | Already in use; all existing tools use `server.tool()` and `McpServer` |
| `better-sqlite3` | ^12.8.0 | SQLite DB access (sync) | Already in use; all query functions use it directly |
| `zod` | ^3.25.0 | Tool parameter schema validation | Already in use for all existing tool registrations |
| `node:child_process` | (built-in) | `execSync` for oasdiff when available | Already used in `queryChanged` for git calls |
| `node:fs` | (built-in) | Read manifest files (package.json, go.mod, etc.) | Pure Node.js, no dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:path` | (built-in) | Resolve repo paths | Already used throughout server.js |
| `node:os` | (built-in) | Resolve dataDir (`~/.ligamen`) | Already used in server.js |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JS manifest parsing | Shell out to drift-versions.sh | Shell-out adds process overhead and bash dependency; JS version is fully testable with in-memory fixtures |
| JS manifest parsing | New DB table populated at scan time | Scan-time population is more reliable but requires changes to the scan pipeline (out of scope for Phase 48) |
| oasdiff JS API | `execSync('oasdiff ...')` | No official JS SDK for oasdiff; must shell out when available, with graceful fallback when absent |

**Installation:** No new packages needed. All required libraries are already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

The three new tools belong entirely in `worker/mcp/server.js` as:
1. Exported pure query functions (for testability)
2. `server.tool()` registrations at the bottom of the file

Test files follow the existing naming pattern: `worker/mcp/server-drift.test.js`

```
worker/mcp/
├── server.js              # Add queryDriftVersions, queryDriftTypes, queryDriftOpenapi + 3 server.tool() registrations
└── server-drift.test.js   # New test file (mirrors server.test.js pattern)
```

### Pattern 1: Exported Pure Query Function

Every MCP tool in this codebase separates logic from registration.

**What:** Export `queryXxx(db, params)` function; register a thin handler that calls it.
**When to use:** Always — existing convention in server.js for all 5 existing tools.

```javascript
// Source: worker/mcp/server.js (existing pattern)
export async function queryDriftVersions(db, { repos, severity } = {}) {
  if (!db) return { findings: [], repos_scanned: 0 };
  // ... implementation
}

server.tool(
  "drift_versions",
  "Query dependency version mismatches across scanned repos.",
  {
    repos: z.array(z.string()).optional().describe("Repo paths to compare (defaults to all scanned repos)"),
    severity: z.enum(["CRITICAL", "WARN", "INFO", "all"]).default("WARN").describe("Minimum severity to return"),
    project: z.string().optional().describe("Project identifier (path, hash, or repo name). Defaults to cwd."),
  },
  async (params) => {
    const qe = resolveDb(params.project);
    const result = await queryDriftVersions(qe?._db ?? null, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);
```

### Pattern 2: Linked-Repo Discovery in JavaScript

The shell scripts discover linked repos via `list_linked_repos` which reads `ligamen.config.json` `linked-repos` array or scans sibling directories. In Node.js, this translates to:

```javascript
// Source: lib/linked-repos.sh behavior — ported to JS
function discoverLinkedRepos(projectRoot) {
  const configPath = path.join(projectRoot, 'ligamen.config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg['linked-repos']?.length) return cfg['linked-repos'];
  } catch { /* no config */ }

  // Fallback: scan sibling directories for .git
  const parentDir = path.dirname(projectRoot);
  return fs.readdirSync(parentDir)
    .map(d => path.join(parentDir, d))
    .filter(d => fs.existsSync(path.join(d, '.git')) && d !== projectRoot);
}
```

The `repos` table in SQLite already stores all scanned repo paths. When `db` is available, prefer querying `SELECT path FROM repos` — this gives the exact repos that were scanned, not just sibling directories.

### Pattern 3: Reading the repos table for drift scope

When a DB exists, derive linked repos from the `repos` table rather than filesystem discovery:

```javascript
// Source: worker/db/migrations/001_initial_schema.js (repos table)
function getRepoPaths(db) {
  // repos table: id, path, name, type, last_commit, scanned_at
  return db.prepare("SELECT path, name FROM repos").all();
}
```

This ensures drift runs against the same repos that were scanned — consistent with what Ligamen knows about.

### Pattern 4: oasdiff Shell-Out with Graceful Degradation

For `drift_openapi`, follow the same approach as the bash script: attempt `oasdiff` first, degrade gracefully.

```javascript
// Source: scripts/drift-openapi.sh (ported pattern)
function compareOpenApiSpecs(specA, specB) {
  try {
    execSync('which oasdiff', { stdio: 'ignore' });
    const breaking = execSync(`oasdiff breaking "${specA}" "${specB}"`, { encoding: 'utf8' }).trim();
    return { tool: 'oasdiff', breaking: breaking || null };
  } catch {
    // oasdiff not available — return informational message
    return { tool: 'none', message: 'Install oasdiff for full OpenAPI comparison' };
  }
}
```

### Pattern 5: Version Normalization

The bash `normalize_version` strips range specifiers (`^`, `~`, `>=`, etc.) before comparing. Port this exactly:

```javascript
// Source: scripts/drift-versions.sh normalize_version()
function normalizeVersion(v) {
  return v.replace(/^[^0-9a-zA-Z]*/, '').replace(/^[^0-9]*/, '');
}
function hasRangeSpecifier(v) {
  return /^[\^~>=<]/.test(v);
}
```

### Pattern 6: Return Shape

All existing MCP query functions return plain objects that serialize to JSON via `JSON.stringify`. Use the same structure as the bash `emit_finding`:

```javascript
// Consistent with bash emit_finding levels: CRITICAL | WARN | INFO
{
  findings: [
    {
      level: "CRITICAL",        // matches bash emit_finding LEVEL
      item: "react",            // package/type/spec name
      repos: ["repo-a", "repo-b"],
      detail: "Version mismatch: repo-a=18.0.0 repo-b=17.0.0"
    }
  ],
  repos_scanned: 3,
  tool_available: true          // for openapi: whether oasdiff was found
}
```

### Anti-Patterns to Avoid

- **Don't store drift results in new DB tables for Phase 48.** The scan pipeline would need to populate them — that's a different subsystem. Query at tool-call time instead.
- **Don't shell out to the bash scripts directly.** The bash scripts read `LINKED_REPOS` from environment/discovery that conflicts with how the MCP server identifies repos. Porting the logic gives clean control.
- **Don't call `execSync` without timeout.** Large repos or missing `oasdiff` can hang. Use `{ timeout: 5000, encoding: 'utf8' }` options.
- **Don't mix `async` with better-sqlite3 calls.** better-sqlite3 is synchronous. Existing query functions are `async` for signature consistency only — keep that pattern but don't `await` DB calls.

---

## What the Existing Schema Already Has

The SQLite database (schema version 8, tables from migration 001 + 008) contains:

| Table | Relevant Columns | Drift Use |
|-------|-----------------|-----------|
| `repos` | `id, path, name, type` | Gives absolute paths to all scanned repos — **the source of truth for which repos to scan for drift** |
| `services` | `id, repo_id, name, language, type` | Language detection (ts/go/py/rs) per repo already done — no need to re-detect |
| `schemas` | `id, connection_id, role, name, file` | Schema names for cross-repo type comparison (partial data) |
| `fields` | `id, schema_id, name, type, required` | Field names and types — useful for `drift_types` if populated |
| `connections` | `source_file, target_file` | Source file paths — for locating type definitions |

**Critical gap:** The `fields` table stores fields as linked to schemas on connections, not as standalone type definitions. It does NOT store exported interface/struct definitions from source files. `drift_types` must still parse source files to extract type bodies — the DB `fields` table covers API schemas, not language-level types.

**What's NOT in the DB that the bash scripts compute at runtime:**
- Raw dependency versions from package.json/go.mod/Cargo.toml/pyproject.toml
- Language-level type definitions (interfaces, structs) and their field bodies
- OpenAPI spec file locations and their parsed content

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAPI spec structural comparison | Custom YAML differ | `oasdiff` (shell-out) + graceful degradation | $ref resolution requires a full OpenAPI parser; raw YAML diff is unreliable (documented in drift-openapi.sh) |
| Version range normalization | Custom regex | Port `normalize_version` from drift-versions.sh verbatim | Already battle-tested against package.json, go.mod, Cargo.toml, pyproject.toml |
| Linked repo discovery | New discovery logic | Read `repos` table first; fall back to ligamen.config.json `linked-repos`; fall back to sibling git dirs | The repos table is the ground truth for what Ligamen has scanned |
| Tool parameter validation | Manual checks | zod schema on each `server.tool()` call | Exact pattern used by all 5 existing tools |

**Key insight:** The bash scripts are already correct and battle-tested. Port their logic to JS rather than reinventing it. The logic is simple enough (file reads + string comparisons) that the port is straightforward. The only non-trivial part is OpenAPI comparison, which still delegates to oasdiff.

---

## Common Pitfalls

### Pitfall 1: repos table vs filesystem discovery
**What goes wrong:** Using only filesystem sibling-directory discovery ignores the explicit repos configured in ligamen.config.json and also misses repos that were scanned from non-sibling paths.
**Why it happens:** The bash scripts use `list_linked_repos` for discovery. In JS there's no equivalent linked repos library.
**How to avoid:** Always query `SELECT path, name FROM repos` from the DB first. Fall back to filesystem discovery only when `db` is null.
**Warning signs:** Tool returns no findings even though `/ligamen:drift` finds mismatches.

### Pitfall 2: Missing repos table paths vs filesystem reality
**What goes wrong:** A repo is in the `repos` table but its files no longer exist at `repos.path` (repo moved or deleted).
**Why it happens:** The DB is a stale index.
**How to avoid:** Use `fs.existsSync(repoPath)` before trying to read manifest files. Return an informational result noting stale paths.

### Pitfall 3: execSync without timeout/encoding
**What goes wrong:** `oasdiff` call hangs if spec is very large or binary; no timeout = MCP tool hangs indefinitely.
**Why it happens:** `execSync` default has no timeout.
**How to avoid:** Always pass `{ timeout: 5000, encoding: 'utf8' }` to `execSync`.

### Pitfall 4: TOML parsing without yq
**What goes wrong:** Cargo.toml and pyproject.toml parsing in bash uses `yq` with an awk fallback. In JS, there's no built-in TOML parser.
**Why it happens:** Node.js has no native TOML support.
**How to avoid:** Port the awk-based fallback logic to JS regex/line-by-line parsing. The bash scripts already have a fallback that doesn't need yq — port that exact pattern. Alternatively, consider only supporting package.json and go.mod in phase 48 (the two most common formats) and document TOML as "limited support."
**Warning signs:** Rust/Python repos show no version drift even when mismatches exist.

### Pitfall 5: Type extraction slowness
**What goes wrong:** The bash `drift-types.sh` caps at top 50 type names per repo. Without this cap, large repos cause the MCP tool to time out.
**Why it happens:** Recursive file scanning + regex per file is expensive.
**How to avoid:** Implement the same 50-type cap in the JS port. Scan only `src/` directory (not full repo) for TypeScript/Rust; full repo scan is optional.

### Pitfall 6: drift_types comparing all language groups
**What goes wrong:** Running drift_types across repos of different languages (ts vs go) produces no results and is wasted work.
**Why it happens:** Types are only comparable within the same language.
**How to avoid:** Group repos by language (using `services.language` from DB, or detecting from manifest files), then only compare repos in the same language group. Exact pattern from drift-types.sh lines 128-135.

### Pitfall 7: async function wrapping sync better-sqlite3
**What goes wrong:** Wrapping synchronous DB calls in `await` makes the code look async but doesn't help; worse, it can cause issues if callers expect Promise resolution behavior.
**Why it happens:** Existing query functions are `async` for signature consistency but DB calls inside are synchronous.
**How to avoid:** Keep the existing pattern: `export async function queryXxx(db, params)` — return a resolved value directly. Don't use `await` on DB calls inside.

---

## Code Examples

### Reading repos from DB (source for drift scope)
```javascript
// Source: worker/db/migrations/001_initial_schema.js + pool.js pattern
function getLinkedReposFromDb(db) {
  if (!db) return [];
  try {
    return db.prepare("SELECT path, name FROM repos").all();
  } catch { return []; }
}
```

### Extracting versions from package.json (JS port of drift-versions.sh)
```javascript
// Source: scripts/drift-versions.sh extract_versions() — JS port
function extractVersionsFromPackageJson(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch { return {}; }
}
```

### Extracting versions from go.mod (JS port)
```javascript
// Source: scripts/drift-versions.sh extract_versions() go.mod section — JS port
function extractVersionsFromGoMod(repoPath) {
  const modPath = path.join(repoPath, 'go.mod');
  if (!fs.existsSync(modPath)) return {};
  const versions = {};
  const lines = fs.readFileSync(modPath, 'utf8').split('\n');
  let inBlock = false;
  for (const line of lines) {
    if (/^require \(/.test(line)) { inBlock = true; continue; }
    if (/^\)/.test(line)) { inBlock = false; continue; }
    if (inBlock && /^\t/.test(line)) {
      const [pkg, ver] = line.trim().split(/\s+/);
      if (pkg && ver) versions[pkg] = ver;
    }
    const m = line.match(/^require (\S+) (\S+)/);
    if (m) versions[m[1]] = m[2];
  }
  return versions;
}
```

### Tool registration pattern (matches all existing tools)
```javascript
// Source: worker/mcp/server.js existing tool registrations
server.tool(
  "drift_versions",
  "Query dependency version mismatches across scanned repos. Returns CRITICAL when exact versions differ, WARN when range specifiers differ.",
  {
    severity: z.enum(["CRITICAL", "WARN", "INFO", "all"]).default("WARN")
      .describe("Minimum finding severity to include in results"),
    project: z.string().optional()
      .describe("Absolute path to project root, 12-char project hash, or repo name. Defaults to LIGAMEN_PROJECT_ROOT or cwd."),
  },
  async (params) => {
    const qe = resolveDb(params.project);
    if (!qe && params.project) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "no_scan_data", project: params.project, hint: "Run /ligamen:map first in that project" }) }] };
    }
    const result = await queryDriftVersions(qe?._db ?? null, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);
```

### Test setup pattern (matches existing server.test.js / server-search.test.js)
```javascript
// Source: worker/mcp/server.test.js createTestDb() pattern
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { queryDriftVersions, queryDriftTypes, queryDriftOpenapi } from "./server.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT, last_commit TEXT, scanned_at TEXT);
    CREATE TABLE services (id INTEGER PRIMARY KEY, repo_id INTEGER REFERENCES repos(id), name TEXT NOT NULL, root_path TEXT, language TEXT);
  `);
  return db;
}

test("queryDriftVersions returns empty when db is null", async () => {
  const result = await queryDriftVersions(null, {});
  assert.deepEqual(result.findings, []);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shell-only drift via `/ligamen:drift` | Add MCP tools alongside shell command | Phase 48 | Agents can query drift autonomously without running shell commands |
| Bash for all drift logic | JS port inside MCP server | Phase 48 | Enables proper unit testing and removes bash dependency for MCP tools |

**Deprecated/outdated:**
- Shell-out to drift scripts from MCP: Not used anywhere in current codebase. The pattern for shell interaction is `queryScan()` which talks to the worker HTTP API, not directly to scripts.

---

## Open Questions

1. **TOML support scope**
   - What we know: Cargo.toml and pyproject.toml parsing in bash uses awk fallback (no yq required). Porting to JS is possible but verbose.
   - What's unclear: How many users have Rust/Python repos in their linked set?
   - Recommendation: Implement package.json and go.mod parsing fully (most common). Add basic Cargo.toml support using line-by-line regex. Mark pyproject.toml as "best-effort."

2. **When DB is null — filesystem-only fallback**
   - What we know: The bash scripts always run from the filesystem, ignoring the DB. The MCP server can fall back to filesystem discovery when db is null.
   - What's unclear: Is filesystem-only drift useful when there's no scan data?
   - Recommendation: Support `db = null` path with filesystem discovery using `LIGAMEN_PROJECT_ROOT` or cwd as the anchor. Return findings with a `"warning": "no_scan_data — using filesystem discovery"` field.

3. **OpenAPI spec caching**
   - What we know: `oasdiff` is fast for small specs but can be slow for very large APIs.
   - What's unclear: Whether a 5-second timeout is sufficient for real-world specs.
   - Recommendation: Use 5s timeout (same as worker readiness check in `queryScan`). If timeout occurs, return a `"timeout"` finding at INFO level.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node >=20) |
| Config file | none — tests run via `node --test <file>` |
| Quick run command | `node --test worker/mcp/server-drift.test.js` |
| Full suite command | `node --test worker/mcp/server.test.js worker/mcp/server-search.test.js worker/mcp/server-drift.test.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | `drift_versions` returns CRITICAL when package versions differ | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |
| MCP-01 | `drift_versions` returns WARN when range specifiers differ | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |
| MCP-01 | `drift_versions` returns empty when db is null | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |
| MCP-02 | `drift_types` returns CRITICAL when shared type has different fields | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |
| MCP-02 | `drift_types` only compares repos of same language | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |
| MCP-03 | `drift_openapi` returns informational message when oasdiff unavailable | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |
| MCP-03 | `drift_openapi` returns empty when fewer than 2 repos have specs | unit | `node --test worker/mcp/server-drift.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test worker/mcp/server-drift.test.js`
- **Per wave merge:** `node --test worker/mcp/server.test.js worker/mcp/server-search.test.js worker/mcp/server-drift.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `worker/mcp/server-drift.test.js` — covers MCP-01, MCP-02, MCP-03 (new file, follows server.test.js pattern)

*(Existing test infrastructure covers existing tools; only the new test file is needed for this phase)*

---

## Sources

### Primary (HIGH confidence)
- `worker/mcp/server.js` — All tool registration and query patterns are directly observed
- `worker/db/database.js` — DB lifecycle, migration system, project hash directory logic
- `worker/db/migrations/001_initial_schema.js` — Complete schema: repos, services, connections, schemas, fields tables
- `worker/db/migrations/008_actors_metadata.js` — actors, actor_connections, node_metadata tables; crossing column
- `worker/db/pool.js` — `resolveDb()` patterns, linked repo resolution via `getQueryEngineByRepo`
- `worker/db/query-engine.js` — QueryEngine class, enrichment helpers, upsert methods

### Secondary (MEDIUM confidence)
- `scripts/drift-versions.sh` — Extract_versions logic, normalize_version, comparison algorithm (directly observable)
- `scripts/drift-types.sh` — Language detection, type extraction per language, body comparison
- `scripts/drift-openapi.sh` — OpenAPI candidate paths, oasdiff vs yq fallback, pairwise vs hub-and-spoke
- `scripts/drift-common.sh` — emit_finding format, LINKED_REPOS discovery
- `lib/linked-repos.sh` — linked-repos config reading and sibling directory discovery
- `worker/mcp/server.test.js` — Test patterns: node:test, in-memory SQLite, direct function import
- `package.json` — Confirmed versions: `@modelcontextprotocol/sdk ^1.27.1`, `better-sqlite3 ^12.8.0`, `zod ^3.25.0`

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All packages are present in package.json; no new dependencies needed
- Architecture: HIGH — All patterns directly observed in existing server.js code
- Pitfalls: HIGH — Most pitfalls are directly observed in bash scripts (oasdiff fallback, TOML parsing, type caps) and JS patterns (better-sqlite3 sync, execSync timeout)

**Research date:** 2026-03-20
**Valid until:** 2026-06-20 (stable libraries, internal codebase changes would invalidate sooner)
