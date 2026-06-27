# Command reference

Every `/arcanon:*` command, what it does, and its exit-code contract.

Every command supports `--help`, `-h`, or `help` to print usage with examples — extracted from the command's own `## Help` section so the in-source documentation is the single source of truth.

## Scanning

### `/arcanon:map [view|full]`

Scan linked repos and (re)build the local service graph.

- No argument → incremental scan when possible, full otherwise.
- `view` → open the local graph UI without scanning.
- `full` → force a full re-scan (asks before discarding prior data when one exists).

Side effects: writes to `~/.arcanon/projects/<hash>/impact-map.db`. With `hub.auto-upload: true` + credentials, also POSTs to the hub.

### `/arcanon:rescan <repo-path-or-name>`

Re-scan exactly **one** linked repo. Other repos in the project are byte-untouched. Always full mode — bypasses the incremental change-detection skip. Pending `scan_overrides` for that repo are applied during the rescan via the apply-hook (see `/arcanon:correct`).

Resolves the repo by absolute or relative path, or by `repos.name` (basename); friendly disambiguation on multi-match.

---

## Read-only navigation

### `/arcanon:list`

5-line project overview: linked repos count, services partitioned by type, connection counts by confidence (high / medium / low), external actors with friendly labels, hub sync status. Silent in non-Arcanon directories. `--json` for machine consumption.

### `/arcanon:view`

Top-level alias for `/arcanon:map view` — opens the graph UI in your default browser. Auto-starts the worker if it isn't running.

### `/arcanon:doctor`

Eight smoke-test diagnostics with PASS / WARN / FAIL / SKIP per check and structured exit codes (`0` = all pass or only non-critical WARN; `1` = critical FAIL). Critical: worker reachable, data dir writable, DB integrity (`PRAGMA quick_check`). Non-critical: version match, schema head (computed dynamically from the migrations directory), config + linked repos, MCP smoke (server starts cleanly without crashing on import), hub credentials. Read-only — uses an isolated read-only SQLite connection that does not touch the worker's process-cached DB pool. `--json` for machine consumption.

### `/arcanon:diff <scanA> <scanB> [--json]`

Compare any two scan versions. Accepts integer scan IDs, `HEAD` / `HEAD~N` shorthand, ISO 8601 timestamps, or branch names (resolves via `repo_state.last_scanned_commit`). Reports services + connections added / removed / modified.

Read-only via direct SQLite read (no worker required). Same-DB diff detects added / removed only — production schema's `UNIQUE` constraints prevent a true modify across two scan IDs in one DB.

---

## Scan corrections

### `/arcanon:correct <kind> --action <action> [flags]`

Stage a correction to the next scan via the `scan_overrides` table. The override is queued (`created_by='cli'`), not applied — the next `/arcanon:map` or `/arcanon:rescan` consumes it via the apply-hook between `persistFindings` and `endScan`.

| Kind         | Actions                       |
|--------------|-------------------------------|
| `connection` | `delete`, `update`            |
| `service`    | `rename`, `set-base-path`     |

Re-application is idempotent — once applied, the override row is stamped with `applied_in_scan_version_id`.

---

## Verification

### `/arcanon:verify [--source <pattern>] [--connection <id>]`

Re-read source files at the cited line ranges and confirm each connection's evidence still matches. Reports per-connection verdicts: `ok`, `moved`, `missing`, or `method_mismatch`. Read-only — does not mutate the DB.

Useful for catching code drift since the last scan. Pair with `/arcanon:correct` (stage fixes) + `/arcanon:rescan` (consume) to repair flagged connections.

---

## Hub sync

### `/arcanon:login [arc_…]`

Store an API key in `~/.arcanon/config.json` (mode `0600`). Prompts interactively when no argument is supplied. Keys are issued exclusively through the web dashboard at https://app.arcanon.dev/settings/api-keys — the hub exposes no programmatic login flow (no device-code, no OAuth).

To check whether credentials are stored, run `/arcanon:status`. To validate that a key actually works, run `/arcanon:sync` — 401/403 indicates a bad key.

### `/arcanon:sync [--drain] [--repo <path>] [--dry-run] [--force] [--offline]`

Reconcile local scans with Arcanon Hub. Default behavior (no flags): upload the current repo's latest scan, then drain the offline queue.

| Flag         | Effect                                                                  |
|--------------|-------------------------------------------------------------------------|
| `--drain`    | Drain the offline queue only; skip uploading the current repo's scan.   |
| `--repo`     | Upload a specific repo's latest scan (relative or absolute path).       |
| `--dry-run`  | Print what would happen; make no network calls or DB writes.            |
| `--force`    | Ignore staleness checks and re-upload.                                  |
| `--offline`  | Step 0.5 short-circuit; persist scan locally, no hub call. Exits `0`.   |

Differentiates intentional offline (clean exit `0`) from hub-unreachable.

### `/arcanon:status`

Single-screen health: plugin version, config file path, project slug, credential presence, auto-sync flag, queue stats, data dir. Now also includes per-repo git-commits-since-scan (driven by `git rev-list --count <last_scanned_sha>..HEAD`) and per-repo scan freshness via the `/api/scan-freshness` worker endpoint.

---

## Drift

### `/arcanon:drift [graph|versions|types|openapi] [--all] [--spec <path>]`

- `graph` — diff the two most recent scan snapshots.
- `versions` — cross-repo dependency version drift across **8 ecosystems**: npm (`package.json` + `package-lock.json`), PyPI (`pyproject.toml` PEP 621 + Poetry + `requirements.txt`), Go (`go.mod` + `go.sum`), Cargo (`Cargo.toml` + `Cargo.lock`), Maven (`pom.xml` with `<parent>` inheritance + `<dependencyManagement>` resolution), Gradle (`build.gradle` + `build.gradle.kts` + `gradle/libs.versions.toml` catalog), NuGet (`*.csproj` + `Directory.Packages.props` Central Package Management), and Bundler (`Gemfile.lock` GEM/GIT/PATH sections).
- `types` — shared type / interface drift across same-language repos. Supports TypeScript / JavaScript, Python, Go, Rust, Java, C#, Ruby.
- `openapi` — OpenAPI spec diff via `oasdiff` when available, with a `yq` structural fallback. Supports `--spec <path>` (repeatable) for explicit two-spec mode that bypasses auto-discovery; otherwise discovers OpenAPI specs in linked repos.

Routed through the unified `scripts/drift.sh` dispatcher; reserved slots for `licenses` and `security` exist but are not yet implemented.

With no subcommand, runs all four and groups output by severity (`CRITICAL`, `WARN`, `INFO`). `--all` shows `INFO` lines too.

---

## Impact

### `/arcanon:impact <target> [--direction downstream|upstream] [--hops N]`

Cross-repo impact query. Answers *"If I change this, what breaks?"*.

- `<target>` → service name, endpoint path, or schema name.
- `--direction downstream` *(default)* → what does `<target>` affect?
- `--direction upstream` → what affects `<target>`?
- `--hops N` *(default 3)* → transitive traversal depth.

Prefers the MCP tool (`mcp__arcanon__impact`), falls back to the HTTP worker endpoint.

---

## Export

### `/arcanon:export [--format mermaid|dot|json|html|all] [--out <dir>]`

Emit the local service graph. The HTML output is a single self-contained page backed by cytoscape.js + fcose layout — open it in any browser without a server.

Defaults: `--format all`, `--out .arcanon/reports/<timestamp>/`.

---

## Maintenance

### `/arcanon:update [--check] [--kill] [--prune-cache] [--verify]`

Plugin maintenance — version checks, worker lifecycle, and cache hygiene.

- `--check` *(default when no flag)* — print install vs latest version + status (`equal` / `newer` / `older` / `offline`); exits `0` regardless of result. `--check` plus a newer release additionally prints a brief changelog preview and `update_available=true` in JSON mode.
- `--kill` — send `SIGTERM` to the running worker (if any) and clean up `worker.pid` + `worker.port`. Refuses if `scan.lock` shows an active scan with a live PID.
- `--prune-cache` — delete cached non-current version directories, skipping any with active file handles.
- `--verify` — start the worker, confirm version match against the manifest, exit `0` on success or timeout.

---

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Command-level error (missing scan, bad input, hub failure) |
| `2` | Usage error (wrong subcommand, missing required arg, repo not found, repo name ambiguous) |
| `127` | Missing system dependency (Node, jq, git) |

Most read-only commands (`list`, `diff`, `correct`, `rescan`, `doctor`) silently exit `0` with no output when invoked from a directory without an `impact-map.db`, so they don't pollute non-Arcanon shells.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ARCANON_API_KEY` | Bearer token for the hub (starts with `arc_`). |
| `ARCANON_API_TOKEN` | Alias for `ARCANON_API_KEY` (preferred by CI vendors). |
| `ARCANON_HUB_URL` | Override the hub URL (default `https://api.arcanon.dev`). |
| `ARCANON_DATA_DIR` | Override `~/.arcanon/`. |
| `ARCANON_DISABLE_SESSION_START` | Silence the session-start banner. |
| `ARCANON_DISABLE_HOOK` | Silence the impact hook entirely (PreToolUse). |
| `ARCANON_LOG_LEVEL` | Worker log verbosity: `DEBUG` / `INFO` / `WARN` / `ERROR`. |
| `ARCANON_WORKER_PORT` | Override the worker HTTP port (default `37888`). |
