# Configuration

AllClear works with zero configuration. All features auto-detect project types and tools.

## Project Config: `allclear.config.json`

Lives in your project root. Committed to git.

```json
{
  "linked-repos": [
    "../api",
    "../auth",
    "../sdk"
  ],
  "impact-map": {
    "history": true
  }
}
```

| Key | Purpose |
|-----|---------|
| `linked-repos` | Explicit list of connected repos. Auto-discovered from parent dir if absent. |
| `impact-map` | Created automatically after first `/allclear:map`. Presence triggers worker auto-start. |

## Machine Settings: `~/.allclear/settings.json` {#machine-settings}

Machine-specific settings. Never committed.

```json
{
  "ALLCLEAR_WORKER_PORT": "37888",
  "ALLCLEAR_WORKER_HOST": "127.0.0.1",
  "ALLCLEAR_DATA_DIR": "/Users/you/.allclear",
  "ALLCLEAR_LOG_LEVEL": "INFO",
  "ALLCLEAR_CHROMA_MODE": "local",
  "ALLCLEAR_CHROMA_HOST": "localhost",
  "ALLCLEAR_CHROMA_PORT": "8000",
  "ALLCLEAR_CHROMA_SSL": "false",
  "ALLCLEAR_CHROMA_API_KEY": "",
  "ALLCLEAR_CHROMA_TENANT": "default_tenant",
  "ALLCLEAR_CHROMA_DATABASE": "default_database"
}
```

## Environment Variables {#environment-variables}

| Variable | Effect |
|----------|--------|
| `ALLCLEAR_DISABLE_FORMAT=1` | Skip auto-formatting |
| `ALLCLEAR_DISABLE_LINT=1` | Skip auto-linting |
| `ALLCLEAR_DISABLE_GUARD=1` | Skip file guard |
| `ALLCLEAR_DISABLE_SESSION_START=1` | Skip session context |
| `ALLCLEAR_LINT_THROTTLE=<seconds>` | Cargo clippy throttle (default: 30) |
| `ALLCLEAR_EXTRA_BLOCKED=<patterns>` | Colon-separated glob patterns to block |

## Data Directory: `~/.allclear/`

```
~/.allclear/
├── settings.json              # machine settings
├── worker.pid                 # daemon PID
├── worker.port                # actual bound port
├── logs/                      # worker logs
└── projects/
    └── <project-hash>/
        ├── impact-map.db      # per-project graph DB
        └── snapshots/         # version history
```
