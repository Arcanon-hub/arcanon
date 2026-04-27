---
description: Run a scan of every linked repo into a shadow DB without touching the live impact map. Use /arcanon:diff --shadow to compare, /arcanon:promote-shadow to swap.
argument-hint: ""
allowed-tools: Bash, Read, AskUserQuestion, Agent
---

# Arcanon Shadow Scan — Sandbox Scan

Performs a scan into `${ARCANON_DATA_DIR}/projects/<hash>/impact-map-shadow.db`
instead of the live `impact-map.db`. The live DB is byte-untouched.

**Core task:** Same two-phase Claude-agent recipe as `/arcanon:map`, but
persistence routes to the shadow DB via `getShadowQueryEngine`. After the
shadow scan you can `/arcanon:diff --shadow` to compare or
`/arcanon:promote-shadow` to atomically swap shadow into live.

## When to use

- **Validate before commit.** You suspect a refactor will change the
  dependency graph and want to see the new graph before mutating the live one.
- **Compare scans cleanly.** A live re-scan replaces the previous scan in
  place; a shadow scan keeps both DBs side-by-side for `/arcanon:diff --shadow`.
- **Trial pending overrides.** Phase 117's apply hook fires inside the
  shadow scan transparently — pending `scan_overrides` rows are read from
  and written to the SHADOW DB's `scan_overrides` table. Live overrides
  are unaffected.

## When NOT to use

- For a routine refresh — use `/arcanon:map` (writes to live, half the disk).
- For a one-shot read-only check — use `/arcanon:verify`.

## Hard contracts

- **Live DB is byte-identical** before and after a shadow scan. The
  persistence step opens `getShadowQueryEngine` only — `openDb` (the live
  pool) is never called.
- **Shadow data NEVER uploads to Arcanon Hub.** `/arcanon:sync` reads from
  the live DB only. The shadow DB is sync-invisible by construction.
- **Existing shadow DB is overwritten in place** with a one-line warning.
  Non-interactive — there is no prompt. If you want to keep the current
  shadow, run `/arcanon:promote-shadow` first.

---

## Step 0 — Detect non-Arcanon dir + warn on existing shadow

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/shadow-scan.md" && exit 0

# Silent in non-Arcanon dirs (no live impact-map.db) — same contract as
# /arcanon:list, /arcanon:diff, /arcanon:correct, /arcanon:rescan.
PROJECT_ROOT="$(pwd)"
PROJECT_HASH=$(printf "%s" "$PROJECT_ROOT" | shasum -a 256 | awk '{print substr($1,1,12)}')
DATA_DIR="${ARCANON_DATA_DIR:-$HOME/.arcanon}"
PROJECT_DIR="${DATA_DIR}/projects/${PROJECT_HASH}"
LIVE_DB="${PROJECT_DIR}/impact-map.db"
SHADOW_DB="${PROJECT_DIR}/impact-map-shadow.db"
if [ ! -f "$LIVE_DB" ]; then
  exit 0
fi

if [ -f "$SHADOW_DB" ]; then
  echo "warn: Existing shadow DB will be overwritten. Use /arcanon:promote-shadow first if you want to keep it." >&2
fi
```

---

## Step 1 — Resolve repos to scan

Read every repo currently registered in the live DB. Open the live DB
**read-only** so the LIVE file's bytes are never mutated (no WAL pragma
write, no sidecar creation):

```bash
REPOS_FILE=$(mktemp /tmp/arcanon-shadow-repos-XXXXXX.json)
node --input-type=module -e "
  import Database from 'better-sqlite3';
  const db = new Database('${LIVE_DB}', { readonly: true });
  // Do NOT set journal_mode on a readonly connection — readonly forbids
  // writes including the pragma metadata write that would change live bytes.
  const rows = db.prepare('SELECT id, path, name FROM repos ORDER BY name').all();
  db.close();
  process.stdout.write(JSON.stringify(rows));
" > \"$REPOS_FILE\"

REPO_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPOS_FILE}','utf8')).length)")
if [ "$REPO_COUNT" -eq 0 ]; then
  echo "no repos to scan — run /arcanon:map first to populate the live DB's repos table" >&2
  exit 2
fi
echo "Shadow-scanning ${REPO_COUNT} repo(s) into ${SHADOW_DB}"
```

---

## Step 2 — Two-Phase Scan (Per Repo)

Same scan recipe as `/arcanon:map` Step 2 — discovery + deep — for each
repo. Iterate over the repos JSON. For each `{ id, path, name }`:

**Phase 1 — Discovery:**

```
Read(${CLAUDE_PLUGIN_ROOT}/worker/scan/agent-prompt-discovery.md)
```

Fill `{{REPO_PATH}}` with the repo's path. Spawn:

```
Agent(
  prompt="<filled discovery prompt>",
  subagent_type="Explore",
  description="Discover <repo-name> structure (shadow)"
)
```

**Phase 2 — Deep scan:**

```
Read(${CLAUDE_PLUGIN_ROOT}/worker/scan/agent-prompt-deep.md)
```

Fill `{{REPO_PATH}}` and `{{DISCOVERY_JSON}}`. Spawn:

```
Agent(
  prompt="<filled deep scan prompt with discovery context>",
  subagent_type="Explore",
  description="Deep scan <repo-name> for services (shadow)"
)
```

Extract the JSON from between the ``` markers. Validate. Print progress per
repo (mirrors map.md):

```
Scanning 1/N: <repo-name>...
  Phase 1: discovered (<langs>, <frameworks>, P service hints, Q route files)
  Phase 2: scanned (R services, S connections, T endpoints exposed)
```

Collect all findings into one array `allFindings` (one entry per repo).

---

## Step 3 — Reconcile crossings

Same logic as `/arcanon:map` Step 3 — build `knownServices` from every
finding's services, then downgrade `external` → `cross-service` whenever
the target name appears in the set.

```javascript
const knownServices = new Set();
for (const finding of allFindings) {
  for (const service of (finding.services || [])) {
    knownServices.add(service.name);
  }
}

let _reconciledCount = 0;
for (const finding of allFindings) {
  for (const conn of (finding.connections || [])) {
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
}
if (_reconciledCount > 0) {
  console.log('Reconciliation: ' + _reconciledCount + ' connection(s) reclassified external → cross-service');
}
```

If no changes, print nothing.

---

## Step 4 — Confirm Findings with User

Show the rolled-up high-confidence findings:

```
Services found across N repos: ...
Connections: ...

Confirm and save to SHADOW DB? (yes / edit / no)
```

Use `AskUserQuestion`. If `no`, abort — no shadow DB writes happen.

For low-confidence findings (max 10), ask individually as in `/arcanon:map`.

---

## Step 5 — Persist to SHADOW DB

Write `allFindings` to a temp file (avoids shell escaping):

```bash
FINDINGS_FILE=$(mktemp /tmp/arcanon-shadow-findings-XXXXXX.json)
# Use the Write tool to write the confirmed findings array to ${FINDINGS_FILE}.
```

Persist via `getShadowQueryEngine(projectRoot, { create: true })`. The
shadow QE is **uncached** — opening it once and closing it in `finally` is
safe and idiomatic (RESEARCH §1 / pool.js). The override hook fires between
`persistFindings` and `endScan` per repo (matches the bracket order in
`scanRepos`):

```bash
node --input-type=module -e "
  import fs from 'fs';
  import { getShadowQueryEngine } from '${CLAUDE_PLUGIN_ROOT}/worker/db/pool.js';
  import { applyPendingOverrides } from '${CLAUDE_PLUGIN_ROOT}/worker/scan/overrides.js';
  const allFindings = JSON.parse(fs.readFileSync('${FINDINGS_FILE}', 'utf8'));
  const shadowQE = getShadowQueryEngine('${PROJECT_ROOT}', { create: true });
  if (!shadowQE) {
    console.error('failed to open shadow QueryEngine');
    process.exit(1);
  }
  try {
    let serviceTotal = 0;
    let connectionTotal = 0;
    for (const findings of allFindings) {
      const repoId = shadowQE.upsertRepo({
        path: findings.repo_path,
        name: findings.repo_name,
        type: 'single',
      });
      const scanVersionId = shadowQE.beginScan(repoId);
      shadowQE.persistFindings(repoId, findings, findings.commit || null, scanVersionId);
      await applyPendingOverrides(scanVersionId, shadowQE);
      shadowQE.endScan(repoId, scanVersionId);
      serviceTotal += (findings.services || []).length;
      connectionTotal += (findings.connections || []).length;
      // TRUST-06 audit rows for reconciled connections (mirrors map.md Step 5).
      const db = shadowQE._db;
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
        shadowQE.logEnrichment(
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
    }
    console.log('Shadow scan complete (' + allFindings.length + ' repo' + (allFindings.length === 1 ? '' : 's') + ' scanned). Shadow DB: ${SHADOW_DB}');
    console.log('Services: ' + serviceTotal + ', Connections: ' + connectionTotal);
    console.log('Next: /arcanon:diff --shadow to compare, /arcanon:promote-shadow to swap.');
  } finally {
    try { shadowQE._db.close(); } catch { /* already closed */ }
  }
"
rm -f "${FINDINGS_FILE}" "${REPOS_FILE}"
```

## Help

**Usage:** `/arcanon:shadow-scan`

Run a scan of every linked repo into the project's shadow DB instead of
the live one. The live `impact-map.db` is byte-untouched.

**Options:**
- `--help`, `-h`, `help` — print this help and exit.

**Examples:**
- `/arcanon:shadow-scan`

**Exit codes:**
- `0` — shadow scan ran; `impact-map-shadow.db` written.
- `2` — no repos to scan (run `/arcanon:map` first).

Silent (no output, exit 0) when run from a directory without an
`impact-map.db`.

**Next steps:**
- `/arcanon:diff --shadow` — compare live vs shadow side-by-side.
- `/arcanon:promote-shadow` — atomically swap shadow into live.
