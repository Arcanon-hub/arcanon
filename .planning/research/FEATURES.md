# Feature Research

**Domain:** Claude Code plugin — self-update, ambient impact hooks, session enrichment, merged sync command
**Researched:** 2026-04-21
**Milestone:** v0.1.1 — Command Cleanup + Update + Ambient Hooks
**Confidence:** HIGH (Claude Code hook mechanics verified against official docs; CLI UX patterns verified against real tools)

---

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `/arcanon:update` shows what version is installed vs available before acting | Every mature CLI (`gh`, `brew`, `npm`) does this — users assume "upgrade" = "I know what I'm getting" | LOW | One `jq` read from manifest + one HTTP fetch of remote manifest version field |
| `/arcanon:update` asks for confirmation before overwriting plugin files | Any tool that mutates installed files prompts before doing so — this is table stakes for plugin-land | LOW | Single `read` prompt; default = no (safe default) |
| Update shows a summary of what changed (version string + categories of change) | Users expect "what's new" even if they don't read it — missing this makes the tool feel opaque | LOW-MEDIUM | Parse CHANGELOG.md between old tag and new tag, or emit categories from commit messages; full diff is anti-feature (too verbose) |
| Update kills and restarts the worker if the worker version changes | Already exists for mid-session detection; update must do the same on demand | LOW | Re-use `lib/worker-restart.sh` logic |
| `ARCANON_SKIP_UPDATE=1` env var to bypass update prompt | `HUSKY=0`, `HOMEBREW_NO_AUTO_UPDATE=1` — every hook/auto system provides an escape hatch | LOW | Checked at top of update script; CI-safe |
| `/arcanon:sync` describes what it does on first use | "sync" is ambiguous — does it scan? push? pull? — users need one sentence of orientation | LOW | Add leading line to sync.md command preamble clarifying: "runs a fresh scan and pushes, or drains queued payloads" |
| SessionStart banner fires on first session message | Already ships (SSTH-02); must remain | LOW | Existing — preserve dedup guard |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| PreToolUse impact hook — injects cross-repo consumer context before editing a service entry-point | No competitor does ambient pre-edit impact injection at the Claude Code hook level. Husky/pre-commit act at git commit time — far too late. Arcanon acts before the first keystroke. | MEDIUM | Exit 0 + `additionalContext` is the right posture (Option A). See analysis below. |
| Impact hook trigger set includes proto + OpenAPI + service root paths (from impact-map) | Competitors validate spec format (openapi-spec-validator) but none cross-reference against actual consumers — validation tells you the file is valid YAML; Arcanon tells you "3 services depend on this contract" | MEDIUM | Pattern matching against impact-map `services.root_path` + static glob set (`.proto`, `openapi.yaml`, `openapi.yml`) |
| Impact hook trigger set includes migration files with a distinct warning tone | CodeSee and Backstage ignore schema migrations entirely. Arcanon already soft-warns migrations in file-guard.sh; extending to cross-repo consumer count elevates this from "immutable file" to "you have 4 downstream consumers" | LOW | Extend existing GRDH-05 migration pattern — change from generic warn to impact-aware warn when consumer count > 0 |
| SessionStart injects topology facts (service count, load-bearing file count, last-scan date) when impact-map exists | Gives Claude ambient awareness of the project's service topology from message 1, without requiring the user to run `/arcanon:impact` manually. Directly addresses "Claude doesn't know Arcanon exists mid-implementation" | LOW-MEDIUM | Conditional injection: only if impact-map.db exists AND scan is fresh (<7 days). Facts: service count, known load-bearing files count, last scan date, hub sync status. |
| `/arcanon:update` prunes stale worker cache on update | `npm cache clean` equivalent — no competitor (for plugin-land) provides this. Prevents stale-worker incidents like the v0.1.0 regression | LOW | Worker PID file + node_modules sentinel; prune old sentinel on version bump |
| `/arcanon:sync` unified command replaces upload + drain into single intent | Reduces cognitive overhead — user's mental model is "push to hub" not "is there a queue? did I already upload?" | MEDIUM | Requires flag design (--dry-run, --repo, --force, --drain); migrate `auto_upload` config key to `auto_sync` with legacy alias |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Hard-blocking PreToolUse hook (exit 2 / permissionDecision: deny) on service file edits | "Stop me before I break something" sounds good | Blocks every routine edit of a service file, not just cross-repo ones. Kills flow for single-repo work or when impact-map is stale. `permissionDecision: "ask"` also has documented bugs (bypass mode resets after user approves in v0.1.x — GH #37420). Exit 2 means no edit without user interaction, which breaks agentic multi-file refactors. | Option A: inject `additionalContext` only. Let Claude reason about the risk. The human is still in the loop. |
| Threshold-based blocking (block if >N consumers) | Feels like proportional response | Threshold value is arbitrary and config-bloated. Users will set it to 0 to avoid prompts. Same downstream friction as full blocking, just delayed. | Warn unconditionally + include consumer count in the context — Claude will self-calibrate urgency from the data. |
| Auto-update-on-session-start | "Always up-to-date" is appealing | Network call on every session start increases cold-start time. Silent auto-update means plugin behavior changes without the user knowing — violates "detect, don't surprise" principle. If update breaks something, no recovery path. | Explicit `/arcanon:update` command + banner noting "update available" in session-start enrichment (one-line, non-blocking) |
| Rollback support (`/arcanon:rollback`) | "Undo the update" seems safe | Plugin files are git-managed; rollback is `git checkout HEAD~1` in the plugin repo. There is no meaningful plugin state (DB lives in `~/.arcanon`, not plugin dir) that would be damaged by a plugin update. Rollback ceremony is theater for zero real protection. | Document that plugin dir is a git clone — `git log` + `git checkout <sha>` is the rollback. Don't build it into the plugin. |
| Full changelog diff injected into session context | "Show me everything that changed" | Context window pollution for changes the user doesn't care about. The 10,000-char additionalContext cap can be saturated by a single large CHANGELOG section, crowding out actual topology data. | Show 2-3 bullet categories in update confirmation + a "see CHANGELOG.md for full details" pointer |
| SessionStart full impact-map JSON dump | "Give Claude maximum context" | 10,000-char hard cap on `additionalContext` — a 10-service project's impact-map JSON easily exceeds this. Structured JSON is also harder for Claude to reason about than prose facts. | 5-6 prose facts: service count, key load-bearing files, last scan date, hub sync status, "run /arcanon:impact for details" |
| Separate `/arcanon:update-check` command | "Let me check without committing" | Adds a command to the surface for behavior that should be a flag (`/arcanon:update --check`) or a banner | Add `--check` flag to `/arcanon:update` that prints available version + exits 0 without applying |

---

## Feature Dependencies

```
/arcanon:update
    └──requires──> lib/worker-restart.sh        (already exists — re-use)
    └──requires──> CLAUDE_PLUGIN_ROOT resolution (already exists)
    └──requires──> remote manifest fetch         (new — one curl call)
    └──requires──> CHANGELOG.md parsing          (new — awk between version tags)

PreToolUse impact hook
    └──requires──> impact-map.db existence check (new guard at hook entry)
    └──requires──> worker HTTP API (/graph or /impact endpoint)  (already exists)
    └──requires──> file classification logic     (partial — file-guard.sh has patterns)
    └──enhances──> existing file-guard.sh        (extend migration warn to include consumer count)

SessionStart enrichment
    └──requires──> impact-map.db existence check
    └──requires──> worker HTTP API (/graph stats or /status endpoint)
    └──enhances──> existing session-start.sh     (additive — extend CONTEXT string)
    └──conflicts──> full-JSON dump anti-feature  (stay prose, not JSON)

/arcanon:sync (merged)
    └──requires──> existing upload logic in hub.sh
    └──requires──> existing drain/queue logic in hub.sh
    └──requires──> config key rename auto_upload → auto_sync  (backward-compat alias for one version)
    └──supersedes──> /arcanon:upload             (remove after merge; redirect users in upload.md)
```

### Dependency Notes

- **PreToolUse hook requires worker running:** The hook must check that the worker is up before querying the HTTP API. If worker is down, hook must exit 0 silently (never block edits due to missing worker).
- **SessionStart enrichment builds on existing session-start.sh:** The current script injects "Arcanon active. Detected: X. Commands: ..." — the new enrichment extends this with topology facts when impact-map.db exists and is fresh.
- **`/arcanon:update` is independent:** Does not require any running worker. It reads local plugin manifest + fetches remote manifest. Worker restart is a consequence of update, not a prerequisite.

---

## MVP Definition

### Ship in v0.1.1 (this milestone)

- [ ] `/arcanon:update` — version check + changelog summary + confirm + reinstall + worker kill/restart + cache prune. Exit immediately if already current.
- [ ] PreToolUse impact hook (Option A: warn-only via `additionalContext`) — fire on proto/OpenAPI/service root edits when impact-map exists + worker is up. Inject "N cross-repo consumers depend on this file" context.
- [ ] SessionStart enrichment — extend existing banner with topology facts when impact-map.db exists and is < 7 days old.
- [ ] `/arcanon:sync` merged command — absorbs `/arcanon:upload`; adds `--dry-run`, `--repo`, `--force`, `--drain` flags; renames `auto_upload` → `auto_sync` config key with legacy alias.
- [ ] Remove `/arcanon:cross-impact` command (per milestone scope).

### Defer to v0.2.0

- [ ] Skills layer on top of hooks — observe real hook firing behavior first, then design skills.
- [ ] `permissionDecision: "ask"` blocking on high-impact edits — wait for GH #37420 and VS Code parity bug to be resolved upstream.
- [ ] Threshold-based consumer count block — re-evaluate after observing real firing patterns.
- [ ] Auto-update-on-session-start — only if user adoption data shows users forgetting to update.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `/arcanon:update` | HIGH — directly addresses v0.1.0 stale-worker incident | LOW (curl + git pull + worker-restart.sh) | P1 |
| PreToolUse impact hook (warn-only) | HIGH — core ambient value prop | MEDIUM (worker query + file classification) | P1 |
| SessionStart topology enrichment | MEDIUM — fills "Claude doesn't know Arcanon exists" gap | LOW (extend existing session-start.sh) | P1 |
| `/arcanon:sync` merged command | MEDIUM — UX cleanup, reduces command confusion | MEDIUM (flag design + config migration + tests) | P1 |
| Remove `/arcanon:cross-impact` | LOW user value | LOW (delete file + sweep docs) | P2 |
| `--check` flag on `/arcanon:update` | LOW-MEDIUM | LOW (same as update minus apply step) | P2 |
| Migration file consumer-count warn | MEDIUM — high impact, low cost | LOW (extend GRDH-05 pattern) | P2 |

---

## Competitor Feature Analysis

| Feature | gh CLI | Homebrew | Husky | Dependabot | Arcanon v0.1.1 approach |
|---------|--------|----------|-------|------------|--------------------------|
| Self-update command | `gh upgrade` — shows version, no confirmation prompt, no changelog | `brew upgrade <formula>` — shows what changed, no prompt by design (script-safe), no rollback | N/A (managed via npm) | Dependabot PRs — shows changelog in PR description, requires human merge | Show version delta + 2-3 change categories, single confirmation prompt, no rollback (git clone is the recovery) |
| Bypass mechanism | `GH_NO_UPDATE_NOTIFIER` | `HOMEBREW_NO_AUTO_UPDATE=1` | `HUSKY=0` | N/A (CI-only) | `ARCANON_SKIP_UPDATE=1` env var |
| Pre-edit protection | None | None | pre-commit blocks if tests fail (git time, not edit time) | None | PreToolUse `additionalContext` injection before Claude edits the file |
| Breaking change surfacing | CLI release notes in GitHub | Version bump + `--dry-run` for package installs | Exit non-zero blocks commit | PR description parsed from CHANGELOG | "N cross-repo consumers depend on this file" injected before edit |
| Session/ambient context | None | None | None | None | SessionStart topology facts (service count, load-bearing files, scan age) |
| Merged push/drain command | gh release upload + create are separate | brew push is not a user concept | N/A | N/A | `/arcanon:sync` — one command for fresh-scan-push and queue-drain |

---

## Detailed Design Notes by Feature

### 1. `/arcanon:update` — Design Decisions

**Confirmation gate:** Prompt once, default No. Pattern: `Update to v0.1.1? (y/N)`. Do NOT gate on breaking changes specifically — every plugin update can in principle change hook behavior, so the confirmation is always warranted. A "breaking change only" gate creates a false sense of safety and requires semver parsing.

**Changelog surfacing:** Show 2-4 lines extracted from CHANGELOG.md between the current and target version. Categories only (e.g., "New: PreToolUse impact hook, SessionStart enrichment / Fixed: worker restart race condition"). Not full diff — that saturates context and users skip it. Pointer to full CHANGELOG.md for those who want detail.

**Auto-update-on-session-start:** Anti-feature. The correct pattern is: session-start banner notes "update available (v0.1.1)" in one line. User runs `/arcanon:update` explicitly. This mirrors how `gh` handles update notifications — shows a banner, never auto-applies.

**Rollback:** Not built. The plugin directory is a git clone. `git -C $CLAUDE_PLUGIN_ROOT log --oneline -5` + `git checkout <sha>` is the recovery path. Document this, do not implement it. DB lives in `~/.arcanon` and is not touched by plugin updates.

**Worker kill sequence:** After successful reinstall, check if worker is running (`worker_running`). If yes, stop it (`worker_stop`) and restart (`worker_start_background`). Use existing `lib/worker-restart.sh` logic — do not duplicate.

### 2. PreToolUse Impact Hook — Design Decisions

**Default behavior: Option A (pure warning via `additionalContext`).**

Rationale:
- Option B (hard block via exit 2 / `permissionDecision: deny`) kills agentic refactors that touch multiple files legitimately. It also has a documented VS Code bug (GH #13339) where `permissionDecision: "ask"` is silently ignored in the VS Code extension.
- Option C (threshold) introduces an arbitrary config knob with no good default and creates user pressure to set threshold=0.
- Option A matches the actual value proposition: "Arcanon should protect you by TELLING you, not by stopping you." The user and Claude together decide — Claude gets the context, reasons about it, and may itself add a warning or change its approach. This is more aligned with the AI-native UX than a hard gate.

**Trigger set (in priority order):**
1. Proto files: `*.proto` (any path)
2. OpenAPI specs: `openapi.yaml`, `openapi.yml`, `openapi.json`, `swagger.yaml`, `swagger.yml` (any path)
3. Service entry-points: files whose absolute path matches `services[*].root_path` from impact-map (queried from worker HTTP API at hook time)
4. Migration files: already handled by GRDH-05 — extend to include consumer count when available

Do NOT trigger on shared type definition files broadly (e.g., all `*.ts` or `*.go` files) — too noisy. Only trigger on files that are structural contracts (proto, OpenAPI) or known service entry-points from the actual scan.

**Worker-down handling:** If the worker HTTP API is unreachable (worker not started, or scan never run), the hook must exit 0 silently. Never block an edit because Arcanon's worker isn't running. This matches the "non-blocking" constraint in PROJECT.md.

**Context message format:**
```
Arcanon: [filename] has N cross-repo consumers: [service-a], [service-b] (and M more).
Last scan: [date]. This is a [proto/OpenAPI/service entry-point] file — changes here may break consumers.
Run /arcanon:impact [target] for full impact analysis.
```
Keep it under 300 chars when possible. Claude will act on the count + service names; it does not need the full impact graph injected here.

**Bypass:** `ARCANON_DISABLE_GUARD=1` already exists in file-guard.sh — reuse this env var. Do not introduce a separate bypass variable for the impact hook.

### 3. SessionStart Enrichment — Design Decisions

**Conditional injection:** Only inject topology facts when:
- `impact-map.db` exists at the expected path
- Last scan timestamp is < 7 days old (stale data is misleading, not helpful)
- Worker is running (or can be auto-started within 2s)

If any condition fails, fall back to the current minimal banner ("Arcanon active. Detected: X.").

**What to inject (when conditions met):**
```
Arcanon: [N] services mapped. [K] load-bearing files tracked. Last scan: [date] ([N] days ago).
Hub: [synced / not configured / stale]. Run /arcanon:impact <target> for cross-repo impact.
```

This is ~120-200 chars — well under the 10,000-char limit, leaves room for the existing project-type and command list lines.

**What NOT to inject:**
- Full service names list (grows with repo count, variable length, pollutes context)
- Impact graph JSON (anti-feature — exceeds context cap, too dense)
- Worker version (internal detail, users don't care)
- Full command list if topology facts are present (already in the existing banner — don't repeat)

**Implementation:** Extend existing `session-start.sh` CONTEXT variable construction. Query the worker HTTP API for `/api/v1/stats` (or equivalent) when available. Graceful fallback to existing behavior if query fails.

### 4. `/arcanon:sync` Merged Command — Design Decisions

**Name:** Keep "sync." The word is well-understood in developer tooling (git sync, Backstage sync, Cursor sync). The confusion is not the name — it is the current split between `upload` (fresh push) and `sync` (queue drain). Merging them under `sync` with intelligent default behavior resolves the confusion.

**Default behavior (no flags):**
1. Check if current repo has been scanned (`impact-map.db` has a row for this repo)
2. If yes: upload latest scan + drain queue in one pass
3. If no: print "No scan found. Run /arcanon:map first." and exit 0

**Flag set:**
- `--dry-run` — show what would be uploaded/drained, no network calls
- `--repo <path>` — target a specific repo instead of cwd
- `--force` — re-upload even if already synced in this session
- `--drain` — queue-drain only (skip fresh upload, just process queued payloads)

**Progress output:** Show per-operation progress during the run, not just a final summary. Users want to see "uploading payment-service... ok" not just "sync complete (3 repos)." Final summary line is additive. This matches the existing drain report format and extends it.

**Config migration:** Rename `auto_upload` → `auto_sync` in arcanon.config.json. Honor `auto_upload` as a legacy alias for v0.1.1 with a deprecation warning: "auto_upload is deprecated; rename to auto_sync."

**Naming in command surface:** Remove `/arcanon:upload` entirely. Update the README command table. Add a redirect note in the old upload.md location for one version (point users to `/arcanon:sync`).

---

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — PreToolUse exit codes, `permissionDecision` values, `additionalContext` 10,000-char cap, SessionStart capabilities (HIGH confidence)
- [GH #13339 — VS Code ignores `permissionDecision: "ask"`](https://github.com/anthropics/claude-code/issues/13339) — Known bug; informs choice of Option A over Option B/C for impact hook (HIGH confidence)
- [GH #37420 — permissionDecision "ask" resets bypass mode](https://github.com/anthropics/claude-code/issues/37420) — Additional reason to avoid "ask" decision in impact hook (MEDIUM confidence — open bug)
- [Husky bypass via HUSKY=0](https://typicode.github.io/husky/how-to.html) — env-var bypass pattern (HIGH confidence)
- [Homebrew auto-update design](https://github.com/orgs/Homebrew/discussions/578) — script-safe design, no confirmation prompts, `HOMEBREW_NO_AUTO_UPDATE=1` bypass (HIGH confidence)
- [Claude Code Hooks — context injection patterns](https://dev.to/sasha_podles/claude-code-using-hooks-for-guaranteed-context-injection-2jg) — sessionStart additionalContext use cases (MEDIUM confidence)
- [Context Engineering Best Practices 2026](https://packmind.com/context-engineering-ai-coding/context-engineering-best-practices/) — balance information density vs context pollution (MEDIUM confidence)
- openapi-spec-validator, Spectral, Buf — validate spec format but do not cross-reference consumers (confirm Arcanon's differentiation) (HIGH confidence)
- [Adaptly for Dependabot](https://medium.com/@ezkatkabratan/do-your-dependabot-prs-contain-breaking-changes-or-not-detect-it-automatically-using-adaptly-6bd592b28eb2) — closest to "change affects" analysis in PR tooling, but post-commit and package-dep-scoped only (MEDIUM confidence)

---

*Feature research for: Arcanon v0.1.1 — Self-update + Ambient Protection Hooks*
*Researched: 2026-04-21*
