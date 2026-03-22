# Commands

Ligamen adds slash commands to Claude Code. Type `/ligamen:<command>` in any Claude Code session where the plugin is installed.

## `/ligamen:map` — Build Your Service Dependency Map

Use this when you want to see how your services connect to each other. Ligamen scans your repositories with Claude agents, extracts services, endpoints, and connections, and builds an interactive graph you can explore in your browser.

```
/ligamen:map              # scan repos and build dependency graph
/ligamen:map full         # force full re-scan of all repos
/ligamen:map view         # open graph UI without scanning
```

After scanning, open `http://localhost:37888` to explore the graph. See [Service Map](service-map.md) for a full walkthrough.

## `/ligamen:cross-impact` — See What Your Changes Affect

Use this before making changes to a shared service or after modifying code to understand the blast radius. Ligamen traces dependencies through your service graph (up to 10 hops deep) and flags every downstream service that could be affected, grouped by severity:

- **CRITICAL** — an endpoint was removed or renamed that other services depend on
- **WARN** — a type or schema changed that consumers rely on
- **INFO** — an additive change (new field, new endpoint) that existing consumers can safely ignore

```
/ligamen:cross-impact                    # auto-detect changes from git diff
/ligamen:cross-impact UserService        # query impact for a specific symbol
/ligamen:cross-impact --changed          # explicit flag for git diff detection
/ligamen:cross-impact --exclude legacy   # exclude a repo from results
```

If you haven't built a dependency map yet, Ligamen falls back to grep-based symbol scanning across your linked repos — still useful for finding references, but without the transitive dependency tracing.

## `/ligamen:drift` — Catch Inconsistencies Across Repos

Use this to find places where your repos have drifted out of sync. Ligamen runs three checks:

- **Versions** — compares dependency versions across repos (npm, pip, Cargo, go.mod). Reports CRITICAL when exact versions differ, WARN when range specifiers disagree (e.g., `^2.0` vs `~2.0`).
- **Types** — finds shared type/interface/struct definitions across same-language repos and flags fields that have diverged.
- **OpenAPI** — compares API specifications for breaking changes. Uses `oasdiff` when available, falls back to structural comparison.

For large repo sets (more than 5), Ligamen uses a hub-and-spoke comparison strategy to keep results manageable.

```
/ligamen:drift                # run all three checks
/ligamen:drift versions       # dependency version alignment only
/ligamen:drift types          # type/interface/struct consistency only
/ligamen:drift openapi        # OpenAPI spec alignment only
/ligamen:drift --all          # include INFO-level findings (default hides them)
```

## `/ligamen:quality-gate` — Run Quality Checks

Use this to run linting, formatting, type checking, and tests for your project. Ligamen auto-detects your project type and uses the right tools. If your project has a Makefile, it prefers those targets.

```
/ligamen:quality-gate              # run all checks
/ligamen:quality-gate lint         # lint only
/ligamen:quality-gate format       # format check (dry-run)
/ligamen:quality-gate test         # tests only
/ligamen:quality-gate typecheck    # type checking only
/ligamen:quality-gate quick        # lint + format (fast)
/ligamen:quality-gate fix          # auto-fix lint and format
```

## Graph UI

After running `/ligamen:map`, open the graph at `http://localhost:37888` to explore your service dependencies visually. See [Service Map](service-map.md) for full details on the graph UI including node colors, interactions, keyboard shortcuts, subgraph isolation, and export.
