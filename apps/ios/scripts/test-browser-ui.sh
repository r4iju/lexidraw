#!/bin/sh
# Runs the browser's UI tests on a simulator made for the run, as
# scripts/simulator.sh makes it; BROWSER_UI_DEVICE names a device type. An
# iPad, since on an iPhone the sidebar folds away into one stack.
set -eu
cd "$(dirname "$0")/.."
. scripts/simulator.sh
make_simulator "Browser UI tests" "${BROWSER_UI_DEVICE:-}" iPad

xcodegen generate
set -- -project Lexidraw.xcodeproj -scheme BrowserHarness -destination "id=$udid" -skipPackagePluginValidation "$@"
xcodebuild build-for-testing "$@"
xcodebuild test-without-building "$@" -collect-test-diagnostics never
