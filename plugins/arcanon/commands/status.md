---
description: One-line health check — worker, hub credentials, upload queue, config.
allowed-tools: Bash
---

# Arcanon Status

Print a compact status report for the current repo.

Run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh status
```

The script reports:
- Installed plugin version
- Resolved config file (`arcanon.config.json`)
- Project slug (from config)
- Credential presence (missing → suggest `/arcanon:login`)
- Whether `hub.auto-sync` is enabled
- Queue stats: pending / dead counts + oldest pending timestamp
- Data directory path (`~/.arcanon/`)
- Latest scan quality (when worker has graph data) — TRUST-05

Relay the output verbatim. If anything is obviously broken (missing
credentials with auto-sync on, dead rows in queue), call it out with
the appropriate next command.

If a `Latest scan: NN% high-confidence (S services, C connections)` line
is shown, the percent is the high-confidence ratio of the most recent
successful scan (formula: `(high + 0.5*low) / total`). The line is omitted
when the worker is offline or no completed scan exists for the project.
