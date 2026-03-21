# Commands

All commands are invoked as `/ligamen:<command>`.

## `/ligamen:quality-gate` — Quality Checks

```
/ligamen:quality-gate              # run all checks
/ligamen:quality-gate lint         # lint only
/ligamen:quality-gate format       # format check (dry-run)
/ligamen:quality-gate test         # tests only
/ligamen:quality-gate typecheck    # type checking only
/ligamen:quality-gate quick        # lint + format (fast)
/ligamen:quality-gate fix          # auto-fix lint and format
```

Detects project type and uses the right tools. Prefers Makefile targets when available.

## `/ligamen:map` — Service Dependency Map

```
/ligamen:map              # scan repos and build dependency graph
/ligamen:map full         # force full re-scan of all repos
/ligamen:map view         # open graph UI without scanning
```

See [Service Map](service-map.md) for details.

## `/ligamen:cross-impact` — Impact Analysis

```
/ligamen:cross-impact                    # auto-detect changes from git diff
/ligamen:cross-impact UserService        # query impact for a specific symbol
/ligamen:cross-impact --exclude legacy   # exclude a repo
```

When a dependency map exists, queries the service graph for transitive impact with CRITICAL/WARN/INFO severity. Falls back to grep-based symbol scanning when no map is available.

## `/ligamen:drift` — Dependency Drift

```
/ligamen:drift                # run all drift checks
/ligamen:drift versions       # dependency version alignment
/ligamen:drift types          # type/interface/struct consistency
/ligamen:drift openapi        # OpenAPI spec alignment
/ligamen:drift --all          # include INFO-level findings
```

## Graph UI — Interactive Controls

The browser-based graph at http://localhost:37888 provides a set of interactive controls for exploring your service dependency map.

### Navigation

Use keyboard shortcuts to move around the graph without reaching for the mouse:

- `F` — fit all nodes to screen (centers and scales the canvas to show every node)
- `Esc` — deselect the current node and close the detail panel (also exits isolation mode)
- `/` — move keyboard focus to the search input so you can type a node name immediately

### Clickable Panel Targets

When a node's detail panel is open, the connections list displays the names of connected services as clickable links. Clicking a service name selects that node, pans the canvas to center it, and opens its detail panel in place of the previous one — allowing you to traverse the dependency graph without returning to the canvas.

### Subgraph Isolation

Press `I` on a selected node to hide all nodes and edges not within 1 hop of that node, focusing the canvas on its immediate neighbors. Press `2` to expand the view to 2-hop depth, or `3` to expand to 3-hop depth. Press `Esc` (or `I` again) to exit isolation mode and restore the full graph.

### What-Changed Overlay

After a re-scan (`/ligamen:map`), nodes and edges introduced or modified in the latest scan are visually highlighted — new nodes receive a glow ring and a "NEW" badge, and new edges are drawn with a distinct highlight color. Unchanged nodes and edges render normally, making recent changes immediately visible at a glance.

### Edge Bundling

When two or more edges share the same source and target nodes, they are rendered as a single thicker edge with a numeric badge showing the count of bundled connections. The bundled edge color reflects the dominant protocol type among the grouped edges. Clicking a bundled edge opens the detail panel listing all individual connections with their protocol, kind, and endpoint.

### PNG Export

Click the export button (camera icon) in the graph toolbar to download a PNG screenshot of the current canvas view. The export captures all visible nodes and edges at the current zoom and pan position.

