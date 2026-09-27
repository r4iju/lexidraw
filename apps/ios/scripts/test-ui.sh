#!/bin/sh
# Runs the editor's UI scripts on a simulator made for the run, as
# scripts/simulator.sh makes it; EDITOR_UI_DEVICE names a device type. The
# composition script types on the Japanese (Romaji) keyboard, which this puts
# first. The document preview tests, which check whether the software
# keyboard comes up, run first, alone, on the fresh boot, since a key pressed
# by a later test attaches a hardware keyboard, and with one attached no
# software keyboard comes up.
set -eu
cd "$(dirname "$0")/.."
. scripts/simulator.sh
make_simulator "Editor UI tests" "${EDITOR_UI_DEVICE:-}"

xcrun simctl spawn "$udid" defaults write .GlobalPreferences AppleKeyboards -array \
  "ja_JP-Romaji@sw=QWERTY-Japanese;hw=Automatic" "en_US@sw=QWERTY;hw=Automatic" "emoji@sw=Emoji"
xcrun simctl spawn "$udid" defaults write .GlobalPreferences AppleKeyboardsExpanded -int 1
# The keyboards are read at boot.
xcrun simctl shutdown "$udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" >/dev/null

bun run build:reference
xcodegen generate
set -- -project Lexidraw.xcodeproj -scheme EditorHarness -destination "id=$udid" -skipPackagePluginValidation "$@"
xcodebuild build-for-testing "$@"
status=0
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -only-testing:EditorUITests/DocumentPreviewUITests || status=$?
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -skip-testing:EditorUITests/DocumentPreviewUITests || status=$?
exit "$status"
