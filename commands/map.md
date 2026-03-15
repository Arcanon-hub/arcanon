---
description: Build or refresh the service dependency map by scanning linked repos with Claude agents. Use when the user runs /allclear:map to build the impact map for the first time or re-scan after changes.
allowed-tools: Bash, Read, Write, AskUserQuestion, Agent
argument-hint: "[--view] [--full]"
---

# AllClear Map — Service Dependency Scanner

This command scans linked repositories using Claude agents to discover services, API endpoints, and connections between them. Results are stored in SQLite and visualized in a web UI.

**Core task:** Read each repo's code → extract services and connections → confirm with user → save.

## Quick Reference

- `/allclear:map` — scan repos and build the dependency graph
- `/allclear:map --view` — just open the graph UI (no scanning)
- `/allclear:map --full` — force full re-scan of all files

---

## If `--view` flag: Open Graph UI and Exit

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
worker_running || bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
PORT=$(cat ~/.allclear/worker.port)
open "http://localhost:${PORT}"
```

Print "Graph UI opened" and stop. Do not proceed to scanning.

---

## Step 1: Discover Linked Repos

Find repos to scan from two sources:

**From config:**

```bash
[ -f allclear.config.json ] && node -e "
  const c = JSON.parse(require('fs').readFileSync('allclear.config.json', 'utf8'));
  (c['linked-repos'] || []).forEach(r => console.log(r));
"
```

**From parent directory:**

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh
list_linked_repos
```

Combine, deduplicate, and present to the user:

```
Found these repos:
  - ../api (configured)
  - ../auth (configured)
  - ../sdk (discovered)

Confirm? (yes / edit / no)
```

Save confirmed list to `allclear.config.json`.

---

## Step 2: Scan Each Repo with a Claude Agent

**This is the main task.** For each confirmed repo, spawn an agent to analyze the code.

**Scan mode:** If `--full` flag is present OR this is the first scan (no existing data), scan all files in every repo. Otherwise, only scan repos with changes since last scan — check git HEAD against the last scanned commit.

**For each repo:**

1. **Check if scan is needed** (skip for `--full` or first scan):

   ```bash
   LAST_COMMIT=$(git -C "${REPO_PATH}" rev-parse HEAD 2>/dev/null)
   ```

   Compare with the repo's `last_scanned_commit` from the database. If they match and `--full` is not set, skip this repo and print: "Skipping <repo> (no changes since last scan)".

2. Read the agent prompt template:

   ```bash
   cat ${CLAUDE_PLUGIN_ROOT}/worker/agent-prompt.md
   ```

3. Replace `{{REPO_PATH}}` with the absolute path and `{{SERVICE_HINT}}` with empty string.

4. **Spawn an agent** using the Agent tool:

   ```
   Agent(
     prompt="<filled prompt with repo path>",
     subagent_type="Explore",
     description="Scan <repo-name> for services"
   )
   ```

5. The agent returns a JSON code block with `services`, `connections`, and `schemas` arrays. Extract the JSON from between the ``` markers.

6. Print progress:

   ```
   Scanning 1/N: api... done (3 services, 5 connections)
   Scanning 2/N: auth... (skipped — no changes)
   ```

7. Collect all findings. Group by confidence (high/low).

---

## Step 3: Confirm Findings with User

**All findings must be confirmed before saving.**

Show high-confidence findings as a batch:

```
Services found:
  - user-api (repo: api, language: typescript)
  - auth-service (repo: auth, language: python)

Connections:
  - user-api → auth-service [REST POST /auth/validate]
  - user-api → billing [REST POST /billing/charge]

Confirm these? (yes / edit / no)
```

For low-confidence findings (max 10), ask individually:

```
Uncertain: Is user-api calling config-service at GET /config?
  Evidence: "const url = getConfig().configEndpoint"
  (yes / no / skip)
```

---

## Step 4: Save to Database

Write the confirmed findings directly to SQLite using the AllClear db module:

```bash
node --input-type=module -e "
  import { openDb, writeScan } from '${CLAUDE_PLUGIN_ROOT}/worker/db.js';
  import { QueryEngine } from '${CLAUDE_PLUGIN_ROOT}/worker/query-engine.js';
  const db = openDb();
  const qe = new QueryEngine(db);
  const findings = JSON.parse(process.argv[1]);
  const repoId = qe.upsertRepo({ path: findings.repo_path, name: findings.repo_name, type: 'single' });
  qe.persistFindings(repoId, findings, findings.commit || null);
  console.log('saved');
" '<CONFIRMED_FINDINGS_JSON>'
```

Repeat for each repo. Print: "Dependency map saved. N services, M connections."

If this was the **first map build**, add `"impact-map": {"history": true}` to `allclear.config.json` and print:

```
Map built successfully. View it with /allclear:map --view
To enable agent-based impact checking, add the AllClear MCP server to your .mcp.json.
```
