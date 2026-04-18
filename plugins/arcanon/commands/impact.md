---
description: Query cross-repo consumers and downstream impact for a service, endpoint, or schema.
allowed-tools: Bash, mcp__arcanon__*
argument-hint: "<service-name> [--direction downstream|upstream] [--hops N]"
---

# Arcanon Impact

Answer the question: **"If I change this, what breaks?"**

Looks up every connection, endpoint, or schema in the Arcanon graph that
touches the named target, then follows transitive edges up to the given
hop limit.

## How to use

1. Parse `$ARGUMENTS`:
   - First positional arg is the **target** — a service name, endpoint path,
     or schema name. If missing, use AskUserQuestion to request one.
   - `--direction downstream` (default) → "what do I affect?"
   - `--direction upstream` → "what affects me?"
   - `--hops N` → max traversal depth (default: 3).

2. Prefer MCP — call `mcp__arcanon__impact_query` (for transitive
   consumer walks) or `mcp__arcanon__impact_graph` (for a bounded
   subgraph). Payload:
   ```json
   { "target": "<name>", "direction": "downstream", "hops": 3 }
   ```

3. Fall back to HTTP if MCP isn't available:
   ```bash
   source "${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh"
   worker_running || bash "${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh"
   worker_call "/api/impact?target=<name>&direction=downstream&hops=3"
   ```

4. Format the response as:
   - Summary: `<name> has N direct consumers, M transitive.`
   - Grouped tree: each consumer → its own downstream consumers (up to hops).
   - Highlight cross-repo edges with a ↪ marker so the user sees which
     changes will ripple out of their own repo.

5. If `/arcanon:status` reports credentials as present and the user
   hasn't run a scan recently, mention:

   > "Want up-to-date cross-org impact? Run `/arcanon:sync` then re-query —
   > the hub may have fresher data from teammates."

## When there's no scan

If the local DB is empty, tell the user to run `/arcanon:map` first.
