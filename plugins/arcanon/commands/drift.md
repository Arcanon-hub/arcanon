---
description: Detect drift — service-graph changes across scans + version/type/OpenAPI drift across linked repos.
allowed-tools: Bash
argument-hint: "[graph|versions|types|openapi|--all] [--spec <path>]..."
---

Check cross-repo drift for linked repositories.

Linked repos: !`source "${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh" && list_linked_repos "${CLAUDE_PLUGIN_ROOT}"`

## Help short-circuit

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/drift.md" && exit 0
```

## Steps

1. Parse arguments to determine subcommand and flags:
   - Subcommand: `graph`, `versions`, `types`, or `openapi` (default: run all)
   - Flags: `--all` enables INFO-level output in addition to CRITICAL and WARN

2. For `graph` (or no subcommand specified):
   Compare the two most recent scan snapshots — surfaces services and
   connections that appeared, disappeared, or changed between scans.
   Run: `node "${CLAUDE_PLUGIN_ROOT}/worker/cli/drift-local.js"`

3. For `versions` (or no subcommand specified):
   Run: `"${CLAUDE_PLUGIN_ROOT}/scripts/drift-versions.sh" $ARCANON_ARGS`

3. For `types` (or no subcommand specified):
   Run: `"${CLAUDE_PLUGIN_ROOT}/scripts/drift-types.sh" $ARCANON_ARGS`

4. For `openapi` (or no subcommand specified):
   Run: `"${CLAUDE_PLUGIN_ROOT}/scripts/drift-openapi.sh" $ARCANON_ARGS`

5. Report findings grouped by severity:
   - CRITICAL first (breaking version mismatches, incompatible API changes)
   - WARN next (likely issues: different locking strategies, non-breaking diffs)
   - INFO suppressed unless `--all` was passed

6. For each finding, state:
   - Which package or definition has drift
   - Which repos are affected
   - The specific version or value each repo holds (not just "differ")

## Notes

- Run `drift versions` alone for fastest check (pure bash + jq, no optional tools required)
- `drift types` is best-effort heuristic (grep-based interface/struct name matching, same-language only)
- `drift openapi` uses `oasdiff` when available; falls back to structural yq comparison
- `/arcanon:drift openapi --spec <path-A> --spec <path-B>` compares explicit spec paths instead of auto-discovering. Useful for non-conventional spec locations. Repeatable; requires at least 2 paths.
- If no sibling repos are found, the command exits with a helpful message
- Expected runtime: versions <5s, types <15s, openapi <10s for typical repo sets

## Help

**Usage:** `/arcanon:drift [graph|versions|types|openapi|--all]`

Detect drift across linked repos: service-graph changes between scans, plus
version, type, and OpenAPI mismatches across sibling repositories.

**Subcommands:**
- *(none)* — run all four drift checks (graph + versions + types + openapi)
- `graph` — compare the two most recent scan snapshots only
- `versions` — fastest check; package-version mismatches via bash + jq
- `types` — heuristic interface/struct name drift, same-language only
- `openapi` — OpenAPI spec drift via `oasdiff` (or yq fallback)

**Options:**
- `--all` — surface INFO-level findings in addition to CRITICAL and WARN
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:drift` — run every check; report CRITICAL + WARN
- `/arcanon:drift versions` — package-version mismatches only
- `/arcanon:drift --all` — include INFO-level findings (e.g. patch bumps)
