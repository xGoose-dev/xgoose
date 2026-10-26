# xgoose Safari for iOS

Fresh SwiftUI host and Safari Web Extension, built from the same agent, content script,
UI, page controller and packaged skills as the current Chrome main (0.3.4). iOS/iPadOS 18 or newer.

The existing App Store identity is retained: app 6770188718, app bundle
`org.xgoose.xgoose-safari`, extension `.Extension`, team `2L6B6ZA57F`, and App Group
`group.org.xgoose.xgoose-safari`. This target replaces the iOS application only.

## Build

From the repository root:

```sh
npm ci
npm run build -w xgoose-extension-safari
xcodegen generate --spec apps/safari/project.yml
xcodebuild -project apps/safari/xgoose.xcodeproj -scheme xgoose \
  -destination 'platform=iOS Simulator,name=xgoose iOS 18 iPhone' CODE_SIGN_IDENTITY=- test
```

Build JS first: the extension resources and native skill list are generated from
reviewed source, and are intentionally not committed. Xcode builds require the
generated `dist` resources. The Safari build replaces only native account and
platform bridge adapters; platform-neutral source stays shared with Chrome.

## Capabilities and security

Safari supports packaged skill invocation and page inspection. Dynamic JavaScript,
community installation, user overrides and remote updates are disabled at both
agent and RPC boundaries. Native credentials are held in a shared, device-only
Keychain item. Only the isolated extension receives credentials; webpage MAIN
scripts receive function arguments, never account or provider keys.

App and extension serialize credential rotation through a process-local task queue
and a cross-process file lock. Settings use atomic shared state with monotonically
increasing revisions. The app patches individual settings. Legacy native and extension
settings are migrated before clearing old plaintext credential records; unsupported
custom scripts and previous conversations remain exportable.

On iOS 26.2+ SafariServices opens extension settings and reads the enabled state.
iOS 18–26.1 uses explicit manual guidance. A content-script handshake and a successful
answer record separate website use and completion. Historical access is never a claim
that permission is still granted, or that every website has been authorized.

## Release dependency

The `DELETE /me/account` route and durable erasure worker are integrated into
`xgoose-web` production `master` and released through its guarded GitHub workflow.
Production API changes must use that workflow from the latest clean master.
Published account deletion includes owned skills;
transient object-store failures retain a disabled account and a retryable job.

Submission evidence and remaining gates are recorded in `submission/VALIDATION.md`.
The approved 1.6 build must only be withdrawn after the replacement passes its gates.
