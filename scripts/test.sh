#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
DEVECO_DIR="${DEVECO_DIR:-/Applications/DevEco-Studio.app/Contents}"
NODE="$DEVECO_DIR/tools/node/bin/node"
export TYPESCRIPT_PATH="${TYPESCRIPT_PATH:-$DEVECO_DIR/tools/hvigor/hvigor/node_modules/typescript}"
"$NODE" "$TYPESCRIPT_PATH/bin/tsc" --noEmit --strict --target ES2020 entry/src/main/ets/model/Card.ts entry/src/main/ets/model/Weather.ts
"$NODE" tests/card.test.cjs
"$NODE" tests/store.test.cjs
"$NODE" tests/weather.test.cjs
