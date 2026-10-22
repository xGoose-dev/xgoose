<div align="center">

<img src="./assets/logo.png" alt="xgoose" width="180" />

# xgoose-extension-chrome

**Chrome MV3 host for the xgoose agent.**

[![Status](https://img.shields.io/badge/status-experimental-orange)](#status)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/E2E-Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)

</div>

---

## Overview

Chrome MV3 host that reuses the same headless agent
([`@xgoose/core`](../xgoose-core/packages/core/)), DOM controller
([`@xgoose/page-controller`](../xgoose-core/packages/page-controller/)),
and chat panel ([`@xgoose/ui`](../xgoose-core/packages/ui/)) that power
[xgoose-extension-safari](../xgoose-extension-safari/) — Chrome just
brings its own MV3 service worker, popup, and `chrome.runtime` adapters.

This is the second concrete host built on top of `@xgoose/*` and exists
mainly to validate that the core extraction is genuinely portable.

## Table of contents

- [Layout](#layout)
- [Build](#build)
- [What the agent can do out of the box](#what-the-agent-can-do-out-of-the-box)
- [End-to-end smoke test](#end-to-end-smoke-test)
- [Status](#status)
- [License](#license)

## Layout

```
xgoose-extension-chrome/
├── assets/                  Brand assets (logo, icons)
├── static/
│   ├── manifest.json        MV3 manifest (committed; copied into dist/ as-is)
│   ├── popup.html
│   └── popup.css
├── src/
│   ├── background/          MV3 service worker (fetch proxy + scripting inject)
│   ├── content/
│   │   ├── index.ts             orchestrator: panel + agent stream loop
│   │   └── hostPorts/           Chrome adapters for the @xgoose/core ports
│   ├── page/
│   │   └── pageBridgeEntry.ts   shim that bundles @xgoose/page-controller/pageBridge
│   ├── popup/               settings (provider, API key, model, theme)
│   └── shared/              messages + chrome.storage shim + Settings schema
├── scripts/
│   ├── build.mjs            esbuild orchestration (build / --watch)
│   └── e2e.mjs              Playwright smoke test (launches Chromium headed)
├── dist/                    build output (load this unpacked into Chrome)
└── package.json
```

## Build

```sh
npm install        # links @xgoose/core, @xgoose/page-controller, @xgoose/ui via file:
npm run build      # → dist/{manifest.json, background.js, content.js, pageBridge.js, popup.html/js/css}
npm run dev        # esbuild --watch
npm run typecheck  # tsc --noEmit
```

After `npm run build`:

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and pick the `dist/` directory.
4. Click the puzzle-piece in the toolbar → pin xgoose.
5. Click the xgoose icon → enter a provider + API key + model → **Save**.
6. Open any page (e.g. `https://example.com`). A purple ✦ button appears
   in the bottom-right. Click it, type a prompt, hit ↵.

## What the agent can do out of the box

Same set of universal tools as xgoose-extension-safari, minus the
skill-registry tools (since this host has no skill bundling pipeline):

- `page_info`, `read_page`, `js_exec`, `console_logs`, `network_requests`,
  `network_request` — DOM + page-API tools from `@xgoose/page-controller`.
- `todo_write`, `remember`, `forget` — agent state tools from `@xgoose/core`.

Things explicitly NOT ported from xgoose-extension-safari (out of scope
for this minimal host):

- Conversation history / persistence
- Auto-resume after `js_exec` navigates the tab
- Skill registry (`list_skills`, `help`, `skill_call`, etc.)
- Account / login flow
- Multi-tab routing

These can be layered on top as additional host modules without touching
`@xgoose/core` / `@xgoose/page-controller` / `@xgoose/ui`.

## End-to-end smoke test

```sh
npm run e2e
```

Launches a headed Chromium with the built `dist/` folder loaded as an
unpacked extension, navigates to `https://example.com`, seeds the API
key (if `GEMINI_API_KEY` / `OPENAI_API_KEY` is in the env), waits for
the floating ✦ button to mount, and verifies the chat panel opens. See
`scripts/e2e.mjs` for the full flow.

The test runs against the actual built bundle, so it doubles as a
regression check for the build pipeline.

## Status

Release candidate for the current-page Chrome extension. See the
[root README](../../README.md) for current release status and the
[Chrome page](https://xgoose.org/chrome/) for setup instructions.

## License

MIT. See [LICENSE](../../LICENSE).
