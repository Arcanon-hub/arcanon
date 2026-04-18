.PHONY: test lint check install uninstall dev help

PLUGIN_NAME := arcanon
PLUGIN_DIR  := $(shell pwd)/plugins/$(PLUGIN_NAME)
BATS        := ./tests/bats/bin/bats

help: ## Show available targets
	@grep -E '^[a-z][a-z_-]+:.*##' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

test: ## Run all bats tests
	$(BATS) tests/*.bats

lint: ## Shellcheck scripts and libs
	shellcheck -x -e SC1091 plugins/$(PLUGIN_NAME)/scripts/*.sh plugins/$(PLUGIN_NAME)/lib/*.sh

check: ## Validate plugin.json and hooks.json
	jq empty plugins/$(PLUGIN_NAME)/.claude-plugin/plugin.json
	jq empty plugins/$(PLUGIN_NAME)/hooks/hooks.json
	@echo "JSON valid"

install: plugins/$(PLUGIN_NAME) ## Register marketplace and install plugin
	claude plugin marketplace add $(shell pwd)
	claude plugin install $(PLUGIN_NAME)@$(PLUGIN_NAME) --scope user

plugins/$(PLUGIN_NAME):
	@test -d plugins/$(PLUGIN_NAME) || (echo "ERROR: plugins/$(PLUGIN_NAME) not found. Complete Phase 49 (directory restructure) first." && exit 1)

uninstall: ## Remove plugin and marketplace registration
	claude plugin uninstall $(PLUGIN_NAME)@$(PLUGIN_NAME) || true
	claude plugin marketplace remove $(shell pwd) || true

dev: ## Launch Claude Code with this plugin loaded (no install)
	claude --plugin-dir $(PLUGIN_DIR)
