/// <reference types="chrome" />

import { send } from "@/shared/messages";
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  LayoutSchema,
  SettingsSchema,
  getProviderApiKey,
  getProviderBaseUrl,
  type Layout,
  type Provider,
  type Settings,
} from "@/shared/types";
import { DEFAULT_MODEL_BY_PROVIDER as CORE_DEFAULT_MODEL_BY_PROVIDER } from "@xgoose/core";
import {
  MODEL_ENTRIES,
  decodeValue,
  encodeEntry,
  findEntry,
  type ModelEntry,
} from "@/shared/modelCatalog";
import { ACCOUNT_KEY, onAccountChange, type Account } from "@/shared/account";
import { track } from "@/shared/analytics";

const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  ...CORE_DEFAULT_MODEL_BY_PROVIDER,
  "xgoose-hosted": "luna",
};

const SETTINGS_KEY = "xgoose.settings";
const LAYOUT_KEY = "xgoose.layout";

async function loadLayout(): Promise<Layout> {
  const data = await chrome.storage.local.get(LAYOUT_KEY);
  const parsed = LayoutSchema.safeParse(data[LAYOUT_KEY] ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_LAYOUT };
}

async function saveLayout(layout: Layout): Promise<void> {
  await chrome.storage.local.set({ [LAYOUT_KEY]: layout });
}

async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const parsed = SettingsSchema.safeParse(data[SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

async function persistSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

async function loadSkills() {
  return await send("sw:list_skills", undefined);
}

async function setDisabled(name: string, disabled: boolean): Promise<void> {
  await send("sw:set_skill_disabled", { name, disabled });
}

function $<T extends HTMLElement = HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

(async function init() {
  await mountAccountSection();
  const privacy = document.createElement("section");
  privacy.className = "card";
  privacy.innerHTML = `<h2>Conversation privacy</h2><p>Hosted Luna saves full messages, actual tool inputs and outputs, errors and summaries for 90 days. Credentials are redacted. Staff can read a conversation only after you authorize that specific conversation. View, export and delete at <a href="https://xgoose.org/account/" target="_blank">Your account</a>.</p><p><label><input id="hostedConsent" type="checkbox"> I agree to conversation storage when using Hosted Luna.</label></p><p><label><input id="byokConsent" type="checkbox"> Also upload my BYOK conversations (optional; off by default).</label></p><button id="saveConsent">Save conversation preferences</button><p id="consentStatus"></p><h2>Allow User Scripts</h2><p>Open chrome://extensions → xgoose → Details and enable Allow User Scripts. Disabling skills stops future calls; existing requests and page changes may require a refresh to clear.</p>`;
  document.querySelector(".page")!.append(privacy);
  const hosted = privacy.querySelector<HTMLInputElement>("#hostedConsent")!;
  const byok = privacy.querySelector<HTMLInputElement>("#byokConsent")!;
  const status = privacy.querySelector<HTMLElement>("#consentStatus")!;
  try { const c = await send("sw:consent_get", undefined); hosted.checked=c.hosted;byok.checked=c.byok; } catch { status.textContent="Sign in to manage server preferences. BYOK upload is off by default."; }
  privacy.querySelector("#saveConsent")!.addEventListener("click",async()=>{
    try { await send("sw:consent_set",{hosted:hosted.checked,byok:byok.checked});status.textContent="Saved. Withdrawing stops future uploads and clears pending uploads. Existing records can be deleted on your account page."; }
    catch(error) { status.textContent=String(error); }
  });
  const settings = await loadSettings();
  const providerEl = $<HTMLSelectElement>("#provider");
  const modelEl = $<HTMLSelectElement>("#model");
  const modelCustomToggleEl = $<HTMLInputElement>("#modelCustomToggle");
  const modelCustomRowEl = $<HTMLDivElement>("#modelCustomRow");
  const modelCustomEl = $<HTMLInputElement>("#modelCustom");
  const apiKeyEl = $<HTMLInputElement>("#apiKey");
  const apiKeyRowEl = $<HTMLDivElement>("#apiKeyRow");
  const apiKeyTestRowEl = $<HTMLDivElement>("#apiKeyTestRow");
  const testApiKeyBtn = $<HTMLButtonElement>("#testApiKeyBtn");
  const testApiKeyStatus = $<HTMLSpanElement>("#testApiKeyStatus");
  const baseUrlEl = $<HTMLInputElement>("#baseUrl");
  const baseUrlOuterRowEl = $<HTMLDivElement>("#baseUrlOuterRow");
  const baseUrlHintEl = $<HTMLSpanElement>("#baseUrlHint");
  const hostedStatusRowEl = $<HTMLDivElement>("#hostedStatusRow");
  const hostedStatusHintEl = $<HTMLSpanElement>("#hostedStatusHint");
  const themeEl = $<HTMLSelectElement>("#theme");
  const launcherVisibilityEl = $<HTMLSelectElement>("#launcherVisibility");
  const jsExecTimeoutMsEl = $<HTMLInputElement>("#jsExecTimeoutMs");
  const jsExecTimeoutMsLabelEl = $<HTMLSpanElement>("#jsExecTimeoutMsLabel");
  const analyticsEnabledEl = $<HTMLInputElement>("#analyticsEnabled");
  const saveBtn = $<HTMLButtonElement>("#saveBtn");
  const resetBtn = $<HTMLButtonElement>("#resetBtn");
  const saveStatus = $<HTMLSpanElement>("#saveStatus");
  const skillList = $<HTMLDivElement>("#skillList");

  function populateModelDropdown(
    provider: Provider,
    currentModel: string,
    currentThinking: boolean,
  ): void {
    const entries = MODEL_ENTRIES[provider] ?? [];
    modelEl.innerHTML = "";
    const isHosted = provider === "xgoose-hosted";
    modelCustomToggleEl.disabled = isHosted;
    if (isHosted) {
      modelCustomToggleEl.checked = false;
      modelCustomRowEl.hidden = true;
      modelCustomEl.value = "";
      if (!entries.length) {
        const opt = document.createElement("option");
        opt.value = currentModel || DEFAULT_MODEL_BY_PROVIDER[provider];
        opt.textContent = "Loading hosted models…";
        modelEl.appendChild(opt);
        modelEl.disabled = true;
        return;
      }
      for (const entry of entries) {
        const opt = document.createElement("option");
        opt.value = encodeEntry(entry);
        opt.textContent = entry.label;
        modelEl.appendChild(opt);
      }
      const choice =
        findEntry(provider, currentModel, false) ??
        findEntry(provider, DEFAULT_MODEL_BY_PROVIDER[provider], false) ??
        entries[0];
      modelEl.value = encodeEntry(choice);
      modelEl.disabled = false;
      return;
    }
    modelCustomToggleEl.disabled = false;
    for (const entry of entries) {
      const opt = document.createElement("option");
      opt.value = encodeEntry(entry);
      opt.textContent = entry.label;
      modelEl.appendChild(opt);
    }
    const match = findEntry(provider, currentModel, currentThinking);
    if (match) {
      modelEl.value = encodeEntry(match);
      modelCustomToggleEl.checked = false;
      modelCustomRowEl.hidden = true;
      modelEl.disabled = false;
      modelCustomEl.value = "";
    } else {
      // Stored model isn't in the curated list, OR the user previously
      // saved a thinking variant for a provider that no longer offers
      // one — drop them into custom mode with the raw id so nothing is
      // silently overwritten.
      modelCustomToggleEl.checked = true;
      modelCustomRowEl.hidden = false;
      modelEl.disabled = true;
      modelCustomEl.value = currentModel;
    }
  }

  modelCustomToggleEl.addEventListener("change", () => {
    const useCustom = modelCustomToggleEl.checked;
    modelCustomRowEl.hidden = !useCustom;
    modelEl.disabled = useCustom;
    if (!useCustom) {
      modelCustomEl.value = "";
      const p = providerEl.value as Provider;
      // Seed the dropdown with the provider default if nothing is selected
      // yet (avoids submitting an empty model).
      if (!modelEl.value) {
        const defaultEntry =
          findEntry(p, DEFAULT_MODEL_BY_PROVIDER[p], false) ??
          (MODEL_ENTRIES[p] ?? [])[0];
        if (defaultEntry) modelEl.value = encodeEntry(defaultEntry);
      }
    }
  });

  // Layout controls
  const layoutInfoEl = $<HTMLDivElement>("#layoutInfo");
  const resetLayoutBtn = $<HTMLButtonElement>("#resetLayoutBtn");

  async function renderLayoutInfo(): Promise<void> {
    const layout = await loadLayout();
    const cornerLabel: Record<Layout["buttonCorner"], string> = {
      br: "bottom-right",
      bl: "bottom-left",
      tr: "top-right",
      tl: "top-left",
    };
    layoutInfoEl.innerHTML =
      `Currently: button at <code>${cornerLabel[layout.buttonCorner]}</code> ` +
      `(${layout.buttonOffset.h}, ${layout.buttonOffset.v}); ` +
      `panel ${layout.panelSize.w}×${layout.panelSize.h}px ` +
      `anchored ${cornerLabel[layout.panelCorner]}.`;
  }
  await renderLayoutInfo();

  resetLayoutBtn.addEventListener("click", async () => {
    if (
      !confirm("Reset the floating button position and panel size to defaults?")
    )
      return;
    await saveLayout({ ...DEFAULT_LAYOUT });
    await renderLayoutInfo();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("xgoose.layout" in changes) void renderLayoutInfo();
  });

  // Skill editor controls
  const editor = $<HTMLElement>("#skillEditor");
  const editorTitle = $<HTMLSpanElement>("#skillEditorTitle");
  const editorStatus = $<HTMLSpanElement>("#skillEditorStatus");
  const addSkillBtn = $<HTMLButtonElement>("#addSkillBtn");
  const skillSourceEl = $<HTMLTextAreaElement>("#skillSource");
  const skillCancelBtn = $<HTMLButtonElement>("#skillCancelBtn");
  const skillDeleteBtn = $<HTMLButtonElement>("#skillDeleteBtn");
  const skillSaveBtn = $<HTMLButtonElement>("#skillSaveBtn");

  // Local per-provider draft maps. We seed from the persisted settings
  // (which the storage migration already shaped into per-provider maps),
  // then mutate them as the user types into the apiKey / baseUrl inputs.
  // On Save we serialise the full maps back to storage. On provider
  // switch, we stash whatever's currently in the inputs into the
  // *previous* provider's slot and then load the next provider's slot.
  const draftApiKeys: Record<string, string> = { ...(settings.apiKeys ?? {}) };
  const draftBaseUrls: Record<string, string> = {
    ...(settings.baseUrls ?? {}),
  };
  let lastProviderForDraft: Provider = settings.provider;

  providerEl.value = settings.provider;
  populateModelDropdown(settings.provider, settings.model, settings.thinking);
  apiKeyEl.value = getProviderApiKey(settings);
  baseUrlEl.value = getProviderBaseUrl(settings);
  themeEl.value = settings.theme;
  launcherVisibilityEl.value = settings.launcherVisibility;
  jsExecTimeoutMsEl.value = String(settings.jsExecTimeoutMs);
  jsExecTimeoutMsLabelEl.textContent = formatTimeout(settings.jsExecTimeoutMs);
  analyticsEnabledEl.checked = settings.analyticsEnabled !== false;
  updateProviderDependent(settings.provider);

  track("options_page_opened", { provider: settings.provider });

  jsExecTimeoutMsEl.addEventListener("input", () => {
    const ms = Number(jsExecTimeoutMsEl.value);
    if (Number.isFinite(ms) && ms >= 1000) {
      jsExecTimeoutMsLabelEl.textContent = formatTimeout(ms);
    }
  });

  // Whenever the user types into the apiKey / baseUrl inputs, mirror
  // the typed value into the draft map under the CURRENTLY-selected
  // provider so a subsequent provider switch doesn't lose unsaved
  // input. This also feeds the Save handler — it reads the draft maps
  // directly so the persisted shape always reflects every provider
  // slot the user has touched in this session.
  apiKeyEl.addEventListener("input", () => {
    draftApiKeys[lastProviderForDraft] = apiKeyEl.value;
  });
  baseUrlEl.addEventListener("input", () => {
    draftBaseUrls[lastProviderForDraft] = baseUrlEl.value;
  });

  providerEl.addEventListener("change", () => {
    const p = providerEl.value as Provider;
    track("options_provider_changed", {
      from: lastProviderForDraft,
      to: p,
    });
    // Stash the current input values into the OLD provider's draft slot
    // before swapping. This is what fixes the original bug: switching
    // Gemini → OpenAI no longer carries the Gemini key into the
    // OpenAI input — instead the OpenAI slot's saved value (if any) is
    // loaded fresh, and the Gemini value is preserved for when the
    // user switches back.
    draftApiKeys[lastProviderForDraft] = apiKeyEl.value;
    draftBaseUrls[lastProviderForDraft] = baseUrlEl.value;
    apiKeyEl.value = draftApiKeys[p] ?? "";
    baseUrlEl.value = draftBaseUrls[p] ?? "";
    lastProviderForDraft = p;

    // Carry the user's current pick over to the new provider when that
    // exact (model, thinking) tuple is also offered there — otherwise
    // fall back to the provider default. Custom-mode entries always
    // re-seed to the default because a custom name typed for one
    // provider rarely makes sense for another.
    const currentChoice = readCurrentChoice();
    const carryEntry = currentChoice
      ? findEntry(p, currentChoice.id, currentChoice.thinking)
      : undefined;
    const nextModel = carryEntry?.id ?? DEFAULT_MODEL_BY_PROVIDER[p];
    const nextThinking = carryEntry?.thinking ?? false;
    populateModelDropdown(p, nextModel, nextThinking);
    updateProviderDependent(p);
  });

  /** Read the model/thinking currently chosen in the dropdown or custom
   *  input. Returns null when nothing meaningful is selected (custom mode
   *  with an empty input). */
  function readCurrentChoice(): { id: string; thinking: boolean } | null {
    if (modelCustomToggleEl.checked) {
      const raw = modelCustomEl.value.trim();
      return raw ? { id: raw, thinking: false } : null;
    }
    const value = modelEl.value;
    return value ? decodeValue(value) : null;
  }

  function updateProviderDependent(p: Provider) {
    const placeholder: Record<Provider, string> = {
      gemini: "(not used — keep blank for native Google API)",
      "gemini-litellm": "https://your-litellm-proxy.example",
      "openai-compat": "https://api.openai.com (or your compatible endpoint)",
      "xgoose-hosted": "(managed by your xgoose account)",
    };
    const hint: Record<Provider, string> = {
      gemini: "Leave blank — the native Gemini API is used.",
      "gemini-litellm":
        "Point this at your LiteLLM-Gemini proxy. The Google SDK uses this as baseURL.",
      "openai-compat":
        "OpenAI Chat-Completions endpoint. We add /v1 if missing. Works with OpenAI, LiteLLM, Together, Ollama, Azure OpenAI, etc.",
      "xgoose-hosted":
        "Routed through https://api.xgoose.org/ai using your signed-in account token; no key needed.",
    };
    baseUrlEl.placeholder = placeholder[p];
    baseUrlHintEl.textContent = hint[p];
    baseUrlEl.disabled = p === "gemini" || p === "xgoose-hosted";

    // Hosted provider takes its key/base URL from the account, so hide
    // the BYO fields entirely and surface a sign-in-aware status banner.
    const isHosted = p === "xgoose-hosted";
    apiKeyRowEl.hidden = isHosted;
    apiKeyTestRowEl.hidden = isHosted;
    baseUrlOuterRowEl.hidden = isHosted;
    hostedStatusRowEl.hidden = !isHosted;
    if (isHosted) {
      void refreshHostedState();
    }
    clearTestStatus();
  }

  function setTestStatus(text: string, kind: "ok" | "err" | "info"): void {
    testApiKeyStatus.textContent = text;
    testApiKeyStatus.classList.remove("saved");
    if (kind === "ok") {
      testApiKeyStatus.classList.add("saved");
      testApiKeyStatus.style.color = "";
    } else if (kind === "err") {
      testApiKeyStatus.style.color = "#f87171";
    } else {
      testApiKeyStatus.style.color = "";
    }
  }
  function clearTestStatus(): void {
    testApiKeyStatus.textContent = "";
    testApiKeyStatus.classList.remove("saved");
    testApiKeyStatus.style.color = "";
  }

  // Re-clear the test result whenever the user edits the credentials —
  // it would be misleading to keep a stale "valid" badge while the
  // input has been mutated since the test ran.
  apiKeyEl.addEventListener("input", clearTestStatus);
  baseUrlEl.addEventListener("input", clearTestStatus);

  testApiKeyBtn.addEventListener("click", async () => {
    const provider = providerEl.value as Provider;
    const apiKey = apiKeyEl.value;
    const baseUrl = baseUrlEl.value.trim();
    if (provider === "xgoose-hosted") {
      // UI hides the button for hosted, so this shouldn't fire — but be
      // defensive in case the row is force-shown via DevTools.
      setTestStatus(
        "Hosted provider uses your account token, not an API key.",
        "info",
      );
      return;
    }
    testApiKeyBtn.disabled = true;
    setTestStatus("Testing…", "info");
    track("options_api_key_test_clicked", { provider });
    try {
      const res = await send("sw:test_api_key", { provider, apiKey, baseUrl });
      if (res.ok) {
        setTestStatus(`✓ ${res.message}`, "ok");
        track("options_api_key_test_succeeded", { provider });
      } else {
        setTestStatus(`✗ ${res.error}`, "err");
        track("options_api_key_test_failed", { provider });
      }
    } finally {
      testApiKeyBtn.disabled = false;
    }
  });

  // ── Hosted provider: dynamic model list + signed-in status ──
  //
  // The host SW exposes `sw:list_xgoose_models` which calls `GET /ai/v1/models`
  // on the xgoose-web gateway with the current bearer token. If the user is
  // signed out, we render a CTA pointing back to the account section above
  // and leave the dropdown empty (with a single placeholder option so the
  // page doesn't look broken).

  async function refreshHostedState(): Promise<void> {
    hostedStatusHintEl.textContent = "Loading available models…";
    hostedStatusHintEl.style.color = "";
    const res = await send("sw:list_xgoose_models", {});
    if (!res.ok) {
      if (!res.signedIn) {
        hostedStatusHintEl.innerHTML =
          "⚠ Sign in to your xgoose account (above) to use the hosted gateway. " +
          "The agent will refuse to run while this provider is selected and you are signed out.";
      } else {
        hostedStatusHintEl.textContent = `Could not load model list: ${res.error}`;
      }
      hostedStatusHintEl.style.color = "#f87171";
      MODEL_ENTRIES["xgoose-hosted"] = [];
      modelEl.innerHTML = "";
      const opt = document.createElement("option");
      const fallback = DEFAULT_MODEL_BY_PROVIDER["xgoose-hosted"];
      opt.value = fallback;
      opt.textContent = !res.signedIn
        ? `${fallback} (sign in required)`
        : `${fallback} (model list unavailable)`;
      modelEl.appendChild(opt);
      modelEl.disabled = true;
      modelCustomToggleEl.checked = false;
      modelCustomToggleEl.disabled = true;
      modelCustomRowEl.hidden = true;
      return;
    }
    MODEL_ENTRIES["xgoose-hosted"] = res.models.map(
      (id): ModelEntry => ({ id, thinking: false, label: id }),
    );
    hostedStatusHintEl.style.color = "";
    hostedStatusHintEl.textContent = `Hosted models: ${res.models.length} available · routed through your xgoose account.`;
    const current = readCurrentChoice();
    populateModelDropdown(
      "xgoose-hosted",
      current?.id || DEFAULT_MODEL_BY_PROVIDER["xgoose-hosted"],
      false,
    );
  }

  saveBtn.addEventListener("click", async () => {
    const provider = providerEl.value as Provider;
    // Custom mode → free-form id, no thinking. Dropdown mode → decode the
    // option value back into `(id, thinking)`. The "(thinking)" entries
    // are the only place `thinking=true` is set; there's no separate
    // checkbox anymore.
    const choice = readCurrentChoice() ?? {
      id: DEFAULT_MODEL_BY_PROVIDER[provider],
      thinking: false,
    };
    const chosenModel = choice.id;
    // Hosted: apiKey + baseUrl are derived from the account at runtime, so
    // we deliberately do NOT persist whatever's in the input fields for
    // this provider. Otherwise stale BYO values could leak into the
    // openai-compat projection and confuse the user.
    const isHosted = provider === "xgoose-hosted";

    // Commit the currently-visible inputs into the draft maps under
    // the active provider before serialising — covers the case where
    // the user types and clicks Save without ever switching providers.
    if (!isHosted) {
      draftApiKeys[provider] = apiKeyEl.value;
      draftBaseUrls[provider] = baseUrlEl.value.trim();
    } else {
      // Explicitly clear the hosted slot so a previous BYO key for this
      // provider doesn't accidentally re-emerge if the user toggles
      // hosted off and on.
      draftApiKeys[provider] = "";
      draftBaseUrls[provider] = "";
    }

    const next: Settings = {
      ...settings,
      provider,
      model: chosenModel || DEFAULT_MODEL_BY_PROVIDER[provider],
      // Per-provider maps are the authoritative storage. The legacy flat
      // fields are kept in sync with the CURRENT provider's values for
      // any code path that still reads them; `getProviderApiKey` /
      // `getProviderBaseUrl` always prefer the map.
      apiKeys: { ...draftApiKeys },
      baseUrls: { ...draftBaseUrls },
      apiKey: isHosted ? "" : (draftApiKeys[provider] ?? ""),
      baseUrl: isHosted ? "" : (draftBaseUrls[provider] ?? ""),
      // Thinking is now part of the model selection: each thinking-capable
      // model is a separate dropdown entry whose value carries the flag.
      // Hosted collapses to openai-compat over the wire so the core
      // `providerOptionsFor` would ignore thinking anyway — force false.
      thinking: isHosted ? false : choice.thinking,
      theme: themeEl.value as Settings["theme"],
      launcherVisibility:
        launcherVisibilityEl.value as Settings["launcherVisibility"],
      // Privacy: header redaction is always on — no user-facing toggle. We
      // still set the field here so the schema stays satisfied and any old
      // persisted `false` value is overwritten on the next save.
      redactSensitiveHeaders: true,
      jsExecTimeoutMs: clampInt(jsExecTimeoutMsEl.value, 1000, 600_000, 30_000),
      analyticsEnabled: analyticsEnabledEl.checked,
    };
    track("options_save_clicked", {
      provider,
      has_api_key: !isHosted && (draftApiKeys[provider] ?? "").length > 0,
      theme: next.theme,
      launcher_visibility: next.launcherVisibility,
      analytics_enabled: next.analyticsEnabled,
    });
    await persistSettings(next);
    saveStatus.textContent = "Saved";
    saveStatus.classList.add("saved");
    setTimeout(() => {
      saveStatus.textContent = "";
      saveStatus.classList.remove("saved");
    }, 2000);
  });

  function clampInt(
    raw: string,
    lo: number,
    hi: number,
    fallback: number,
  ): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function formatTimeout(ms: number): string {
    if (ms >= 60_000) return (ms / 60_000).toFixed(0) + "m";
    return (ms / 1000).toFixed(0) + "s";
  }

  resetBtn.addEventListener("click", async () => {
    if (
      !confirm("Reset all settings to defaults? Your API key will be cleared.")
    )
      return;
    await persistSettings({ ...DEFAULT_SETTINGS });
    location.reload();
  });

  // ── Skills rendering ──

  async function renderSkillList(): Promise<void> {
    const skills = await loadSkills();
    skillList.innerHTML = "";
    if (!skills.length) {
      skillList.innerHTML = `<div class="empty">No skills yet. Click <strong>Add custom skill</strong> below to create one.</div>`;
      return;
    }
    for (const s of skills) {
      const row = document.createElement("div");
      row.className = "skill-item";
      row.innerHTML = `
        <input type="checkbox" ${s.enabled ? "checked" : ""} data-name="${escAttr(s.name)}">
        <div class="skill-meta">
          <div>
            <span class="skill-name"></span><span class="skill-ns"></span>
            <span class="skill-badge ${s.userAuthored ? "custom" : "bundled"}">${s.userAuthored ? "custom" : "bundled"}</span>
          </div>
          <div class="skill-desc"></div>
          <div class="skill-matches"></div>
        </div>
        ${s.userAuthored ? `<button class="skill-edit" data-name="${escAttr(s.name)}">Edit</button>` : ""}
      `;
      (row.querySelector(".skill-name") as HTMLElement).textContent = s.name;
      (row.querySelector(".skill-ns") as HTMLElement).textContent =
        ` · ${s.namespace}`;
      (row.querySelector(".skill-desc") as HTMLElement).textContent =
        s.description || "(no description)";
      (row.querySelector(".skill-matches") as HTMLElement).textContent =
        (s.matches ?? []).join(", ") || "(no URL match — never auto-injects)";
      const cb = row.querySelector("input[type=checkbox]") as HTMLInputElement;
      cb.addEventListener("change", async () => {
        await setDisabled(s.name, !cb.checked);
      });
      const editBtn = row.querySelector(
        ".skill-edit",
      ) as HTMLButtonElement | null;
      editBtn?.addEventListener("click", async () => {
        await openEditorFor(s.name);
      });
      skillList.appendChild(row);
    }
  }
  await renderSkillList();
  const catalogSection=document.createElement("section");catalogSection.id="catalog";catalogSection.className="card";
  const heading=document.createElement("h2");heading.textContent="Website skills";catalogSection.append(heading);
  document.querySelector(".page")!.append(catalogSection);
  const selected=new Set((new URLSearchParams(location.search).get("skills")??"").split(","));
  try {
    const catalog=await send("sw:skill_catalog",undefined);
    const installed=await send("sw:list_user_skills",undefined);
    for(const item of catalog.sort((a,b)=>Number(selected.has(b.slug))-Number(selected.has(a.slug)))) {
      const row=document.createElement("div");row.className="skill-item";
      const label=document.createElement("span");label.textContent=`${item.name} · ${item.version} — ${item.description}`;row.append(label);
      const existing=installed.find(s=>s.name===item.name);
      const install=document.createElement("button");install.textContent=existing?(existing.version===item.version?"Installed":"Update explicitly"):"Install";
      install.disabled=existing?.version===item.version;
      install.addEventListener("click",async()=>{install.disabled=true;try{await send("sw:install_catalog_skill",{slug:item.slug,version:item.version});install.textContent="Installed";await renderSkillList();}catch(error){install.textContent=String(error);install.disabled=false;}});row.append(install);catalogSection.append(row);
    }
    if(location.hash==="#catalog")catalogSection.scrollIntoView();
  }catch {const msg=document.createElement("p");msg.textContent="The skill catalog is temporarily unavailable. Installed skills remain available.";catalogSection.append(msg);}


  // ── Skill editor ──

  let editingName: string | null = null;

  async function openEditorFor(name: string | null): Promise<void> {
    editor.removeAttribute("hidden");
    editorStatus.textContent = "";
    editorStatus.classList.remove("saved");
    if (name) {
      editingName = name;
      editorTitle.textContent = `Edit skill · ${name}`;
      const res = await send("sw:get_skill_source", { name });
      skillSourceEl.value = res.ok ? res.source : "";
      skillDeleteBtn.hidden = false;
    } else {
      editingName = null;
      editorTitle.textContent = "New custom skill";
      skillSourceEl.value = "";
      skillDeleteBtn.hidden = true;
    }
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor(): void {
    editor.setAttribute("hidden", "");
    editingName = null;
  }

  // "Add custom skill" → open the dedicated install page (extension-served)
  // in a new tab. The install page supports file upload, paste, header
  // preview, and confirmation, and shares the install pipeline with the
  // auto-redirect flow from `*.xgs.js` URLs.
  addSkillBtn.addEventListener("click", () => {
    const url = chrome.runtime.getURL("install.html");
    void chrome.tabs.create({ url });
  });
  skillCancelBtn.addEventListener("click", closeEditor);

  skillSaveBtn.addEventListener("click", async () => {
    const source = skillSourceEl.value;
    if (!source.trim()) {
      editorStatus.textContent = "Paste a `.xgs.js` source first.";
      editorStatus.style.color = "#f87171";
      return;
    }
    // For a brand-new skill, peek the header to extract @name so we know the
    // storage key. The background handler validates everything else.
    const headerMatch = source.match(
      /^[ \t]*\/\/[ \t]*@name[ \t]+([^\r\n]+)$/m,
    );
    const peekedName = headerMatch?.[1]?.trim() ?? "";
    const targetName = editingName ?? peekedName;
    if (!targetName) {
      editorStatus.textContent = "Header is missing `@name`.";
      editorStatus.style.color = "#f87171";
      return;
    }
    const res = await send("sw:edit_skill", { name: targetName, source });
    if (!res.ok) {
      editorStatus.textContent = res.error;
      editorStatus.style.color = "#f87171";
      return;
    }
    editorStatus.style.color = "";
    editorStatus.textContent = `Saved · ${res.name}@${res.version}${res.bodyChanged ? " (body changed — re-publish to refresh bundled IIFE)" : ""}`;
    editorStatus.classList.add("saved");
    await renderSkillList();
    setTimeout(() => {
      editorStatus.textContent = "";
      editorStatus.classList.remove("saved");
    }, 4000);
  });

  skillDeleteBtn.addEventListener("click", async () => {
    if (!editingName) return;
    if (!confirm(`Delete custom skill "${editingName}"? This can't be undone.`))
      return;
    await send("sw:delete_user_skill", { name: editingName });
    closeEditor();
    await renderSkillList();
  });

  // Live-refresh the skill list when something writes the user-skill storage
  // (e.g. someone editing in another window).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      "xgoose.skills.user" in changes ||
      "xgoose.skills.disabled" in changes
    ) {
      void renderSkillList();
    }
  });

  // When the account state changes (sign-in / sign-out / refresh), and the
  // hosted provider is currently selected, repopulate the model dropdown
  // and the inline status hint so the page reflects the new auth state
  // without a manual reload.
  onAccountChange(() => {
    if ((providerEl.value as Provider) === "xgoose-hosted") {
      void refreshHostedState();
    }
  });
})().catch((err) => console.error("[xgoose] options init failed", err));

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Account section: sign-in via xgoose.org device flow + signed-in profile.
// All login state lives in the service worker (`background/account.ts`); we
// just render whatever the SW reports, and refresh on storage.onChanged.
// ---------------------------------------------------------------------------

type LoginPhase = "idle" | "pending" | "denied" | "expired" | "error";
interface LoginState {
  phase: LoginPhase;
  userCode: string | null;
  verificationUri: string | null;
  expiresAt: number | null;
  intervalMs: number;
  error: string | null;
}

async function mountAccountSection(): Promise<void> {
  const found = document.getElementById(
    "accountState",
  ) as HTMLDivElement | null;
  if (!found) return;
  const root: HTMLDivElement = found;

  // Local UI poll handle — we tick a re-render while a login is pending so the
  // countdown stays fresh and we pick up the SW's polling result.
  let pendingTicker: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    const [account, loginState] = await Promise.all([
      send("sw:account_get", undefined),
      send("sw:account_login_state", undefined),
    ]);
    render(account, loginState as LoginState);
    if (loginState.phase === "pending" && !pendingTicker) {
      pendingTicker = setInterval(refresh, 2000);
    } else if (loginState.phase !== "pending" && pendingTicker) {
      clearInterval(pendingTicker);
      pendingTicker = null;
    }
  }

  function render(account: Account | null, login: LoginState): void {
    // Clear any transient device-code/error cards we previously appended
    // alongside the root (they live as siblings inside the section).
    const parent = root.parentElement;
    if (parent) {
      Array.from(parent.querySelectorAll(".device-code-card")).forEach((el) =>
        el.remove(),
      );
    }
    root.classList.remove("account-state-loading");
    root.innerHTML = "";
    if (account) {
      renderSignedIn(root, account);
    } else {
      renderSignedOut(root, login);
    }
  }

  function renderSignedIn(host: HTMLElement, account: Account): void {
    const initial = (account.user.name || account.user.email || "?")
      .trim()
      .charAt(0)
      .toUpperCase();
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (account.user.avatar_url) {
      avatar.style.backgroundImage = `url("${escAttr(account.user.avatar_url)}")`;
      avatar.textContent = "";
    } else {
      avatar.textContent = initial;
    }
    const body = document.createElement("div");
    body.className = "account-state-body";
    const badges: string[] = [];
    if (account.user.is_admin)
      badges.push('<span class="badge admin">admin</span>');
    if (!account.user.email_verified)
      badges.push('<span class="badge unverified">unverified</span>');
    const displayName = account.user.name || account.user.email;
    body.innerHTML =
      `<div class="name">${escHtml(displayName)}${badges.join("")}</div>` +
      `<div class="meta">${escHtml(account.user.email)} · token expires <code>${escHtml(
        formatExpiry(account.accessTokenExpiresAt),
      )}</code></div>`;

    const actions = document.createElement("div");
    actions.className = "actions";
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "btn secondary";
    refreshBtn.textContent = "Refresh token";
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing…";
      const next = await send("sw:account_refresh", undefined);
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh token";
      if (!next) alert("Refresh failed — please sign in again.");
      await refresh();
    });
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "btn danger";
    logoutBtn.textContent = "Sign out";
    logoutBtn.addEventListener("click", async () => {
      if (!confirm(`Sign out of ${account.user.email}?`)) return;
      logoutBtn.disabled = true;
      await send("sw:account_logout", undefined);
      logoutBtn.disabled = false;
      await refresh();
    });
    actions.append(refreshBtn, logoutBtn);
    host.append(avatar, body, actions);
  }

  function renderSignedOut(host: HTMLElement, login: LoginState): void {
    const body = document.createElement("div");
    body.className = "account-state-body";
    body.innerHTML =
      '<div class="name">Not signed in</div>' +
      '<div class="meta">Click sign in to link this plugin to your xgoose account.</div>';
    const actions = document.createElement("div");
    actions.className = "actions";
    const signInBtn = document.createElement("button");
    signInBtn.className = "btn primary";
    signInBtn.textContent =
      login.phase === "pending"
        ? "Waiting for approval…"
        : "Sign in via xgoose.org";
    signInBtn.disabled = login.phase === "pending";
    signInBtn.addEventListener("click", async () => {
      signInBtn.disabled = true;
      signInBtn.textContent = "Opening browser…";
      await send("sw:account_start_login", undefined);
      await refresh();
    });
    actions.append(signInBtn);
    host.append(body, actions);

    if (login.phase === "pending" && login.userCode && login.verificationUri) {
      const card = document.createElement("div");
      card.className = "device-code-card";
      const secs = Math.max(
        0,
        Math.floor(((login.expiresAt ?? 0) - Date.now()) / 1000),
      );
      const min = Math.floor(secs / 60);
      const rem = String(secs % 60).padStart(2, "0");
      card.innerHTML =
        `<div>Approval code: <span class="code">${escHtml(login.userCode)}</span></div>` +
        `<div class="meta">A new tab should have opened with this code pre-filled. ` +
        `If not, visit <a href="${escAttr(login.verificationUri)}" target="_blank" rel="noopener">${escHtml(
          login.verificationUri,
        )}</a> and enter the code above. ` +
        `Expires in ${min}m ${rem}s.</div>`;
      host.parentElement?.appendChild(card);
    }
    if (
      (login.phase === "denied" ||
        login.phase === "expired" ||
        login.phase === "error") &&
      login.error
    ) {
      const err = document.createElement("div");
      err.className = "device-code-card err";
      err.innerHTML =
        `<div class="code">${escHtml(humanPhase(login.phase))}</div>` +
        `<div class="meta">${escHtml(login.error)}</div>`;
      host.parentElement?.appendChild(err);
    }
  }

  await refresh();
  // Storage-driven refresh so a sign-in finished in another window (or by the
  // background polling loop) lights up this page without a manual reload.
  onAccountChange(() => void refresh());
  // Also react to changes in the inflight login flow that the SW broadcasts
  // via the same storage key namespace (we listen to ACCOUNT_KEY since that's
  // the only one that flips when polling resolves).
  void ACCOUNT_KEY;
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return iso;
  if (ms <= 0) return "expired";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h`;
  return `in ${Math.floor(hr / 24)}d`;
}

function humanPhase(p: LoginPhase): string {
  if (p === "denied") return "Sign-in denied";
  if (p === "expired") return "Sign-in expired";
  if (p === "error") return "Sign-in error";
  return "Sign in";
}
