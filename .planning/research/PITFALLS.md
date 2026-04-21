# Pitfalls Research

**Domain:** Claude Code plugin — v0.1.1 feature additions (update command, impact hook, SessionStart enrichment, command merge)
**Researched:** 2026-04-21
**Confidence:** HIGH (grounded in existing codebase patterns in hooks.json, file-guard.sh, worker-stop.sh)

---

## Critical Pitfalls

### Pitfall 1: Semver String Comparison in `/arcanon:update`

**What goes wrong:**
Comparing version strings with lexicographic operators (`<`, `>`, `[[ "0.10.0" > "0.9.0" ]]`) produces wrong results because `"0.10.0" < "0.9.0"` lexicographically. An installed v0.10.0 would be offered a downgrade to v0.9.0.

**Why it happens:**
Shell has no native semver comparison. Developers reach for `[[ "$installed" < "$latest" ]]` or `sort -V` without verifying macOS BSD `sort` doesn't support `-V` (it's GNU-only).

**How to avoid:**
Use the worker's Node runtime (already required) for version comparison: `node -e "const s=require('semver'); process.exit(s.gt(latest,installed)?0:1)"`. Do not shell-compare version strings. Alternatively use `sort -t. -k1,1n -k2,2n -k3,3n` as a portable fallback, but this fails on pre-release tags (e.g. `0.1.1-rc.1`).

**Warning signs:**
Bats test showing update offered when already on latest, or no update offered when behind by a minor version bump only.

**Phase to address:**
Phase implementing `/arcanon:update` version check logic. Add a dedicated bats test matrix: `0.1.0 < 0.1.1`, `0.9.0 < 0.10.0`, `1.0.0 == 1.0.0`, `2.0.0 > 1.99.99`.

---

### Pitfall 2: Worker Killed Mid-Scan During `/arcanon:update`

**What goes wrong:**
`/arcanon:update` calls `worker-stop.sh` (SIGTERM → 5s poll → SIGKILL) while the worker is mid-scan writing to its SQLite DB. A SIGKILL after 5 s leaves the DB in a partial WAL state. The new worker version starts, reads a corrupt DB, and silently produces wrong impact-map results.

**Why it happens:**
`worker-stop.sh` already has the right SIGTERM pattern, but 5 seconds is insufficient for a large-repo scan. The update command will reuse this script without considering the scan-in-progress case.

**How to avoid:**
Before stopping: query the worker's HTTP health endpoint for `{"status":"scanning"}` and either (a) wait for scan completion up to a configurable timeout, or (b) abort with a user prompt: "Scan in progress — update anyway? This will interrupt the scan." Never proceed to SIGKILL when a scan flag is set. Add a `scan_in_progress` flag file (`$DATA_DIR/scan.lock`) that the worker creates at scan start and removes at scan end, so the update script can check it without an HTTP round-trip.

**Warning signs:**
SQLite `PRAGMA integrity_check` returning errors after update. Worker log line: "database disk image is malformed."

**Phase to address:**
Phase implementing `/arcanon:update` — requires coordination with worker scan lifecycle before stop is called.

---

### Pitfall 3: PreToolUse Impact Hook Latency Kills Usability

**What goes wrong:**
Every `Write|Edit|MultiEdit` fires the hook. If the hook shells out to Node.js cold (e.g. `node impact-lookup.js`), each invocation pays ~300 ms Node startup. With a session that edits 50 files, that is 15 seconds of accumulated blocking latency. Claude Code's PreToolUse hook is synchronous — the tool call is blocked until the hook exits.

**Why it happens:**
The existing `file-guard.sh` (PreToolUse) is pure bash and exits in <5 ms. When the impact hook is added alongside it, the temptation is to call the worker's Node CLI directly from shell. The existing `hooks.json` already has `"timeout": 10` on PreToolUse hooks — exceeding that timeout causes the hook to be killed silently and the tool allowed (fail-open), making the feature invisible at scale.

**How to avoid:**
The impact hook MUST be pure bash that queries the already-running worker daemon over its local HTTP socket (e.g. `curl -s --max-time 0.5 http://localhost:$PORT/impact?file=$FILE`). The daemon has the impact-map loaded in memory — response time is <10 ms. Never spawn Node in the hot path. If the worker is not running, exit 0 silently (fail-open) rather than blocking. Keep the hook co-located with `file-guard.sh` so the 10-second timeout is a safety net, not a dependency.

**Warning signs:**
Observable pause before each edit in a session. Hook timeout errors in Claude Code debug logs. `time bash impact.sh` taking >100 ms.

**Phase to address:**
Phase implementing the PreToolUse impact hook. Benchmark requirement: p99 <50 ms including the HTTP round-trip.

---

### Pitfall 4: Recursive Self-Firing in Arcanon's Own Repo

**What goes wrong:**
When developing Arcanon itself, editing `worker/db/migrations/001_init.sql` fires the PreToolUse impact hook. The hook queries the local worker, which may have Arcanon's own repo indexed. This produces a warning: "Migration files in arcanon/worker are impacted" — which is noise at best, a blocking deny at worst if the hook is wired to block on high-severity impact.

**Why it happens:**
The hook has no self-exclusion. `file-guard.sh` avoids this because it operates on file type patterns that don't include Arcanon's own source. The impact hook operates on path membership in the indexed service graph — which includes Arcanon itself when dogfooding.

**How to avoid:**
Add an `ARCANON_DISABLE_IMPACT=1` env var (parallel to the existing `ARCANON_DISABLE_GUARD=1` pattern in `file-guard.sh`). Also: when the impact hook detects that the file being written is inside `$CLAUDE_PLUGIN_ROOT`, skip the lookup unconditionally. Document this in the hook header alongside the disable guard pattern.

**Warning signs:**
During Arcanon self-development sessions, seeing impact warnings about Arcanon's own worker migrations or source files.

**Phase to address:**
Phase implementing the PreToolUse impact hook — include self-exclusion test in bats suite.

---

### Pitfall 5: `auto_upload` → `auto_sync` Silent Config Break

**What goes wrong:**
Users with `auto_upload: true` in their `arcanon.config.json` get silent no-op behavior after upgrade — their config is no longer read, sync no longer runs automatically. No error, no warning.

**Why it happens:**
Config key is renamed but the reader only checks `auto_sync`. The old key is ignored rather than forwarded or warned about.

**How to avoid:**
For exactly one release (v0.1.1), the config reader must check both keys with precedence: `auto_sync` wins if present, else fall back to `auto_upload`. Emit a one-time deprecation warning to stderr: `"arcanon: config key 'auto_upload' is deprecated, rename to 'auto_sync'"`. In v0.2.0 the fallback can be dropped. Add a bats test asserting that a config with only `auto_upload: true` triggers the sync path and emits the deprecation warning.

**Warning signs:**
Users reporting hub sync stopped working after upgrade. CI pipelines that rely on auto-sync going silent.

**Phase to address:**
Phase implementing the command merge — config migration logic must ship in the same commit as the key rename.

---

## High-Severity Pitfalls

### Pitfall 6: Root-Path Prefix Matching Fires Spuriously

**What goes wrong:**
The impact hook checks whether the edited file falls within a service's `root_path`. If matching is done as a simple string prefix (`[[ "$FILE" == "$root_path"* ]]`), then a service rooted at `/services/auth` will spuriously match edits to `/services/auth-legacy/README.md` because the prefix `auth` is a substring of `auth-legacy`.

**Why it happens:**
Shell prefix matching does not normalize path separators. The safe check requires a trailing `/`: `[[ "$FILE" == "${root_path%/}/"* ]]`.

**How to avoid:**
Always normalize `root_path` to have a trailing slash before prefix-matching. Add a bats test with a repo that has both `services/auth/` and `services/auth-legacy/` — editing a file in `auth-legacy` must not fire an `auth` service warning.

**Warning signs:**
Impact warnings for services that share a name prefix with the file being edited. High false-positive rate causing users to disable the hook entirely.

**Phase to address:**
Phase implementing the PreToolUse impact hook.

---

### Pitfall 7: Stale Impact-Map Gives Wrong Warnings

**What goes wrong:**
The impact hook warns based on the last scan's data. If the last scan ran 3 weeks ago and the service topology changed (service removed, path relocated), the hook produces wrong warnings — either false positives for deleted services or missing warnings for newly added ones.

**Why it happens:**
The hook consults a snapshot, not a live analysis. There is no staleness signal surfaced to the user.

**How to avoid:**
The worker should record `last_scan_timestamp` in its DB. The impact hook response from the daemon should include `{"stale": true, "age_hours": 504}` when the map is older than a configurable threshold (default: 48 h). The hook should prepend the warning with `[stale map — last scanned 21d ago]` so users know to run `/arcanon:map`. The `/arcanon:update` flow should also prompt a rescan after update.

**Warning signs:**
No `last_scan_timestamp` field in worker health endpoint. Hook warnings that don't match current repo state.

**Phase to address:**
Phase implementing the PreToolUse impact hook — staleness metadata must be part of the daemon API contract from day one.

---

### Pitfall 8: SessionStart Enrichment in Every Directory Produces Noise

**What goes wrong:**
`session-start.sh` is wired as a SessionStart hook for all projects (hooks.json has no matcher). If a user opens Claude Code in a directory that has no Arcanon impact-map (e.g. a personal scripts folder), the enrichment fires and either outputs an error or empty context — both are noise.

**Why it happens:**
The existing `session-start.sh` is a stub (1 line). When enrichment logic is added, it will be tempting to always emit context. The hook fires unconditionally per `hooks.json`.

**How to avoid:**
`session-start.sh` must check for the existence of the impact-map DB (`$DATA_DIR/impact.db` or equivalent) and the worker PID file before injecting any content. If neither exists, exit 0 with no output. Only emit enrichment when there is a valid, non-empty impact-map for the current working directory.

**Warning signs:**
Error messages in sessions unrelated to Arcanon. `sessionMessage` output appearing in projects with no `arcanon.config.json`.

**Phase to address:**
Phase implementing SessionStart enrichment.

---

### Pitfall 9: Large Impact-Map (200+ Services) Produces Wall of Text

**What goes wrong:**
SessionStart injects a summary of all cross-repo impacts for the current session's working directory. A repo with 200+ indexed services produces a multi-kilobyte context injection that: (a) consumes significant context budget every session, (b) pushes other system context off the context window, (c) reads as noise rather than signal.

**Why it happens:**
Injecting the full impact list seems complete and helpful during development on a small test repo. At production scale the volume is unusable.

**How to avoid:**
Limit SessionStart injection to: (a) top-N most impacted services (default: 10, configurable via `arcanon.config.json: session_top_n`), (b) only services with impact severity >= threshold (default: "high"). Append a summary line: "...and 43 more services. Run /arcanon:map for full report." Keep total injected text under 500 tokens.

**Warning signs:**
`systemMessage` output from SessionStart exceeding 2000 characters in testing. User feedback about slow session starts or "noisy" context.

**Phase to address:**
Phase implementing SessionStart enrichment — must include a truncation test with a synthetic 200-service fixture.

---

### Pitfall 10: Marketplace Refresh Failure Blocks `/arcanon:update`

**What goes wrong:**
`/arcanon:update` fetches the latest version from a registry/marketplace endpoint. If the user is offline or the endpoint is rate-limited, the command hangs or exits with a cryptic error rather than telling the user they're already on the current known version.

**Why it happens:**
Network calls in CLI tools are often written optimistically without timeout or offline fallback.

**How to avoid:**
Set an explicit `curl --max-time 5` on the version fetch. On failure, print: "arcanon: could not reach update server (offline or rate-limited). Your current version is X.Y.Z." and exit 0 (not an error). Cache the last known latest version with a TTL (e.g. in `$DATA_DIR/last-known-version`) so repeat invocations within the TTL skip the network call.

**Warning signs:**
`/arcanon:update` hanging indefinitely in CI with no network access. No timeout in the update fetch code path.

**Phase to address:**
Phase implementing `/arcanon:update`.

---

### Pitfall 11: Post-Update Worker Fails to Start — No Recovery Path

**What goes wrong:**
After update, the new worker version has a bug (bad migration, missing dep, port conflict) and fails to start. The update command exits 0 (install succeeded), but the user has a broken plugin with no impact-map and no scan capability.

**Why it happens:**
Install success is conflated with runtime success. The update script runs `npm install` and exits without verifying the new worker actually starts.

**How to avoid:**
After install, run `worker-start.sh` and poll the health endpoint for up to 10 seconds. If the worker does not come up, print the worker log tail and offer rollback: "Update failed health check — restore previous version? [y/N]". Keep the previous version's tarball in `$DATA_DIR/rollback/` for one version. Rollback restores the tarball and restarts.

**Warning signs:**
Update script exits 0 but `worker.pid` is absent or health endpoint returns 500. No post-update health check in the update script.

**Phase to address:**
Phase implementing `/arcanon:update` — health check and rollback are non-optional for a shipped update command.

---

### Pitfall 12: Claude Code CLI Syntax Change Breaks `/arcanon:update`

**What goes wrong:**
If `claude plugin install` or `claude plugin update` command syntax changes in a future Claude Code release, the `/arcanon:update` command breaks silently or with a confusing error.

**Why it happens:**
The plugin install/update mechanism is an external CLI contract that Arcanon doesn't own. Tight coupling to a specific syntax without a version guard means any Claude Code release can silently break the feature.

**How to avoid:**
At update time, check the Claude Code CLI version with `claude --version` and validate it is within a known-compatible range. If unknown version: warn and show the manual update command instead of attempting programmatic install. Abstract the install call behind a function (`arcanon_install_plugin`) so the calling syntax is a single-point-of-change. Log the exact command being run so users can debug.

**Warning signs:**
`/arcanon:update` working in dev but breaking after a Claude Code upgrade. No version guard around the `claude plugin install` call.

**Phase to address:**
Phase implementing `/arcanon:update`.

---

## Moderate Pitfalls

### Pitfall 13: `/arcanon:upload` Stub Breaks CI Silently

**What goes wrong:**
CI pipelines or team runbooks invoking `/arcanon:upload` after the merge get a "command not found" error (exit non-zero) which fails CI. Because the merge is a renaming, not a deprecation, there is no forwarding stub.

**Why it happens:**
Command renames in plugin ecosystems often assume only interactive users. CI scripts and runbooks are not updated atomically with the plugin release.

**How to avoid:**
Keep a `/arcanon:upload` stub command that prints a deprecation warning and then invokes the `sync` logic identically. The stub must exit 0 so existing CI does not break. Add a `# DEPRECATED: remove in v0.2.0` comment. Document the rename in CHANGELOG.

**Phase to address:**
Phase implementing the command merge.

---

### Pitfall 14: `upload` vs `sync` Behavioral Mismatch

**What goes wrong:**
`/arcanon:upload` was a single-repo push. `/arcanon:sync` is a queue drain (all pending repos). If the merged command defaults to queue-drain behavior, users who invoked `upload` expecting single-repo behavior will push stale data for unrelated repos.

**Why it happens:**
Merging two commands with different scopes without making the scope explicit. "sync" implies broader scope than "upload."

**How to avoid:**
Make the default behavior of `/arcanon:sync` match the safer (narrower) scope: sync only the current repo unless `--all` is passed. Document this explicitly. The stub `/arcanon:upload` should call `/arcanon:sync` without `--all` to preserve prior behavior.

**Phase to address:**
Phase implementing the command merge.

---

### Pitfall 15: Context Injection Format Collision With Other Hooks

**What goes wrong:**
Both the SessionStart hook and a third-party plugin emit `systemMessage` JSON. Claude Code merges them or only uses the last one — exact merge behavior is undocumented. The impact enrichment may be silently dropped if another hook's output overwrites it.

**Why it happens:**
Multiple hooks registered for SessionStart/UserPromptSubmit interact in ways that depend on undocumented Claude Code internals.

**How to avoid:**
Verify via a test Claude Code session that multiple `systemMessage` outputs from the same hook event are concatenated (not last-wins). If last-wins, register the impact enrichment as a separate hook entry with higher priority. Keep the enrichment output clearly prefixed (`"Arcanon impact context: ..."`) so it survives any merging.

**Warning signs:**
SessionStart enrichment not appearing in Claude context despite the hook firing successfully (visible in debug logs).

**Phase to address:**
Phase implementing SessionStart enrichment.

---

### Pitfall 16: PreToolUse Hook Invisible in Transcripts — Debugging Blind Spot

**What goes wrong:**
When the impact hook fires but does not warn (correct behavior for a clean edit), there is no trace in the Claude Code transcript. When it should warn but doesn't (bug), developers have no visibility into whether the hook ran, what file path it received, or what the worker returned.

**Why it happens:**
PreToolUse hooks that exit 0 with no stdout leave no transcript footprint. The hook is a black box from the user's perspective.

**How to avoid:**
Add an `ARCANON_IMPACT_DEBUG=1` env var that causes the hook to write a one-line JSON trace to `$DATA_DIR/logs/impact-hook.jsonl` on every invocation (file_path, worker_response, exit_code, duration_ms). The debug log is off by default (no performance overhead). For test verification, assert on this log file in bats rather than relying on stdout capture.

**Phase to address:**
Phase implementing the PreToolUse impact hook — debug logging must be part of the initial implementation, not retrofitted.

---

### Pitfall 17: Cache Dir Pruning Race During Update

**What goes wrong:**
`/arcanon:update` deletes an old version's cached files while another process (a concurrent scan or MCP wrapper) holds file descriptors open in that directory. On Linux, the directory entry is unlinked but the FDs remain valid until closed — the other process continues reading stale data. On macOS, behavior is the same. The real risk is if the update moves a SQLite DB file while the worker has it open: SQLite WAL mode requires the WAL and SHM files to be co-located — moving just the main DB file corrupts the WAL chain.

**How to avoid:**
Never move or delete the active DB files during an update. The update sequence must be: stop worker → install new version → start worker (which migrates in place). Do not maintain multiple version dirs for the DB; only plugin source code should be versioned. The DB lives in `$DATA_DIR` (user data dir), not inside the plugin source tree.

**Phase to address:**
Phase implementing `/arcanon:update`.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Shell string comparison for semver | No dep needed | Wrong results on minor/major bumps | Never |
| Calling Node in PreToolUse hot path | Simple code | 300 ms per edit, unusable at scale | Never |
| No deprecation stub for `/arcanon:upload` | Less code | CI breaks across user installs silently | Never |
| Injecting full impact-map in SessionStart | Complete info | Context budget exhaustion at scale | Never in production |
| Skip post-update health check | Simpler update script | Silent broken installs | Never for shipped feature |
| No `ARCANON_IMPACT_DEBUG` logging | Less code | Hook impossible to debug in production | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code PreToolUse hook | Spawning Node process per invocation | Query running worker daemon over local HTTP |
| Claude Code SessionStart hook | Assuming single hook output wins | Verify multi-hook merge behavior; prefix all output |
| Claude Code `claude plugin install` CLI | Hardcoding syntax without version guard | Abstract behind a function; check CLI version first |
| Worker SQLite DB | Moving DB files during update | Stop worker first; DB stays in `$DATA_DIR`, never in plugin src |
| Config key migration | Only reading new key name | Read both keys for one release with explicit deprecation warning |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Node cold-start in PreToolUse | >300 ms per edit, 10s timeout hit | Pure-bash hook + HTTP to daemon | Immediately on first file edit |
| Full impact-map in SessionStart | >2000 char systemMessage, context budget consumed | Top-N + severity filter + truncation | Repos with >50 indexed services |
| No HTTP timeout in impact hook | Hook hangs if worker is unresponsive | `curl --max-time 0.5`, fail-open on timeout | Any session where worker crashes |
| No staleness guard on impact-map | Wrong warnings after topology changes | Include `age_hours` in daemon response, surface in warning | Repos where services are added/removed frequently |

---

## "Looks Done But Isn't" Checklist

- [ ] **`/arcanon:update` version compare:** Tested with `0.9.x` vs `0.10.x` — not just patch-level bumps
- [ ] **`/arcanon:update` post-install:** Worker health check passes before reporting success
- [ ] **PreToolUse impact hook:** Benchmarked at p99 <50 ms with worker running
- [ ] **PreToolUse self-exclusion:** Editing Arcanon's own source does not fire impact warning
- [ ] **Prefix matching:** `services/auth-legacy/` does not match `services/auth/` root_path
- [ ] **SessionStart silence:** No output when no impact-map exists for current directory
- [ ] **`auto_upload` fallback:** Config with only `auto_upload: true` still triggers sync in v0.1.1
- [ ] **`/arcanon:upload` stub:** Deprecated command exits 0 and forwards to sync logic
- [ ] **Rollback tarball:** Previous version preserved in `$DATA_DIR/rollback/` after update

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Corrupt DB after mid-scan SIGKILL | MEDIUM | `PRAGMA integrity_check`; if corrupt, delete DB and rescan |
| New worker fails to start post-update | MEDIUM | Restore rollback tarball, restart old worker, report error |
| Stale impact-map producing wrong warnings | LOW | Run `/arcanon:map` to rescan; map is regenerated non-destructively |
| `auto_upload` config silently ignored | LOW | Rename key in config; one-line fix |
| PreToolUse hook hitting 10s timeout | LOW | Set `ARCANON_DISABLE_IMPACT=1` while debugging; check worker health |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Semver string compare | `/arcanon:update` implementation | Bats matrix: 0.9.0 vs 0.10.0 |
| Worker killed mid-scan | `/arcanon:update` implementation | Bats: scan.lock present → update waits |
| PreToolUse Node cold-start | Impact hook implementation | Benchmark: p99 <50 ms |
| Recursive self-firing | Impact hook implementation | Bats: edit in PLUGIN_ROOT → no warning |
| Root-path prefix false positive | Impact hook implementation | Bats: auth vs auth-legacy fixture |
| Stale map wrong warnings | Impact hook implementation | Daemon API includes age_hours |
| `auto_upload` silent break | Command merge | Bats: legacy config triggers sync + deprecation warning |
| `/arcanon:upload` CI break | Command merge | Bats: stub exits 0 and calls sync |
| Upload vs sync scope mismatch | Command merge | Manual test: sync without --all only touches current repo |
| SessionStart noise in non-Arcanon dirs | SessionStart enrichment | Bats: no impact.db → empty output |
| Large map wall of text | SessionStart enrichment | Bats: 200-service fixture → output <500 tokens |
| Context injection collision | SessionStart enrichment | Live test: two hooks both emit systemMessage |
| Marketplace refresh failure | `/arcanon:update` implementation | Test: update with no network → graceful message + exit 0 |
| Post-update worker failure | `/arcanon:update` implementation | Bats: bad worker binary → rollback offered |
| CLI syntax change | `/arcanon:update` implementation | Version guard + manual install fallback |
| Cache dir pruning race | `/arcanon:update` implementation | DB stays in DATA_DIR; never in plugin src |
| Hook invisible in transcripts | Impact hook implementation | ARCANON_IMPACT_DEBUG=1 log written on every invocation |

---

## Sources

- Codebase: `plugins/arcanon/hooks/hooks.json` — existing hook wiring, timeout values, event matchers
- Codebase: `plugins/arcanon/scripts/file-guard.sh` — PreToolUse pattern, exit-code contract, disable-guard env var pattern
- Codebase: `plugins/arcanon/scripts/worker-stop.sh` — SIGTERM/SIGKILL graceful stop, 5s poll pattern
- Codebase: `plugins/arcanon/scripts/hub.sh` — Node invocation pattern, thin wrapper approach
- Codebase: `plugins/arcanon/scripts/session-start.sh` — stub (1 line), wired to both SessionStart and UserPromptSubmit
- Domain knowledge: SQLite WAL mode behavior during concurrent file operations
- Domain knowledge: Node.js cold-start latency (~300 ms on typical hardware)
- Domain knowledge: Shell glob prefix matching without trailing-slash normalization

---
*Pitfalls research for: Arcanon plugin v0.1.1 milestone*
*Researched: 2026-04-21*
