# Development

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- Node.js v20+ (for worker features)
- `shellcheck` (for linting: `brew install shellcheck`)

## Setup

```bash
git clone https://github.com/chilleregeravi/allclear.git
cd allclear
git submodule update --init --recursive
npm install
```

## Makefile Targets

```bash
make help        # show all targets
make test        # run all bats tests (173+)
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
claude --plugin-dir /path/to/allclear
```

## Quality Gate

Run all checks before committing:

```bash
make lint && make check && make test
```

Or use AllClear itself: `/allclear:quality-gate`
