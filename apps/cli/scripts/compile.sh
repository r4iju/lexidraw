#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
bun build --compile src/main.ts --outfile dist/lexidraw

# `--compile` appends the payload after the linker signed the executable, which
# leaves the signature stale and makes macOS kill the process on exec.
if [ "$(uname)" = "Darwin" ] && command -v codesign >/dev/null 2>&1; then
  codesign --sign - --force dist/lexidraw
fi
