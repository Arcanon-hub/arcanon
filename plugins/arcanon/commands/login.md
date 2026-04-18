---
description: Store your Arcanon Hub API key so scans can sync to the cloud.
allowed-tools: Bash, AskUserQuestion
argument-hint: "[arc_... api key]"
---

# Arcanon Login

Save an API key so other `/arcanon:*` commands can talk to the hub at
`https://api.arcanon.dev`. The key is written to `~/.arcanon/config.json`
with mode `0600`.

## What to do

**1. Resolve the key.**

If `$ARGUMENTS` is non-empty and starts with `arc_`, use it as the API key.
Otherwise use AskUserQuestion to prompt the user:

> "Paste your Arcanon Hub API key. Create one at https://app.arcanon.dev/settings/api-keys — it starts with `arc_`."

**2. Persist it.**

Run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh login --api-key "<KEY>"
```

Do **not** print the key back to the user. The script confirms success.

The hub exposes no way to validate an `arc_*` key without an actual
upload, so treat the `/arcanon:login` step as storage-only. The first
`/arcanon:upload` call will surface a bad key as 401 within seconds.

**3. Nudge toward the next step.**

If `arcanon.config.json` does not have `hub.auto-upload: true`, mention:

> "Want Arcanon to upload automatically after every `/arcanon:map` scan?
> Set `hub.auto-upload: true` in `arcanon.config.json`, or run
> `/arcanon:upload` manually."
