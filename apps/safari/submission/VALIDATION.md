# iOS 1.6 replacement validation

App Store 6770188718; existing app/extension bundle IDs, group and Keychain sharing
retained. iOS/iPadOS 18 minimum. Release remains manual; macOS is outside this task.
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
- iOS 26.5 iPad: native onboarding, provider save and live connection test pass.
  Final Safari layout, orientation and store screenshots are in progress.

## Backend evidence and release boundary

113 deletion/backend tests pass, including owner isolation, session revocation,
durable erasure and object-store retry. Backend changes are integrated into
production master and released by GitHub Deploy run 40373988854. Read-only health
returned commit c20ca4e155773507a87525673366ade9cb0662b7 and version
d666acd5-524a-4b39-8e2f-60cea7b1cde0, preserving all four approved Hosted models:
luna, claude-haiku-5-5, claude-sonnet-5-5, gpt-6.1-sol.
No direct Wrangler deployment or LiteLLM restart is permitted for this task.

Public iOS policy: https://api.xgoose.org/privacy/ios. Nine ASC data types with
purposes and no tracking published; native Privacy Manifest matches. Optional
analytics default off and Safari parameters exclude email/keys/chat/model/prompt size.

## Build and submission evidence

- Signed archive/export 1.6 (11) succeeds using existing distribution assets.
  Source signing restored to Automatic. Bundle IDs, minimum OS and signatures checked.
- Apple upload validation caught iPad orientations and manifest description length;
  corrected both before successful upload. Delivery UUID
  e3dec9ea-f6ce-431c-b94a-187192d267db.
- Review Gemini key verified with actual inference and excluded from source/IPA.
  It belongs only in ASC review notes; never include the credential in this document.
- Processing, final screenshots/listing/review notes, old iOS build 10 withdrawal,
  replacement and Waiting for Review confirmation remain pending.

Local logs: /tmp/xgoose-ios-*.log, /tmp/xgoose-chrome-e2e-final.log and
/tmp/xgoose-safari-viewport.log. Save sanitized final status and real screenshots
alongside this document when submission completes.
