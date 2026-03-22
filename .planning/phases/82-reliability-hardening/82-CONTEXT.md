# Phase 82: Reliability Hardening - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden agent output parsing, transitive impact queries, and auth-db file traversal against edge cases. Three reliability fixes: REL-01 (multi-strategy JSON parsing), REL-02 (transitive depth limit + timeout), REL-03 (auth-db traversal guards).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure reliability/infrastructure phase.

Key constraints from CONCERNS.md analysis:

- REL-01: `findings.js` currently depends on specific JSON block markers. Add fallback chain: (1) try JSON block markers, (2) try fenced ```json code block extraction, (3) try raw JSON.parse(). Log parse failures with truncated preview of raw output. Skip repo on all-fail.
- REL-02: Transitive impact queries in `query-engine.js` have no depth limit. Add configurable max depth (default 7). Add 30s query timeout. Return partial results with truncation notice on limit hit.
- REL-03: `auth-db-extractor.js` recursively scans entire directories without limits. Add: pre-traversal exclusion list (node_modules, .git, vendor, dist, build, __pycache__), max depth 8 levels, skip files >1MB.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `plugins/ligamen/worker/scan/findings.js` — parseAgentOutput() with current single-strategy JSON extraction
- `plugins/ligamen/worker/db/query-engine.js` — impact query methods with recursive SQL
- `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js` — extractAuthAndDb() with readdirSync traversal

### Established Patterns
- findings.js: warn-and-skip pattern for validation errors (SVAL-01)
- query-engine.js: prepared statements for all queries
- auth-db-extractor: enrichment pass isolation (failure-tolerant)

### Integration Points
- parseAgentOutput is called by scanRepos in manager.js for every repo scan result
- Impact queries are called by MCP server tools and HTTP endpoints
- Auth-db extractor runs inside enrichment pass framework

</code_context>

<specifics>
## Specific Ideas

No specific requirements — reliability/infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
