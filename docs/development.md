# Development

> **Audience:** Contributors to the Arcanon codebase. If you just want to use Arcanon, see [Commands](commands.md).

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- Node.js v20+ (for worker features)
- `shellcheck` (for linting: `brew install shellcheck`)

## Setup

```bash
git clone https://github.com/Arcanon-hub/arcanon.git
cd arcanon
git submodule update --init --recursive
cd plugins/arcanon && npm install
```

## Makefile Targets

```bash
make help        # show all targets
make test        # run all bats tests (245+)
make lint        # shellcheck scripts and libs
make check       # validate plugin.json and hooks.json
make install     # register marketplace and install plugin
make uninstall   # remove plugin
make dev         # launch Claude Code with plugin loaded (no install)
```

## Testing

Tests use [bats-core](https://github.com/bats-core/bats-core):

```bash
make test                    # all bats tests
npm run test:storage         # query engine unit tests (node:test)
```

## Quick Test (no install)

```bash
claude --plugin-dir /path/to/arcanon
```

## Pre-commit Check

Run all checks before committing:

```bash
make lint && make check && make test
```
