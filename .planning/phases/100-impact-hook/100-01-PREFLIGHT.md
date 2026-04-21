# Phase 100 Pre-Flight Findings

Generated: 2026-04-21 — Plan 100-01 empirical validation run.

All four findings are locked decisions. Plans 02 and 03 must not deviate from these without updating this file.

---

## 1. PreToolUse Output Key: systemMessage vs additionalContext

**Method:** Inspected `plugins/arcanon/scripts/file-guard.sh` line 64. The `warn_file()` function — which is a shipped, working soft-warn hook — emits:

```bash
printf '{"systemMessage": "Arcanon: %s -- %s"}\n' "$(basename "$file")" "$message"
exit 0
```

This is live production evidence. The hook is registered in `hooks.json` under `PreToolUse`, runs today, and Claude Code renders the `systemMessage` string as a visible assistant notification.

**Finding:** `systemMessage` is the correct output key for PreToolUse soft-warn (exit 0) output.  
`additionalContext` is a different key used in `SessionStart` / `UserPromptSubmit` hook output, NOT PreToolUse.

**Locked decision for Plans 02/03:**
- Emit `{"systemMessage": "Arcanon: <message>"}` on stdout.
- Exit 0 for soft-warn (show context to Claude, do not block the edit).
- Exit 2 + `{"hookSpecificOutput": {"permissionDecision": "deny", ...}}` for hard-block (not used by impact hook).

---

## 2. Project Hash Algorithm

**Method:** Read `plugins/arcanon/worker/db/pool.js` lines 28-35.

**Exact JS implementation:**

```javascript
function projectHashDir(projectRoot) {
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12);
  return path.join(dataDir, "projects", hash);
}
```

**Parity verification (run during pre-flight):**

```
$ node -e "console.log(require('crypto').createHash('sha256').update('/tmp/demo').digest('hex').slice(0,12))"
84a8cd7d7a26

$ printf '%s' "/tmp/demo" | shasum -a 256 | cut -c1-12
84a8cd7d7a26
```

Both produce `84a8cd7d7a26`. Hash is identical byte-for-byte.

**Bash equivalent (portable):**

```bash
if command -v shasum &>/dev/null; then
  printf '%s' "$project_root" | shasum -a 256 | cut -c1-12
elif command -v sha256sum &>/dev/null; then
  printf '%s' "$project_root" | sha256sum | cut -c1-12
fi
```

Critical: use `printf '%s'` (no trailing newline). Node's `.update(projectRoot)` hashes the raw string with no newline. `echo "$project_root"` adds a newline and produces a different hash.

**Locked decision for Plan 01 (db-path.sh):** Use `shasum -a 256` (macOS + Linux), fall back to `sha256sum` (GNU coreutils only). Input via `printf '%s'` — no trailing newline.

---

## 3. root_path Absolute vs Relative Convention

**Method:** Queried all locally available impact-map.db files:

```bash
sqlite3 "$HOME/.arcanon/projects/*/impact-map.db" "SELECT DISTINCT root_path FROM services LIMIT 20;"
```

**Actual production data observed (3 DBs with service rows):**

From `cb1bc14ae568/impact-map.db`:
```
packages/api-server
packages/graph-reconciler
packages/dashboard
packages/mcp-server
```

From `d3f0b2d448c5/impact-map.db`:
```
src/controller
```

From `ee98696bf906/impact-map.db`:
```
services/event_journal/
services/query_api/
services/source_registry/
services/stream_runtime/
.
sdk-python/edgeworks_sdk
sdk-rust
ui
```

**Finding:** All observed `root_path` values are **relative** (relative to the repo root). No absolute paths found across any of the 18 local DBs. Notable edge cases observed:
- Bare `.` (repo root itself is the service root)
- Paths with trailing slash (`services/event_journal/`)
- Shallow single-level paths (`src/controller`)
- Multi-level paths (`packages/api-server`)

**Locked decision for Plan 03 (Tier 2 SQL match):** All production data is relative. The defensive two-branch match handles trailing slashes and the bare `.` case:

```bash
# Normalize trailing slash from stored root_path
root_path_clean="${ROOT_PATH%/}"

# Match: edited file is under the service's repo directory + root_path
if [[ "$FILE" == "${REPO_PATH}/${root_path_clean}/"* ]] || \
   [[ "$root_path_clean" == "." && "$FILE" == "${REPO_PATH}/"* ]]; then
  # service matched
fi
```

The relative path is anchored against the repo's absolute path (from the `repos` table). Plan 03 must join `services` with `repos` to reconstruct the absolute prefix.

---

## 4. /impact Endpoint Parameter Signature

**Method:** Read `plugins/arcanon/worker/server/http.js` lines 132-148.

**Exact route registration:**

```javascript
// 4. GET /impact?project=/path&change=endpoint — impacted services
fastify.get("/impact", async (request, reply) => {
  const qe = getQE(request);         // resolves via ?project= or ?hash=
  if (!qe) { return reply.code(503)... }
  const change = request.query.change;
  if (!change) {
    return reply.code(400).send({ error: "change param required" });
  }
  return reply.send(qe.getImpact(change));
});
```

`getQE()` reads `request.query?.project` (absolute path) to resolve the per-project QueryEngine. `change` is the service name passed to `qe.getImpact()`.

**Finding:**
- `?project=<absolute-project-root>` — selects the DB (resolved via pool.js hash)
- `?change=<service-name>` — the name of the changed service to find downstream consumers of
- Both params required. Missing `change` → 400. Missing `project` (no hash either) → 503 (no QE)

**Locked decision for Plan 03:** curl call uses URL-encoding via jq (jq is already a dependency):

```bash
local proj_q chg_q
proj_q=$(jq -rn --arg v "$PROJECT_ROOT" '$v | @uri')
chg_q=$(jq -rn --arg v "$SERVICE_NAME" '$v | @uri')
worker_call "/impact?project=${proj_q}&change=${chg_q}"
```

Do NOT use `?change=<file-path>`. The `change` param is a **service name** (e.g., `payment-service`), not a file path. The hook resolves the service name from the matched `services.name` row in Tier 2, then passes that to `/impact`.

---

## Summary Table

| # | Question | Answer | Plan that consumes it |
|---|----------|--------|----------------------|
| 1 | PreToolUse output key | `systemMessage` (exit 0 for warn) | 02 (skeleton), 03 (full payload) |
| 2 | Hash algorithm | `sha256(projectRoot) → hex → cut -c1-12`, input via `printf '%s'` | 01 (db-path.sh), 02, 03 |
| 3 | root\_path convention | Relative paths only (observed in production). Bare `.` and trailing slashes exist. Join with `repos.path` to reconstruct absolute prefix. | 03 (Tier 2 SQL match) |
| 4 | /impact signature | `GET /impact?project=<abs-path>&change=<service-name>` — change is service name, not file | 03 (consumer query) |
