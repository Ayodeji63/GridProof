#!/usr/bin/env bash
# Dry-runs Deploy.s.sol through `forge script` with throwaway parameters.
#
# `forge test` cannot cover this: guards like "Usage of `address(this)` detected in
# script contract" are enforced by the forge *script* runner, not the test runner, so
# a script-only defect compiles, passes all 62 unit tests, and fails at deploy time.
# This runs the real entry point (`run()` -> env -> deploy) to catch that class early.
#
# No RPC URL and no --broadcast: nothing is sent and no key is needed.
set -euo pipefail

cd "$(dirname "$0")/.."

NETWORK="simulate-$$"
MANIFEST="deployments/${NETWORK}.json"
trap 'rm -f "$MANIFEST"' EXIT

# Deliberately not sourced from .env — this must not depend on local operator config.
# Admin is forge's DEFAULT_SENDER so the zone-seeding branch is exercised, not skipped.
GRIDPROOF_NETWORK="$NETWORK" \
GRIDPROOF_ADMIN_ADDRESS=0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38 \
GRIDPROOF_RELAYER_ADDRESS=0x000000000000000000000000000000000000dEaD \
GRIDPROOF_ZONE_IDS=simulate-zone-1 \
  forge script script/Deploy.s.sol:Deploy

echo "OK: Deploy.s.sol simulates cleanly under the forge script runner."
