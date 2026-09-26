#!/bin/sh
# Runs the drawing editor's UI tests on a simulator made for the run and
# deleted after it: the newest iPhone on the newest iOS runtime, unless
# DRAWING_UI_DEVICE names a device type. The menu keyboard tests run first,
# alone, on the fresh boot, since a key pressed by a later test attaches a
# hardware keyboard, and with one attached no software keyboard comes up.
set -eu
cd "$(dirname "$0")/.."

for tool in jq xcodegen; do
  command -v "$tool" >/dev/null || { echo "test:drawing-ui needs $tool: brew install $tool" >&2; exit 1; }
done

runtime=$(xcrun simctl list runtimes available -j |
  jq -c '[.runtimes[] | select(.platform == "iOS")] | sort_by(.version | split(".") | map(tonumber)) | last')
[ "$runtime" != null ] || { echo "No iOS simulator runtime is installed" >&2; exit 1; }
device=${DRAWING_UI_DEVICE:-$(xcrun simctl list devicetypes -j | jq -r --argjson runtime "$runtime" '
  ($runtime.supportedDeviceTypes | map(.identifier)) as $supported
  | [.devicetypes[] | select(.productFamily == "iPhone" and (.identifier | IN($supported[])))]
  | sort_by(.minRuntimeVersion) | last | .identifier')}
udid=$(xcrun simctl create "Drawing UI tests" "$device" "$(echo "$runtime" | jq -r .identifier)")
trap 'xcrun simctl shutdown "$udid" 2>/dev/null || true; xcrun simctl delete "$udid"' EXIT
echo "Drawing UI tests on $device, $(echo "$runtime" | jq -r .name)"

xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" >/dev/null

xcodegen generate
set -- -project Lexidraw.xcodeproj -scheme DrawingHarness -destination "id=$udid" -skipPackagePluginValidation "$@"
xcodebuild build-for-testing "$@"
status=0
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -only-testing:DrawingUITests/MenuKeyboardUITests || status=$?
xcodebuild test-without-building "$@" -collect-test-diagnostics never \
  -skip-testing:DrawingUITests/MenuKeyboardUITests || status=$?
exit "$status"
