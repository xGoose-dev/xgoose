# Chrome setup and Hosted AI usability

Implemented in the Chrome host on 2026-10-23.

- Fresh installs open `onboarding.html`. Chrome's extension details page is
  linked directly, and `userScripts.getScripts()` checks whether Allow User
  Scripts is enabled. A location diagram highlights the switch below Site access.
  Both onboarding and Settings open `chrome://extensions/?id=<runtime ID>`
  directly, so store and unpacked installations reach their own details.
  The guide remains available in Settings.
- Fresh settings use Hosted AI / Luna and `launcherVisibility: skill-sites`.
  Existing saved provider credentials and visibility choices are retained.
- The connection mode separates free Hosted AI from BYOK. Hosted models come
  from the gateway's model list; custom models, API keys and base URLs are
  visible only for BYOK. The global `[hidden]` rule prevents layout rules from
  accidentally revealing hidden fields.
- Hosted setup checks the account's quota. Users explicitly claim available
  trial credit. A footer disclaimer explains Hosted storage; starting a Hosted
  conversation or pressing Test applies that policy without a separate checkbox.
  Opening Settings does not enable storage. BYOK transcripts stay local. Testing Hosted AI sends a small actual inference request, so it can
  consume trial credit; it does not merely test the public model list.
- The gateway currently uses the same 429 code for several reservation failures.
  Chat preserves its detailed message, and unclaimed/expired/exhausted credit
  get actionable setup guidance. Inference is never retried
  automatically. These changes do not remove server rate or spending limits.
- All 31 local site skills ship in the extension and are enabled by default.
  The panel shows one dismissible, 12-second introduction per installation,
  only after the skill bar becomes visible. Installed skill management
  stays collapsed in Settings. Discover more skills opens https://xgoose.org/skills/
  directly in a new tab.
- Discourse owns three reusable English shortcuts: Latest topics, Summarize this
  thread, and Surprise me randomly. The uscardforum layer adds only 最近羊毛.
  Discourse detection also supports custom domains. Skill chips, launcher visibility, shortcut merging and model context use the
  skills actually installed after their @detect checks. This preserves Substack
  custom domains and generic Discourse detection while ordinary pages show
  neither skill. Registry-change pushes reapply the same checks.
- Other authors' catalog skills can be installed without publishing a skill or
  signing in. Existing built-in dependencies are reused. File, paste and URL
  installation provide a review screen and do not require publishing.

Validation: `npm run check`, plus the extension tests in `npm run e2e`.
`tests/browser/setup.mjs` covers Hosted prerequisites and inference/error
responses, BYOK drafts, actual CSS visibility, permission changes, all bundled
skills, a concurrent one-time notice, anonymous catalog and local installation,
URL preview, and a 390px viewport. Hosted requests in these tests use fixtures;
passing them does not verify the user's production Luna account or upstream.

Skill updates (2026-10-24): Settings → Skills now shows current/new versions with manual checking and source review. Checks also run daily, at browser startup and after extension install/update. Toolbar badges and the popup link to available updates. Installs require user confirmation; local edits are flagged, disabled state is preserved, and author IDs/package digests are verified. Built-in catalog identities are pinned at build time. Unpublished local imports can be replaced by importing their new source; they do not adopt a catalog author by name.

The 0.2.4 Settings page shows a permission warning until Allow User Scripts is enabled. Its button opens the running extension’s own Chrome details page; the guide highlights the actual toggle below Site access. Returning to the extension rechecks the setting and hides the warning automatically. A manual Check again is also available. When an assistant message mentions Allow User Scripts, the chat adds a native setup card with the direct link, illustrated guide and steps. Before each turn, permission status is supplied to the model. Disabled js_exec calls return setup instructions immediately; visible-page reading remains available where it succeeds. The script bridge and skills are refreshed after enabling, without automatically retrying a user action.

Getting started now reminds users to return to their target website after email confirmation, with US Card Forum and Hacker News entry links. It includes catalog/file/URL/source installation, the authoring guide and a reviewable starter that can be installed and tested on example.com. The built-in xgoose-guide skill (0.1.0) provides the same help only on xgoose.org and www.xgoose.org; Gmail and forum pages do not activate it. The guide covers mismatched page context, User Scripts, partial thread reads, failed search results, Hosted/BYOK setup, installation and authoring. Chromium verified matching boundaries and starter installation/execution.

### Image conversations in 0.2.4

Use the image button beside the chat input, or paste an image. PNG, JPEG and
WebP are accepted, up to three per message (20 MB maximum original file size).
Before sending, inspect the thumbnail and remove it with × if needed. Images
are resized on-device to a 1600-pixel long edge and at most 240 KB of JPEG data;
very detailed images may be resized further. Send with a question or send an
image alone. Hosted uses luna; BYOK requires an image-capable model.

Images are stored in local chat history and included in requests to the chosen
AI provider. Diagnostic transcript uploads retain attachment metadata but omit
image bytes. Recent model context keeps up to eight images; older images stay
in local history and are explicitly marked omitted in model context. Reattach
an older image when asking about a detail that is no longer in context.


### Built-in skills and automatic context compaction — 0.2.5

All 32 bundled skills are enabled on installation and work without Allow User
Scripts. Packaged files load through Chrome scripting; fixed metadata readers
and structured skill_call invocations do not evaluate generated JavaScript.
The active set still respects matching websites, @detect, dependencies and the
user's disabled list. Empty active sets also remove previously loaded skills.
Local edits and online updates replace the reviewed packaged copy with a user
script, so they require Allow User Scripts just like community installations.
Settings retains an alert with the direct extension-details link and highlighted
setup guide. Its copy explicitly says that built-in skills and page reading work
already. Onboarding describes the toggle as recommended for custom scripts.
Permission changes refresh skills without a page reload. Built-in shortcuts use
their task prompt and structured skill calls when raw JavaScript is unavailable.

Hosted gateway response headers report exact request text bytes, the limit and
the target. Image bytes are excluded. The chat's Context indicator reports this
current-request byte ratio separately from accumulated token usage. The gateway
is authoritative; the client estimates the same wire representation before
sending and compacts old history in bounded chunks when necessary. Full local
history is retained, while the model receives a summary, current goal and recent
images. A pre-response context rejection triggers one compact-and-retry attempt;
other errors and responses that have already produced output are not replayed.
A summary failure uses explicitly incomplete excerpts. Tool actions are not
replayed during compaction. This is context management rather than a larger
upstream model window.


### Quiet built-in sites — 0.2.6

On a page with an active packaged skill, the chat does not display the User
Scripts banner or insert a setup card merely because the assistant mentions
that permission. Detection finishes before a disabled-permission banner may
appear, preventing an initial flash. Focus checks and subsequent turns apply
the same rule. Settings continues to show its existing reminder, direct Chrome
link and highlighted guide. The model is instructed to use built-in helpers
without prompting for the optional permission; actual blocked custom operations
and explicit setup questions still receive accurate instructions.

The latest production transcript was inspected through the audited admin viewer:
skill_call Result contains its returned object. A read-only aggregate over the
latest ten sessions found 72 tool-call and 72 tool-result events. Per the owner's
follow-up, transcript upload frequency, batching and the collapsed viewer remain
unchanged.


### Language preferences and minimizing chat — 0.2.7

The Chrome host supports English, Simplified Chinese and Spanish. Its default
language follows navigator.languages in preference order, accepts regional tags
such as zh-TW and es-MX, and falls back to English. Settings → Personalization →
Language also supports an explicit choice. Changes save immediately, preserve
provider credentials, and update already-open extension pages and chat panels.
The selected/resolved language is included in each turn's system instructions;
explicit requests for another response language take priority.

Product UI labels, setup instructions, accessibility names, common status
messages and built-in shortcuts are localized. Translation is limited to
extension-owned roots; visited websites, user and AI messages, history titles,
source code, skill names and tool data are preserved. Unknown messages retain
the original text. There is no translation service or new network destination.

The header's former × is now a neutral minus glyph with a localized Minimize
label and tooltip. It uses the existing collapse behavior: the conversation and
composer draft stay in place, and an ongoing model response continues. Reopen
from the floating button or the Chrome toolbar. This does not start a new chat.
