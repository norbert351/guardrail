#!/usr/bin/env bash
# Verify GuardRailMarketplace v2 source on BscScan (via Etherscan V2, chain 56).
#
# STATUS: staged and ready. The ONLY blocker is an API key — verification needs
# one and there is none on this box (checked 2026-09-10: no ETHERSCAN_API_KEY /
# BSCSCAN_API_KEY in env, no ~/.foundry/etherscan.toml).
#
# Get a free key: https://etherscan.io/myapikey  (V2 covers BSC with chainid=56).
# Then:
#     export ETHERSCAN_API_KEY=YOUR_KEY
#     bash contracts/verify-bscscan.sh
#
# BscScan V1 (api.bscscan.com/api) is DEPRECATED — it returns
# "You are using a deprecated V1 endpoint". Etherscan V2 is the working route.
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"

ADDR=0xb7c80f5154952E48f6E1548282343000c45b80d6
CONTRACT=src/GuardRailMarketplace.sol:GuardRailMarketplace
# Constructor args: (address keyStore, address admin) — both mainnet values.
CTOR=0x0000000000000000000000006572427ed530badcf7375cf9a4709d8d2b0e7e0a000000000000000000000000a847f3bbf69e8a888b59bc8729ce787e0db5be97

if [ -z "${ETHERSCAN_API_KEY:-}" ]; then
  echo "ERROR: ETHERSCAN_API_KEY is not set."
  echo "  1. Get a free key at https://etherscan.io/myapikey"
  echo "  2. export ETHERSCAN_API_KEY=YOUR_KEY"
  echo "  3. re-run: bash contracts/verify-bscscan.sh"
  exit 1
fi

cd "$(dirname "$0")"

forge verify-contract "$ADDR" "$CONTRACT" \
  --chain 56 \
  --constructor-args "$CTOR" \
  --verifier etherscan \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --watch

echo
echo "Verify at: https://bscscan.com/address/$ADDR#code"
