---
name: impact
description: This skill should be used when the user asks to "build the impact map", "scan my repos", "map service dependencies", "run /arcanon:map", or when an agent needs to build or query the service dependency graph. Provides cross-repo impact analysis using a local SQLite graph.
version: 1.0.0
---

# Impact Map

Build and query the Arcanon service dependency graph across one or more repositories.

This skill provides the same functionality as the `/arcanon:map` command. When invoked, it orchestrates the full scan lifecycle: repo discovery, user confirmation, agent-based scanning, finding persistence, and results display.

For full execution instructions, invoke the `/arcanon:map` command which contains the complete procedure for starting the worker, discovering repos, running agent scans, confirming findings, and persisting the map.

## After First Map Build

When this is the first successful map build (no prior map_versions, i.e., `isFirstScan()` returned true before this scan), output these recommendations to the user:

---

Map built successfully. To unlock the full Arcanon experience:

**1. Enable semantic search (optional but recommended)**
Add to ~/.arcanon/settings.json:

```json
{
  "LIGAMEN_CHROMA_MODE": "local",
  "LIGAMEN_CHROMA_HOST": "localhost",
  "LIGAMEN_CHROMA_PORT": "8000"
}
```

Then start ChromaDB: `docker run -p 8000:8000 chromadb/chroma`

**2. Add Arcanon impact checking to all your Claude agents**
Create or update `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "arcanon": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/worker/mcp/server.js"]
    }
  }
}
```

## After saving, fully restart Claude Code for MCP changes to take effect.

The `/arcanon:map` skill reads this section and outputs it verbatim after the first successful persist.
The check `isFirstScan()` from `worker/db/database.js` is called before `writeScan()` to determine whether to show this.
