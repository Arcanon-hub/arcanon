# Hub integration reference

How the Arcanon plugin talks to Arcanon Hub (`api.arcanon.dev`).

## Endpoint contract

```
POST {hub_url}/api/v1/scans/upload
Authorization: Bearer arc_<key>
Content-Type: application/json
```

Request body shape (`ScanPayloadV1`):

```jsonc
{
  "version": "1.0",
  "metadata": {
    "tool": "claude-code",          // enum: claude-code | copilot | cursor | cli | unknown
    "tool_version": "0.1.0",
    "scan_mode": "full",            // "full" | "incremental"
    "repo_url": "git@github.com:org/repo.git",
    "repo_name": "repo",            // required
    "branch": "main",
    "commit_sha": "abc123...",      // required — dedup key
    "started_at": "2026-04-18T07:00:00.000Z",
    "completed_at": "2026-04-18T07:00:42.117Z",
    "files_scanned": 412,
    "project_slug": "my-project"    // required for org-scoped keys
  },
  "findings": {
    "services":    [ /* { name, language, root_path, type, … } */ ],
    "connections": [ /* { source, target, protocol, method, path, … } */ ],
    "schemas":     [ /* … */ ],
    "actors":      [ /* … */ ]
  }
}
```

### Payload v1.1 — library dependencies (opt-in)

When the `hub.beta_features.library_deps` config flag is enabled **and** at
least one scanned service has persisted dependencies, the plugin emits
`version: "1.1"` with a per-service `dependencies` array derived from the
`service_dependencies` table:

```jsonc
{
  "version": "1.1",
  "metadata": { /* unchanged */ },
  "findings": {
    "services": [
      {
        "name": "api",
        "dependencies": [
          {
            "ecosystem": "maven",           // npm | pypi | go | cargo | maven | nuget | rubygems
            "package_name": "org.springframework.boot:spring-boot-starter-web",
            "version_spec": "3.2.1",
            "resolved_version": "3.2.1",    // from lockfile when available; null otherwise
            "manifest_file": "pom.xml",
            "dep_kind": "direct"            // "direct" | "transient" (only "direct" emitted in 0.1.0)
          }
        ]
      }
    ],
    "connections": [ /* … */ ],
    "schemas":     [ /* … */ ],
    "actors":      [ /* … */ ]
  }
}
```

Back-compat contract:

- Flag **off** (default) → always `version: "1.0"`, no `dependencies` key.
- Flag **on** with every service having empty deps → falls back to
  `version: "1.0"`.
- Flag **on** with at least one populated `dependencies` array → `version: "1.1"`.

Production deps only; `devDependencies` (npm), `test` scope (Maven), and
`python` key (PyPI) are explicitly excluded from persistence. The v1.1
payload is gated behind the feature flag until the hub side of the
`service_dependencies` resolver ships.

Response codes the plugin reacts to:

| Status | Meaning | Plugin behavior |
| --- | --- | --- |
| 202 | Accepted — scan queued on hub side | success; `scan_upload_id` surfaced |
| 409 | Idempotent duplicate for same `(org, repo, commit_sha)` | treated as success |
| 400 | Project lookup failed or `project_slug` missing on org-scoped key | fail fast with user-facing error |
| 401 | Missing or invalid API key, or JWT sent | fail fast, suggest `/arcanon:login` |
| 413 | Payload > 10 MB | plugin refuses to send (local guard matches) |
| 422 | Pydantic validation error | fail fast, surface payload warnings |
| 429 | Rate limit (50 uploads/org/minute) | retry honoring `Retry-After` |
| 5xx / network | Infra error | retry 3× with exponential backoff, then enqueue |

## Credentials

Precedence (first hit wins):

1. `--api-key` flag to `/arcanon:upload` / `scripts/hub.sh`
2. `$ARCANON_API_KEY` environment variable
3. `$ARCANON_API_TOKEN` (alias for CI env ergonomics)
4. `~/.arcanon/config.json` → `api_key`
5. `~/.ligamen/config.json` → `api_key` *(legacy)*

`/arcanon:login` writes `~/.arcanon/config.json` with mode `0600`.

## Hub URL

1. `--hub-url` flag
2. `$ARCANON_HUB_URL`
3. `~/.arcanon/config.json` → `hub_url`
4. Default: `https://api.arcanon.dev`

## Offline queue

When an upload fails with a retriable error (5xx, network exhaustion,
429 after exhaustion), the serialized payload is enqueued at
`<data-dir>/hub-queue.db` with a dedup key of `(repo_name, commit_sha)`.

Retry schedule (seconds): `30, 120, 600, 3600, 21600`. After
`MAX_ATTEMPTS = 5`, the row transitions to `status = 'dead'` and stops
retrying — surface via `/arcanon:status`.

`/arcanon:sync` drains all rows whose `next_attempt_at` has arrived,
oldest first. Max 50 rows per drain (configurable with `--limit`).

## Auto-upload

Set in `arcanon.config.json`:

```json
{ "hub": { "auto-upload": true } }
```

When enabled *and* credentials exist, `/arcanon:map` uploads after every
scan via the module-level `syncFindings()` call in
`plugins/arcanon/worker/scan/manager.js`. A hub failure never fails the
scan — the findings are persisted locally first, then enqueued for retry.

## Payload reconciliation

The plugin's internal findings shape is slightly broader than
`ScanPayloadV1`. The `buildScanPayload()` function
([payload.js](../plugins/arcanon/worker/hub-sync/payload.js)) bridges the gap:

- Drops any `connection` whose `source` field doesn't match a known
  service name. The hub's Pydantic validator 422s on orphan connections,
  so we filter proactively and return the dropped list as warnings.
- Fills in sensible defaults (`root_path = "."`, `language = "unknown"`,
  `type = "service"`) so optional fields from the scanner don't trigger
  hub-side 422s.
- Derives `repo_url`, `branch`, `commit_sha` from `git` commands in the
  repo directory — each field is nullable and the hub only requires
  `commit_sha`.
- Enforces the 10 MB payload limit locally before sending.

## Observability

Upload outcomes are logged through the scan manager's `slog()` helper
with `"hub-sync: "` prefix, so they appear in the worker log at
`<data-dir>/logs/worker-*.log`.

## Security notes

- API keys are hashed (SHA-256) server-side. Plaintext lives only on the
  machine that generated it.
- `~/.arcanon/config.json` is created mode `0600` (POSIX).
- Never commit API keys. Add `arcanon.config.json` secrets to `.gitignore`
  if you ever inline `api_key` there (the plugin does **not** read keys
  from the repo-local config by design).

## Standalone CLI

Outside Claude Code (e.g., in CI) you can call the Node CLI directly:

```bash
node plugins/arcanon/worker/cli/hub.js status --json
node plugins/arcanon/worker/cli/hub.js upload --repo /path/to/repo --api-key arc_...
node plugins/arcanon/worker/cli/hub.js sync --limit 100
```

All subcommands accept `--json` for machine-readable output.
