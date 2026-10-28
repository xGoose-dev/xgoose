# iOS 1.8 branding validation

Built from current monorepo main 3f8731a, retaining 1.7 behavior and analytics fixes. New canonical icons, brand tint, localized store metadata and 22 screenshot compositions. Safari typecheck, Safari viewport suite and seven native tests passed; final simulator build also passed. Metadata was saved and read back in English and Simplified Chinese. The unsigned archive/export path dropped App Group and Keychain entitlements during validation; build 14 was not used. Build 15 signs the archive with existing profiles before export. Both app and extension signatures, shared App Group and shared Keychain entitlements are verified in the final IPA. Screenshot processing and review submission results will be appended after verification.

The following records are historical evidence for the 1.6 replacement, not checks claimed for this branding change.

---

# iOS 1.6 replacement validation

App Store 6770188718; existing app/extension bundle IDs, group and Keychain sharing
retained. iOS/iPadOS 18 minimum. iOS 1.6 (12) is Waiting for Review and release
remains manual. macOS 1.6 was withdrawn only after explicit user authorization to
unlock Apple's shared app information; it was not rebuilt, resubmitted or released.
Initial 0.3.2 baseline merged with current main 2dc955e (0.3.4), including website
available-evidence answers, summary windows and recoverable context budgets.

## Automated evidence

- Shared and Safari TypeScript checks pass; 90 shared unit tests pass after main
  integration. Covers streaming/cancellation, images/context, Safari capability
  filters, stable document handshake, public URL limits and credential isolation.
- Seven native tests pass on actual installed iOS 18.6 runtime. Covers Keychain
  migration, stable revisions, concurrent field and skill patches, separate page
  and answer progress, provider consent, public-reader limits, repeatable legacy
  migration without account resurrection, anonymous credentials kept out of
  ordinary storage and concurrent refresh-token rotation.
- Full Chrome e2e suite passes after current main integration: email recovery,
  layout, packaged skills under strict CSP, all BYOK transports, images/history,
  context compaction and available-evidence behavior. These use synthetic browser
  fixtures and are not substitutes for live Safari website checks.
- Safari viewport tests pass at normal/2x zoom, desktop-width page viewport and
  keyboard viewport. Shared layout checks pass at widths 320–1024.
- 33 packaged executable skills; script generation/editing, community installation
  and remote executable updates disabled at both agent and RPC boundaries.

## Actual native and Safari evidence

Apple simulators run real Safari/WebKit. No physical device was connected; do not
represent these as physical-device checks.

- iOS 18.6 iPhone: first-install setup/language, Gemini BYOK save/test, manual Safari
  activation and per-site permission. Live USCardForum/Discourse latest-topic tools
  returned real topics and AI answers with source links. Repeated successfully
  after the packaged-file document permit guard was added.
- iOS 18.6 iPhone: Reddit skill activates; logged-out live API returns HTTP 403.
  Agent reports access denied without fabricating posts.
- iOS 18.6 iPhone: ordinary example.com page without a skill uses read_page,
  retrieves 917 characters and correctly explains the page purpose.
- iOS 18.6 iPhone: system photo picker attaches synthetic red-circle/blue-square
  fixture; live Gemini correctly identifies both. Keyboard retains input/Send.
  Stop ends a long requested response and clears generating state.
- iOS 18.6 iPhone: history lists site and other-site conversations. Markdown export
  opens native share sheet with a 39 KB text document.
- iOS 26.5 iPhone: real Hosted email confirmation, app restart and pending-login
  recovery, account credit/catalog, explicit Hosted consent and live streamed
  answer. Hacker News getStories/getItems succeeds via bounded public transport.
- iOS 26.5 iPhone: extension settings/state API, per-site-only access distinct from
  all-website permission and 2x page zoom layout verified.
- iOS 26.5 iPad: native onboarding, provider save/live connection test, live Hacker
  News, NGA public hot topics and Weibo public feeds pass. Safari panel works in
  portrait and landscape. Revoking Other Websites access clears websiteAvailable
  while retaining firstAnswerAt. Safari does not reliably expose an all-sites
  grant through permissions.contains; the app conservatively shows only verified
  website availability when that query returns false.
- iPadOS 18.6, 13 inch: native onboarding skip/resume, portrait/landscape, Dark
  appearance and maximum accessibility XXXL text checked. Labels and controls
  remain readable. Accessibility labels inspected through the native AX tree;
  physical-device VoiceOver speech interaction was not performed.

## Backend evidence and release boundary

113 deletion/backend tests pass, including owner isolation, session revocation,
durable erasure and object-store retry. Backend changes were integrated and
released through GitHub. Earlier health returned c20ca4e and four models. Final
read-only verification on 2026-10-26 returned current origin/master commit
2982b27f9091bb95c30c2c5ad25a9590f717e793, deployed version
f00c54b9-8ccf-4705-88e2-55a3bb0f3240 and the complete approved six-model catalogue:
luna, claude-haiku-5-5, claude-sonnet-5-5, gpt-6.1-sol, deepseek-flash and
gpt-6.1-terra. GitHub master Deploy runs 40387996758 and 40387439845 both succeeded
for that commit. Safari loads the current server catalogue dynamically.
No gateway changes or deployments were performed in the final submission phase.
Future website/API releases must preserve current master, merge and push to
master, and use the guarded scripts/production-release.mjs workflow. Direct
production Wrangler deployment and unrelated LiteLLM restarts are prohibited.

Public iOS policy: https://api.xgoose.org/privacy/ios. Nine ASC data types with
purposes and no tracking published; native Privacy Manifest matches. Optional
analytics default off and Safari parameters exclude email/keys/chat/model/prompt size.

## Build and submission evidence

- Final signed archive/export **1.6 (12)** succeeds using existing distribution
  assets. Source signing is restored to Automatic. App/extension identifiers,
  App Group, shared Keychain entitlement, minimum OS and strict signatures checked.
- Apple validation initially caught iPad orientations and manifest description
  length; both were fixed. Build 11 was uploaded and superseded before submission.
  Final build 12 delivery/build UUID: 5521d2bb-5156-489d-9f7b-3e4fb630a7ac; Apple
  processing state VALID. Export compliance declares no non-exempt encryption.
- Final source: main merge e0a5e481019b2bf1aea817a260693a9606a5255e, PRs #13 and #14.
  PR #14 checks 40386315779 and 40386370161 passed.
- Build 12 fixes the live interruption notice, marks periodic partial checkpoints
  for crash recovery and avoids duplicating a canonical abort response. Actual
  iOS 26.5 Safari QA requested a long Hosted answer, backgrounded Safari, returned
  and verified 63 received lines retained with an explicit interruption notice.
- Final IPA SHA-256:
  0b911658f2d9fbad3a2ace8be022d40e155ad86f3742f13823b45c4531341dc2.
  Durable local copies: builds/xgoose-1.6-12.ipa and
  builds/xgoose-1.6-12.xcarchive (ignored, not committed).
- Review Gemini key verified with actual inference and excluded from source/IPA.
  It belongs only in ASC review notes; never include the credential in evidence.
- Old iOS build 10 withdrawn; build 12 attached to the existing iOS 1.6 record.
  Description, release notes, keywords and review instructions replaced. Six
  actual iPhone/iPad screenshots processed COMPLETE; old screenshots removed.
- Apple initially rejected adding the iOS version to review because shared age
  metadata lacked the new socialMedia field. macOS Pending Developer Release
  locked that shared record. After the user explicitly approved withdrawal,
  macOS 1.6 changed to DEVELOPER_REJECTED. The app's private assistant has no own
  public social feed, so socialMedia=false and socialMediaAgeRestricted=false
  were saved. Updated subtitle and https://api.xgoose.org/privacy/ios saved.
- **Submitted 2026-10-26 19:38:51 UTC**. Review submission
  1cf2952a-e26b-4988-9f4c-b23c7bb3bb93 contains exactly one iOS item. Both the public
  ASC API and authenticated ASC page confirm **WAITING_FOR_REVIEW**. Release type
  **MANUAL**. No macOS item was submitted.

Sanitized machine-readable evidence is in evidence/app-store-submission.json and
evidence/test-results.json. Actual screenshots are retained in screenshots/
(ignored), including asc-ios-1.6-12-waiting-for-review.png and
iphone-12-interrupted-reply.png. Tests ran on Apple simulators with real Safari;
physical devices and spoken VoiceOver interaction were not tested.

Local test logs: /tmp/xgoose-ios-unit-final.log,
/tmp/xgoose-ios-native-tests.log, /tmp/xgoose-chrome-e2e-final.log and
/tmp/xgoose-safari-viewport.log. The Chrome suite passed after a transient worker
startup timeout during a concurrent archive; no failure was suppressed.
