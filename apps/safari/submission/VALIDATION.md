# iOS 1.6 replacement validation

App Store app: 6770188718. Existing approved build: 10, pending manual release.
Replacement build starts at 11; recheck App Store Connect before uploading.

Completed during implementation:
- TypeScript checks for shared Chrome source and Safari adapter source.
- Safari JS build: 33 executable packaged skills; Chrome-specific product guide excluded.
- Shared unit suite: 77 tests passed, including Safari prompt/capability coverage.
- Native iPhone/iPad launch; 3 native tests passed on iOS 18.6 (twice).
- Installed iOS 18.6 runtime and created iPhone and iPad simulators.
- Backend account deletion: 110 tests passed on current production baseline; deployed
  version a8dfc7f4-44e9-4f25-8a6b-6796166a38ad. Health 200, unauthenticated deletion 401.
- Complete Chrome e2e suite passed after fixing early Send/History readiness races.
- Device Release build, signed 1.6 (11) archive and IPA export succeeded.
- Existing ASC reviewer Gemini key validated with actual inference HTTP 200; credential
  remains outside source, in ASC and protected local transient data only.

Required before submission (update with actual evidence, never infer a pass):
- Native tests, including Keychain migration, concurrent patches and stable revisions.
- Actual iOS 18 and 26 Safari activation and packaged website skills.
- Hosted email confirmation and live inference; BYOK provider test and live chat.
- iPhone/iPad keyboard, orientation, zoom, images, cancellation, export and history.
- Full Chrome regression after final shared-source changes.
- Deletion route deployment and production health verification.
- Current privacy policy, privacy manifest/labels, support copy and real screenshots.
- Independent limited review credential supplied only in ASC review notes.
- Signed archive, upload VALID, attach build, withdraw old iOS 1.6, submit manual release.

Safari runtime findings: initialized a single per-document nonce responder before skill
discovery; made content bootstrap idempotent; confirmed Hacker News packaged skill
activation and per-site-only authorization on iOS 26.5. Explicit page reload is required
after replacing an extension build in an already-open Safari document.

No App Store release or withdrawal has been performed by this implementation yet.
