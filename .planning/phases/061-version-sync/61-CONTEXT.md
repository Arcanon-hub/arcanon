# Phase 61: Version Sync - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Bump all 5 manifest files to version 5.2.0 and clean up the root .mcp.json. Ensures Claude Code detects the update and users get the new install-deps hook. No automated bump script in this phase (deferred to future requirements).

</domain>

<decisions>
## Implementation Decisions

### Files to Update
- `plugins/ligamen/.claude-plugin/marketplace.json` — plugin marketplace version
- `.claude-plugin/marketplace.json` — root marketplace version (currently stale at 5.1.1)
- `plugins/ligamen/.claude-plugin/plugin.json` — plugin metadata version
- `plugins/ligamen/package.json` — npm package version
- `plugins/ligamen/runtime-deps.json` — runtime deps version (used as diff sentinel)

### Version String
- All 5 files set to exactly `"5.2.0"`
- No pre-release suffix, no build metadata

### Root .mcp.json
- Set to `{"mcpServers": {}}` — empty, dev repo should not have consumer MCP config
- Already done in earlier conversation, verify it stays correct

### Claude's Discretion
- Order of file edits
- Whether to add a git tag after version bump

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Manifest files
- `.claude-plugin/marketplace.json` — Root marketplace manifest
- `plugins/ligamen/.claude-plugin/marketplace.json` — Plugin marketplace manifest
- `plugins/ligamen/.claude-plugin/plugin.json` — Plugin metadata
- `plugins/ligamen/package.json` — npm package manifest
- `plugins/ligamen/runtime-deps.json` — Runtime deps manifest

### Root config
- `.mcp.json` — Root dev-repo MCP config, should be empty

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — this is pure file editing

### Established Patterns
- Version appears as `"version": "X.Y.Z"` in all JSON files
- marketplace.json nests version inside plugins[0].version

### Integration Points
- runtime-deps.json version is used by install-deps.sh diff sentinel (Phase 59)
- marketplace.json version determines whether Claude Code offers updates

</code_context>

<specifics>
## Specific Ideas

- Root marketplace.json was stuck at 0.2.0 when we started, then updated to 5.1.1 — must not fall behind again

</specifics>

<deferred>
## Deferred Ideas

- Automated bump-version.sh script (REL-01) — future requirement
- make check version validation (REL-02) — future requirement

</deferred>

---

*Phase: 61-version-sync*
*Context gathered: 2026-03-21*
