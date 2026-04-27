---
description: Re-scan exactly one linked repo using Claude agents. Other linked repos in the project are NOT touched. Always full mode — incremental skip is bypassed. Pending scan_overrides for that repo are applied during the rescan via Phase 117's apply hook.
argument-hint: "<repo-path-or-name>"
allowed-tools: Bash, Read, AskUserQuestion, Agent
---

# Arcanon Rescan — Single-Repo Re-scan

Re-scan exactly one linked repo using the same two-phase Claude-agent
workflow as `/arcanon:map`, scoped to a single repo. Other repos registered
in the project are NOT re-scanned — their `services`, `connections`, and
`scan_versions` rows are byte-untouched. Pending `scan_overrides` rows for
the rescanned repo are consumed via Phase 117's `applyPendingOverrides` hook
between `persistFindings` and `endScan`.

**Core task:** Resolve `<repo>` → run discovery + deep agents → reconcile →
confirm → persist with `applyPendingOverrides` → print result.

## When to use

- Right after `/arcanon:correct` — the apply hook consumes pending overrides
  on the next scan; this is the cheapest way to trigger that without
  re-scanning the whole project.
- After a hotfix in one repo when you want a fresh service map for it
  without touching the others.
- When `/arcanon:verify` flagged drift in one repo and you've fixed the
  underlying code — confirm the new scan picks it up.

## When NOT to use

- For a one-shot read-only check — use `/arcanon:verify`.
- To rebuild the entire project map — use `/arcanon:map` (or `/arcanon:map full`).
- To stage corrections — use `/arcanon:correct`. This command consumes them;
  it does not insert them.

---

## Step 0 — Detect non-Arcanon dir + parse arg

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/rescan.md" && exit 0

# Silent in non-Arcanon dirs (no impact-map.db) — same contract as
# /arcanon:list, /arcanon:diff, /arcanon:correct.
PROJECT_ROOT="$(pwd)"
PROJECT_HASH=$(printf "%s" "$PROJECT_ROOT" | shasum -a 256 | awk '{print substr($1,1,12)}')
DATA_DIR="${ARCANON_DATA_DIR:-$HOME/.arcanon}"
DB_PATH="${DATA_DIR}/projects/${PROJECT_HASH}/impact-map.db"
if [ ! -f "$DB_PATH" ]; then
  exit 0
fi

# Validate positional repo arg.
REPO_ARG="${ARGUMENTS%% *}"
if [ -z "$REPO_ARG" ]; then
  echo "error: /arcanon:rescan requires a repo path or name as the first argument" >&2
  echo "usage: /arcanon:rescan <repo-path-or-name>" >&2
  exit 2
fi
```

---

## Step 1 — Resolve repo identifier → row

```bash
TARGET_FILE=$(mktemp /tmp/arcanon-rescan-target-XXXXXX.json)
node --input-type=module -e "
  import Database from 'better-sqlite3';
  import { resolveRepoIdentifier } from '${CLAUDE_PLUGIN_ROOT}/worker/lib/repo-resolver.js';
  const db = new Database('${DB_PATH}', { readonly: true });
  try {
    const row = resolveRepoIdentifier('${REPO_ARG}', db, '${PROJECT_ROOT}');
    process.stdout.write(JSON.stringify(row));
  } catch (err) {
    if (err && (err.code === 'NOT_FOUND' || err.code === 'AMBIGUOUS' || err.code === 'INVALID')) {
      process.stderr.write(err.message + '\n');
      process.exit(2);
    }
    throw err;
  } finally {
    db.close();
  }
" > \"$TARGET_FILE\" || { rm -f \"$TARGET_FILE\"; exit 2; }

REPO_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${TARGET_FILE}','utf8')).id)")
REPO_PATH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${TARGET_FILE}','utf8')).path)")
REPO_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${TARGET_FILE}','utf8')).name)")
echo "Rescanning ${REPO_NAME} (repo_id=${REPO_ID}, path=${REPO_PATH})"
```

Capture `REPO_ID`, `REPO_PATH`, `REPO_NAME` — they thread through the rest
of the steps.

---

## Step 2 — Two-Phase Scan

Same scan recipe as `/arcanon:map` but for one repo only.

**Phase 1 — Discovery** (fast, reads only structure files):

Read the discovery prompt template using the Read tool:

```
Read(${CLAUDE_PLUGIN_ROOT}/worker/scan/agent-prompt-discovery.md)
```

Replace `{{REPO_PATH}}` with `$REPO_PATH`. Spawn the discovery agent:

```
Agent(
  prompt="<filled discovery prompt>",
  subagent_type="Explore",
  description="Discover ${REPO_NAME} structure"
)
```

The agent returns a JSON with `languages`, `frameworks`, `service_hints`,
`route_files`, etc.

**Phase 2 — Deep scan** (reads source code, targeted by discovery):

Read the deep-scan prompt template using the Read tool:

```
Read(${CLAUDE_PLUGIN_ROOT}/worker/scan/agent-prompt-deep.md)
```

Replace `{{REPO_PATH}}` with `$REPO_PATH` and `{{DISCOVERY_JSON}}` with the
Phase 1 output. Spawn the deep agent:

```
Agent(
  prompt="<filled deep scan prompt with discovery context>",
  subagent_type="Explore",
  description="Deep scan ${REPO_NAME} for services"
)
```

Extract the JSON from between the ``` markers. Validate the findings.

Print progress:

```
Scanning ${REPO_NAME}...
  Phase 1: discovered (${LANGS}, ${FRAMEWORKS}, N service hints, M route files)
  Phase 2: scanned (P services, Q connections, R endpoints exposed)
```

---

## Step 3 — Reconcile crossings (cross-repo aware)

Build the known-services set from BOTH the existing DB (so other repos'
services are honoured as known) AND the new findings:

```javascript
const knownServices = new Set();
// Existing services from every repo currently in the DB.
for (const row of db.prepare("SELECT name FROM services").all()) {
  knownServices.add(row.name);
}
// Plus the new findings for this repo.
for (const service of (findings.services || [])) {
  knownServices.add(service.name);
}
```

For every connection in the new findings: if `crossing === "external"` AND
`target` is in `knownServices`, change it to `"cross-service"` and capture
`_reconciliation` for the audit log (TRUST-06):

```javascript
let _reconciledCount = 0;
for (const conn of (findings.connections || [])) {
  if (conn.crossing === 'external' && knownServices.has(conn.target)) {
    conn._reconciliation = {
      from: 'external',
      to: 'cross-service',
      reason: 'target matches known service: ' + conn.target,
    };
    conn.crossing = 'cross-service';
    _reconciledCount++;
  }
}
if (_reconciledCount > 0) {
  console.log('Reconciliation: ' + _reconciledCount + ' connection(s) reclassified external → cross-service');
}
```

If no changes, print nothing.

---

## Step 4 — Confirm Findings with User

Show high-confidence findings as a batch:

```
Services found in ${REPO_NAME}:
  - <name> (language: <lang>)

Connections from ${REPO_NAME}:
  - <source> → <target> [<protocol> <method> <path>]

Confirm and save? (yes / edit / no)
```

Use `AskUserQuestion`. If `no`, abort — do NOT call `beginScan`.

For low-confidence findings (max 10), ask individually as in `/arcanon:map`.

---

## Step 5 — Persist (full scan + applyPendingOverrides)

Write the confirmed findings to a temp file (avoids shell escaping):

```bash
FINDINGS_FILE=$(mktemp /tmp/arcanon-rescan-findings-XXXXXX.json)
# Use the Write tool to write the confirmed findings JSON to ${FINDINGS_FILE}.
```

Then persist with the standard scan bracket — `beginScan`,
`persistFindings`, `applyPendingOverrides`, `endScan`. The override hook
fires BEFORE `endScan` (matches the bracket order in `scanRepos`):

```bash
node --input-type=module -e "
  import fs from 'fs';
  import { openDb } from '${CLAUDE_PLUGIN_ROOT}/worker/db/database.js';
  import { QueryEngine } from '${CLAUDE_PLUGIN_ROOT}/worker/db/query-engine.js';
  import { applyPendingOverrides } from '${CLAUDE_PLUGIN_ROOT}/worker/scan/overrides.js';
  const db = openDb('${PROJECT_ROOT}');
  const qe = new QueryEngine(db);
  const findings = JSON.parse(fs.readFileSync('${FINDINGS_FILE}', 'utf8'));
  const repoId = qe.upsertRepo({
    path: findings.repo_path,
    name: findings.repo_name,
    type: 'single',
  });
  const scanVersionId = qe.beginScan(repoId);
  qe.persistFindings(repoId, findings, findings.commit || null, scanVersionId);
  await applyPendingOverrides(scanVersionId, qe);
  qe.endScan(repoId, scanVersionId);
  console.log('Rescanned: ' + findings.repo_name + ' (repo_id=' + repoId + ', scan_version_id=' + scanVersionId + ')');
  console.log('Mode: full (incremental skip bypassed)');
  // TRUST-05 quality breakdown — same surface as /arcanon:map.
  const breakdown = qe.getScanQualityBreakdown(scanVersionId);
  if (breakdown && breakdown.quality_score !== null) {
    const pct = Math.round(breakdown.quality_score * 100);
    console.log('Scan quality: ' + pct + '% high-confidence, ' + breakdown.prose_evidence_warnings + ' prose-evidence warnings');
  } else if (breakdown) {
    console.log('Scan quality: n/a (' + breakdown.total + ' connections)');
  }
  // TRUST-06 audit rows for reconciled connections (mirrors map.md Step 5).
  for (const conn of (findings.connections || [])) {
    if (!conn._reconciliation) continue;
    const sourceRow = db.prepare(
      'SELECT id FROM services WHERE name = ? AND repo_id = ?'
    ).get(conn.source, repoId);
    const targetRow = db.prepare(
      'SELECT id FROM services WHERE name = ?'
    ).get(conn.target);
    if (!sourceRow || !targetRow) continue;
    const connRow = db.prepare(
      'SELECT id FROM connections WHERE source_service_id = ? AND target_service_id = ? AND ' +
      '(path IS ? OR path = ?) AND (method IS ? OR method = ?)'
    ).get(
      sourceRow.id, targetRow.id,
      conn.path || null, conn.path || '',
      conn.method || null, conn.method || ''
    );
    if (!connRow) continue;
    qe.logEnrichment(
      scanVersionId,
      'reconciliation',
      'connection',
      connRow.id,
      'crossing',
      conn._reconciliation.from,
      conn._reconciliation.to,
      conn._reconciliation.reason
    );
  }
"
rm -f "${FINDINGS_FILE}" "${TARGET_FILE}"
```

Then suggest the next step:

> Sync to Hub with `/arcanon:sync` when ready.

## Help

**Usage:** `/arcanon:rescan <repo-path-or-name>`

Re-scan exactly one linked repo using Claude agents. Always full mode —
incremental skip is bypassed. Other repos are NOT touched. Pending
`scan_overrides` for that repo are applied via Phase 117's apply hook.

**Options:**
- `<repo-path-or-name>` — required positional; absolute or relative path,
  OR the value of `repos.name` (typically the repo basename).
- `--help`, `-h`, `help` — print this help and exit.

**Examples:**
- `/arcanon:rescan ../api`
- `/arcanon:rescan api`
- `/arcanon:rescan /abs/path/to/auth-service`

**Exit codes:**
- `0` — rescan ran; new `scan_versions` row present for the rescanned repo.
- `2` — usage error: missing repo arg, repo not found, ambiguous name.

Silent (no output, exit 0) when run from a directory without an
`impact-map.db`.
