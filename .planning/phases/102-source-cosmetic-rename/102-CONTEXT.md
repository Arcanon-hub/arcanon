# Phase 102: Source Cosmetic Rename — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — well-scoped cosmetic sweep)

<domain>
## Phase Boundary

Every `ligamen` / `Ligamen` / `LIGAMEN` mention in source code **comments, docstrings, log messages, agent prompts, and string literals** (excluding env var reads already purged in Phase 101) renamed to `arcanon` / `Arcanon` / `ARCANON`.

**Requirements (8):** SRC-01 through SRC-08.

**Explicit Phase 102 targets inherited from Phase 101 verification:**
- `worker/mcp/server.js` — 7 `.describe()` Zod schema strings referencing `LIGAMEN_PROJECT_ROOT`
- `worker/mcp/server.js:33` — JSDoc `~/.ligamen/projects/...`
- `worker/mcp/server.js:82` — inline comment `~/.arcanon or legacy ~/.ligamen`
- `worker/scan/manager.js:77` — JSDoc "legacy ligamen.config.json supported"
- `worker/db/database.js:8` — file-header JSDoc `~/.ligamen/projects/...`
- `worker/db/pool.js:74` — JSDoc `~/.ligamen/projects/`
- `worker/db/database.js:2, 8`, `chroma.js:2` — pure historical prose
- `pool.js:74` — historical prose

</domain>

<decisions>
## Implementation Decisions

### Mechanical rename, not rewrite
This is a find-and-replace sweep. Preserve code structure. Preserve sentence meaning.

### Casing preservation
- `ligamen` → `arcanon` (lowercase preserved)
- `Ligamen` → `Arcanon` (title case preserved)
- `LIGAMEN` → `ARCANON` (uppercase preserved — applies to env-var-like tokens in docstrings)

### Delete outright where language becomes stale
If a comment says "Back-compat with legacy LIGAMEN_FOO", and the back-compat logic was deleted in Phase 101, the comment should be DELETED rather than renamed to "Back-compat with legacy ARCANON_FOO" (which would be nonsensical). Use judgment: if the comment's meaning survives the rename, rename it; if not, delete it.

### Don't touch tests
Test files have their own cosmetic ligamen references that will be addressed in Phase 103 alongside the fixture rewrites. Leave them alone in Phase 102.

### Don't touch historical CHANGELOG entries
The `[0.1.0] Pre-release fixes` section and earlier historical text are preserved as historical record (Phase 104 DOC-03 scope).

### Agent prompts need careful review
`worker/scan/agent-prompt-*.md` files are LLM prompts. Renaming "ligamen" to "arcanon" in instruction text is mechanical, but if a prompt uses the word "ligamen" to distinguish a specific legacy system or convention, verify the rename makes sense contextually.

</decisions>

<code_context>
## Existing Code Insights

### Scope (53 files total across milestone; Phase 102 owns ~23)

**Worker JS (non-test):**
- `worker/index.js` (5 refs — comments/logs)
- `worker/server/chroma.js` (14 refs — docstring + historical prose from 101-04 carry-over)
- `worker/server/http.js` (4 refs)
- `worker/mcp/server.js` (23 refs — Zod descriptions + JSDoc, biggest file in Phase 102)
- `worker/scan/manager.js` (9 refs)
- `worker/scan/findings.js` (?)
- `worker/scan/confirmation.js` (?)
- `worker/scan/discovery.js` (?)
- `worker/scan/agent-schema.json` (?)
- `worker/db/database.js` (?)
- `worker/db/pool.js` (12 refs — JSDoc + historical prose)
- `worker/db/query-engine.js` (?)
- `worker/hub-sync/auth.js` (3 refs — JSDoc after 101-04 stripped the code)
- `worker/ui/modules/export.js` (?)

**Agent prompts (worker/scan/agent-prompt-*.md):**
- `agent-prompt-discovery.md`
- `agent-prompt-common.md`
- `agent-prompt-service.md`
- `agent-prompt-library.md`
- `agent-prompt-infra.md`

**Scripts (non-test):**
- `scripts/worker-start.sh`, `worker-stop.sh`, `lint.sh`, `format.sh`, `file-guard.sh`, `drift-versions.sh`, `install-deps.sh`, `session-start.sh` — any remaining comments after Phase 101

**Libs:**
- `lib/db-path.sh`, `lib/config-path.sh` — any remaining comments
- Note: `lib/config.sh`, `lib/data-dir.sh`, `lib/linked-repos.sh` already cleaned in 101-02

</code_context>

<specifics>
## Specific Ideas

### Recommended approach
For each file:
1. Read it
2. Find every `ligamen|Ligamen|LIGAMEN` occurrence NOT in an env var read (those are done)
3. Decide rename vs delete per the "Delete outright" rule
4. Apply changes in one pass

### Verification greps (per category)
```bash
# All source files (non-test) — should return 0 after Phase 102
grep -rn "ligamen\|Ligamen\|LIGAMEN" plugins/arcanon/worker --include="*.js" --exclude="*.test.js"
grep -rn "ligamen\|Ligamen\|LIGAMEN" plugins/arcanon/worker/scan/agent-prompt-*.md
grep -rn "ligamen\|Ligamen\|LIGAMEN" plugins/arcanon/worker/scan/agent-schema.json
grep -rn "ligamen\|Ligamen\|LIGAMEN" plugins/arcanon/scripts plugins/arcanon/lib --include="*.sh"
```

### Don't touch
- `*.test.js`, `*.bats` (Phase 103)
- `CHANGELOG.md` historical entries (Phase 104)
- `README.md` (Phase 104)
- `commands/*.md`, `skills/*/SKILL.md` (Phase 104)
- `plugins/arcanon/runtime-deps.json` (already correct from Phase 101)

</specifics>

<deferred>
## Deferred Ideas

None — this phase is fully scoped.

</deferred>
