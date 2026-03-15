---
description: Build or refresh the service dependency map by scanning linked repos. Use when the user runs /allclear:map to build the impact map for the first time or re-scan after changes. Also handles --view to open the graph UI and --full to force a complete re-scan.
allowed-tools: Bash, Read, Write, AskUserQuestion, Agent
argument-hint: "[--view] [--full]"
---

# AllClear Map — Service Dependency Builder

Orchestrates the complete dependency map pipeline: discover repos → confirm → scan → confirm findings → persist → open graph UI.

## Usage

- `/allclear:map` — discover repos, scan, confirm findings, persist to SQLite, open graph UI
- `/allclear:map --view` — open the graph UI without scanning (requires existing map data)
- `/allclear:map --full` — force a full re-scan of all repos (ignores git diff incremental check)

---

## Step 0: Handle --view Flag

Parse the user's invocation arguments. Detect the `--view` flag.

If `--view` is present:

1. Source the worker client library:
   ```bash
   source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
   ```

2. Ensure the worker is running. If `worker_running` returns false:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
   wait_for_worker
   ```
   If the worker fails to start, print the error output and exit.

3. Check if map data exists:
   ```bash
   GRAPH=$(worker_call GET /graph)
   ```
   Parse the JSON response. If `services` array is non-empty, map data exists.

4. If map data exists: open the browser and exit.
   ```bash
   PORT=$(cat ~/.allclear/worker.port)
   open http://localhost:${PORT}
   ```
   Print: "Graph UI opened at http://localhost:PORT"

5. If no map data: print the following and exit.
   > No map data yet. Run `/allclear:map` to build the dependency map first.

---

## Step 1: Ensure Worker Is Running

Source the worker client library:
```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
```

Check if the worker is running:
```bash
worker_running
```

If the worker is NOT running:
1. Start it:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
   ```
2. Wait for it to be ready:
   ```bash
   wait_for_worker
   ```
3. If `wait_for_worker` fails or times out, print the error and exit. Do not continue.

---

## Step 2: Discover Repos

Build a combined, deduplicated list of repos from two sources:

**Source A — allclear.config.json (project config):**
```bash
CONFIG_REPOS=""
if [ -f allclear.config.json ]; then
  CONFIG_REPOS=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('allclear.config.json', 'utf8'));
    const repos = c['linked-repos'] || [];
    console.log(repos.join('\n'));
  " 2>/dev/null)
fi
```

**Source B — auto-discovery (parent directory + memory):**
```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh
DISCOVERED_REPOS=$(list_linked_repos 2>/dev/null)
```

Combine and deduplicate both lists. For each repo in the combined list, track whether it came from `allclear.config.json` or was newly discovered (present in Source B but not Source A). Mark newly discovered repos with "(newly discovered)" in the display.

---

## Step 3: Present Repo List and Confirm

Present the combined repo list to the user. Example format:

```
Repos found for scanning:
  - /Users/you/projects/api  (configured)
  - /Users/you/projects/auth  (configured)
  - /Users/you/projects/sdk  (newly discovered)

Confirm these repos for scanning? (yes / edit / no)
```

Use `AskUserQuestion` to ask: "Confirm these repos for scanning? (yes / edit / no)"

- If the user says **"edit"**: ask "Which repos to add or remove? (enter the updated list, one path per line)". Update the list and re-present it. Repeat until confirmed.
- If the user says **"no"**: print "Map build cancelled." and exit.
- If the user says **"yes"**: proceed.

Once confirmed, write the confirmed list to `allclear.config.json`:
```bash
node -e "
  const fs = require('fs');
  const repos = process.argv.slice(1);
  let config = {};
  if (fs.existsSync('allclear.config.json')) {
    config = JSON.parse(fs.readFileSync('allclear.config.json', 'utf8'));
  }
  config['linked-repos'] = repos;
  fs.writeFileSync('allclear.config.json', JSON.stringify(config, null, 2) + '\n');
" -- [confirmed repo paths]
```

---

## Step 4: Determine Scan Mode

Parse the user's invocation arguments. Detect the `--full` flag.

If `--full` flag is present: **mode = full**.

Otherwise, check the current graph state to determine if this is a first scan:
```bash
GRAPH=$(worker_call GET /graph)
```

Parse the JSON response. Look for any repo in `repo_state` that has a non-null `last_scanned_commit`. If no repo has been previously scanned, **mode = full (first scan)**. Otherwise, **mode = incremental**.

Print the determined mode: "Scan mode: full" or "Scan mode: incremental (scanning changes since last commit)"

---

## Step 5: Scan Repos with Agents

For each confirmed repo, spawn a Claude agent to analyze the codebase and extract service dependencies. Agents are spawned **sequentially in the foreground** (not background — they need full context).

**For each repo path in the confirmed list:**

1. Read the agent prompt template:
   ```bash
   PROMPT=$(cat ${CLAUDE_PLUGIN_ROOT}/worker/agent-prompt.md)
   ```

2. Replace the template tokens:
   - `{{REPO_PATH}}` → the absolute path to the repo
   - `{{SERVICE_HINT}}` → empty string (or service name from previous scan if re-scanning)

3. Spawn a Claude agent using the Agent tool:
   ```
   Agent(
     prompt="<filled agent prompt with repo path>",
     subagent_type="Explore",
     description="Scan <repo-name> for service dependencies"
   )
   ```

4. Parse the agent's response. The agent returns a fenced JSON code block. Extract the JSON from between the ``` markers.

5. Validate the findings using the schema. Check that:
   - `services` array exists and has at least one entry
   - Each connection has `source`, `target`, `protocol`, `confidence`, and `evidence`
   - Each finding has a `confidence` field (high or low)

6. If validation fails for a repo, log the error and continue to the next repo. Do not abort the entire scan.

7. Collect all findings across all repos. Group by confidence level:
   - `high` — all findings where `confidence === "high"`
   - `low` — all findings where `confidence === "low"`

Print progress as each repo completes:
```
Scanning repo 1/N: api... done (3 services, 5 connections)
Scanning repo 2/N: auth... done (1 service, 2 connections)
```

After all repos are scanned, print a summary:
```
Scan complete: N services, M connections found across K repos.
```

---

## Step 6: Present Findings and Confirm

**High-confidence findings:**

Count services and connections in the `high` array. Present a grouped summary to the user:

```
High-confidence findings:
  Found N services, M connections across K repos.

  Services discovered:
    - service-name (repo: /path/to/repo, language: node)
    ...

  Connections:
    - service-a → service-b  [REST GET /api/users]
    ...
```

Use `AskUserQuestion` to ask: "Confirm and save these findings? (yes / edit / no)"

**Low-confidence findings:**

For each finding in the `low` array (show at most 10), present the finding's `clarification_question` field and ask the user to answer it. Incorporate answers into the findings before proceeding.

Example:
```
Low-confidence finding (1/N):
  "Is payment-service calling auth-service at POST /token? (found in payment-service/src/auth-client.js)"
  (yes / no / unsure)
```

After all low-confidence questions are answered, either include or exclude those findings based on the user's answers.

- If the user says **"edit"** to the high-confidence confirmation: ask what to change. Re-present the modified findings. Repeat.
- If the user says **"no"** to everything: print "Scan cancelled. No data written." and exit.

Merge all confirmed findings (high + answered low-confidence) into a single `confirmedFindings` object.

---

## Step 7: Snapshot Existing Map (If Re-scan)

Check if there is existing map data:
```bash
VERSIONS=$(worker_call GET /versions)
```

Parse the JSON response. If the versions array is non-empty (existing map data exists), this is a re-scan.

Use `AskUserQuestion` to ask: "Keep a history snapshot before overwriting the current map? (yes / no)"

If yes, create a snapshot. The worker doesn't have a snapshot HTTP endpoint, so call the db module directly:
```bash
node --input-type=module -e "
  import { openDb, createSnapshot } from '${CLAUDE_PLUGIN_ROOT}/worker/db.js';
  openDb();
  const snapshotPath = createSnapshot('before-rescan');
  process.stdout.write('Snapshot saved: ' + snapshotPath + '\n');
"
```
Print: "Snapshot saved."

Note whether this was a first-time build (versions list was empty) — needed in Step 9.

---

## Step 8: Persist Confirmed Findings

For each repo's confirmed findings, POST to the worker's `/scan` endpoint:

```bash
for each REPO in confirmed repos:
  # Get the current git HEAD for this repo
  COMMIT=$(git -C "${REPO_PATH}" rev-parse HEAD 2>/dev/null || echo "")

  # Build the persist payload
  PAYLOAD='{
    "repo_path": "<absolute repo path>",
    "repo_name": "<repo basename>",
    "repo_type": "single",
    "commit": "<HEAD commit hash>",
    "findings": <confirmed findings JSON for this repo>
  }'

  RESULT=$(worker_call POST /scan "${PAYLOAD}")
done
```

The worker's `POST /scan` endpoint:
- Upserts the repo row
- Persists all services, connections, schemas, and fields
- Updates `repo_state` with the scanned commit hash
- Returns `{ "status": "persisted", "repo_id": N }`

Print: "Dependency map saved. N services, M connections across K repos."

If any persist call fails, print the error for that repo but continue with remaining repos.

**IMPORTANT:** The data is immediately available — no worker restart needed. The worker's query engine reads from the same SQLite file. `GET /graph` will return the new data right away.

---

## Step 9: Handle First-Time Build

If the versions list from Step 7 was **empty** (this was the first successful map build):

1. Update `allclear.config.json` to add the `impact-map` section:
   ```bash
   node -e "
     const fs = require('fs');
     const config = JSON.parse(fs.readFileSync('allclear.config.json', 'utf8'));
     config['impact-map'] = { history: true };
     fs.writeFileSync('allclear.config.json', JSON.stringify(config, null, 2) + '\n');
   "
   ```

2. Print MCP registration instructions:
   ```
   Map built successfully.

   To enable impact checking in all your Claude Code agents, add the AllClear MCP server
   to your project's .mcp.json:

   {
     "mcpServers": {
       "allclear-impact": {
         "type": "stdio",
         "command": "node",
         "args": ["${CLAUDE_PLUGIN_ROOT}/worker/mcp-server.js"]
       }
     }
   }

   Then restart Claude Code. Agents will automatically check impact before modifying services.
   ```

---

## Step 10: Open Graph UI

Open the graph UI in the browser:
```bash
PORT=$(cat ~/.allclear/worker.port)
open http://localhost:${PORT}
```

Print: "Graph UI opened at http://localhost:PORT"
