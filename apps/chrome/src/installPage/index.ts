/// <reference types="chrome" />
//
// Extension-served install page.
//
// Two entry modes:
//   1. Auto-redirected from the `.xgs.js` content script — the page receives
//      a `?stash=<key>` query param pointing at a one-shot
//      `chrome.storage.session` entry holding the file source + origin URL.
//   2. Opened manually (from the options page CTA or toolbar) — the page
//      starts empty and the user pastes source or uploads a `.xgs.js` file.
//
// In both modes the user gets a parsed-header preview before confirming.
// On confirm we reuse the existing `sw:edit_skill` envelope so the
// background does the canonical parse/validate/save flow shared with the
// options-page editor.

import { send } from "@/shared/messages";
import { track } from "@/shared/analytics";
import { parseSkillFile, SkillHeaderError } from "@xgoose/skill-runtime/header";
import type { SkillHeader } from "@xgoose/skill-runtime";

const browserAPI: typeof chrome =
  (globalThis as any).browser ?? (globalThis as any).chrome;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

void main();

async function main(): Promise<void> {
  const sourceInput = $<HTMLTextAreaElement>("#sourceInput");
  const fileInput = $<HTMLInputElement>("#fileInput");
  const fileLabel = $<HTMLSpanElement>("#fileLabel");
  const installBtn = $<HTMLButtonElement>("#installBtn");
  const cancelBtn = $<HTMLButtonElement>("#cancelBtn");
  const installStatus = $<HTMLSpanElement>("#installStatus");
  const previewSection = $<HTMLElement>("#previewSection");
  const previewBody = $<HTMLDivElement>("#previewBody");
  const errorSection = $<HTMLElement>("#errorSection");
  const errorBody = $<HTMLParagraphElement>("#errorBody");
  const resultSection = $<HTMLElement>("#resultSection");
  const resultBody = $<HTMLParagraphElement>("#resultBody");
  const openOptionsBtn = $<HTMLButtonElement>("#openOptionsBtn");
  const closeTabBtn = $<HTMLButtonElement>("#closeTabBtn");

  let currentHeader: SkillHeader | null = null;
  let currentSource = "";

  // Pull `?stash=` from the URL — populated by the install-banner content
  // script (or any future trigger that stashes via `sw:stash_install_source`).
  const stashKey = new URL(location.href).searchParams.get("stash");
  track("install_page_opened", {
    source: stashKey ? "auto_redirect" : "manual",
  });
  if (stashKey) {
    const got = await loadStash(stashKey);
    if (got) {
      sourceInput.value = got.source;
      fileLabel.textContent = got.originUrl
        ? `loaded from ${shorten(got.originUrl)}`
        : "";
      handleSourceChange();
    }
  }

  sourceInput.addEventListener("input", handleSourceChange);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileLabel.textContent = `loaded ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    sourceInput.value = await file.text();
    handleSourceChange();
  });

  cancelBtn.addEventListener("click", () => {
    sourceInput.value = "";
    fileLabel.textContent = "";
    currentHeader = null;
    currentSource = "";
    previewSection.hidden = true;
    errorSection.hidden = true;
    resultSection.hidden = true;
    installBtn.disabled = true;
    installStatus.textContent = "";
  });

  installBtn.addEventListener("click", async () => {
    if (!currentHeader || !currentSource) return;
    installBtn.disabled = true;
    installStatus.textContent = "Installing…";
    installStatus.classList.remove("saved");
    track("install_clicked", { skill: currentHeader.name });
    const res = await send("sw:edit_skill", {
      name: currentHeader.name,
      source: currentSource,
    });
    if (res.ok) {
      track("install_succeeded", { skill: res.name, version: res.version });
      installStatus.textContent = `Installed · ${res.name}@${res.version}`;
      installStatus.classList.add("saved");
      resultSection.hidden = false;
      resultBody.classList.remove("error");
      resultBody.classList.add("success");
      resultBody.textContent =
        `xgoose.skills.${res.namespace} is ready on matching pages. ` +
        `Reload any open tab to load the new code.` +
        (res.bodyChanged
          ? " Heads-up: the bundled IIFE may be stale until the skill is re-published."
          : "");
    } else {
      track("install_failed", { skill: currentHeader.name });
      installBtn.disabled = false;
      installStatus.textContent = "";
      resultSection.hidden = false;
      resultBody.classList.remove("success");
      resultBody.classList.add("error");
      resultBody.textContent = `Install failed: ${res.error}`;
    }
  });

  openOptionsBtn.addEventListener("click", async () => {
    await send("sw:open_options", undefined);
  });

  closeTabBtn.addEventListener("click", () => window.close());

  function handleSourceChange(): void {
    const source = sourceInput.value;
    currentSource = source;
    resultSection.hidden = true;
    if (!source.trim()) {
      currentHeader = null;
      previewSection.hidden = true;
      errorSection.hidden = true;
      installBtn.disabled = true;
      return;
    }
    try {
      const parsed = parseSkillFile(source);
      currentHeader = parsed.header;
      renderPreview(previewBody, parsed.header);
      previewSection.hidden = false;
      errorSection.hidden = true;
      installBtn.disabled = false;
    } catch (err) {
      currentHeader = null;
      previewSection.hidden = true;
      errorSection.hidden = false;
      installBtn.disabled = true;
      track("install_parse_failed", {
        error_kind: err instanceof SkillHeaderError ? "header" : "other",
      });
      errorBody.textContent =
        err instanceof SkillHeaderError
          ? err.message
          : ((err as Error)?.message ?? String(err));
    }
  }
}

async function loadStash(
  key: string,
): Promise<{ source: string; originUrl: string | null } | null> {
  try {
    const got = await browserAPI.storage.session.get(key);
    const raw = got[key] as { source?: string; originUrl?: string } | undefined;
    if (!raw || typeof raw.source !== "string") return null;
    await browserAPI.storage.session.remove(key);
    return { source: raw.source, originUrl: raw.originUrl ?? null };
  } catch {
    return null;
  }
}

function renderPreview(host: HTMLElement, header: SkillHeader): void {
  host.innerHTML = "";
  const rows: Array<[string, string]> = [
    ["name", `${header.name}@${header.version}`],
    ["namespace", `xgoose.skills.${header.namespace}`],
    ["description", header.description || "(none)"],
  ];
  if (header.matches.length) rows.push(["matches", header.matches.join(", ")]);
  if (header.include.length) rows.push(["include", header.include.join(", ")]);
  if (header.exclude.length) rows.push(["exclude", header.exclude.join(", ")]);
  if (header.primary) rows.push(["★ primary", header.primary]);
  if (header.requires.length)
    rows.push(["requires", header.requires.join(", ")]);
  if (header.author) rows.push(["author", header.author]);
  if (header.homepage) rows.push(["homepage", header.homepage]);

  for (const [label, value] of rows) {
    const labelEl = document.createElement("div");
    labelEl.className = "label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "value";
    const code = document.createElement("code");
    code.textContent = value;
    valueEl.appendChild(code);
    host.append(labelEl, valueEl);
  }
}

function shorten(url: string): string {
  if (url.length <= 64) return url;
  return url.slice(0, 30) + "…" + url.slice(-30);
}
