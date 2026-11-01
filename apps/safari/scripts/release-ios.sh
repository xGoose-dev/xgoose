#!/bin/bash
# The supported iOS build/export/upload entry. Never export an unsigned archive
# directly: Xcode may omit all App Group and shared Keychain entitlements.
set -euo pipefail
cd "$(dirname "$0")/../../.."
# Generated source plists use build variables; read the checked-in project.
version=$(sed -n "s/.*MARKETING_VERSION: '\([^']*\)'.*/\1/p" apps/safari/project.yml)
build=$(sed -n "s/.*CURRENT_PROJECT_VERSION: '\([^']*\)'.*/\1/p" apps/safari/project.yml)
[[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ && "$build" =~ ^[0-9]+$ ]]
output="${XGOOSE_IOS_OUTPUT:-$PWD/artifacts/ios-$version-$build}"
mkdir -p "$output"
npm run typecheck -w xgoose-extension-safari
npm run build -w xgoose-extension-safari
xcodegen generate --spec apps/safari/project.yml
xcodebuild -project apps/safari/xgoose.xcodeproj -scheme xgoose -configuration Release -destination 'generic/platform=iOS' -archivePath "$output/xgoose.xcarchive" archive CODE_SIGNING_ALLOWED=NO
python3 apps/safari/scripts/sign-ios-archive.py "$output/xgoose.xcarchive"
xcodebuild -exportArchive -archivePath "$output/xgoose.xcarchive" -exportPath "$output/export" -exportOptionsPlist apps/safari/submission/ExportOptions-iOS-manual.plist
python3 apps/safari/scripts/verify-ios-signature.py "$output/export/xgoose.ipa" --version "$version" --build "$build" --report "$output/signature-report.json"
if [[ "${1:-}" == '--upload' ]]; then
  : "${ASC_KEY_ID:?Set ASC_KEY_ID}" "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID}"
  xcrun altool --upload-app -t ios -f "$output/export/xgoose.ipa" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
fi
