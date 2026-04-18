---
description: Upload the latest local scan for the current repo to Arcanon Hub.
allowed-tools: Bash
argument-hint: "[--project <slug>] [--repo <path>]"
---

# Arcanon Upload

Push the latest findings from the local SQLite DB to
`POST /api/v1/scans/upload`. Runs manually — useful when
`hub.auto-upload` is disabled or you want to retry after a failed auto sync.

## Preflight

Make sure:
1. A scan exists. If no `~/.arcanon/projects/*/impact-map.db` row covers
   the current repo, tell the user to run `/arcanon:map` first.
2. Credentials exist. If not, route to `/arcanon:login`.

## Run

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $ARGUMENTS
```

The CLI handles everything — it reads the latest findings for the current
repo, wraps them in `ScanPayloadV1`, POSTs with exponential backoff, and
either confirms `scan_upload_id` or enqueues on retriable failure.

## Report

Relay the script's stdout verbatim. On failure, check the printed error:

- "no local scan found" → `/arcanon:map` first.
- "hub returned 422" → findings reconciliation bug — suggest filing an issue with the warning list.
- "hub returned 429" → rate limit — surface the Retry-After hint.
- "network error" → the payload is safely queued; `/arcanon:sync` will retry later.
