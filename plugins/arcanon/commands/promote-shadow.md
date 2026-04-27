---
description: Atomically swap the shadow impact map over the live one. Backs up the prior live DB to impact-map.db.pre-promote-<timestamp>. Backup is NEVER auto-deleted.
argument-hint: "[--json]"
allowed-tools: Bash
---

# Arcanon Promote Shadow — Atomic Swap

Atomically promotes `impact-map-shadow.db` over `impact-map.db`:

1. **Active-scan-lock check** — refuses to promote if a live `/arcanon:map`
   or `/arcanon:rescan` is in progress for any repo under the current project
   (T-119-02-04). Wait for the scan to finish and retry.
2. **Evict cached live QueryEngine** — the worker's pool.js drops its cached
   handle and closes the underlying DB BEFORE the rename. Otherwise the
   worker would hold an fd to a renamed-out inode and subsequent live writes
   would land on the wrong file (T-119-02-01).
3. **Backup live** — `fs.renameSync(impact-map.db, impact-map.db.pre-promote-<ISO-timestamp>)`.
   Atomic POSIX rename — same filesystem guaranteed by sibling-path
   placement under `${ARCANON_DATA_DIR}/projects/<hash>/`.
4. **Promote shadow** — `fs.renameSync(impact-map-shadow.db, impact-map.db)`.
   Atomic POSIX rename. WAL sidecars (`-wal`, `-shm`) are renamed alongside
   the main file in BOTH steps so SQLite never sees a stale log on next open.
5. **Report backup path** — printed to stdout. Operators clean up manually
   with `rm`.

## Hard contracts

- **Backup is NEVER auto-deleted.** Clean up manually with
  `rm impact-map.db.pre-promote-<ts>` once you're confident the promoted state
  is correct. To rollback: `mv impact-map.db.pre-promote-<ts> impact-map.db`.
- **Atomic POSIX rename.** Both DBs sit as siblings under
  `${ARCANON_DATA_DIR}/projects/<hash>/`. Same parent dir → same filesystem
  → `fs.rename` is atomic per POSIX `rename(2)`. There is no observable
  intermediate state on success.
- **Shadow `scan_overrides` becomes the new live `scan_overrides`.** Any
  rows in the live `scan_overrides` table from BEFORE the promote are LOST
  (per RESEARCH §2). This is by design — shadow scans are meant for
  "validate and commit" workflows, not parallel state.
- **First-promote.** If no live DB exists yet (greenfield project), the
  shadow is promoted in place with no backup and exit 0. Output line:
  `No live DB to back up; shadow promoted to live.`

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | Promote succeeded; backup path printed. |
| `1` | Rename failed mid-flight (e.g., disk full); rollback attempted. |
| `2` | No shadow DB to promote, OR a live scan is currently in progress. |

Silent (no output, exit 0) when run from a directory without an
`impact-map.db` AND no `impact-map-shadow.db` — same contract as
`/arcanon:list`, `/arcanon:doctor`, `/arcanon:diff`.

## Step 1 — Run

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/promote-shadow.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories per the SHADOW-03 contract
fi
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh promote-shadow $ARGUMENTS
```

## Help

**Usage:** `/arcanon:promote-shadow [--json]`

Atomically swap the shadow impact map over the live one. The prior live DB
is backed up to `impact-map.db.pre-promote-<ISO-timestamp>` and is never
auto-deleted.

**Options:**
- `--json` — emit `{ok, backup_path, live_path, evicted_cached_qe}` instead
  of the human line.
- `--help`, `-h`, `help` — print this help and exit.

**Examples:**
- `/arcanon:promote-shadow`
- `/arcanon:promote-shadow --json`

**Rollback:**
- `mv impact-map.db.pre-promote-<ts> impact-map.db`
