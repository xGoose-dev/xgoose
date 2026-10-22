/// <reference types="chrome" />
//
// Content-script entry that runs ONLY on `*.xgs.js` URLs (matched in the
// manifest). When the user navigates to a raw xgoose skill file (typically
// served as `text/plain` by the registry at
// `https://api.xgoose.org/skills/<slug>.xgs.js`), we:
//
//   1. Read the raw page text (browsers render text/plain in a `<pre>`).
//   2. Parse the `// ==XGooseSkill== … // ==/XGooseSkill==` header. If
//      none is present, bail silently — the file isn't ours.
//   3. Ask the background to stash the source in `chrome.storage.session`
//      and redirect this tab to the extension-served install page
//      (`install.html?stash=<key>`).
//
// The actual install UI — header preview, file upload, paste, Install /
// Cancel — lives on `install.html`, not in this content script.

import { send } from "@/shared/messages";
import { track } from "@/shared/analytics";
import { parseSkillFile, SkillHeaderError } from "@xgoose/skill-runtime/header";

if (shouldRun()) {
  void main();
}

function shouldRun(): boolean {
  const ct = document.contentType ?? "";
  if (
    ct &&
    !/^text\/(plain|javascript|x-userscript)/i.test(ct) &&
    !/javascript/i.test(ct)
  ) {
    return false;
  }
  return /\.xgs\.js(?:$|[?#])/i.test(location.pathname + location.search);
}

async function main(): Promise<void> {
  const source = await readPageSource();
  if (!source) return;

  try {
    parseSkillFile(source);
  } catch (err) {
    if (err instanceof SkillHeaderError && err.kind === "missing_header") {
      return; // Not our file — leave the page alone.
    }
    // Header malformed: surface a minimal inline error rather than silently
    // hijacking the tab to a broken install screen.
    renderError(
      `xgoose: Couldn't open install — ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  track("install_banner_xgs_detected");
  const res = await send("sw:open_install_page", {
    source,
    originUrl: location.href,
  });
  if (!res.ok) {
    renderError(`xgoose: Couldn't open install — ${res.error}`);
  }
}

async function readPageSource(): Promise<string | null> {
  const pre = document.querySelector("body > pre, pre");
  if (pre?.textContent && pre.textContent.includes("==XGooseSkill==")) {
    return pre.textContent;
  }
  // Fallback: re-fetch the URL. Same-origin, so cookies are reused without
  // any extra extension permission beyond the tab-scoped content script.
  try {
    const res = await fetch(location.href, { credentials: "include" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function renderError(msg: string): void {
  let host = document.getElementById(
    "__xgoose_install_error__",
  ) as HTMLDivElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = "__xgoose_install_error__";
    host.setAttribute(
      "style",
      [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "z-index:2147483647",
        "background:#7f1d1d",
        "color:#fee2e2",
        "font:13px/1.4 system-ui,sans-serif",
        "padding:10px 20px",
        "box-shadow:0 6px 14px rgba(0,0,0,0.3)",
      ].join(";"),
    );
    (document.body ?? document.documentElement).appendChild(host);
  }
  host.textContent = msg;
}
