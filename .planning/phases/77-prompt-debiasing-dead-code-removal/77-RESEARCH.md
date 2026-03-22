# Phase 77: Prompt Debiasing & Dead Code Removal - Research

**Researched:** 2026-03-22
**Domain:** LLM agent prompt engineering, prompt interpolation, dead code removal
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SARC-02 | Active agent prompts use discovery context for language-specific pattern guidance instead of hardcoded Python/JS examples; entry points expanded for Java, C#, Ruby, Kotlin (THE-959) | Prompt files located, Python/JS bias identified in agent-prompt-common.md and agent-prompt-deep.md; DISCOVERY_JSON placeholder approach documented |
| SARC-03 | Dead code removed: agent-prompt-deep.md deleted, promptDeep variable removed from manager.js, unique documentation migrated to active prompts first (THE-954) | Confirmed promptDeep read on line 340 of manager.js, confirmed variable is unused after loading (never referenced in routing logic), agent-prompt-deep.md content audited for unique sections |
</phase_requirements>

---

## Summary

Phase 77 is a targeted prompt-engineering and dead-code-removal phase. It has two interlocked tasks: first expand the active scan agent prompts to remove Python/JS example bias (SARC-02), then delete the obsolete `agent-prompt-deep.md` file and its `promptDeep` variable in `manager.js` after ensuring no unique content is lost (SARC-03).

The active agent prompts — `agent-prompt-service.md`, `agent-prompt-library.md`, `agent-prompt-infra.md`, and `agent-prompt-common.md` — are Markdown template files loaded by `scanRepos()` in `manager.js` at runtime. The `{{DISCOVERY_JSON}}` placeholder is defined in `agent-prompt-deep.md` (the dead-code file) but does NOT currently appear in any active prompt. Phase 76 (SARC-01) is responsible for wiring the discovery agent output into these active prompts via `{{DISCOVERY_JSON}}`; Phase 77 extends the active prompts to use that placeholder for language-specific guidance and adds Java, C#, Ruby, Kotlin entry-point examples.

The `promptDeep` variable on line 340 of `manager.js` reads `agent-prompt-deep.md` at startup but is never used in the routing logic — `promptService`, `promptLibrary`, and `promptInfra` are the three prompts selected at runtime. The variable is dead code. SARC-03 removes it along with the file itself.

**Primary recommendation:** Edit the active prompt files directly (plain Markdown) and delete the obsolete file. No new dependencies, no framework changes.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (`fs`, `path`) | Node 20+ | Read prompt files at scan time | Already used throughout manager.js |
| node:test | Node 20+ | Unit tests for prompt injection behavior | Already used in manager.test.js |

No new npm dependencies are required. This is pure file editing work.

**No installation needed.**

---

## Architecture Patterns

### Prompt File Loading Pattern (Existing)

Manager loads prompt templates once at the top of `scanRepos()` via `readFileSync`. The routing switch selects `promptService`, `promptLibrary`, or `promptInfra` based on `detectRepoType()`. Placeholder interpolation uses `.replaceAll("{{TOKEN}}", value)` chained calls.

```
plugins/ligamen/worker/scan/
├── agent-prompt-common.md     # Injected via {{COMMON_RULES}} into all three active prompts
├── agent-prompt-service.md    # Active — service repos
├── agent-prompt-library.md    # Active — library/SDK repos
├── agent-prompt-infra.md      # Active — infra repos
├── agent-prompt-discovery.md  # Phase 1 discovery agent (not routed through scanRepos)
├── agent-prompt-deep.md       # DEAD CODE — to be deleted in SARC-03
└── manager.js                 # Loads and routes prompts
```

### Pattern 1: Expanding Confidence Examples with Language-Agnostic Approach

**What:** Replace or extend the existing HIGH/LOW confidence examples in `agent-prompt-common.md` (and echoed in `agent-prompt-deep.md`) with multi-language examples. The current `agent-prompt-common.md` HIGH confidence block only cites Python (`@app.route`) and JS (`router.get`).

**When to use:** Always — common rules apply to all three active prompts via `{{COMMON_RULES}}` injection.

**Current bias location:**
```markdown
# File: agent-prompt-common.md, line 10
**HIGH** — literal string definition in source code:
- `@app.route('/users')`, `router.get('/health', handler)`, `producer.send('order.created', msg)`
```

**Target pattern — expand to multi-language:**
```markdown
**HIGH** — literal string definition in source code:
- `@app.route('/users')` — Python Flask
- `router.get('/health', handler)` — Node.js Express
- `@RestController` / `@GetMapping("/users")` — Java Spring Boot
- `[HttpGet("users")]` / `[Route("api/[controller]")]` — C# ASP.NET Core
- `get '/users', to: 'users#index'` — Ruby on Rails routes.rb
- `@Get("/users")` / `fun getUsers()` — Kotlin Ktor/Spring Boot
- `producer.send('order.created', msg)` — Kafka (language-agnostic)
```

### Pattern 2: DISCOVERY_JSON Placeholder for Language-Specific Guidance

**What:** When Phase 76 wires `{{DISCOVERY_JSON}}` into the prompt interpolation pipeline, the active prompts can use it to steer the agent toward the discovered language's patterns instead of hard-wiring examples.

**When to use:** The `{{DISCOVERY_JSON}}` block should be added to the active prompts so the agent is instructed to prefer the detected language's idioms. This is the alternative to adding explicit per-language examples — the discovery context makes hardcoded examples less necessary.

**Two valid strategies for SARC-02:**

Option A (Language Examples): Add Java/C#/Ruby/Kotlin examples alongside existing Python/JS examples in `agent-prompt-common.md` and the type-specific prompts. This satisfies the success criterion of "entry-point examples for Java, C#, Ruby, and Kotlin."

Option B (DISCOVERY_JSON Placeholder): Add `{{DISCOVERY_JSON}}` to active prompt headers with an instruction block — "use the detected language from discovery context to guide pattern matching." This satisfies the `or use {{DISCOVERY_JSON}} placeholders instead of any hardcoded language examples` alternative in the success criteria.

**Recommendation:** Option A for `agent-prompt-common.md` (add multi-language HIGH confidence examples), plus Option B adding a `{{DISCOVERY_JSON}}` section to each active prompt. Combining both fully satisfies SARC-02 and works whether or not Phase 76 has run.

### Pattern 3: Discovery Context Section in Active Prompts

The `agent-prompt-deep.md` file already has a well-structured `## Discovery Context (from Phase 1)` section with `{{DISCOVERY_JSON}}` placeholder and guidance on how to use it. This content is unique to `agent-prompt-deep.md` and MUST be migrated to the three active prompts before deleting the file (SARC-03 requirement).

**Unique content in `agent-prompt-deep.md` to migrate:**
- The `## Discovery Context (from Phase 1)` section (lines 3-17 of the file) with `{{DISCOVERY_JSON}}` and five bullet instructions
- The fallback instruction: "If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files."
- The bias-containing confidence examples (lines 47-58) — these should be migrated in expanded/debiased form to `agent-prompt-common.md`

**Content in `agent-prompt-deep.md` that is NOT unique** (already present in active files or should not be migrated):
- The full JSON schema (exists in `agent-schema.json`, referenced via `{{SCHEMA_JSON}}` in common rules)
- Service naming convention rules (already in `agent-prompt-common.md`)
- Type classification rules (already in `agent-prompt-service.md`)
- Example JSON outputs (already in each type-specific prompt)

### Pattern 4: Removing Dead Code from manager.js

`promptDeep` is loaded on line 340 but never used in prompt routing. Safe removal:

```javascript
// REMOVE these two lines (lines 339-340 in current manager.js):
// Legacy prompt kept as fallback
const promptDeep = readFileSync(join(__dirname, "agent-prompt-deep.md"), "utf8");
```

No downstream reference to `promptDeep` exists. Confirmed by: `grep -n "promptDeep" manager.js` returns only line 340 (the assignment). The variable is never passed to `agentRunner`, never interpolated, never exported.

### Anti-Patterns to Avoid

- **Migrating verbatim bias:** Do NOT copy Python/JS-only examples from `agent-prompt-deep.md` into the active prompts unchanged — they must be expanded with Java/C#/Ruby/Kotlin equivalents per SARC-02.
- **Deleting before migrating:** The `## Discovery Context` section in `agent-prompt-deep.md` is unique. Delete the file only AFTER migrating that section to the three active prompts.
- **Adding `{{DISCOVERY_JSON}}` without a fallback:** Always include the fallback instruction ("if not replaced, scan all files") so agents don't break on repos that haven't gone through Phase 1 discovery.
- **Touching `promptDeep` in tests:** The test suite in `manager.test.js` does not reference `promptDeep`. Removing it from `manager.js` will not break any existing tests.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verifying prompt content in tests | A complex prompt parser | Capture the prompt via injected agentRunner mock and assert substrings | manager.test.js already uses `capturedPrompt` pattern (line 486) |
| Language detection in prompts | Runtime language detection code | `{{DISCOVERY_JSON}}` placeholder — discovery agent already returns `languages` array | Language detection is Phase 1's job; prompts just consume the context |
| Regex on prompt files | grep/regex parsing | Node.js `fs.readFileSync` + `.includes()` in tests | Simpler and less fragile |

---

## Common Pitfalls

### Pitfall 1: Missing Migration of Discovery Context Section

**What goes wrong:** Developer deletes `agent-prompt-deep.md` without copying the `## Discovery Context (from Phase 1)` section into the active prompts. The active prompts then have no `{{DISCOVERY_JSON}}` block, and Phase 76's discovery wiring has nowhere to inject output.

**Why it happens:** SARC-03 says "delete agent-prompt-deep.md" — easy to do without reading the migration precondition.

**How to avoid:** Explicitly migrate the discovery context section to all three active prompts FIRST, then delete the file.

**Warning signs:** After deletion, grep for `{{DISCOVERY_JSON}}` in the scan directory — if zero matches, migration was skipped.

### Pitfall 2: Removing promptDeep Breaks File Load at Startup

**What goes wrong:** The `readFileSync` for `agent-prompt-deep.md` is on line 340. If the file is deleted before the code reference is removed, the process crashes at startup with ENOENT.

**Why it happens:** Order of operations — file deleted from git, code not updated.

**How to avoid:** Remove the `const promptDeep = readFileSync(...)` line from `manager.js` in the SAME commit as or BEFORE deleting `agent-prompt-deep.md`.

**Warning signs:** Startup error: `ENOENT: no such file or directory, open '.../agent-prompt-deep.md'`

### Pitfall 3: Confidence Examples Remain Python/JS Only

**What goes wrong:** Developer adds `{{DISCOVERY_JSON}}` to active prompts but leaves the HIGH/LOW confidence examples in `agent-prompt-common.md` unchanged. The success criterion #1 is not met — no Java/C#/Ruby/Kotlin entry-point examples.

**Why it happens:** The success criterion allows either approach (examples OR `{{DISCOVERY_JSON}}`). Developer picks `{{DISCOVERY_JSON}}` but forgets it satisfies criterion #1 only if ALL hardcoded examples are replaced. If any hardcoded Python/JS examples remain, criterion #1 requires the others too.

**How to avoid:** Either (a) expand examples to include all four new languages, or (b) replace ALL hardcoded examples with a `{{DISCOVERY_JSON}}`-driven instruction.

### Pitfall 4: DISCOVERY_JSON Placeholder Not in Interpolation Chain

**What goes wrong:** `{{DISCOVERY_JSON}}` is added to the prompt templates but `manager.js`'s `interpolatedPrompt` chain doesn't include `.replaceAll("{{DISCOVERY_JSON}}", discoveryContext)`. The placeholder is sent literally to the agent.

**Why it happens:** Phase 76 (SARC-01) must wire this replacement — Phase 77 adds the placeholder, Phase 76 adds the interpolation. If Phase 76 is not yet complete when Phase 77 runs, the placeholder remains unresolved.

**How to avoid:** The prompt templates should include the fallback instruction: "If `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files." This makes prompts safe to use even before Phase 76 wires the replacement.

### Pitfall 5: Test Coverage Gap for Prompt Content

**What goes wrong:** After editing prompts, no test verifies that `{{DISCOVERY_JSON}}` appears in the active prompt sent to the agent, or that Java/C# patterns are included.

**Why it happens:** Prompt content is tested manually in the existing test suite only via `capturedPrompt` string assertions for the incremental constraint. No tests currently assert prompt content for language coverage.

**How to avoid:** Add at minimum one test that captures the interpolated prompt and asserts `{{DISCOVERY_JSON}}` is present (or that after interpolation it is replaced). Success criterion #2 (Java repo scan produces Java entry points) is an integration-level check that requires a real agent run — flag this as manual validation.

---

## Code Examples

### Existing capturedPrompt Test Pattern (reuse for SARC-02 tests)

```javascript
// Source: plugins/ligamen/worker/scan/manager.test.js, line 486
let capturedPrompt = null;
setAgentRunner(async (prompt, _repoPath) => {
  capturedPrompt = prompt;
  // ... return mock agent response
});
// Then assert:
assert.ok(capturedPrompt.includes("{{DISCOVERY_JSON}}"), "prompt must contain DISCOVERY_JSON placeholder");
assert.ok(capturedPrompt.includes("@RestController"), "prompt must include Java entry point pattern");
```

### Prompt Interpolation Chain in manager.js (reference for where to add DISCOVERY_JSON)

```javascript
// Source: plugins/ligamen/worker/scan/manager.js, lines 384-388
const interpolatedPrompt = promptTemplate
  .replaceAll("{{REPO_PATH}}", repoPath)
  .replaceAll("{{SERVICE_HINT}}", basename(repoPath))
  .replaceAll("{{COMMON_RULES}}", commonRules.replaceAll("{{REPO_PATH}}", repoPath))
  .replaceAll("{{SCHEMA_JSON}}", schemaJson);
// Phase 76 adds: .replaceAll("{{DISCOVERY_JSON}}", discoveryOutput)
// Phase 77 adds the {{DISCOVERY_JSON}} token to the template files themselves
```

### Dead Code to Remove from manager.js

```javascript
// Source: plugins/ligamen/worker/scan/manager.js, lines 339-340 — REMOVE BOTH LINES
// Legacy prompt kept as fallback
const promptDeep = readFileSync(join(__dirname, "agent-prompt-deep.md"), "utf8");
```

### Discovery Context Section to Migrate into Active Prompts

```markdown
<!-- Source: agent-prompt-deep.md lines 3-17 — migrate this section to service/library/infra prompts -->
## Discovery Context (from Phase 1)

{{DISCOVERY_JSON}}

Use the discovery context above to focus your scan:

- **Only read files relevant to the detected services** — route files, handler files, client files, config files
- **Use the framework hints** to know what patterns to look for (e.g., `@app.route` for Flask, `router.get` for Express, `@RestController` for Spring Boot)
- **Focus on `route_files`** listed above — these contain the endpoint definitions
- **Check `proto_files` and `openapi_files`** for API contracts
- **Check `event_config_files`** for message queue topics

If discovery context is empty or `{{DISCOVERY_JSON}}` was not replaced, fall back to scanning all files.
```

### Expanded HIGH Confidence Examples for agent-prompt-common.md

```markdown
<!-- Replace current HIGH block in agent-prompt-common.md lines 9-10 with: -->
**HIGH** — literal string definition in source code:
- `@app.route('/users')` — Python Flask
- `router.get('/health', handler)` — Node.js Express
- `@RestController` + `@GetMapping("/users")` — Java Spring Boot
- `[HttpGet("users")]` + `[Route("api/[controller]")]` — C# ASP.NET Core
- `get '/users', to: 'users#index'` — Ruby on Rails routes.rb
- `@Get("/users") fun getUsers()` — Kotlin Ktor / Spring Boot
- `producer.send('order.created', msg)` — event producer (any language)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single monolithic `agent-prompt-deep.md` | Three type-specific prompts (service/library/infra) | v5.3.x (Phase 73) | Dead code left behind |
| Python/JS examples only in confidence rules | Multi-language examples + discovery-driven guidance | Phase 77 | Agents scan Java/C#/Ruby/Kotlin repos accurately |
| `{{DISCOVERY_JSON}}` only in dead-code file | `{{DISCOVERY_JSON}}` in all three active prompts | Phase 77 | Phase 76 discovery wiring has a destination |

**Deprecated/outdated:**
- `agent-prompt-deep.md`: Superseded by type-specific prompts in Phase 73. Still referenced in manager.js as "Legacy prompt kept as fallback" — but never actually used as fallback. Safe to delete.

---

## Open Questions

1. **Phase 76 completion status**
   - What we know: SARC-01 (discovery agent + `{{DISCOVERY_JSON}}` wiring) is a prerequisite for Phase 77 per the dependency note. `{{DISCOVERY_JSON}}` interpolation does NOT exist in `manager.js` yet.
   - What's unclear: Whether Phase 76 will be complete before Phase 77 is planned/executed.
   - Recommendation: Phase 77 prompt templates should include `{{DISCOVERY_JSON}}` WITH the fallback instruction regardless. The templates are safe to deploy before Phase 76 wires the replacement — unresolved placeholders degrade gracefully when the fallback instruction is present.

2. **Success criterion #2 — Java repo integration test**
   - What we know: "Scanning a Java repo produces scan output where the agent correctly identifies Java entry points" is a behavioral criterion, not a unit test criterion.
   - What's unclear: Whether any test Java repos exist in the project for integration validation.
   - Recommendation: Flag this as a manual validation step. The planner should include a manual verification task where the implementer scans a known Java repo after the prompt changes.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (Node 20+ built-in) |
| Config file | None — run via `node --test` |
| Quick run command | `node --test plugins/ligamen/worker/scan/manager.test.js` |
| Full suite command | `node --test plugins/ligamen/worker/scan/manager.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SARC-02 | Active prompts contain Java/C#/Ruby/Kotlin examples OR `{{DISCOVERY_JSON}}` placeholder | unit | `node --test plugins/ligamen/worker/scan/manager.test.js --test-name-pattern "SARC-02"` | Wave 0 |
| SARC-02 | `{{DISCOVERY_JSON}}` placeholder appears in prompt sent to agent | unit | `node --test plugins/ligamen/worker/scan/manager.test.js --test-name-pattern "SARC-02"` | Wave 0 |
| SARC-02 | Java repo scan produces Java entry points (behavioral) | manual | n/a — requires real agent run | manual-only |
| SARC-03 | `agent-prompt-deep.md` does not exist | smoke | `node -e "const fs = require('fs'); if(fs.existsSync('plugins/ligamen/worker/scan/agent-prompt-deep.md')) process.exit(1);"` | n/a |
| SARC-03 | `promptDeep` does not appear in manager.js | smoke | `node -e "const src = require('fs').readFileSync('plugins/ligamen/worker/scan/manager.js','utf8'); if(src.includes('promptDeep')) process.exit(1);"` | n/a |
| SARC-03 | scanRepos still loads without error after file deletion | unit | `node --test plugins/ligamen/worker/scan/manager.test.js` | ✅ existing |

### Sampling Rate

- **Per task commit:** `node --test plugins/ligamen/worker/scan/manager.test.js`
- **Per wave merge:** `node --test plugins/ligamen/worker/scan/manager.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `plugins/ligamen/worker/scan/manager.test.js` needs new test cases for SARC-02: capture prompt sent to agent, assert `{{DISCOVERY_JSON}}` is present and/or Java/C#/Ruby/Kotlin patterns appear in the prompt template for service repos.

*(All other test infrastructure exists — node:test framework is already in use, `setAgentRunner` injection pattern and `capturedPrompt` pattern are established.)*

---

## Sources

### Primary (HIGH confidence)

- Source file inspection: `plugins/ligamen/worker/scan/manager.js` — confirmed `promptDeep` on line 340, confirmed unused in routing logic
- Source file inspection: `plugins/ligamen/worker/scan/agent-prompt-common.md` — confirmed Python/JS bias on lines 10, 13
- Source file inspection: `plugins/ligamen/worker/scan/agent-prompt-deep.md` — confirmed unique `## Discovery Context` section, confirmed `{{DISCOVERY_JSON}}` placeholder
- Source file inspection: `plugins/ligamen/worker/scan/agent-prompt-service.md`, `agent-prompt-library.md`, `agent-prompt-infra.md` — confirmed no `{{DISCOVERY_JSON}}` present
- Source file inspection: `plugins/ligamen/worker/scan/manager.test.js` — confirmed `capturedPrompt` test pattern exists, confirmed no tests reference `promptDeep`
- `.planning/REQUIREMENTS.md` — SARC-02, SARC-03 requirements verbatim

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — Phase 76 dependency noted: "SARC-02 requires discovery context to be wired before removing Python/JS bias"

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, pure file editing in established codebase
- Architecture: HIGH — all prompt files, manager.js, and test patterns directly inspected
- Pitfalls: HIGH — confirmed by reading actual code; all pitfalls are based on verified source state

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain — prompt files and manager.js are not fast-moving)
