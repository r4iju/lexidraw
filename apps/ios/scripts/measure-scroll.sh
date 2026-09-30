#!/bin/sh
# Scrolls synthetic documents (#108's benchmarks, never real ones) through
# the editor in a Release build of the harness, under Instruments, and
# summarizes each run: frame intervals and work, Core Animation commits,
# hangs, how far text jumped as blocks laid out, memory and time to the
# first screen (`measure/summary.ts`).
#
# By default on an iPhone 13 simulator on the newest iOS runtime that has
# one, made for the run and deleted after it. MEASURE_DEVICE names a
# connected device by UDID instead, where Instruments also counts hitches;
# the simulator can't.
#
#   scripts/measure-scroll.sh [large|small...]   (large, 115k words, by default)
#   MEASURE_OUT=<dir>                            (measurements/<time> by default)
set -eu
cd "$(dirname "$0")/.."

for tool in jq xcodegen bun; do
  command -v "$tool" >/dev/null || { echo "measure:scroll needs $tool" >&2; exit 1; }
done

documents=${*:-large}
out=${MEASURE_OUT:-measurements/$(date +%Y%m%d-%H%M%S)}
mkdir -p "$out"
out=$(cd "$out" && pwd)
bundle=xyz.raiju.lexidraw.editor-harness
simulator=
cleanup() {
  [ -n "${MEASURE_BUILD:-}" ] || { [ -z "${build:-}" ] || rm -rf "$build"; }
  [ -z "$simulator" ] || { xcrun simctl shutdown "$simulator" 2>/dev/null || true; xcrun simctl delete "$simulator"; }
}
trap cleanup EXIT
build=${MEASURE_BUILD:-$(mktemp -d)}
mkdir -p "$build"
bun run build:reference

if [ -n "${MEASURE_DEVICE:-}" ]; then
  udid=$MEASURE_DEVICE
  xcodegen generate
  xcodebuild build -project Lexidraw.xcodeproj -scheme EditorHarness -configuration Release \
    -destination "id=$udid" -derivedDataPath "$build" -skipPackagePluginValidation -allowProvisioningUpdates -quiet
  app="$build/Build/Products/Release-iphoneos/EditorHarness.app"
  xcrun devicectl device install app --device "$udid" "$app" >/dev/null
else
  runtime=$(xcrun simctl list runtimes available -j | jq -c '
    [.runtimes[] | select(.platform == "iOS" and any(.supportedDeviceTypes[]; .identifier | endswith(".iPhone-13")))]
    | sort_by(.version | split(".") | map(tonumber)) | last')
  [ "$runtime" != null ] || { echo "No iOS simulator runtime runs an iPhone 13" >&2; exit 1; }
  simulator=$(xcrun simctl create "Scroll measurements" com.apple.CoreSimulator.SimDeviceType.iPhone-13 \
    "$(echo "$runtime" | jq -r .identifier)")
  udid=$simulator
  echo "Measuring on an iPhone 13 simulator, $(echo "$runtime" | jq -r .name)"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" >/dev/null
  xcodegen generate
  xcodebuild build -project Lexidraw.xcodeproj -scheme EditorHarness -configuration Release \
    -destination "id=$udid" -derivedDataPath "$build" -skipPackagePluginValidation -quiet
  xcrun simctl install "$udid" "$build/Build/Products/Release-iphonesimulator/EditorHarness.app"
  # Instruments attaches to a process on a simulator only once it has
  # recorded there since the simulator booted.
  xcrun xctrace record --no-prompt --quiet --device "$udid" --output "$build/warm-up.trace" --all-processes \
    --time-limit 1s --instrument "Points of Interest" >/dev/null
fi

for document in $documents; do
  echo "Scrolling the $document document"
  trace="$out/$document.trace"
  report="$out/$document.json"
  rm -rf "$trace" "$report"
  if [ -n "${MEASURE_DEVICE:-}" ]; then
    # On a device Instruments launches the app in front, and the report is
    # written to the app's Documents.
    xcrun xctrace record --no-prompt --quiet --device "$udid" --output "$trace" \
      --instrument "Core Animation Commits" --instrument Hangs --instrument "Points of Interest" \
      --instrument Hitches \
      --env EDITOR_SYNTHETIC="$document" --env EDITOR_SCROLL_REPORT="$document.json" \
      --launch -- "$bundle"
    xcrun devicectl device copy from --device "$udid" --domain-type appDataContainer \
      --domain-identifier "$bundle" --source "Documents/$document.json" --destination "$report" >/dev/null
  else
    # On a simulator Instruments launches apps without a screen, so the app
    # is launched first, and Instruments attaches once it is on screen. The
    # app scrolls when told to and quits when done, ending the recording.
    pid=$(SIMCTL_CHILD_EDITOR_SYNTHETIC="$document" \
      SIMCTL_CHILD_EDITOR_SCROLL_REPORT="$report" SIMCTL_CHILD_EDITOR_SCROLL_WAIT=1 \
      xcrun simctl launch --terminate-running-process "$udid" "$bundle" | awk '{ print $2 }')
    until [ "$(xcrun simctl spawn "$udid" notifyutil -g "$bundle.ready" | awk '{ print $2 }')" = "$pid" ]; do
      xcrun simctl spawn "$udid" launchctl list | grep "^$pid	" >/dev/null || { echo "The harness quit before its first screen" >&2; exit 1; }
      sleep 1
    done
    log="$out/$document.xctrace.log"
    xcrun xctrace record --no-prompt --device "$udid" --output "$trace" --attach "$pid" \
      --instrument "Core Animation Commits" --instrument Hangs --instrument "Points of Interest" >"$log" 2>&1 &
    recording=$!
    until grep -q "Ctrl-C to stop" "$log" || ! kill -0 "$recording" 2>/dev/null; do sleep 1; done
    xcrun simctl spawn "$udid" notifyutil -p "$bundle.scroll"
    wait "$recording" || { cat "$log" >&2; exit 1; }
  fi
done

# shellcheck disable=SC2086 # one argument per document
bun measure/summary.ts "$out" $documents
