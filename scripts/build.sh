#!/usr/bin/env bash
# Builds every contract to target/near/<name>/<name>.wasm.
set -euo pipefail
cd "$(dirname "$0")/.."
for contract in agent collector registry xvault notemarket mocks/token mocks/outlayer; do
  (cd "contracts/$contract" && cargo near build non-reproducible-wasm)
done
