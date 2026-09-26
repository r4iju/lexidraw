#!/bin/sh
# Runs the editor's UI scripts on a simulator made for the run and deleted
# after it: the newest iPhone on the newest iOS runtime, unless
# EDITOR_UI_DEVICE names a device type. The composition script types on the
# Japanese (Romaji) keyboard, which this puts first.
set -eu
cd "$(dirname "$0")/.."

for tool in jq xcodegen; do
  command -v "$tool" >/dev/null || { echo "test:ui needs $tool: brew install $tool" >&2; exit 1; }
done

runtime=$(xcrun simctl list runtimes available -j |
  jq -c '[.runtimes[] | select(.platform == "iOS")] | sort_by(.version | split(".") | map(tonumber)) | last')
[ "$runtime" != null ] || { echo "No iOS simulator runtime is installed" >&2; exit 1; }
device=${EDITOR_UI_DEVICE:-$(xcrun simctl list devicetypes -j | jq -r --argjson runtime "$runtime" '
  ($runtime.supportedDeviceTypes | map(.identifier)) as $supported
  | [.devicetypes[] | select(.productFamily == "iPhone" and (.identifier | IN($supported[])))]
  | sort_by(.minRuntimeVersion) | last | .identifier')}
udid=$(xcrun simctl create "Editor UI tests" "$device" "$(echo "$runtime" | jq -r .identifier)")
trap 'xcrun simctl shutdown "$udid" 2>/dev/null || true; xcrun simctl delete "$udid"' EXIT
echo "Editor UI tests on $device, $(echo "$runtime" | jq -r .name)"

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
  -destination "id=$udid" -skipPackagePluginValidation -collect-test-diagnostics never "$@"
