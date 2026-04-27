#!/usr/bin/env bats
# tests/hub-evidence-mode.bats — Phase 120-01 INT-01.
#
# End-to-end coverage of the hub.evidence_mode config flag. For each of the
# three valid values ("full", "hash-only", "none") spawns a node subprocess
# that drives buildScanPayload through the same boundary cmdUpload uses, and
# asserts payload.version + per-connection evidence shape.
#
# The Node-side payload-construction matrix lives at
# plugins/arcanon/worker/hub-sync/payload.test.js (M1-M11, including the
# load-bearing byte-identical regression at v1.1). This bats file proves the
# slash-command surface — config file -> payload bytes — actually wires
# end-to-end.

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURE_DIR="${REPO_ROOT}/plugins/arcanon/tests/fixtures/integration/evidence-mode"
BUILD_PAYLOAD="${FIXTURE_DIR}/build-payload.mjs"

@test "INT-01 bats: hub.evidence_mode='full' emits payload.version=1.0 with string evidence" {
  run node "$BUILD_PAYLOAD" full
  [ "$status" -eq 0 ]
  [[ "$output" == *'"version":"1.0"'* ]]
  [[ "$output" == *'"evidence":"fetch'* ]]
}

@test "INT-01 bats: hub.evidence_mode='hash-only' emits payload.version=1.2 with {hash, start_line, end_line}" {
  run node "$BUILD_PAYLOAD" hash-only
  [ "$status" -eq 0 ]
  [[ "$output" == *'"version":"1.2"'* ]]
  [[ "$output" == *'"hash":'* ]]
  [[ "$output" == *'"start_line":1'* ]]
  [[ "$output" == *'"end_line":1'* ]]
  # The string-form evidence must NOT appear in hash-only mode.
  [[ "$output" != *'"evidence":"fetch'* ]]
}

@test "INT-01 bats: hub.evidence_mode='none' emits payload.version=1.2 with no evidence field" {
  run node "$BUILD_PAYLOAD" none
  [ "$status" -eq 0 ]
  [[ "$output" == *'"version":"1.2"'* ]]
  [[ "$output" != *'"evidence"'* ]]
}

@test "INT-01 bats: build-payload.mjs rejects unknown mode argument with non-zero exit" {
  run node "$BUILD_PAYLOAD" weird-not-real
  [ "$status" -ne 0 ]
  [[ "$output" == *'usage:'* ]]
}
