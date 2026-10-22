/**
 * Fallback paths for getting the MAIN-world `pageBridge.js` script into the
 * page. The happy path is the host's MV3 `content_scripts` manifest entry
 * with `"world": "MAIN"` at `document_start`, which doesn't require this
 * port at all — `ensurePageBridge` first pings the bridge, and if it
 * responds, we're done.
 *
 * The two fallbacks below cover SPAs / older runtimes where the manifest
 * entry didn't fire:
 *
 *   1. `injectViaScripting()` — hosts that have `chrome.scripting.executeScript`
 *      (MV3 background SW). The SW does the actual injection on the
 *      content script's behalf, because content scripts in isolated worlds
 *      can't call `chrome.scripting`.
 *
 *   2. `injectViaScriptTag()` — last-resort `<script src="extension://…/pageBridge.js">`
 *      injection. Works on relaxed CSP sites; gets silently blocked on
 *      strict ones (Google, Facebook, GitHub, Twitter/X).
 *
 * A host that has neither (e.g. a pure userscript) should return `null`
 * from both — `ensurePageBridge` will then immediately flip the bridge to
 * "unreachable" so `callBridge` callsites fail fast with a clear error.
 */
export interface BridgeLoader {
  injectViaScripting(): Promise<BridgeInjectResult | null>;
  injectViaScriptTag(): Promise<BridgeInjectResult | null>;
}

export type BridgeInjectResult = { ok: true } | { ok: false; error: string };
