#!/bin/sh
# Runs the drawing editor's UI tests on a simulator made for the run, as
# scripts/simulator.sh makes it; DRAWING_UI_DEVICE names a device type. The
# menu keyboard tests run first, alone, on the fresh boot, since a key
# pressed by a later test attaches a hardware keyboard, and with one attached
# no software keyboard comes up.
set -eu
cd "$(dirname "$0")/.."
. scripts/simulator.sh
make_simulator "Drawing UI tests" "${DRAWING_UI_DEVICE:-}"

xcodegen generate
set -- -project Lexidraw.xcodeproj -scheme DrawingHarness -destination "id=$udid" -skipPackagePluginValidation "$@"
xcodebuild build-for-testing "$@"
status=0
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -only-testing:DrawingUITests/MenuKeyboardUITests || status=$?
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -skip-testing:DrawingUITests/MenuKeyboardUITests || status=$?
exit "$status"
