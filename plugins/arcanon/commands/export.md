---
description: Export the local service graph as Mermaid, DOT, or a self-contained HTML viewer.
allowed-tools: Bash
argument-hint: "[--format mermaid|dot|html|json|all] [--out <dir>]"
---

# Arcanon Export

Emit the local service graph in one or more formats. The HTML output is a
single self-contained file with a cytoscape-powered viewer — drop it on a
static host, email it, or open it offline. Mermaid and DOT are the
standard "paste into a PR" formats.

Defaults: `--format all`, `--out .arcanon/reports/<timestamp>/`.

## Run

```bash
node ${CLAUDE_PLUGIN_ROOT}/worker/cli/export.js $ARGUMENTS
```

## Report

Relay the script's stdout (it lists the written files). If the user asked
for `html`, offer to open it:

- macOS: `open <path>`
- Linux: `xdg-open <path>`
- Windows: `start <path>`

If the user wants to paste Mermaid into a doc, show them the contents of
`graph.mmd` directly — it's already fenced.

If the command errors with "no local scan", tell them to run `/arcanon:map`
first.
