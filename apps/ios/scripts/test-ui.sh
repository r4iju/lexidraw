#!/bin/sh
# Runs the editor's UI scripts on a simulator made for the run, as
# scripts/simulator.sh makes it; EDITOR_UI_DEVICE names a device type. The
# document phase exercises English prediction/QuickPath; the remaining phase
# exercises Japanese Romaji composition. Each boots with its input mode and
# software-keyboard preferences selected.
set -eu
cd "$(dirname "$0")/.."
. scripts/simulator.sh
make_simulator "Editor UI tests" "${EDITOR_UI_DEVICE:-}"

sh scripts/set-ui-keyboard.sh "$udid" english
xcrun simctl addmedia "$udid" EditorUITests/Fixtures/picker-image.png EditorUITests/Fixtures/picker-video.mp4

bun run build:reference
xcodegen generate
set -- -project Lexidraw.xcodeproj -scheme EditorHarness -destination "id=$udid" -skipPackagePluginValidation "$@"
xcodebuild build-for-testing "$@"
status=0
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -only-testing:EditorUITests/DocumentPreviewUITests || status=$?
sh scripts/set-ui-keyboard.sh "$udid" japanese
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -skip-testing:EditorUITests/DocumentPreviewUITests || status=$?
exit "$status"
