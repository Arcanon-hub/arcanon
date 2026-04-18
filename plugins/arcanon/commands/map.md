---
description: Build or refresh the service dependency map by scanning linked repos with Claude agents. Use when the user runs /arcanon:map to build the impact map for the first time or re-scan after changes.
allowed-tools: Bash, Read, Write, AskUserQuestion, Agent
argument-hint: "[view|full]"
---

# Arcanon Map — Service Dependency Scanner

This command scans linked repositories using Claude agents to discover services, API endpoints, and connections between them. Results are stored in SQLite and visualized in a web UI.

**Core task:** Read each repo's code → extract services and connections → confirm with user → save.

## Quick Reference

- `/arcanon:map` — scan repos and build the dependency graph
- `/arcanon:map view` — just open the graph UI (no scanning)
- `/arcanon:map full` — force full re-scan of all files

---

## If `view` flag: Open Graph UI and Exit

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
worker_running || bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
PORT=$(cat ~/.arcanon/worker.port)
# Cross-platform open
if command -v xdg-open &>/dev/null; then xdg-open "http://localhost:${PORT}"
elif command -v open &>/dev/null; then open "http://localhost:${PORT}"
else echo "Open http://localhost:${PORT} in your browser"; fi
```

Print "Graph UI opened" and stop. Do not proceed to scanning.

---

## Step 0: Ensure Project Name

Before scanning, ensure the project has a name stored in `arcanon.config.json`.

**Read existing config:**

```bash
PROJECT_NAME=""
if [ -f arcanon.config.json ]; then
  PROJECT_NAME=$(node --input-type=module -e "
    import fs from 'fs';
    const c = JSON.parse(fs.readFileSync('arcanon.config.json', 'utf8'));
    if (c['project-name']) console.log(c['project-name']);
  ")
fi
```

**If PROJECT_NAME is empty**, ask the user using `AskUserQuestion`:

```
What is this project called? (e.g., "my-platform", "acme-backend")
```

Then write the entered name to config:

```bash
node --input-type=module -e "
  import fs from 'fs';
  const configPath = 'arcanon.config.json';
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  config['project-name'] = '${PROJECT_NAME}';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
"
```

**If PROJECT_NAME already exists**, print: `Project: ${PROJECT_NAME}` and continue.

---

## Step 1: Discover Linked Repos

Find repos to scan from two sources:

**From config:**

```bash
[ -f arcanon.config.json ] && node --input-type=module -e "
  import fs from 'fs';
  const c = JSON.parse(fs.readFileSync('arcanon.config.json', 'utf8'));
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

Save confirmed list to `arcanon.config.json`.

Capture the project root at this point:

```bash
PROJECT_ROOT="$(pwd)"
```

---

## Step 2: Scan Each Repo (Two-Phase)

**This is the main task.** Each repo is scanned in two phases for accuracy and efficiency.

**Scan mode determination:**

- If this is the **first scan** (no existing data in the database), proceed with a full scan automatically — no confirmation needed.
- If `full` subcommand is present AND existing scan data exists, **ask the user before proceeding**:

  ```
  Existing scan data found (N services, M connections).
  A full re-scan will delete all existing data and rebuild from scratch.

  Proceed with full re-scan? (yes / no — incremental scan instead)
  ```

  If the user says no, fall back to incremental mode (only scan repos with changes).

- If `full` is NOT present, use incremental mode — only scan repos with changes since last scan.

**For each repo:**

1. **Check if scan is needed** (skip for incremental mode):

   ```bash
   LAST_COMMIT=$(git -C "${REPO_PATH}" rev-parse HEAD 2>/dev/null)
   ```

   Compare with the repo's `last_scanned_commit` from the database. If they match and mode is incremental, ask the user:

   ```
   No changes detected in <repo> since last scan.
   Skip this repo? (yes / no — force re-scan this repo)
   ```

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

## Step 3: Reconcile Crossing Values

After all repos are scanned, run a single reconciliation pass over all collected findings to correct misclassified `external` crossings.

**Build the known-services set:**

Collect every `service.name` from every repo's scan findings:

```javascript
const knownServices = new Set();
for (const finding of allFindings) {
  for (const service of (finding.services || [])) {
    knownServices.add(service.name);
  }
}
```

**Downgrade external to cross-service:**

For every connection across all findings: if `crossing === "external"` AND `target` is in `knownServices`, change `crossing` to `"cross-service"`:

```javascript
for (const finding of allFindings) {
  for (const conn of (finding.connections || [])) {
    if (conn.crossing === 'external' && knownServices.has(conn.target)) {
      conn.crossing = 'cross-service';
    }
  }
}
```

Print a reconciliation summary if any crossings were changed:

```
Reconciliation: 3 connection(s) reclassified external → cross-service
```

If no changes, print nothing.

---

## Step 4: Confirm Findings with User

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

## Step 5: Save to Database

First, write the confirmed findings JSON to a temp file to avoid shell escaping and ARG_MAX issues:

```bash
# Write findings to temp file (use Write tool, or echo with heredoc)
FINDINGS_FILE=$(mktemp /tmp/arcanon-findings-XXXXXX.json)
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

If this was the **first map build**, add `"impact-map": {"history": true}` to `arcanon.config.json` and print:

```
Map built successfully. View it with /arcanon:map view
To enable agent-based impact checking, add the Arcanon MCP server to your .mcp.json.
```
