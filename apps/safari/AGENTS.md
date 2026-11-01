# iOS distribution signing — release gate

For every iOS App Store release, use `bash apps/safari/scripts/release-ios.sh` from the repository root. Its `--upload` option uploads only after verifying the exported IPA.

- Never export a wholly unsigned archive directly. If archiving with `CODE_SIGNING_ALLOWED=NO`, run `scripts/sign-ios-archive.py` on that archive before `xcodebuild -exportArchive`.
- Before any upload, run `scripts/verify-ios-signature.py` on the exact exported IPA with the expected version and build. Both the app and Safari extension must pass. A valid provisioning profile or successful Xcode export does not prove the executable has shared-storage permissions.
- Preserve `group.org.xgoose.xgoose-safari` and `2L6B6ZA57F.org.xgoose.xgoose-safari`. Do not change those identifiers to work around a signing error; existing users' settings and credentials depend on them.
- Do not upload, submit, or release a package that fails the gate. Retain the verification report and IPA checksum with the submission evidence.

iOS 1.10 build 20 was exported from an unsigned archive and omitted the signed App Group and shared Keychain entitlements from both binaries. This caused “Shared storage is unavailable. Check the app signature.” on real devices. The 1.11 build 21 hotfix restores them and adds executable-entitlement verification.
