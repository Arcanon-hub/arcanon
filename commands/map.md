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

1. Read the agent prompt template:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/worker/agent-prompt.md
```

2. For each repo, replace `{{REPO_PATH}}` with the absolute path and `{{SERVICE_HINT}}` with empty string.

3. **Spawn an agent for each repo** using the Agent tool:

```
Agent(
  prompt="<filled prompt with repo path>",
  subagent_type="Explore",
  description="Scan <repo-name> for services"
)
```

4. The agent returns a JSON code block with `services`, `connections`, and `schemas` arrays. Extract the JSON from between the ``` markers.

5. Print progress:

```
Scanning 1/N: api... done (3 services, 5 connections)
Scanning 2/N: auth... done (1 service, 2 connections)
```

6. Collect all findings. Group by confidence (high/low).

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

Ensure the worker is running:

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
worker_running || bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
```

For each repo's confirmed findings, POST to the worker:

```bash
COMMIT=$(git -C "${REPO_PATH}" rev-parse HEAD 2>/dev/null || echo "")
worker_call POST /scan '{"repo_path":"...","repo_name":"...","findings":{...},"commit":"..."}'
```

Data is immediately available — no restart needed.

Print: "Dependency map saved. N services, M connections."

---

## Step 5: Open Graph UI

```bash
PORT=$(cat ~/.allclear/worker.port)
open "http://localhost:${PORT}"
```

If this was the **first map build**, also:

1. Add `"impact-map": {"history": true}` to `allclear.config.json`
2. Print MCP registration instructions for enabling agent-based impact checking
