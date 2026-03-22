---
description: Build or refresh the service dependency map by scanning linked repos with Claude agents. Use when the user runs /ligamen:map to build the impact map for the first time or re-scan after changes.
allowed-tools: Bash, Read, Write, AskUserQuestion, Agent
argument-hint: "[view|full]"
---

# Ligamen Map — Service Dependency Scanner

This command scans linked repositories using Claude agents to discover services, API endpoints, and connections between them. Results are stored in SQLite and visualized in a web UI.

**Core task:** Read each repo's code → extract services and connections → confirm with user → save.

## Quick Reference

- `/ligamen:map` — scan repos and build the dependency graph
- `/ligamen:map view` — just open the graph UI (no scanning)
- `/ligamen:map full` — force full re-scan of all files

---

## If `view` flag: Open Graph UI and Exit

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
worker_running || bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
PORT=$(cat ~/.ligamen/worker.port)
# Cross-platform open
if command -v xdg-open &>/dev/null; then xdg-open "http://localhost:${PORT}"
elif command -v open &>/dev/null; then open "http://localhost:${PORT}"
else echo "Open http://localhost:${PORT} in your browser"; fi
```

Print "Graph UI opened" and stop. Do not proceed to scanning.

---

## Step 1: Discover Linked Repos

Find repos to scan from two sources:

**From config:**

```bash
[ -f ligamen.config.json ] && node --input-type=module -e "
  import fs from 'fs';
  const c = JSON.parse(fs.readFileSync('ligamen.config.json', 'utf8'));
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

Save confirmed list to `ligamen.config.json`.

Capture the project root at this point:

```bash
PROJECT_ROOT="$(pwd)"
```

---

## Step 2: Scan Each Repo (Two-Phase)

**This is the main task.** Each repo is scanned in two phases for accuracy and efficiency.

**Scan mode:** If `full` subcommand is present OR this is the first scan (no existing data), scan all repos. Otherwise, only scan repos with changes since last scan — check git HEAD against the last scanned commit.

**For each repo:**

1. **Check if scan is needed** (skip for `full` or first scan):

   ```bash
   LAST_COMMIT=$(git -C "${REPO_PATH}" rev-parse HEAD 2>/dev/null)
   ```

   Compare with the repo's `last_scanned_commit` from the database. If they match and `full` is not set, skip this repo and print: "Skipping <repo> (no changes since last scan)".

2. **Phase 1 — Discovery** (fast, reads only structure files):
   Read the discovery prompt template using the Read tool:

   ```
   Read(${CLAUDE_PLUGIN_ROOT}/worker/scan/agent-prompt-discovery.md)
   ```

   Replace `{{REPO_PATH}}` with the absolute path. Spawn a quick agent:

   ```
   Agent(
     prompt="<filled discovery prompt>",
     subagent_type="Explore",
     description="Discover <repo-name> structure"
   )
   ```

   The agent returns a JSON with `languages`, `frameworks`, `service_hints`, `route_files`, etc. This takes seconds.

3. **Phase 2 — Deep scan** (reads source code, targeted by discovery):
   Read the deep scan prompt template using the Read tool:

   ```
   Read(${CLAUDE_PLUGIN_ROOT}/worker/scan/agent-prompt-deep.md)
   ```

   Replace `{{REPO_PATH}}` with the absolute path. Replace `{{DISCOVERY_JSON}}` with the Phase 1 JSON output. Spawn a focused agent:

   ```
   Agent(
     prompt="<filled deep scan prompt with discovery context>",
     subagent_type="Explore",
     description="Deep scan <repo-name> for services"
   )
   ```

   The agent uses the discovery context to focus on relevant files — route files, handler files, proto files — instead of scanning everything.

4. Extract the JSON from between the ``` markers. Validate the findings.

5. Print progress:

   ```
   Scanning 1/N: api...
     Phase 1: discovered (python, fastapi, 2 services, 5 route files)
     Phase 2: scanned (2 services, 5 connections, 8 endpoints exposed)
   Scanning 2/N: auth... (skipped — no changes)
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

First, write the confirmed findings JSON to a temp file to avoid shell escaping and ARG_MAX issues:

```bash
# Write findings to temp file (use Write tool, or echo with heredoc)
FINDINGS_FILE=$(mktemp /tmp/ligamen-findings-XXXXXX.json)
```

Then save to SQLite using the beginScan/endScan bracket to garbage-collect stale data:

```bash
node --input-type=module -e "
  import fs from 'fs';
  import { openDb } from '${CLAUDE_PLUGIN_ROOT}/worker/db/database.js';
  import { QueryEngine } from '${CLAUDE_PLUGIN_ROOT}/worker/db/query-engine.js';
  const db = openDb('${PROJECT_ROOT}');
  const qe = new QueryEngine(db);
  const findings = JSON.parse(fs.readFileSync('${FINDINGS_FILE}', 'utf8'));
  const repoId = qe.upsertRepo({ path: findings.repo_path, name: findings.repo_name, type: 'single' });
  const scanVersionId = qe.beginScan(repoId);
  qe.persistFindings(repoId, findings, findings.commit || null, scanVersionId);
  qe.endScan(repoId, scanVersionId);
  console.log('saved');
"
rm -f "${FINDINGS_FILE}"
```

Repeat for each repo. Print: "Dependency map saved. N services, M connections."

If this was the **first map build**, add `"impact-map": {"history": true}` to `ligamen.config.json` and print:

```
Map built successfully. View it with /ligamen:map view
To enable agent-based impact checking, add the Ligamen MCP server to your .mcp.json.
```
