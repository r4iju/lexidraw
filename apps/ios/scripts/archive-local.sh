#!/bin/bash
# Archive locally using the same Apple authentication as the upload workflow.
set -euo pipefail
cd "$(dirname "$0")/.."
config_path="${LEXIDRAW_ASC_CONFIG:-$HOME/.appstoreconnect/lexidraw.json}"
archive_path="${LEXIDRAW_ARCHIVE_PATH:-/tmp/lexidraw-release/Lexidraw.xcarchive}"
: "${LEXIDRAW_BUILD_NUMBER:?Set LEXIDRAW_BUILD_NUMBER to a number above the latest uploaded build}"
marketing_version="${LEXIDRAW_MARKETING_VERSION:-$(jq -er '.appStoreRecord.version' release/app-store-metadata.json)}"
key_id="$(jq -er '.keyId' "$config_path")"
issuer_id="$(jq -er '.issuerId' "$config_path")"
private_key_path="$(jq -er '.privateKeyPath' "$config_path")"
test -r "$private_key_path"
xcodegen generate
xcodebuild archive \
  -project Lexidraw.xcodeproj -scheme Lexidraw -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive_path" \
  -skipPackagePluginValidation -allowProvisioningUpdates \
  -authenticationKeyPath "$private_key_path" \
  -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id" \
  DEVELOPMENT_TEAM=C7X9BCC7LP CURRENT_PROJECT_VERSION="$LEXIDRAW_BUILD_NUMBER" \
  MARKETING_VERSION="$marketing_version"
