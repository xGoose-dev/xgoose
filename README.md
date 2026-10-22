# xgoose Chrome

An open source, in-page browser agent powered by PI. This repository contains
the Chrome extension, shared agent core, page tools, floating chat UI, skill
runtime, and synthetic regression tests. MIT licensed.

**0.2.1 is a release candidate with refreshed store assets and toolbar icons.**
The Chrome Web Store currently serves 0.1.0; the 0.2 update is being prepared for
review. See [the Chrome page](https://xgoose.org/chrome/) for setup and the store
link. The documented release gate still requires three consecutive real-browser
Hosted Luna runs and human evidence review; passing synthetic tests alone does
not meet that gate.

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

## Sign in

Open the extension settings, enter your email and select **Send sign-in email**.
Click the confirmation link in your inbox; the extension signs in automatically.
New accounts are created on confirmation, with no password or separate website
registration. You can close settings while waiting, including restarting Chrome.
Links expire after ten minutes; settings lets you change the email or request
another link. Hosted Luna still requires explicit conversation-storage consent.

`npm run e2e` exercises the built extension in Chromium using synthetic provider
and email responses, including recovery of pending login after a browser restart.
It does not replace real email delivery or the live forum release gate.

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
