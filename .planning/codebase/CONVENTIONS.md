# Coding Conventions

**Analysis Date:** 2026-04-24

Arcanon is a Claude Code plugin shipped as `plugins/arcanon/` inside the `ligamen` monorepo. The plugin is a polyglot mix of Bash (hooks, libs, scripts) and Node.js ESM (worker, MCP server, UI). Both stacks have hard-enforced naming and idiom rules as of v0.1.2.

## Project Layout at a Glance

- Plugin root: `plugins/arcanon/`
- Bash hook entry points: `plugins/arcanon/scripts/*.sh`
- Bash sourced helpers: `plugins/arcanon/lib/*.sh`
- Node worker (Fastify + better-sqlite3): `plugins/arcanon/worker/{cli,db,hub-sync,lib,mcp,scan,server,ui}/*.js`
- Slash commands: `plugins/arcanon/commands/*.md`
- Manifests: `plugins/arcanon/.claude-plugin/{plugin,marketplace}.json`, `plugins/arcanon/hooks/hooks.json`, `plugins/arcanon/package.json`
- Bats tests: `tests/*.bats` (repo root, not plugin root)

## Brand & Naming (v0.1.2 hard-enforced)

### Environment variables -- `ARCANON_*` only

Zero-tolerance on legacy names. No `LIGAMEN_*` fallback anywhere. No two-read fallbacks. No stderr deprecation warnings for legacy env vars -- they are removed outright.

Canonical surface:

| Variable | Purpose | Default |
|----------|---------|---------|
| `ARCANON_DATA_DIR` | Override data directory | `$HOME/.arcanon` |
| `ARCANON_LOG_LEVEL` | Worker + MCP log level | -- |
| `ARCANON_WORKER_PORT` | Worker HTTP port | `37888` |
| `ARCANON_DB_PATH` | MCP server DB override | derived from `cwd` hash |
| `ARCANON_PROJECT_ROOT` | MCP server project override | `$PWD` |
| `ARCANON_CHROMA_MODE` / `_HOST` / `_PORT` / `_SSL` / `_API_KEY` / `_TENANT` / `_DATABASE` | ChromaDB cloud/server config | embedded |
| `ARCANON_CONFIG_FILE` | Override auto-discovered `arcanon.config.json` | -- |
| `ARCANON_API_KEY` / `ARCANON_API_TOKEN` | Hub bearer | -- |
| `ARCANON_HUB_URL` | Hub base URL | `https://api.arcanon.dev` |
| `ARCANON_LINT_THROTTLE` | Lint throttle seconds | `30` |
| `ARCANON_EXTRA_BLOCKED` | File-guard extra patterns (colon-separated) | -- |
| `ARCANON_DISABLE_FORMAT` / `_LINT` / `_GUARD` / `_SESSION_START` / `_HOOK` | Escape hatches (any non-empty value disables) | unset |
| `ARCANON_IMPACT_DEBUG` | JSONL trace file for `impact-hook.sh` | unset |

See `plugins/arcanon/lib/data-dir.sh` for the canonical resolver pattern -- it reads `ARCANON_DATA_DIR` only, falls back to `$HOME/.arcanon`, and never consults legacy names.

### Slash commands -- `/arcanon:<verb>`

All commands live under `plugins/arcanon/commands/*.md`, one file per verb. The v0.1.2 surface is 7 canonical verbs plus 1 deprecated stub:

| Verb | File | Purpose |
|------|------|---------|
| `/arcanon:map` | `commands/map.md` | Scan repo graph |
| `/arcanon:impact` | `commands/impact.md` | Impact query (absorbed legacy cross-impact) |
| `/arcanon:drift` | `commands/drift.md` | Cross-repo diff |
| `/arcanon:sync` | `commands/sync.md` | Canonical upload + drain verb |
| `/arcanon:upload` | `commands/upload.md` | DEPRECATED stub forwarding to `sync` |
| `/arcanon:status` | `commands/status.md` | Worker + hub health |
| `/arcanon:login` | `commands/login.md` | Hub auth |
| `/arcanon:export` | `commands/export.md` | Mermaid / DOT / HTML export |
| `/arcanon:update` | `commands/update.md` | Self-update flow |

`upload.md` is the *one* deprecation grace exception post-v0.1.2; it is kept for a single release only.

### Config file -- `arcanon.config.json`

- Always at repo root: `arcanon.config.json`
- No `ligamen.config.json` fallback
- Example template: `plugins/arcanon/arcanon.config.json.example`
- Repo-local example: `arcanon.config.json` at repo root
- Resolver: `plugins/arcanon/lib/config-path.sh` (`resolve_arcanon_config`)
- Common keys: `project-name`, `linked-repos`, `hub.auto-sync` (renamed from `auto-upload`), `hub.url`, `hub.beta_features.library_deps`, `impact-map` (worker opt-in)

### Data directory layout

- Root: `$ARCANON_DATA_DIR` or `$HOME/.arcanon/` -- no `~/.ligamen` fallback
- Per-project DB: `projects/<sha256(cwd)[:12]>/impact-map.db`
- The 12-char prefix is computed from `printf '%s' "$cwd" | sha256sum | cut -c1-12` on the shell side and `crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 12)` on the Node side. The `printf '%s'` (no newline) form is required to match Node's `update(cwd)`.

## Bash Conventions

### File layout

- `plugins/arcanon/scripts/*.sh` -- hook entry points, always executable, usually invoked by Claude Code
- `plugins/arcanon/lib/*.sh` -- sourced helpers, never executed directly

### Shebang and strictness

Every script begins with:

```bash
#!/usr/bin/env bash
# <path> -- <one-line purpose>
set -euo pipefail
```

Hooks additionally add a non-blocking trap:

```bash
trap 'exit 0' ERR
```

`file-guard.sh` is the sole exception that deliberately avoids `set -e` because `realpath` can fail on pending files; it uses explicit exit codes instead.

### Source guard for `lib/*.sh`

Every sourced helper starts with a source-only guard:

```bash
[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }
```

See `plugins/arcanon/lib/worker-client.sh:7` for the canonical pattern.

### Exit code semantics

- Hooks are **warn-only**: they always `exit 0`. Warnings and context are emitted as `hookSpecificOutput` JSON on stdout or human text on stderr.
- Only `plugins/arcanon/scripts/file-guard.sh` uses `exit 2` for a hard block (Claude Code PreToolUse deny contract).
- Escape-hatch env vars short-circuit with `exit 0` silently -- e.g., `[[ -n "${ARCANON_DISABLE_SESSION_START:-}" ]] && exit 0`.

### Hook JSON output contract

Hooks that inject context print a `hookSpecificOutput` object:

```bash
CONTEXT_JSON=$(printf '%s' "$CONTEXT" | jq -Rs .)
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' \
  "$EVENT" \
  "$CONTEXT_JSON"
```

All user-supplied strings go through `jq -Rs .` for safe escaping.

### Worker HTTP client

`plugins/arcanon/lib/worker-client.sh` is sourced by any script that needs to talk to the Node worker. It exposes `worker_running`, `worker_call`, `wait_for_worker`, `worker_start_background`, and `worker_status_line`. `session-start.sh` sources it to perform version-check + restart-if-stale on every `UserPromptSubmit`.

### Plugin-root resolution pattern

Scripts resolve the plugin root in a consistent order:

```bash
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh" ]]; then
  DETECT_LIB="${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
else
  SCRIPT_DIR="$(dirname "$0")"
  DETECT_LIB="${SCRIPT_DIR}/../lib/detect.sh"
fi
```

Prefer `CLAUDE_PLUGIN_ROOT` when set; fall back to `$0`-relative path. Never hard-code `$HOME/.claude/plugins/...`.

### Portability rules

- macOS Bash 4+ required. CI injects Homebrew bash via PATH in bats `setup()`.
- Portable date parsing: try GNU `date -d` first, then BSD `date -jf '%Y-%m-%d %H:%M:%S'`.
- Portable sha256: prefer `shasum -a 256`, fall back to `sha256sum`.
- `realpath -m` is Linux-only; macOS fallback uses `cd "$dir" && pwd`.

### Shellcheck

Every script and lib must pass `shellcheck -x --severity=error -e SC1091`. The `-e SC1091` is required because sourced paths are resolved at runtime. Use `# shellcheck source=path/to/file.sh` directives above `source` calls to give shellcheck a static hint.

## Node (JavaScript) Conventions

### Module system

- `plugins/arcanon/package.json` declares `"type": "module"` -- every `.js` file is ESM.
- **All imports must include the `.js` extension.** Example from `plugins/arcanon/worker/db/query-engine.js:24-25`:

```js
import { chromaSearch, isChromaAvailable } from "../server/chroma.js";
import { resolveConfigPath } from "../lib/config-path.js";
```

- No `NODE_PATH` reliance. The MCP server installs deps into `CLAUDE_PLUGIN_ROOT` and imports use only relative paths.
- Node engine: `>=20.0.0` (package.json `engines`).

### File organization

Worker subdirectories, each owning one concern:

| Dir | Purpose |
|-----|---------|
| `worker/cli/` | CLI entry point(s) |
| `worker/db/` | Database schema, migrations, query engine, pool |
| `worker/hub-sync/` | Hub upload / drain client |
| `worker/lib/` | Shared utilities (logger, paths, etc.) |
| `worker/mcp/` | MCP server (stdin/stdout) |
| `worker/scan/` | Scan manager, agent prompt orchestration |
| `worker/server/` | Fastify HTTP server, ChromaDB client |
| `worker/ui/` | Static UI assets |

### File naming

- Source: `kebab-case.js` (`query-engine.js`, `hub-sync.js`, `worker-client.js`).
- Tests: `<module>.test.js` co-located beside the source (`query-engine.js` + `query-engine-search.test.js`).
- Multiple tests per module split on suffix: `query-engine-enrich.test.js`, `query-engine-search.test.js`, `query-engine-actors.test.js`, etc.
- Migrations: numbered `NNN_name.js` (`worker/db/migrations/011_services_boundary_entry.js`).

### Class and function naming

- Classes: `PascalCase` (`QueryEngine`, `StmtCache`).
- Functions and methods: `camelCase` (`openDb`, `resolveConfigPath`, `enrichImpactResult`).
- Factory / predicate / setter prefixes remain in effect: `create*`, `is*`, `set*`, `_privateHelper`.
- Constants: `SCREAMING_SNAKE_CASE` for module-level immutable config; module-scoped private helpers use leading underscore (`_stmtCache`, `_capacity`).

### Export patterns

- Named exports for public API (`export class QueryEngine`, `export function search`, `export const version = 11`).
- No default exports in library modules.
- Tests import from the adjacent module:

```js
import { search, _stmtCache, StmtCache } from "./query-engine.js";
```

- Migrations export `version: N` plus an `up(db)` function.

### Migration idioms

Migrations under `plugins/arcanon/worker/db/migrations/`:

```js
export const version = 11;

export function up(db) {
  const hasCol = (table, col) =>
    db.prepare("PRAGMA table_info(" + table + ")").all().some((c) => c.name === col);
  if (!hasCol("services", "boundary_entry")) {
    db.exec("ALTER TABLE services ADD COLUMN boundary_entry TEXT;");
  }
}
```

Rules:

- Additive columns: gate with `PRAGMA table_info` (see `009_confidence_enrichment.js`, `011_services_boundary_entry.js`).
- New tables: `CREATE TABLE IF NOT EXISTS` (see `010_service_dependencies.js`).
- **No `down()` migrations.** Schema drift is handled at runtime via prepared-statement `try/catch` fallbacks inside `QueryEngine`.

### Error and logging style

- Logger module at `plugins/arcanon/worker/lib/logger.js` honours `ARCANON_LOG_LEVEL`.
- Never `console.log` in MCP server code (`plugins/arcanon/worker/mcp/server.js`) -- it corrupts JSON-RPC. Use `console.error` for MCP debugging; shell lint enforces.
- Throw `Error` subclasses for programmer errors; return `null` / empty arrays for "not found" semantics.
- Validation functions return `{ valid: true, findings, warnings }` or `{ valid: false, error }`.

### Comments and docstrings

- Every module begins with a file-level block comment explaining its role. Example -- `plugins/arcanon/worker/db/query-engine.js:1-17`.
- JSDoc `@param` is used for better-sqlite3 Database params and for caller-facing helpers, e.g. `@param {import('better-sqlite3').Database} db`.
- Inline comments reference the phase/issue that introduced the code (e.g., `// REL-04`, `// Phase 14-02`, `// Issue #18 (Bug 2)`). This is deliberate -- it lets future readers trace decisions.

### Async

- Prefer `async/await`; avoid raw `.then()` chains.
- Top-level `await` is allowed (ESM) and used in test files that do one-shot setup.

## JSON Manifest Conventions

- `plugins/arcanon/.claude-plugin/plugin.json` -- name must be `"arcanon"` (CI asserts this).
- `plugins/arcanon/.claude-plugin/marketplace.json` -- name and `plugins[0].name` must both be `"arcanon"`.
- `plugins/arcanon/hooks/hooks.json` -- registers which script runs on which event.
- All JSON must pass `jq empty` (CI `lint-manifests` job).

## Deprecation Policy (post-v0.1.2)

- **Zero tolerance** on legacy names. When a name is renamed, the old form is removed outright -- no two-read fallback, no stderr warning.
- `hub.auto-upload` -> `hub.auto-sync` was renamed this way. Config reader reads `auto-sync` only.
- The single exception is `/arcanon:upload` which is a deprecated stub forwarding to `/arcanon:sync` for one release grace.

## Commit Message Style

Conventional prefixes with optional phase-plan scope:

- `feat(NN-MM): <imperative summary>` -- new feature inside a phase
- `fix(NN-MM): ...` -- bug fix
- `refactor(NN-MM): ...` -- no behaviour change
- `docs(NN-MM): ...` -- docs-only
- `test(NN-MM): ...` -- tests only
- `chore: ...` -- no phase scope

`NN-MM` references the phase-plan ID (e.g., `feat(101-01): purge LIGAMEN_* env names`).

Every commit authored with Claude assistance ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Where to Add New Code

| Situation | Location |
|-----------|----------|
| New slash command | `plugins/arcanon/commands/<verb>.md` + register in `plugins/arcanon/.claude-plugin/plugin.json` |
| New hook | `plugins/arcanon/scripts/<hook>.sh` + wire in `plugins/arcanon/hooks/hooks.json` |
| New sourced helper | `plugins/arcanon/lib/<name>.sh` (with source guard) |
| New worker HTTP route | `plugins/arcanon/worker/server/*.js` |
| New MCP tool | `plugins/arcanon/worker/mcp/*.js` |
| New DB schema change | `plugins/arcanon/worker/db/migrations/NNN_<name>.js` |
| New scan capability | `plugins/arcanon/worker/scan/*.js` |
| New test (shell) | `tests/<subsystem>.bats` |
| New test (node) | `plugins/arcanon/worker/**/<module>.test.js` co-located |

---

*Convention analysis: 2026-04-24*
