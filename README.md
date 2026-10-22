# xgoose Chrome

An open source, in-page browser agent powered by PI. This repository contains
the Chrome extension, shared agent core, page tools, floating chat UI, skill
runtime, and synthetic regression tests. MIT licensed.

**0.2.0 is under development. It is not a Chrome Web Store release.** The release
gate requires three consecutive real-browser Hosted Luna runs and human review
of their evidence. Passing unit tests alone does not meet that gate.

## Build

Use Node.js 22.19 or newer and Chrome 138 or newer.

```sh
npm ci
npm run check
```

Load `apps/chrome/dist` as an unpacked extension in `chrome://extensions`.
Open its Details page and enable **Allow User Scripts**. Arbitrary JavaScript,
installed skills and agent-authored skills require this permission; no eval or
Blob-module execution fallback is provided.

The agent runs in the current document. Navigation, refresh and closing the tab
end the run. History is available explicitly; opening history starts a separate
local session so tabs cannot overwrite one another.

## Providers and skills

BYOK supports OpenAI-compatible endpoints (including LiteLLM) and Gemini.
Hosted inference is restricted to Luna and requires a verified account, live
session, explicit transcript consent and available trial credit. The hosted
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
