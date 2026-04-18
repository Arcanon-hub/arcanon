---
description: Validate the stored Arcanon Hub API key and print the bound org/project.
allowed-tools: Bash
---

# Arcanon Whoami

Check whether this machine is authenticated to Arcanon Hub.

Run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh whoami
```

The command calls `GET /api/v1/auth/whoami`. On success it prints the
org name and (for project-scoped keys) the project slug. On failure it
prints the HTTP status and a suggestion.

If the key is missing, tell the user to run `/arcanon:login`.

If the key is rejected (401/403), suggest rotating it at
https://app.arcanon.dev/settings/api-keys.
