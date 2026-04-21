# Requirements: Arcanon v0.1.1 — Command Cleanup + Update + Ambient Hooks

**Defined:** 2026-04-21
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

**Milestone intent:** Tighten command surface, add self-update flow, make Arcanon's cross-repo impact awareness ambient during implementation.

## v1 Requirements (Milestone v0.1.1)

### Command Cleanup (CLN)

Remove legacy surface, merge redundant commands, migrate config key.

- [x] **CLN-01
**: `/arcanon:cross-impact` command removed (file `commands/cross-impact.md` deleted)
- [x] **CLN-02
**: Banner / doc references to `/arcanon:cross-impact` removed from `scripts/session-start.sh`, `README.md`, `docs/commands.md`
- [x] **CLN-03
**: `/arcanon:sync` absorbs `/arcanon:upload` semantics; supports `--drain` (queue only), `--repo <path>`, `--dry-run`, `--force` flags
- [x] **CLN-04
**: Default `/arcanon:sync` with no flags does upload-then-drain (push current repo's latest scan, then drain queue)
- [x] **CLN-05
**: `/arcanon:upload` kept for one version as deprecated stub that forwards to `/arcanon:sync` with a stderr deprecation warning
- [x] **CLN-06
**: Plugin config rename `auto_upload` → `auto_sync` in `.claude-plugin/plugin.json` userConfig
- [x] **CLN-07
**: Worker `hub.js` line 114 + `manager.js` line 55 use two-read pattern `cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]`
- [x] **CLN-08
**: Deprecation warning emitted to stderr when legacy `auto-upload` key is read
- [x] **CLN-09
**: bats regression test — existing commands still work (`/arcanon:map`, `/arcanon:drift`, `/arcanon:impact`, `/arcanon:sync`, `/arcanon:login`, `/arcanon:status`, `/arcanon:export`)
- [x] **CLN-10
**: `/arcanon:impact` absorbs cross-impact's `--exclude <repo>` flag (can be repeated to exclude multiple repos from results) — matches flag parity flagged by review point #8
- [x] **CLN-11
**: `/arcanon:impact --changed` flag (no positional target required) auto-detects changed symbols from uncommitted `git diff` and queries impact for each — absorbs cross-impact's primary use case
- [x] **CLN-12
**: `/arcanon:impact` has 3-state degradation model inherited from cross-impact: (A) no worker → grep-based legacy fallback; (B) worker up, no map data → prompt to run /arcanon:map, then grep fallback as partial answer; (C) worker up, map has data → graph query flow
- [x] **CLN-13**: Phase 97 delete-cross-impact task (CLN-01) must run AFTER merge task (CLN-10
..12) — ensures no regression in feature set during the deletion. bats test: `/arcanon:impact --exclude X` and `/arcanon:impact --changed` work BEFORE `commands/cross-impact.md` is deleted.

### Update Command (UPD)

New `/arcanon:update` command for clean self-update flow.

- [x] **UPD-01
**: `/arcanon:update` checks installed version (read `.claude-plugin/plugin.json` at plugin root) vs remote version (after `claude plugin marketplace update arcanon`, read `~/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json`)
- [x] **UPD-02
**: Version comparison uses `node -e "const s=require('semver'); process.exit(s.gt(remote,installed)?0:1)"` — NOT shell string comparison
- [x] **UPD-03
**: When up-to-date, command exits 0 with "Arcanon v{version} is the latest release." message
- [x] **UPD-04
**: When newer available, command prints 2-4 CHANGELOG lines from the remote `CHANGELOG.md` Unreleased / latest section
- [x] **UPD-05
**: Command asks for confirmation (default No) via user prompt before applying update
- [x] **UPD-06
**: On confirmation, command runs `claude plugin update arcanon --scope user` to trigger reinstall
- [x] **UPD-07
**: Before killing worker, command checks `$ARCANON_DATA_DIR/scan.lock` OR worker HTTP `/api/status` for active scan — aborts with user prompt if scan in progress
- [x] **UPD-08
**: Worker kill uses kill-only semantics (SIGTERM → 5s wait → SIGKILL), NOT `restart_worker_if_stale` (which restarts the old binary)
- [ ] **UPD-09**: Old cache version dirs pruned from `~/.claude/plugins/cache/arcanon/arcanon/` after verifying no active `lsof` locks on files
- [ ] **UPD-10**: Post-update health poll: GET `/api/version` for up to 10s; confirm version matches target
- [x] **UPD-11
**: On offline / rate-limited marketplace fetch (`curl --max-time 5` fails), command exits 0 with "could not reach update server, current version is X.Y.Z"
- [ ] **UPD-12**: Final message tells user "Restart Claude Code to activate v{newver}" (session-restart is required for new commands/hooks to load)
- [x] **UPD-13
**: bats test matrix for semver comparison (`0.9.0 < 0.10.0`, `0.1.0 < 0.1.1`, `1.0.0 == 1.0.0`)

### SessionStart Enrichment (SSE)

Extend existing `session-start.sh` with impact-map context when available.

- [ ] **SSE-01**: When `impact-map.db` exists for the current project AND is < 7 days old AND worker is up, inject enrichment suffix to the session banner
- [ ] **SSE-02**: Enrichment string capped at ~120-200 chars: "N services mapped. K load-bearing files. Last scan: date. Hub: status."
- [ ] **SSE-03**: Staleness guard: prepend `[stale map — last scanned Xd ago]` when scan age > 48h (but still within the 7-day window)
- [ ] **SSE-04**: On any error (db missing, worker down, query timeout > 200ms) fall back silently to existing minimal banner — never break the session
- [ ] **SSE-05**: Inject ONLY when an impact-map exists — NOT in directories where Arcanon has never scanned
- [ ] **SSE-06**: Total SessionStart overhead stays under 200ms (three sqlite3 CLI queries + one `hub.sh status` call)
- [ ] **SSE-07**: bats test with fixture impact-map.db: verifies fresh map → full enrichment, stale map → prefixed warning, missing map → silent fallback

### PreToolUse Impact Hook (HOK)

Ambient protection when Claude Edit/Writes service-load-bearing files.

- [ ] **HOK-01**: New `hooks/hooks.json` entry registers `scripts/impact-hook.sh` on PreToolUse matcher `Edit|Write` AFTER the existing `file-guard.sh` entry
- [ ] **HOK-02**: Hook implements two-tier file classification:
  - **Tier 1** (pure bash, ~0ms): file matches `*.proto`, `openapi.yaml|yml|json`, `swagger.yaml|yml|json`
  - **Tier 2** (SQLite prefix match, ~5-15ms): file path starts with any `services.root_path` value from impact-map.db
- [ ] **HOK-03**: `root_path` prefix match must normalize trailing slashes: `[[ "$FILE" == "${root_path%/}/"* ]]` — prevents `services/auth` falsely matching `services/auth-legacy`
- [ ] **HOK-04**: When file classified as service-load-bearing, hook queries consumer count via worker HTTP `GET /impact?change=<service>` (fall back to direct SQLite if worker down)
- [ ] **HOK-05**: Hook output format: `{"systemMessage": "Arcanon: <service> has N consumers: svc-a, svc-b, svc-c. Run /arcanon:impact for details."}` + exit 0 (warn-only, never block)
- [ ] **HOK-06**: NO Node cold-start in hot path — hook is pure bash + curl + sqlite3 CLI. p99 latency < 50ms (bats-benchmarked).
- [ ] **HOK-07**: Self-exclusion: hook exits 0 silently when edited file is inside `$CLAUDE_PLUGIN_ROOT` (prevents hook-storm when developing Arcanon itself)
- [ ] **HOK-08**: Staleness signal in warning text: prepend `[stale map — scanned Xd ago]` when impact-map is > 48h old
- [ ] **HOK-09**: On any error (db missing, worker down, query timeout), hook exits 0 silently — NEVER blocks an edit
- [ ] **HOK-10**: `ARCANON_IMPACT_DEBUG=1` env var writes one-line JSONL trace per fire to `$DATA_DIR/logs/impact-hook.jsonl` with `{ts, file, classified, service, consumer_count, latency_ms}`
- [ ] **HOK-11**: `ARCANON_DISABLE_HOOK=1` env var short-circuits the hook (exits 0 silently) — escape hatch for users who don't want the ambient warnings
- [ ] **HOK-12**: New `lib/db-path.sh` helper that resolves per-project DB path from CWD using the exact same hash algorithm as `worker/lib/data-dir.js`
- [ ] **HOK-13**: bats test fixtures:
  - Tier 1 match (edit `*.proto` → hook fires with warning)
  - Tier 2 match (edit file inside a tracked service's root_path → hook fires)
  - False-positive guard (`auth-legacy` does NOT fire when `auth` service exists)
  - Self-exclusion (edit inside `$CLAUDE_PLUGIN_ROOT` → silent exit)
  - Worker-down fallback (SQLite direct query path works)
  - Latency benchmark (p99 < 50ms)

## v2 Requirements (Deferred)

### Skills layer (v0.2.0)

- **SKL-V2-01**: `arcanon:check-impact` skill — auto-triggers on "what depends on X" phrasing
- **SKL-V2-02**: `arcanon:interpret-drift` skill — teaches CRITICAL/WARN/INFO interpretation
- **SKL-V2-03**: `arcanon:impact-awareness` skill — pairs with PreToolUse hook output
- **SKL-V2-04**: Rename existing `skills/impact` → `skills/build-map` (fixes naming inconsistency)

### Agent layer (v0.2.0 or later)

- **AGT-V2-01**: `arcanon-impact-investigator` agent — deep cross-repo investigation with MCP tool composition + source reading
- **AGT-V2-02**: `arcanon-scanner` agent — refactor inline Explore calls in `commands/map.md`

### Hook enhancements (post-v0.2.0)

- **HOK-V2-01**: `permissionDecision: "ask"` blocking (gated on GH #13339 + #37420 resolution)
- **HOK-V2-02**: Consumer-count threshold blocking (block when > N consumers; warn otherwise)
- **HOK-V2-03**: Auto-update-on-session-start toggle

## Out of Scope

Explicit exclusions for v0.1.1.

| Feature | Reason |
|---------|--------|
| Any skills | Defer to v0.2.0 — ship hooks first, observe real firing behavior, then design skills on top |
| Any agents | Defer to v0.2.0 — see skills reasoning |
| `/arcanon:rollback` command | Plugin dir is a git clone; `git checkout <sha>` is the documented recovery path |
| Hard-block PreToolUse (exit 2) | Anti-feature: kills agentic multi-file refactors and hits known VS Code bug (GH #13339) |
| Auto-update-on-session-start | Users should know when plugin changes its own hook behavior; explicit confirmation only |
| Full CHANGELOG diff in update | Saturates context; 2-4 line summary is enough |
| Claude plugin update via filesystem (bypass CLI) | No equivalent filesystem operation exists for marketplace refresh + reinstall |
| Legacy Ligamen v5.x env var / data dir removal | `LIGAMEN_*` and `~/.ligamen/` fallbacks stay for back-compat |

## Traceability

Populated by gsd-roadmapper during ROADMAP.md creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLN-01 | 97 | Pending |
| CLN-02 | 97 | Pending |
| CLN-03 | 97 | Pending |
| CLN-04 | 97 | Pending |
| CLN-05 | 97 | Pending |
| CLN-06 | 97 | Pending |
| CLN-07 | 97 | Pending |
| CLN-08 | 97 | Pending |
| CLN-09 | 97 | Pending |
| CLN-10 | 97 | Pending |
| CLN-11 | 97 | Pending |
| CLN-12 | 97 | Pending |
| CLN-13 | 97 | Pending |
| UPD-01 | 98 | Pending |
| UPD-02 | 98 | Pending |
| UPD-03 | 98 | Pending |
| UPD-04 | 98 | Pending |
| UPD-05 | 98 | Pending |
| UPD-06 | 98 | Pending |
| UPD-07 | 98 | Pending |
| UPD-08 | 98 | Pending |
| UPD-09 | 98 | Pending |
| UPD-10 | 98 | Pending |
| UPD-11 | 98 | Pending |
| UPD-12 | 98 | Pending |
| UPD-13 | 98 | Pending |
| SSE-01 | 99 | Pending |
| SSE-02 | 99 | Pending |
| SSE-03 | 99 | Pending |
| SSE-04 | 99 | Pending |
| SSE-05 | 99 | Pending |
| SSE-06 | 99 | Pending |
| SSE-07 | 99 | Pending |
| HOK-01 | 100 | Pending |
| HOK-02 | 100 | Pending |
| HOK-03 | 100 | Pending |
| HOK-04 | 100 | Pending |
| HOK-05 | 100 | Pending |
| HOK-06 | 100 | Pending |
| HOK-07 | 100 | Pending |
| HOK-08 | 100 | Pending |
| HOK-09 | 100 | Pending |
| HOK-10 | 100 | Pending |
| HOK-11 | 100 | Pending |
| HOK-12 | 100 | Pending |
| HOK-13 | 100 | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 41, Unmapped: 0 ✓

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 after roadmap generation*
