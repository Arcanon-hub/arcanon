#!/usr/bin/env bash
# Ligamen test helper — loads bats-support and bats-assert
# NOTE: Do not set PLUGIN_ROOT here. Each test file sets its own PLUGIN_ROOT
# (pointing to plugins/arcanon/) before loading this helper.
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

load "$TEST_DIR/test_helper/bats-support/load"
load "$TEST_DIR/test_helper/bats-assert/load"
