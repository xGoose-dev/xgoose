# Chrome Web Store assets

The editable icon master is `branding/icon.svg`. Run `node scripts/render-brand.mjs` to render extension toolbar sizes and the 512px store source.

Historical screenshots show actual extension UI: an existing uscardforum research session and the current settings pages. Email capture is signed out, without an address entered. Skills capture contains installed public forum skills. No API keys, login tokens, private browser profiles or full transcript evidence belong in this directory.

`research.png`, `skills.png`, and `email.png` are full 1280×800 captures. The settings `*-raw.png` files are 1280×640 captures for the store layouts. `node scripts/render-store-assets.mjs` composes the 1280×800 store images, 440×280 small tile, 1400×560 marquee, and 1200×630 social image. The artwork adds explanatory headings without fabricating or rewriting the product interface or model output.

The 0.2.1 package changes the icon, short description, and settings guidance. PI, Hosted routing, permissions and privacy behavior are unchanged from 0.2.0. Submission and publication are separate states; check the developer dashboard for the current review status.

The 0.2.2 update bundles the default website skills, improves Hosted/BYOK setup and User Scripts onboarding, and updates LinkedIn and Substack readers. The store description reflects Hosted conversation retention and local-only BYOK conversations. The extension manifest permissions are unchanged.

0.2.2 was uploaded and submitted for review on October 23, 2026 (America/Chicago).
The dashboard confirmed **Pending review**, with automatic publication after
approval selected. The last verified published version was 0.2.1; submission is
not confirmation that 0.2.2 is public.

Release archive SHA-256:
`c0377874198c0c73b7101faa793d65d63ee42928382f0ac2902235fb59a3c6dc`.
Validation: typecheck, 40 unit tests, and the existing synthetic browser suite
passed. Separately, the installed Chrome build passed live LinkedIn people
search, About/Experience/Education reads, job search and job-description reads;
Substack publication search, archive, post and RSS reads were also verified in
the installed browser. These checks do not assert compatibility of every
undocumented endpoint or replace the historical live forum acceptance gate.

## 0.2.3 resubmission — October 24, 2026 (America/Chicago)

At the owner's request, canceled the pending 0.2.2 review, uploaded
`artifacts/releases/xgoose-chrome-0.2.3.zip`, and submitted 0.2.3 for review.
The dashboard confirmed **Pending review**. Automatic publication after review
was selected. Package page still showed 0.2.1 as the published version.

0.2.3 includes daily/manual skill update checks, toolbar and popup reminders,
version/source review, local-edit warnings, and identity/digest validation.
The store description now explains skill updates. Manifest permissions match
the earlier package. Typecheck, 41 unit tests and build passed; skill-update
browser scenarios passed before the release version bump.

Archive SHA-256: `14f4cb27cc315b5ee7a66a8580911ac119c6f73af3158b5464bbf30ffab0f678`.
Evidence: `artifacts/releases/chrome-0.2.3-pending-review.png`.

## 0.2.4 prepared — October 25, 2026

Built `artifacts/releases/xgoose-chrome-0.2.4.zip` and an unpacked folder with the same name. This release is prepared locally, not uploaded or submitted to the Chrome Web Store. It adds detailed setup/login/credit/connection/chat/skill-update usage events, persistent retry queues with stable event IDs, and website hostnames in Hosted transcript events. Settings shows an Allow User Scripts alert with a direct runtime-specific Chrome details link and highlighted illustrated guide. Chat adds a native SOP card whenever the assistant asks to enable the setting; permission preflight makes disabled js_exec fail immediately, while current-page reading can still be used. Returning after enabling rechecks permission, hides the reminders and refreshes skills. Typecheck, 41 unit tests, production build and synthetic Chromium setup, analytics and permission-guidance flows passed. Release metadata and SHA-256 are saved alongside the ZIP.

### Discourse reader refresh

The prepared 0.2.4 package includes `discourse-forum 0.2.3` with `readTopicPosts`, exact legacy `getTopicPosts` floor selection, bounded sequential batches and cursor/text continuation. `getTopic` is explicitly a five-post preview. Skill instructions require checking returned ranges, IDs and cursor progress, stopping repeated non-advancing reads, and separating current reply evidence from historical posts. Regression tests cover both the centered floor-632 window and a whole 19-post response requested from floors 6 and 11. All 37 skill contract tests (canonical and Chrome copies), 41 extension tests, build, and synthetic Chromium range/shortcut flows passed. ZIP and unpacked directory were refreshed; this is still an unsubmitted local release package.


## English artwork and image conversations — 0.2.4

The new gallery is rendered from code with English copy and explicitly labelled
feature illustrations. See ARTWORK.md. The owner chose to retain all three old screenshots and both promotional tiles.
Only the research and image-conversation renders are added, in positions one
and two. Other renders are local alternatives. Prior assets remain in
previous-0.2.3/.

Image upload accepts PNG/JPEG/WebP, up to three per message; images are decoded
and resized locally to at most 1600 pixels on the long edge and 240 KB of JPEG
bytes. The UI supports previews, removal, clipboard paste, image-only prompts,
queued messages and saved-history replay. The model context keeps the newest
eight images; older image parts are explicitly marked omitted, while local
history remains complete. Diagnostic transcripts omit image bytes.

Hosted enforces a 3,000,000-byte streamed input limit before JSON parsing, eight
inline image parts, individual image size/type/base64 checks, a text-only budget,
no image URL fetching, and the existing authenticated reservation/concurrency
gates. Base64 transport is excluded from text-token reservations. Local tests
cover 100 mixed requests through the actual route at concurrency 10 with a mocked
upstream: 50 valid requests succeed, 50 invalid/oversized requests return 400, no
5xx, and the next normal request succeeds. This is not a production load benchmark.


## 0.2.4 submitted — October 25, 2026 (America/Chicago)

Chrome Web Store confirmed **Pending review** after the final package upload.
Automatic publication after approval was selected. The last verified public
package remains 0.2.3. Added only the research and image-conversation English
renders in gallery positions one and two; all three old screenshots and both
promo tiles were retained as requested. The 496-character reviewer instructions
include permissions, email login, Hosted/BYOK, images, updates and the starter.

Final ZIP SHA-256:
`a31b57ba687ce4d205d924e629fe3ee59aef02a8385f93d482284214b4df4eda`.
No new manifest permissions or host permissions. Typecheck, 43 extension unit
tests, production build, image/paste/history/mobile browser flows, setup and
permission regressions passed. Backend typecheck and 99 tests passed. API and
LiteLLM changes are deployed; the privacy page image disclosure is deployed and
verified. The production health endpoint returns 200; unauthenticated inference
returns 401. Image transport was verified with a mocked Hosted response; actual
Luna visual recognition was not authenticated or measured in this run.

Evidence: `artifacts/releases/chrome-0.2.4-pending-review.png`.
Release details: `artifacts/releases/xgoose-chrome-0.2.4-report.json`.


## 0.2.5 prepared — October 25, 2026 (America/Chicago)

All 32 built-in skills now execute without Allow User Scripts through packaged
files and structured calls. Settings retains a permission alert with the direct
Chrome details link and highlighted guide for custom/community/edited/online-updated
scripts. URL matching, detect gates, dependencies and disabled choices remain
enforced. Permission changes refresh skills without reload.

Long contexts compact automatically in bounded batches, preserving full local
history, the current request and recent images. The gateway reports exact text
bytes and authoritative limits; an eligible context rejection compacts and
retries once without replaying tool actions. Chat shows gateway context usage
separately from cumulative token usage.

Typecheck, 53 unit tests, production build and 13 synthetic browser suites passed
(built-ins with permission off and strict CSP, site detection, forum shortcuts,
permission guide, setup, Discourse ranges, product guide, research acceptance,
skill updates, analytics, image uploads, context compaction and panel layout).
Actual authenticated Luna visual recognition was not measured. No new manifest
permissions. Gateway context handling is deployed; its 102 tests passed.

ZIP SHA-256: `4dc79ee1f352eada5c4c577240b3b5ddaa5d2c7b9ca448b59a360858dd39b3dc`.
Release report: `artifacts/releases/xgoose-chrome-0.2.5-report.json`.


## 0.2.5 submitted — October 25, 2026 (America/Chicago)

Canceled 0.2.4 review, uploaded the verified 0.2.5 ZIP, and submitted it for review.
Chrome confirmed “Your extension was submitted for review” and then showed
Pending review. Publish automatically after review was checked. Package page
verified Draft 0.2.5 / Published 0.2.3 before submission. Updated the saved store
description and 493-character reviewer instructions for built-in skills without
User Scripts and automatic compaction. Gallery and promotional tiles were
preserved. Evidence is saved in chrome-0.2.5-package.png and
chrome-0.2.5-pending-review.png next to the release report and immutable ZIP.


## 0.2.6 prepared — October 25, 2026 (America/Chicago)

Built-in skill pages keep the User Scripts reminder in Settings. Chat hides the
permission banner after skill detection and does not insert a setup card on an
assistant mention. The model is told not to request the optional permission
proactively when built-in tools are working. Other pages retain permission
guidance, and Settings keeps the existing direct Chrome link and illustrated SOP.

Typecheck, 53 unit tests, build and targeted Chromium suites passed: built-in
invocation with permission off, no chat warning even after an AI mention,
Settings reminder, permission recovery on other sites, and six site-detection
cases. Service-worker JS is byte-identical to 0.2.5. Transcript upload timing,
batching and viewer remain unchanged at the owner's request; an audited admin
read confirmed a returned skill object was present. No new manifest permissions.

ZIP SHA-256: `4df9eb312b035087c1b28864b8f23f8fc72e71c7b6a5865d158f887214e1969e`.


## 0.2.6 submitted — October 25, 2026 (America/Chicago)

Canceled 0.2.5 review, uploaded 0.2.6 and verified Draft 0.2.6 / Published 0.2.3.
Saved the store description and 470-character reviewer instructions explaining
quiet built-in pages and the Settings reminder. Chrome confirmed submission and
then Pending review; automatic publication after approval was selected. Gallery
and promotional artwork were preserved. Package and pending-review screenshots
are in artifacts/releases next to the immutable ZIP and release report.


## 0.2.7 prepared — October 25, 2026 (America/Chicago)

Chrome UI supports browser language detection and explicit English, Simplified
Chinese or Spanish preferences in Settings. Selection persists immediately and
updates open panels and extension pages. 324 entries per translated catalog
cover settings, chat controls, onboarding, installation and common statuses.
Each AI turn receives its resolved preferred reply language; explicit requests
for another language take priority. Original website text, user/model content,
source and credentials are preserved. Unknown text retains its original form.

The former header × is now a neutral minus with a localized Minimize tooltip.
Drafts, chat and active generation survive collapse and reopening. The popup
version label now uses the actual manifest version. No new permissions or
translation service. Transcript upload timing is unchanged.

Typecheck, 57 unit tests, build and 10 synthetic Chromium suites passed,
including Spanish regional detection, Chinese variants, English fallback,
manual override persistence, cross-tab language changes, preferred AI language,
minimizing during generation, image/context regressions, setup, skills, login
and layout. Model compliance was checked at the request boundary using fixtures.

ZIP SHA-256: `5b28fbecc14aae7a5bd13e0004785130f997e068c160e086b719675fbba0da55`.


## 0.2.8 prepared — October 25, 2026 (America/Chicago)

Combines 0.2.7 localization/minimize changes with canonical V2EX 0.2.0, Weibo 0.2.0, NGA 0.1.0 and Reddit 0.1.0. 34 packaged skills total. Existing host-specific LinkedIn/Substack and other adapters are preserved.

Typecheck, 57 extension unit tests, 52 reader tests and eight synthetic Chromium suites passed. All four updated/new skills were called through model help/skill_call with User Scripts OFF and strict CSP, and actual fixture API outputs returned to the model. Settings retains the permission reminder; built-in pages do not show the chat warning. Native auth requirements and Reddit morechildren restrictions remain. No new manifest permissions.

ZIP SHA-256: `a41d8637f6097d9c24051a0e6f21baf6d20bd9635dd5a6442b894f832d4e1727`.
Report: `artifacts/releases/xgoose-chrome-0.2.8-report.json`. 0.2.7 archive is preserved and was never submitted.


## 0.2.8 submitted — October 25, 2026 (America/Chicago)

Canceled the pending 0.2.6 review and uploaded the verified 0.2.8 ZIP. Package page confirmed Draft 0.2.8 / Published 0.2.3. Saved the combined skills/localization/minimize store description and 484-character reviewer instructions. Chrome confirmed “Your extension was submitted for review” and then Pending review. Publish automatically after approval was checked. Five screenshots and both promo tiles were preserved. Package/pending-review evidence is saved beside the release report. 0.2.7 was not submitted.


## 0.2.8 shortcuts revision submitted — October 25, 2026 (America/Chicago)

Retained extension version 0.2.8 as requested, canceled the earlier pending 0.2.8 review and uploaded `xgoose-chrome-0.2.8-shortcuts.zip`. Original ZIP/snapshot retained. Four prompt-only actions each for V2EX 0.2.1, NGA 0.1.1, Weibo 0.2.1 and Reddit 0.1.1. Chinese sites have authored Chinese labels; Reddit has English labels, preserved across UI language changes. Prompts describe native API choices, current-page scope and incomplete-reading limits; no arbitrary JS shortcuts or new permissions.

57 extension tests, 52 reader tests and browser suites (16 shortcut clicks, four actual structured skill calls, generic built-ins, existing forum shortcuts and localization) passed. Permission OFF, strict CSP and 390px layout tested with fixtures. Website metadata/source/actions published and hash-verified; live marketplace install preserved all four actions and executed all four adapters on fixture origins. Existing permissions/guides and store artwork preserved.

Package page confirmed Draft 0.2.8 / Published 0.2.3. Saved description and 488-character reviewer instructions, submitted with automatic publication checked. Chrome confirmed submission and Pending review. Report: `artifacts/releases/xgoose-chrome-0.2.8-shortcuts-report.json`.


## 0.2.8 BYOK revision prepared — October 25, 2026 (America/Chicago)

Keeps extension version 0.2.8. Gemini uses the Google SDK per-request httpOptions.fetch through the existing background transport; PI's unsupported top-level fetch is omitted only for the Google branch. Pin @google/genai 2.31.0, which supports the custom transport. The root PI dev dependency makes npm apply the transitive SDK override consistently across workspaces; the runtime PI version remains 1.3.0 and OpenAI SDK remains 7.19.0. No global fetch replacement. Streaming, abort, errors, native images, tools, automatic compact and persisted thought signatures are covered.

Model construction and Settings Test now share URL normalization. Gemini/LiteLLM append v1beta only once; OpenAI-compatible APIs preserve versioned paths such as /v1beta/openai and accept a pasted /chat/completions endpoint. Hosted remains OpenAI-compatible at /ai/v1, with its account token and consent/quota path.

64 unit tests, typecheck and build passed. Synthetic Chromium suites cover all four providers under strict page CSP, actual background transport, Settings Test, read_page, tool outputs, follow-up, credential isolation and Hosted context rejection/compact/retry without tool replay. Social built-ins, Hosted image upload, context compaction and email login regressions passed. Live Gemini native and Gemini OpenAI-compatible tests each returned HTTP 200 twice with one local fixture tool call. The user-provided OpenAI test credential passed the same two-request gpt-4o-mini live test; a prior local credential returned insufficient_quota. Test credentials are never bundled or persisted in reports. Hosted regression uses simulated server responses; no new production Hosted session or gateway deployment was performed.

Immutable ZIP: artifacts/releases/xgoose-chrome-0.2.8-byok.zip. SHA-256: 45221164736a67b7f5413b60515e89d31f870c8ca2622d179324995621f288cd. Only background.js and content.js differ from the previous shortcuts package; manifest and all 34 skill files are identical.


## 0.2.8 BYOK revision submitted — October 25, 2026 (America/Chicago)

Used the in-app browser as requested. Canceled the prior pending 0.2.8 shortcuts review, uploaded xgoose-chrome-0.2.8-byok.zip, confirmed Draft 0.2.8 / Published 0.2.3, saved the 484-character reviewer instructions and existing store listing, and submitted with automatic publication checked. Chrome confirmed “Your extension was submitted for review” and then “Status: Pending review.” Artwork preserved. Package and pending-review screenshots are next to the immutable ZIP and report.


## 0.3.0 prepared — October 25, 2026 (America/Chicago)

Bumps package, Chrome package, manifest and lockfile versions together. Separates interface language from Preferred Answer Language in Settings and onboarding. Automatic answer language (the default, including existing installations without this field) injects no preferred-language context for any browser locale. Explicit en/zh-CN/es choices are saved immediately, synchronized across open extension pages and sent on each turn; requests in chat still take priority. UI language alone never sets an answer preference.

Onboarding begins with the shared email sign-in component and answer-language choice, followed by the highlighted, collapsible Chrome User Scripts guide. Eight website links: Reddit, YouTube, Weibo, V2EX, NGA, US Card Forum, Hacker News and Zhihu. YouTube is explicitly basic page reading, not a bundled dedicated skill. Installation, starter authoring and troubleshooting move to skills-help.html. Personalization uses consistent full-width preference rows, independent language controls and a compact analytics checkbox; panel coordinates are folded into details. Focused selects retain their small caret background sizing/position (the focus shorthand no longer resets them).

Keeps all 34 packaged skills and the tested 0.2.8 BYOK/native transport fixes. No new extension permissions.
