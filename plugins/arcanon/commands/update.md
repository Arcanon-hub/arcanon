---
description: Check for a newer Arcanon release and (after Phase 2-3 plans) apply it cleanly.
allowed-tools: Bash
argument-hint: "[--check-only]"
---

# Arcanon Update

Check the installed plugin version against the latest on the Arcanon marketplace,
show a short changelog preview if there is one, and (after Phase 98-02 + 98-03
ship) orchestrate a clean self-update.

**Phase 1 status:** only the `--check` step is wired. Confirmation, kill, prune,
and verify arrive in plans 98-02 and 98-03.

## Pre-flight (one-time, during implementation)

Before writing any code, verify:

```bash
claude plugin update --help 2>&1 | grep -i -- '--yes'
```

- If `--yes` / `-y` exists: plan 98-02 can auto-confirm the reinstall step.
- If not: plan 98-02 instructs the user to approve the interactive prompt.

Record the result in the 98-01 SUMMARY so plan 98-02 knows which branch to wire.

## Step 1 — Check current vs. remote version

Run:

```bash
CHECK=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/update.sh" --check)
```

The script emits JSON with keys `status`, `installed`, `remote`, `update_available`, `changelog_preview`.

Possible `status` values and what to say to the user:

| status | Message |
|--------|---------|
| `equal` | `Arcanon v{installed} is the latest release.` — then stop. |
| `ahead` | `You're running v{installed}, which is ahead of the published v{remote}. Nothing to update.` — then stop. |
| `offline` | `Could not reach update server. Your current version is v{installed}.` — then stop. |
| `unknown` | `Could not determine a valid version comparison (installed={installed}, remote={remote}). No update applied.` — then stop. |
| `newer` | Render the changelog preview (Step 2) and tell the user plans 98-02/98-03 will add the apply flow. |

Extract fields with `jq`:

```bash
STATUS=$(printf '%s' "$CHECK" | jq -r '.status')
INSTALLED=$(printf '%s' "$CHECK" | jq -r '.installed')
REMOTE=$(printf '%s' "$CHECK" | jq -r '.remote')
PREVIEW=$(printf '%s' "$CHECK" | jq -r '.changelog_preview')
```

## Step 2 — Render changelog preview (only when `status=newer`)

Show exactly what's in `PREVIEW`. Do not summarize. If `PREVIEW` is empty (CHANGELOG had no bullets under the first section), fall back to:

> `Remote has v{remote}. No changelog preview available — see the project CHANGELOG for details.`

Otherwise:

> `Arcanon v{remote} is available. Changes:`
> `{PREVIEW verbatim, one bullet per line}`

## Step 3 — (Coming in plans 98-02 + 98-03)

Confirmation, kill, reinstall, cache prune, health poll, and the final
"Restart Claude Code to activate v{newver}" message are wired in the next
two plans. This command prints a placeholder for now:

> `Apply flow lands in plans 98-02 and 98-03. For now, run 'claude plugin update arcanon --scope user' manually.`

Never mutate state in this plan. The check is read-only.
