# Requirements: Ligamen

**Defined:** 2026-03-21
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.2.0 Requirements

Requirements for Plugin Distribution Fix milestone. Each maps to roadmap phases.

### Runtime Dependency Installation

- [ ] **DEPS-01**: SessionStart hook installs runtime deps into ${CLAUDE_PLUGIN_ROOT} via npm install
- [ ] **DEPS-02**: Install uses diff-based idempotency — skips if runtime-deps.json unchanged
- [ ] **DEPS-03**: Hook timeout is 120s+ to accommodate better-sqlite3 native compilation
- [ ] **DEPS-04**: Install runs before SESSION_ID dedup guard in session-start.sh

### MCP Server Distribution

- [ ] **MCP-01**: MCP server starts successfully from marketplace-installed plugin
- [ ] **MCP-02**: Self-healing MCP wrapper installs deps if missing before server exec
- [ ] **MCP-03**: .mcp.json works without NODE_PATH (ESM-compatible resolution)

### Version Sync

- [ ] **VER-01**: All 5 manifest files bumped to 5.2.0 (root marketplace.json, plugin marketplace.json, plugin.json, package.json, runtime-deps.json)
- [ ] **VER-02**: Root .mcp.json is empty (dev repo, not consumer)

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Context Menu

- **CTX-01**: User can right-click a node to access actions (copy name, show blast, open repo)
- **CTX-02**: Context menu adapts options based on node type (service vs library vs infra)

### Advanced Visualization

- **VIZ-01**: Minimap overview showing full graph with viewport indicator
- **VIZ-02**: On-canvas legend showing node shape → type mapping
- **VIZ-03**: Zoom level indicator with reset-to-100% click
- **VIZ-04**: URL state persistence for bookmarkable views (zoom, position, filters, selected node)

### Release Tooling

- **REL-01**: Automated bump-version.sh script for all manifest files
- **REL-02**: make check validation that all version files match

## Out of Scope

| Feature | Reason |
|---------|--------|
| esbuild bundling of MCP server | Adds build step complexity; install-at-runtime is simpler and officially documented |
| Committing node_modules | Bloats repo, ABI version fragility across platforms |
| npx-based MCP launch | Splits distribution across marketplace + npm registry |
| WASM SQLite replacement | 65+ call sites to migrate, doesn't solve chromadb native dep |
| SVG export | Canvas-to-SVG re-rendering is high effort; PNG covers the use case |
| Touch/mobile support | Single-developer desktop tool |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPS-01 | — | Pending |
| DEPS-02 | — | Pending |
| DEPS-03 | — | Pending |
| DEPS-04 | — | Pending |
| MCP-01 | — | Pending |
| MCP-02 | — | Pending |
| MCP-03 | — | Pending |
| VER-01 | — | Pending |
| VER-02 | — | Pending |

**Coverage:**
- v5.2.0 requirements: 9 total
- Mapped to phases: 0
- Unmapped: 9 ⚠️

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after initial definition*
