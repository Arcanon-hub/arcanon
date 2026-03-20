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

