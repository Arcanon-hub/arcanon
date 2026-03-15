# Service Dependency Map

AllClear scans your linked repositories with Claude agents to build an interactive service dependency graph.

## How It Works

1. `/allclear:map` discovers your linked repos (from config or parent directory)
2. You confirm the repo list
3. Claude agents scan each repo — extracting services, endpoints, connections, schemas
4. You confirm the findings (high-confidence as a batch, low-confidence individually)
5. Data is saved to SQLite
6. View the graph at `http://localhost:37888`

## What Gets Detected

**Services** — deployable units: HTTP servers, gRPC servers, event producers/consumers, daemons, workers, serverless functions

**Libraries/SDKs** — shared code that multiple services import (shown in purple in the graph)

**Connections** — classified by boundary crossing:
- `external` — network calls (REST, gRPC, events)
- `sdk` — shared library imports
- `internal` — within-service module calls

**Schemas** — request/response/event payload structures with field-level detail

## Graph UI

Open with `/allclear:map view` or navigate to `http://localhost:37888`.

**Node colors:**
- Blue — backend services
- Orange — frontend services
- Purple — libraries/SDKs

**Interactions:**
- Click a node — detail panel with connections, methods, files
- Shift+click — transitive blast radius highlighting
- Drag on empty space — pan the viewport
- Mouse wheel — zoom in/out
- Protocol filters — toggle REST, gRPC, events, internal
- Search — filter by service name

**Mismatch indicators:**
- Red ✗ on edges where the endpoint handler wasn't found in the target service
- Red border in detail panel for unverified connections

## Incremental Scanning

After the first full scan, `/allclear:map` only re-scans repos with new commits. Use `/allclear:map full` to force a complete re-scan.

## MCP Server

After building your first map, add the AllClear MCP server so all Claude agents can check impact before making changes:

```json
{
  "mcpServers": {
    "allclear-impact": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-allclear>/worker/mcp-server.js"]
    }
  }
}
```

Available MCP tools: `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`.
