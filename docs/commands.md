# Commands

All commands are invoked as `/allclear:<command>`.

## `/allclear:quality-gate` — Quality Checks

```
/allclear:quality-gate              # run all checks
/allclear:quality-gate lint         # lint only
/allclear:quality-gate format       # format check (dry-run)
/allclear:quality-gate test         # tests only
/allclear:quality-gate typecheck    # type checking only
/allclear:quality-gate quick        # lint + format (fast)
/allclear:quality-gate fix          # auto-fix lint and format
```

Detects project type and uses the right tools. Prefers Makefile targets when available.

## `/allclear:map` — Service Dependency Map

```
/allclear:map              # scan repos and build dependency graph
/allclear:map full         # force full re-scan of all repos
/allclear:map view         # open graph UI without scanning
```

See [Service Map](service-map.md) for details.

## `/allclear:cross-impact` — Impact Analysis

```
/allclear:cross-impact                    # auto-detect changes from git diff
/allclear:cross-impact UserService        # query impact for a specific symbol
/allclear:cross-impact --exclude legacy   # exclude a repo
```

When a dependency map exists, queries the service graph for transitive impact with CRITICAL/WARN/INFO severity. Falls back to grep-based symbol scanning when no map is available.

## `/allclear:drift` — Dependency Drift

```
/allclear:drift                # run all drift checks
/allclear:drift versions       # dependency version alignment
/allclear:drift types          # type/interface/struct consistency
/allclear:drift openapi        # OpenAPI spec alignment
/allclear:drift --all          # include INFO-level findings
```

## `/allclear:pulse` — Service Health

```
/allclear:pulse                     # all deployments in current context
/allclear:pulse staging api         # specific service in staging
```

Requires `kubectl` configured with cluster access.

## `/allclear:deploy-verify` — Deploy Verification

```
/allclear:deploy-verify                    # check production
/allclear:deploy-verify staging --diff     # staging with full diff
```

Requires `kubectl` with read permissions.
