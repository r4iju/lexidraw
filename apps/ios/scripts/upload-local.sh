#!/bin/bash
# Upload an already built local archive; do not invoke GitHub Actions.
set -euo pipefail
cd "$(dirname "$0")/.."
config_path="${LEXIDRAW_ASC_CONFIG:-$HOME/.appstoreconnect/lexidraw.json}"
archive_path="${LEXIDRAW_ARCHIVE_PATH:-/tmp/lexidraw-release/Lexidraw.xcarchive}"
key_id="$(jq -er '.keyId' "$config_path")"
issuer_id="$(jq -er '.issuerId' "$config_path")"
private_key_path="$(jq -er '.privateKeyPath' "$config_path")"
test -r "$private_key_path"
test -d "$archive_path"
export_dir="$(mktemp -d /tmp/lexidraw-export.XXXXXX)"
export_options="$export_dir/ExportOptions.plist"
cat > "$export_options" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>C7X9BCC7LP</string>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
plutil -lint "$export_options"
xcodebuild -exportArchive \
  -archivePath "$archive_path" -exportOptionsPlist "$export_options" -exportPath "$export_dir" \
  -allowProvisioningUpdates -authenticationKeyPath "$private_key_path" \
  -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id"
