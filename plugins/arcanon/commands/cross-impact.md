---
description: Check cross-repo impact of current changes using the service dependency map (when available) or grep-based symbol scanning (fallback). Use when the user invokes /arcanon:cross-impact, asks about breaking changes, or wants to know what services are affected before merging.
allowed-tools: Bash, Read, Write, AskUserQuestion
argument-hint: "[symbol...] [--changed] [--exclude <repo>]"
---

# Cross-Repo Impact Scanner

Checks the impact of current changes across linked services. When a service dependency map is available (built by `/arcanon:map`), this command queries the graph for transitive blast radius with CRITICAL/WARN/INFO severity. When no map is available, it falls back to the v1.0 grep-based symbol scan so existing users are never broken.

## Usage

- `/arcanon:cross-impact` — auto-detect uncommitted changes and query impact
- `/arcanon:cross-impact <symbol>` — query impact for a specific endpoint or service name
- `/arcanon:cross-impact --changed` — same as no-args (git diff auto-detect)
- `/arcanon:cross-impact --exclude <repo>` — exclude a repo from results

---

## Step 0: Detect State (Worker + Map Availability)

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
WORKER_UP=$(worker_running && echo "yes" || echo "no")
```

If `WORKER_UP=yes`, check whether the map has data:

```bash
GRAPH_RESPONSE=$(worker_call GET /graph 2>/dev/null || echo "[]")
```

Parse the response:

- If `GRAPH_RESPONSE` contains at least one service node (non-empty array / non-empty `services` key), set `MAP_HAS_DATA=yes`.
- Otherwise set `MAP_HAS_DATA=no`.

**Three degradation states:**

| State                       | Condition                           | Action                                                                                                                                                                 |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — No worker, no map       | `WORKER_UP=no`                      | Jump to **Legacy Fallback**                                                                                                                                            |
| B — Worker up, no map data  | `WORKER_UP=yes`, `MAP_HAS_DATA=no`  | Print "No scan data found. Run `/arcanon:map` to build the dependency map first." — then jump to **Legacy Fallback** (still provide grep results as a partial answer) |
| C — Worker up, map has data | `WORKER_UP=yes`, `MAP_HAS_DATA=yes` | Proceed with **Graph Query Flow**                                                                                                                                      |

> **Important:** Do NOT attempt to start the worker from this command. The map orchestrator (`/arcanon:map`) owns the worker lifecycle. Cross-impact is a query-only command.

---

## State C: Graph Query Flow

### Step 1: Detect Changes

Parse arguments from the user's invocation:

- Collect positional args as the target symbol or endpoint path.
- Detect `--changed` flag (treat same as no symbol: auto-detect from git diff).
- Collect `--exclude` repo names.

If no symbol argument and no `--changed` flag (or `--changed` is present):

```bash
# Uncommitted changes
DIFF_UNCOMMITTED=$(git diff --name-only HEAD 2>/dev/null)
# Most recent commit
DIFF_RECENT=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
# Combine and deduplicate
CHANGED_FILES=$(printf "%s\n%s\n" "$DIFF_UNCOMMITTED" "$DIFF_RECENT" | sort -u | grep -v '^$')
```

If `CHANGED_FILES` is empty and no symbol was provided, ask:

> No changes detected. What would you like to check? (enter a service name or endpoint path)

If a symbol argument was provided, use it directly as the query target.

### Step 2: Query the Impact Map

For each changed file or symbol target identified in Step 1:

```bash
# Direct impact query
IMPACT_RESPONSE=$(worker_call GET "/impact?change=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$TARGET")" 2>/dev/null || echo "{}")

# Transitive (full blast radius)
TRANSITIVE_RESPONSE=$(worker_call GET "/impact?change=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$TARGET")&transitive=true" 2>/dev/null || echo "{}")
```

Collect all `affected` items from all responses. Deduplicate by `service` + `change_type`.

The worker returns JSON in this shape:

```json
{
  "affected": [
    {
      "service": "auth-service",
      "change_type": "endpoint_removed",
      "severity": "CRITICAL",
      "consumers": ["api-gateway", "user-service"],
      "transitive_depth": 2,
      "files": ["src/client/auth.ts:42"]
    }
  ]
}
```

Severity mapping:

- `endpoint_removed` → **CRITICAL**
- `field_type_changed` → **WARN**
- `field_added` → **INFO**

### Step 3: Render Impact Report

Produce a structured report grouped by severity (CRITICAL first, then WARN, then INFO):

```
Impact Report — <date>
Changes detected: <N files or symbol>

CRITICAL — Endpoint removed (<N> services affected)
  auth-service  [consumers: api-gateway, user-service]
    └─ POST /auth/token removed
       Consumers will break at runtime.
       Files to update: src/client/auth.ts:42, src/gateway/auth-proxy.ts:18

WARN — Field type changed (<N> services affected)
  user-service  [consumers: reporting-service]
    └─ UserProfile.email: string → string | null
       Existing consumers may fail null checks.

INFO — Additive change (<N> services)
  user-service
    └─ UserProfile.avatar_url: string (new field)
       No existing consumers affected.

Transitive blast radius: <total unique services across all hops>
```

If no affected services found, print:

```
No impact found. Changes appear safe. (Verify the map is up to date.)
```

### Step 4: Suggest Re-Scan if Map May Be Stale

After the report, check for stale map data:

```bash
# Check if any linked repo has uncommitted changes not reflected in the last scan
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
```

Check the `repo_state` table (via the `/graph` response or a direct query) — if the `last_scanned_commit` for any linked repo is earlier than its current HEAD, the map may be stale.

If potentially stale, print:

```
Note: Your dependency map may not reflect recent code changes.
Run `/arcanon:map` to re-scan and catch any new or removed connections.
```

Ask: "Re-scan now? (yes/no)"

If yes: print "Run `/arcanon:map` to trigger a scan." (Do not trigger scan inline — `/arcanon:map` is the orchestrator.)

---

## Legacy Fallback (States A and B)

Print this banner before running the legacy scan:

```
[Legacy mode — dependency map not available]
Using grep-based symbol scan. Run /arcanon:map for full dependency intelligence.
```

### Linked Repos Configuration Check

Config file exists: !`test -f arcanon.config.json && echo "yes" || echo "no"`
Config contents: !`test -f arcanon.config.json && cat arcanon.config.json || echo "{}"`
Auto-discovered repos: !`source ${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh && list_linked_repos 2>/dev/null`

**Follow this decision tree before proceeding to the scan:**

#### If `arcanon.config.json` exists and has a non-empty `linked-repos` array:

- Show the configured repos to the user: "Using linked repos from arcanon.config.json: [list]"
- Proceed to the Legacy Scan step.

#### If `arcanon.config.json` does NOT exist or has no `linked-repos`:

Ask the user:

> No linked repos configured. Would you like to:
>
> 1. **Auto-detect** — scan for repos and confirm
> 2. **Manual** — enter repo paths yourself
> 3. **Skip** — run without config (uses auto-discovery this time only)

**If the user chooses Auto-detect (option 1):**

1. Check auto-discovered repos from the output above (parent directory scan).
2. Check memory for any previously known repos by searching for project context, repo names, or related work using the mem-search skill.
3. Combine both sources into a deduplicated list.
4. Present the combined list to the user for confirmation:
   > Found these repos:
   >
   > - ../api (from parent directory)
   > - ../ui (from parent directory)
   > - ../shared-types (from memory)
   >
   > Save these to `arcanon.config.json`? (yes/no, or edit the list)
5. If confirmed, write `arcanon.config.json` with the confirmed repos.
6. Proceed to the Legacy Scan step using the confirmed repos.

**If the user chooses Manual (option 2):**

1. Ask: "Enter repo paths (relative or absolute), one per line or comma-separated:"
2. Validate each path exists. Warn about any that don't.
3. Write `arcanon.config.json` with the validated paths.
4. Proceed to the Legacy Scan step.

**If the user chooses Skip (option 3):**

- Use auto-discovered repos for this run only. Do not write config.
- Proceed to the Legacy Scan step.

### Legacy Scan

Parse arguments from the user's invocation: collect positional args as symbols, detect `--changed` flag, collect `--exclude` repo names.

Run the v1.0 impact scanner:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]
```

Read the structured output. Each match line is tab-separated:

```
{repo}  {term}  {type}  {filepath}
```

Summarize by repo: which repos have matches, what match types appear, how many unique files per repo.

Highlight `code`-type matches as highest risk — these are direct source code references that will break if the symbol is removed or renamed.

If no matches found anywhere, confirm the symbol appears safe to change or remove.

### Output Interpretation

Match types and their risk levels:

| Type   | Risk   | Meaning                                                           |
| ------ | ------ | ----------------------------------------------------------------- |
| code   | HIGH   | Direct source reference — will break if symbol is removed/renamed |
| config | MEDIUM | Configuration reference — may need updating                       |
| test   | LOW    | Test reference — tests will need updating, not a runtime break    |
| docs   | LOW    | Documentation reference — no runtime impact                       |

### Reporting Format

- Group matches by repo, then by match type within each repo.
- Report unique file count per repo, not line count. One file containing 40 references is less significant than 40 different files containing one reference each.
- List file paths (not line numbers) so the user knows exactly where to look.
- Lead with a one-line summary: "X repos reference `<symbol>`, Y with code matches."
