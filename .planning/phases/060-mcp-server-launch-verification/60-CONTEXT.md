# Phase 60: MCP Server Launch Verification - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify that the MCP server starts correctly from a marketplace-installed plugin after Phase 59's dep installation. Confirm ESM resolution works without NODE_PATH, all 8 tools are callable, and ChromaDB degrades gracefully. This is a verification/testing phase, not new feature work.

</domain>

<decisions>
## Implementation Decisions

### Verification Approach
- Test MCP server startup from the installed plugin location (~/.claude/plugins/marketplaces/ligamen/)
- Send MCP initialize handshake and verify response includes all 8 tools
- Confirm no ERR_MODULE_NOT_FOUND errors in stderr
- .mcp.json stays as-is — no NODE_PATH env needed since deps install into PLUGIN_ROOT

### ESM Resolution
- Verify that `node ${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js` finds node_modules via ESM directory walk
- No changes to .mcp.json required — current config is correct

### ChromaDB Graceful Degradation
- Remove @chroma-core/default-embed from node_modules, restart server
- Verify server starts and 3-tier search fallback activates (ChromaDB → FTS5 → basic SQL)
- This is existing behavior — just verify it still works with the new install location

### Root .mcp.json
- Confirm root .mcp.json is `{"mcpServers": {}}` — dev repo should not have consumer MCP config

### Claude's Discretion
- Whether to create automated test scripts or manual verification steps
- How to simulate marketplace install for testing

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP server
- `plugins/ligamen/.mcp.json` — MCP server config
- `plugins/ligamen/worker/mcp/server.js` — Server entry point, ESM imports to verify
- `plugins/ligamen/scripts/mcp-wrapper.sh` — Wrapper with self-healing (after Phase 59)

### Existing tests
- `plugins/ligamen/worker/mcp/server.test.js` — Existing MCP server tests
- `plugins/ligamen/worker/mcp/server-drift.test.js` — Drift tool tests
- `plugins/ligamen/worker/mcp/server-search.test.js` — Search tool tests

### Root config
- `.mcp.json` — Root dev-repo config, should be empty

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- MCP test files already test tool listing and responses — can extend for install-path verification
- `echo '{"jsonrpc":"2.0",...}' | node server.js` pattern proven in earlier debugging

### Established Patterns
- MCP server responds to initialize with protocolVersion and capabilities.tools
- ChromaDB availability checked via `isChromaAvailable()` function

### Integration Points
- Depends on Phase 59 completing (deps must be installed first)
- Verifies the install-deps.sh + mcp-wrapper.sh pipeline end-to-end

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard verification approach

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 60-mcp-server-launch-verification*
*Context gathered: 2026-03-21*
