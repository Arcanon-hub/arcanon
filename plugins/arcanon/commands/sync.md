---
description: Drain the offline upload queue — retry scans that couldn't sync earlier.
allowed-tools: Bash
argument-hint: "[--limit N]"
---

# Arcanon Sync

Process every queued payload whose `next_attempt_at` is due.

Run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh sync $ARGUMENTS
```

The CLI prints a one-line report:

> `drain: attempted=N succeeded=K failed=M dead=D (pending=P)`

Interpretation:
- `succeeded` rows are removed from the queue.
- `failed` rows reschedule with exponential backoff (30s → 6h).
- `dead` rows hit MAX_ATTEMPTS (5) or a non-retriable error (e.g. 422)
  and stay in the queue for inspection — run `/arcanon:status` to see them.

If the user wants a full row-level view of the queue, run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh queue
```

If dead rows look unrecoverable, suggest deleting them with:

```bash
sqlite3 ~/.arcanon/hub-queue.db "DELETE FROM uploads WHERE status='dead'"
```
