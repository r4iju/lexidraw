#!/bin/sh
# Runs the editor's UI scripts on a simulator made for the run and deleted
# after it, with the Japanese (Romaji) keyboard first, which the composition
# script types on. EDITOR_UI_DEVICE picks the device type.
set -eu
cd "$(dirname "$0")/.."

runtime=$(xcrun simctl list runtimes available -j |
  jq -r '[.runtimes[] | select(.platform == "iOS")] | last | .identifier')
udid=$(xcrun simctl create "Editor UI tests" "${EDITOR_UI_DEVICE:-iPhone 17}" "$runtime")
trap 'xcrun simctl shutdown "$udid" 2>/dev/null || true; xcrun simctl delete "$udid"' EXIT

xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" >/dev/null
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
  -destination "id=$udid" -skipPackagePluginValidation "$@"
