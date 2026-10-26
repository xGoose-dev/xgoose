# xgoose Chrome

An open source, in-page browser agent powered by PI. This repository contains
the Chrome extension, shared agent core, page tools, floating chat UI, skill
runtime, and synthetic regression tests. MIT licensed.

**0.3.3** defaults Hosted AI to Haiku 5.5 and uses model-specific context windows
instead of a fixed 128K window or 175 KB early-compaction threshold. Luna and
GPT-6.1 Sol use 1,050,000 tokens; Haiku/Sonnet 5.5 use 1,000,000. Context occupancy
is a local token estimate before a request and provider-reported usage after a
response, separate from cumulative conversation totals. Output headroom, bounded
transport sizes and automatic compaction/retry remain in place.

0.3.1 includes the Weibo/NGA reader fixes, optional NGA image context,
and the latest onboarding language and sign-in fixes. It retains a focused
sign-in onboarding flow, separate interface and answer language preferences,
cleaner personalization settings, and built-in website skills. The interface follows the browser by default. **Automatic** answer
language adds no language directive to AI context; only an explicit preferred
answer language sets a default. Requests in chat take priority.

Weibo 0.2.2 searches directly on `weibo.com` through the native JSON search API.
NGA 0.1.3 recovers once from malformed topic JSON and adds **看图概括此帖**.
`nga.getTopic({tid, includeImages:true, maxImages:3})` can attach images from the
selected posts to the model. Text-only reading remains the default. Images carry
their original post/floor links, are limited to three per call and normalized
to bounded JPEGs. Recent images survive follow-up turns; diagnostic transcripts
omit their bytes. Older hosts that only return image URLs must say that the
images were not actually seen.

Getting started includes email sign-in, an illustrated optional User Scripts
setup, and eight example websites. Its language selector sets the interface and
answer preference together, translating the page immediately. Settings keeps
the two preferences independently editable. Skill installation and authoring
live on a separate advanced setup page. YouTube uses basic page reading from the Chrome
toolbar; a dedicated YouTube skill is not bundled.

Gemini BYOK uses the background streaming transport, including tools, images,
cancellation and automatic context compaction. OpenAI-compatible URLs preserve
versioned API paths. Live Gemini native, Gemini OpenAI-compatible and OpenAI
(gpt-4o-mini) tool round trips were tested separately from synthetic regressions.
See [the Chrome page](https://xgoose.org/chrome/) for setup and the store link.

## Build

Use Node.js 22.19 or newer and Chrome 138 or newer.

```sh
npm ci
npm run check
```

Load `apps/chrome/dist` as an unpacked extension in `chrome://extensions`.
Built-in skills and page reading work immediately after installation. For custom scripts, open its Details page and enable **Allow User Scripts**. Arbitrary JavaScript,
community, edited, online-updated and agent-authored skills require this permission; no eval or
Blob-module execution fallback is provided.

The agent runs in the current document. Navigation, refresh and closing the tab
end the run. History is available explicitly; opening history starts a separate
local session so tabs cannot overwrite one another.

## Sign in

Open the extension settings, enter your email and select **Send sign-in email**.
Click the confirmation link in your inbox; the extension signs in automatically.
New accounts are created on confirmation, with no password or separate website
registration. You can close settings while waiting, including restarting Chrome.
Links expire after ten minutes; settings lets you change the email or request
another link. The settings disclaimer explains Hosted AI conversation storage.

`npm run e2e` exercises the built extension in Chromium using synthetic provider
and email responses, including recovery of pending login after a browser restart.
It does not replace real email delivery or the live forum release gate.

## Providers and skills

BYOK supports OpenAI-compatible endpoints (including LiteLLM) and Gemini.
Hosted inference is restricted to Luna and requires a verified account, live
session and available trial credit. The hosted
backend, production configuration and full skills collection are private and
are not required to build this repository.

Skills use `.xgs.js` ESM source. Source and executable bundles are distinct.
See `packages/skill-runtime/SKILL_AUTHORING.md`. Disabling or replacing a skill
invalidates its callable wrappers, including cached references. Requests and DOM
changes that already happened cannot be undone; a page refresh may be needed.

## Release requirements

See `docs/acceptance.md` for the live forum acceptance specification. Public CI
uses only synthetic data. Never commit API keys, browser profiles, real chats,
forum login state, or private acceptance evidence. No provider key is bundled in
this extension.
