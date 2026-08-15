#!/bin/bash
# Build the dsh-subscription-auth external plugin: compile src/ → lib/ with the dsh
# checkout's TypeScript. Dependency linking mirrors dsh-vision: the plugin's
# node_modules holds symlinks into the dsh checkout, so tsc type-checks against
# the same vendored/workspace packages the running dsh ships. Requires `dsh`
# on PATH and the checkout's `packages/` + `vendor/` layout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT=""
if command -v dsh &>/dev/null; then
  DSH_BIN=$(readlink -f "$(command -v dsh)" 2>/dev/null || command -v dsh)
  CHECKOUT=$(cd "$(dirname "$DSH_BIN")/../../.." && pwd)
fi
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ]; then
  echo "build: cannot locate the dsh checkout (dsh not on PATH?)" >&2
  exit 1
fi

TSC="$CHECKOUT/node_modules/.bin/tsc"
if [ ! -x "$TSC" ]; then
  echo "build: tsc not found at $TSC" >&2
  exit 1
fi

link_pkg() {
  local target="$CHECKOUT/$2"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    echo "       (if your checkout lays this package out differently, fix the path in build.sh)" >&2
    exit 1
  fi
  mkdir -p "$(dirname "node_modules/$1")"
  ln -sfn "$target" "node_modules/$1"
}

echo "=== Linking build dependencies (checkout: $CHECKOUT) ==="
mkdir -p node_modules/@deepseek-ai node_modules/@standard-schema
ln -sfn "$CHECKOUT/node_modules/@types" node_modules/@types
link_pkg @deepseek-ai/cordis vendor/cordis
link_pkg cosmokit vendor/cosmokit
link_pkg @deepseek-ai/schemastery vendor/schemastery
link_pkg @deepseek-ai/dsh-brand packages/util/brand
link_pkg @deepseek-ai/dsh-llm packages/llm/llm
link_pkg @deepseek-ai/dsh-credentials packages/credentials/credentials
link_pkg @deepseek-ai/dsh-settings packages/settings/settings
link_pkg @deepseek-ai/dsh-tools packages/core/tools

STD_SCHEMA=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1)
if [ -n "$STD_SCHEMA" ]; then
  ln -sfn "$STD_SCHEMA/node_modules/@standard-schema/spec" node_modules/@standard-schema/spec
else
  echo "build: @standard-schema/spec not found in pnpm store; skipLibCheck may still cover it" >&2
fi

echo "=== Compiling src → lib (tsc $("$TSC" --version)) ==="
"$TSC" -p tsconfig.json

echo "=== Build complete ==="
ls -la lib/ lib/types/
