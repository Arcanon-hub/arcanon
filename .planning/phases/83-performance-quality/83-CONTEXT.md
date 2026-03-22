# Phase 83: Performance & Quality - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

FTS5 prepared statement caching, journal mode pragma test coverage, and map command project name UX. Three requirements: REL-04, QUAL-01, QUAL-02.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure/quality phase.

Key constraints:

- REL-04: FTS5 search in `query-engine.js` (lines 84-130) builds three separate prepared statements per query. Add LRU cache (size ~50) keyed by normalized query string. Cache hit returns existing statement. Eviction on capacity.
- QUAL-01: No tests exist for journal mode pragma ordering. Add tests to verify WAL is set on read-write connections and NOT set on readonly connections. Test files: `pool.js` and `database.js`.
- QUAL-02: `/ligamen:map` command file (`commands/map.md`) already updated this session to ask for project name. Port the changes from the plugin cache to source. Also need to handle reading/writing `project-name` in `ligamen.config.json`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `plugins/ligamen/worker/db/query-engine.js` — search() method with 3-tier fallback (ChromaDB → FTS5 → SQL)
- `plugins/ligamen/worker/db/pool.js` — openDb with WAL pragma at lines 95-96, readonly connection at line 237
- `plugins/ligamen/worker/db/database.js` — openDb function with pragma configuration
- `~/.claude/plugins/cache/ligamen/ligamen/5.4.0/commands/map.md` — already-updated command with project name prompt

### Integration Points
- FTS5 cache is internal to query-engine.js search() — no interface changes
- Pragma tests are new test files — no production code changes
- Map command changes are in the command markdown file

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure/quality phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
