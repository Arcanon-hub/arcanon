# Phase 79: Version Bump - Research

**Researched:** 2026-03-22
**Domain:** JSON manifest version synchronization
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REL-01 | All manifest files (package.json, marketplace.json, plugin.json) version-bumped to 5.4.0 | All four files identified, current values confirmed, correct JSON paths documented |
</phase_requirements>

## Summary

Phase 79 is the release gate for v5.4.0 — it bumps four JSON manifest files to `"version": "5.4.0"`. This is pure file editing: no code logic changes, no new dependencies, no test infrastructure required. The version string must be consistent across all files so the Claude marketplace surfaces the correct version on `claude plugin marketplace add`.

The project has shipped this exact operation four times before (v5.2.0 in Phase 61, with v5.2.1 / v5.3.0 / v5.3.1 following the same pattern). Precedent and file paths are fully established.

The `make check` target only validates JSON syntax (`jq empty`) — it does NOT validate that version strings match. Version correctness must be verified with `jq` queries directly against the version fields.

**Primary recommendation:** Edit all four files in one plan task using the Edit tool. Verify each with `jq -e` assertions immediately after. Run `make check` for JSON validity confirmation.

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| jq | system | Query and validate JSON files | Already required by `make check`; used in all prior version-bump verifications |
| Edit tool | — | Surgical in-place JSON edits | No risk of reformatting or whitespace changes |

No npm packages, no new libraries, no runtime dependencies.

**No installation required** — `jq` is already present (make check uses it).

## File Inventory

### Files Requiring Version Bump

| File | Current Version | JSON Path to Version |
|------|----------------|----------------------|
| `plugins/ligamen/package.json` | `5.3.1` | `.version` (top-level) |
| `plugins/ligamen/.claude-plugin/marketplace.json` | `5.3.1` | `.plugins[0].version` |
| `plugins/ligamen/.claude-plugin/plugin.json` | `5.3.1` | `.version` (top-level) |
| `.claude-plugin/marketplace.json` | `5.3.0` | `.plugins[0].version` |

### Files NOT Requiring a Bump This Phase

| File | Current Version | Reason |
|------|----------------|---------|
| `plugins/ligamen/runtime-deps.json` | `5.3.0` | Phase 79 success criteria only reference the three plugin files; runtime-deps.json not listed in REL-01 or success criteria |
| `.mcp.json` | `{"mcpServers": {}}` | Empty object — no version field, no change needed |

> NOTE: In Phase 61 (v5.2.0), runtime-deps.json was bumped because it is used by install-deps.sh as a diff sentinel. Review whether this is still needed for v5.4.0. The REL-01 requirement and phase success criteria do NOT list runtime-deps.json, so it is excluded unless the planner decides otherwise.

## Architecture Patterns

### Pattern: Direct JSON Edit (Established Practice)

This project has never used an automated bump script. Every version-bump phase has been a direct Edit-tool operation per file.

From Phase 61 precedent:
- Read each file first
- Edit only the version value — do not alter other fields, whitespace, or formatting
- Verify with `jq -e` assertions immediately after each edit
- Run `make check` at the end for JSON syntax validation

### Verification Command Pattern

```bash
# Top-level version files
jq -e '.version == "5.4.0"' plugins/ligamen/package.json
jq -e '.version == "5.4.0"' plugins/ligamen/.claude-plugin/plugin.json

# Nested plugins[0].version files
jq -e '.plugins[0].version == "5.4.0"' plugins/ligamen/.claude-plugin/marketplace.json
jq -e '.plugins[0].version == "5.4.0"' .claude-plugin/marketplace.json

# JSON syntax validation
make check
```

### Anti-Patterns to Avoid

- **sed substitution:** Risk of replacing version strings in unintended locations (e.g., dependency version ranges, comments). Use Edit tool with exact string targeting.
- **jq --arg rewrite:** Rewrites the entire file via stdout; loses formatting if piped incorrectly. Not needed when using the Edit tool.
- **Bumping only 3 of 4 files:** The root `.claude-plugin/marketplace.json` is separate from `plugins/ligamen/.claude-plugin/marketplace.json` — both must be bumped. This was a known pitfall in v5.2.0 (root file was stale at 0.2.0).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| JSON validation | Custom validator | `jq empty` (already in `make check`) |
| Version sync check | Custom script | `jq -e '.version == "5.4.0"'` per file |

## Common Pitfalls

### Pitfall 1: Forgetting the Root marketplace.json
**What goes wrong:** Only the plugin-scoped `plugins/ligamen/.claude-plugin/marketplace.json` is bumped; the root `.claude-plugin/marketplace.json` stays at 5.3.0. Claude marketplace still shows 5.3.0 on `claude plugin marketplace add`.
**Why it happens:** There are two marketplace.json files at different paths. Easy to treat them as one.
**How to avoid:** Always treat both marketplace.json files as separate bump targets. Verify both with jq assertions.
**Warning signs:** Root `.claude-plugin/marketplace.json` still shows `5.3.0` after the task.

### Pitfall 2: make check Does Not Check Version Strings
**What goes wrong:** `make check` passes (JSON is syntactically valid) but a file still has `"5.3.1"`. The phase is considered done but the marketplace shows the wrong version.
**Why it happens:** `make check` only runs `jq empty` — it checks JSON syntax, not version value correctness.
**How to avoid:** Always run the `jq -e '.version == "5.4.0"'` assertions separately from `make check`. Both checks are required.

### Pitfall 3: Nested vs Top-Level Version Path
**What goes wrong:** `jq -e '.version'` returns null for marketplace.json because the version is at `.plugins[0].version`.
**Why it happens:** marketplace.json has a different schema — version is nested under the plugins array.
**How to avoid:** Use the correct jq path per file type (see File Inventory table above).

## Code Examples

### Verify All Four Files at Once
```bash
# Source: established pattern from Phase 61 PLAN.md
jq -e '.plugins[0].version == "5.4.0"' .claude-plugin/marketplace.json && \
jq -e '.plugins[0].version == "5.4.0"' plugins/ligamen/.claude-plugin/marketplace.json && \
jq -e '.version == "5.4.0"' plugins/ligamen/.claude-plugin/plugin.json && \
jq -e '.version == "5.4.0"' plugins/ligamen/package.json && \
make check && \
echo "ALL FILES AT 5.4.0 — JSON VALID"
```

### Negative Check (No Old Versions Remain)
```bash
# Confirm 5.3.0 and 5.3.1 are gone from version fields
grep -r '"5\.3\.' \
  .claude-plugin/marketplace.json \
  plugins/ligamen/.claude-plugin/marketplace.json \
  plugins/ligamen/.claude-plugin/plugin.json \
  plugins/ligamen/package.json
# Should return no output
```

## Validation Architecture

nyquist_validation is enabled. However, this phase has no automated tests — version bump is a data change, not a logic change.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bats (tests/*.bats) |
| Config file | none — bats runs directly |
| Quick run command | `make test` |
| Full suite command | `make test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 | All manifests at 5.4.0 | manual verification | `jq -e '.version == "5.4.0"' plugins/ligamen/package.json && jq -e '.version == "5.4.0"' plugins/ligamen/.claude-plugin/plugin.json && jq -e '.plugins[0].version == "5.4.0"' plugins/ligamen/.claude-plugin/marketplace.json && jq -e '.plugins[0].version == "5.4.0"' .claude-plugin/marketplace.json` | ✅ (inline jq, no test file needed) |

**Why no bats test:** Version correctness is verified by direct jq assertions in the task verification block. There is no behavior under test — only data values. Adding a bats test for this would be testing the file system, not logic.

### Sampling Rate
- **Per task commit:** Run jq assertions inline (see verification command above)
- **Per wave merge:** `make check`
- **Phase gate:** All four jq assertions pass and `make check` exits 0

### Wave 0 Gaps
None — existing infrastructure (jq + make check) covers all verification needs.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No precedent for automated bump script | Direct Edit tool per file | Always | No change — manual is correct for this project |

**Deprecated/outdated:**
- Automated bump-version.sh was explicitly deferred in Phase 61 CONTEXT.md as a future requirement. It is still not present and not needed for this phase.

## Open Questions

1. **Should runtime-deps.json be bumped?**
   - What we know: It was bumped in Phase 61 (v5.2.0). Current value is `5.3.0`. REL-01 and the phase success criteria do NOT list it.
   - What's unclear: Whether the install-deps.sh diff-sentinel use case still requires it to match the other manifest versions.
   - Recommendation: Planner should confirm whether to include it. If in doubt, bump it for consistency — it is low risk.

## Sources

### Primary (HIGH confidence)
- Direct file reads: `plugins/ligamen/package.json`, `plugins/ligamen/.claude-plugin/marketplace.json`, `plugins/ligamen/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/ligamen/runtime-deps.json` — current version values confirmed
- `Makefile` — `make check` implementation confirmed (jq empty only)
- `.planning/phases/061-version-sync/61-01-PLAN.md` — prior version-bump plan structure and verification patterns
- `.planning/phases/061-version-sync/61-CONTEXT.md` — version field schema differences documented
- `.planning/REQUIREMENTS.md` — REL-01 definition
- `.planning/config.json` — nyquist_validation: true confirmed

### Secondary (MEDIUM confidence)
- None needed — all findings come from direct file inspection

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- File inventory and current versions: HIGH — directly read from filesystem
- JSON path patterns: HIGH — confirmed from prior plan and direct jq verification patterns
- make check behavior: HIGH — read directly from Makefile
- Pitfalls: HIGH — derived from Phase 61 CONTEXT.md notes about root marketplace.json being stale

**Research date:** 2026-03-22
**Valid until:** This research is tied to static file paths and version numbers. Valid until any file is restructured. Stable indefinitely for planning purposes.
