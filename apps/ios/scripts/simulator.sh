# Sourced by the UI test scripts. `make_simulator NAME DEVICE [FAMILY]` makes
# a simulator named NAME for the run, deletes it when the script exits, and
# boots it: the newest iPhone (or FAMILY, such as iPad) on the newest iOS
# runtime, unless DEVICE names a device type. It sets $udid.
make_simulator() {
  for tool in jq xcodegen; do
    command -v "$tool" >/dev/null || { echo "$1 need $tool: brew install $tool" >&2; exit 1; }
  done

  runtime=$(xcrun simctl list runtimes available -j |
    jq -c '[.runtimes[] | select(.platform == "iOS")] | sort_by(.version | split(".") | map(tonumber)) | last')
  [ "$runtime" != null ] || { echo "No iOS simulator runtime is installed" >&2; exit 1; }
  device=${2:-$(xcrun simctl list devicetypes -j | jq -r --argjson runtime "$runtime" --arg family "${3:-iPhone}" '
    ($runtime.supportedDeviceTypes | map(.identifier)) as $supported
    | [.devicetypes[] | select(.productFamily == $family and (.identifier | IN($supported[])))]
    | sort_by(.minRuntimeVersion) | last | .identifier')}
  udid=$(xcrun simctl create "$1" "$device" "$(echo "$runtime" | jq -r .identifier)")
  trap 'xcrun simctl shutdown "$udid" 2>/dev/null || true; xcrun simctl delete "$udid"' EXIT
  echo "$1 on $device, $(echo "$runtime" | jq -r .name)"

  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" >/dev/null
}
