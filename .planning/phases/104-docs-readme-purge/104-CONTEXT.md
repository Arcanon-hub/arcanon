# Phase 104: Docs & README Purge — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — well-scoped doc sweep)

<domain>
## Phase Boundary

Command docs, skill docs, CHANGELOG, and README have zero `ligamen` references in user-facing surfaces. CHANGELOG carries a dedicated `### BREAKING` subsection explaining the rename removal. README retracts the v0.1.1 "legacy honored" paragraphs and removes the `## Related repos` section entirely.

**Requirements (6):** DOC-01, DOC-02, DOC-03, README-01, README-02, README-03.

</domain>

<decisions>
## Implementation Decisions

### Preserve historical CHANGELOG entries
The `[0.1.0] Pre-release fixes` section and any earlier historical text MUST be preserved as historical record. Only the `[Unreleased]` section gets the new BREAKING entry.

### README: delete paragraphs, not just rename
The two ligamen-referencing paragraphs in README must be DELETED or REPLACED, not cosmetically renamed. Per requirements:
- L63: "Legacy `ligamen.config.json` is still honored" paragraph → delete entirely
- L107: "Arcanon was formerly known as Ligamen..." paragraph → replace with single line "Arcanon `0.1.0` was the first release under the current name."

### README: remove Related repos section
L94-L101 entire `## Related repos` section (with 4 table rows linking to arcanon-hub, arcanon-scanner, arcanon-plugin, arcanon-skills) → delete entirely. These repos either don't exist publicly or aren't relevant to plugin users.

### CHANGELOG BREAKING section content (from Phase 101 VERIFICATION)
Required entries:
1. Removed all `LIGAMEN_*` env var reads
2. Removed `$HOME/.ligamen` data-dir fallback
3. Removed `ligamen.config.json` config reader
4. Renamed ChromaDB `COLLECTION_NAME` from `"ligamen-impact"` to `"arcanon-impact"` — existing collections orphaned; rebuild via `/arcanon:map`
5. Renamed `runtime-deps.json` package identity from `@ligamen/runtime-deps` to `@arcanon/runtime-deps`

Migration instructions for users:
- Rename `ligamen.config.json` → `arcanon.config.json`
- Rename `$HOME/.ligamen/` → `$HOME/.arcanon/`
- Rename any shell profile `LIGAMEN_*` env vars to `ARCANON_*` equivalents

### SKILL.md fix (DOC-02)
The skill `plugins/arcanon/skills/impact/SKILL.md` currently shows users a settings example with `LIGAMEN_CHROMA_MODE`. Phase 101 removed that read path — the skill example needs updating to `ARCANON_CHROMA_MODE`. This is the user-reported inconsistency.

</decisions>

<code_context>
## Existing Code Insights

### Files in scope (from initial residue scan)

- `plugins/arcanon/commands/drift.md` (2-3 refs)
- `plugins/arcanon/commands/status.md` (1-2 refs)
- `plugins/arcanon/skills/impact/SKILL.md` (4 refs — 3 LIGAMEN_CHROMA_* env var examples + 1 mention)
- `plugins/arcanon/CHANGELOG.md` — add BREAKING section (don't delete historical entries)
- `README.md` L63 — paragraph deletion
- `README.md` L94-101 — section deletion
- `README.md` L107 — paragraph replacement

### Out of scope (Phase 102 handles these)
- `worker/scan/agent-prompt-*.md` files — Phase 102 owns them (they're source code, not docs)
- `CLAUDE.md` at repo root — pre-existing untracked file, not part of this plugin

### Note: commands directory at repo root vs plugin
`plugins/arcanon/commands/*.md` are user-invoked slash commands and count as user-facing docs.
`worker/` internal files with comments are source code (Phase 102 scope).

</code_context>

<specifics>
## Specific Ideas

### Approach
For README.md:
1. Read full file
2. Delete L63 paragraph (the one starting "Arcanon reads `arcanon.config.json`...")
3. Actually — that paragraph has value (tells users about config file). Delete ONLY the "Legacy ligamen.config.json is still honored" sentence.
4. Delete the entire `## Related repos` section (from heading through last table row)
5. Replace L107 paragraph with single-line sentence

For CHANGELOG.md:
1. Under `[Unreleased]`, add `### BREAKING` subsection at the top
2. List the 5 breaking changes with migration instructions
3. Preserve the existing `[Unreleased] ### Fixed` section (pre-release fixes) but note these become retroactive `[0.1.1]` or are already in `[0.1.0] Pre-release fixes`
4. Verify `[0.1.0] Pre-release fixes` section is untouched

For commands/*.md and skills/*/SKILL.md:
1. Find every ligamen mention
2. Rename to arcanon equivalent
3. Special handling for SKILL.md: update the env var settings example from `LIGAMEN_CHROMA_*` to `ARCANON_CHROMA_*`

### Verification greps
```bash
grep -ni "ligamen" plugins/arcanon/commands/drift.md plugins/arcanon/commands/status.md plugins/arcanon/skills/impact/SKILL.md  # should be 0
grep -ni "ligamen" README.md  # should be 0 (no exclusions in README)
grep -ni "ligamen" plugins/arcanon/CHANGELOG.md | grep -v "0.1.0\] Pre-release"  # should be 0 outside historical section
```

</specifics>

<deferred>
## Deferred Ideas

None — this phase is fully scoped.

</deferred>
