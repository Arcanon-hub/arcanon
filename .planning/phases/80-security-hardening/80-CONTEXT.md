# Phase 80: Security Hardening - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden the MCP server, scan manager, and auth-db enricher against path traversal, credential leakage, and concurrent scan corruption. Three security fixes: SEC-01 (path traversal in resolveDb), SEC-02 (credential entropy rejection in auth-db extractor), SEC-03 (project lock for concurrent scans).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure security/infrastructure phase.

Key constraints from CONCERNS.md analysis:
- SEC-01: Use `path.normalize()` + verify resolved path starts with `~/.ligamen/projects/`. Current guard is only `project.includes('..')`
- SEC-02: Add Shannon entropy calculation. Reject strings above threshold (~4.0 bits/char). Log near-threshold strings at WARN level
- SEC-03: Use filesystem lock file (`.ligamen/scan-{project-hash}.lock`) with PID check for stale lock detection

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `plugins/ligamen/worker/mcp/server.js` — resolveDb() at lines 72-89, current basic `.includes('..')` guard
- `plugins/ligamen/worker/scan/enrichment/auth-db-extractor.js` — extractAuthAndDb() with current length-based rejection at lines 43-57
- `plugins/ligamen/worker/scan/manager.js` — scanRepos() entry point, no current lock mechanism

### Established Patterns
- Error handling: try/catch with logger.warn() for non-fatal, throw for fatal
- Validation: warn-and-skip pattern established in findings.js (SVAL-01)
- DB pool: `~/.ligamen/projects/` directory structure for per-project databases

### Integration Points
- resolveDb() is called by every MCP tool handler — single choke point for path validation
- auth-db extractor runs inside the enrichment pass framework (isolated, failure-tolerant)
- scanRepos() is called from both CLI fallback and POST /scan HTTP endpoint

</code_context>

<specifics>
## Specific Ideas

No specific requirements — security/infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
