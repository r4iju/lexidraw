#!/bin/sh
# Runs the editor's UI scripts on a simulator made for the run, as
# scripts/simulator.sh makes it; EDITOR_UI_DEVICE names a device type. The
# composition script types on the Japanese (Romaji) keyboard, which this puts
# first.
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
xcodebuild test -project Lexidraw.xcodeproj -scheme EditorHarness \
  -destination "id=$udid" -skipPackagePluginValidation -collect-test-diagnostics never "$@"
