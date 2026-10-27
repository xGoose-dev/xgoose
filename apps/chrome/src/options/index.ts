import {HOSTED_DEFAULT_CHOICE, resolveHostedModel, hostedModelLabel} from "@/shared/hostedModels";
import {initializeLocale,saveLanguage,mountAnswerLanguage,translate,type LanguagePreference} from "@/shared/locale";
import { mountSkillUpdates } from "./skillUpdates";
import { mountCatalog } from "./catalog";
import { mountSetup } from "./setup";
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
import { onAccountChange } from "@/shared/account";
import {mountAccountSection} from "@/shared/accountSection";
import { track,failureReason } from "@/shared/analytics";

const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  ...CORE_DEFAULT_MODEL_BY_PROVIDER,
  "xgoose-hosted": HOSTED_DEFAULT_CHOICE,
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
  await initializeLocale(document.body);
  void mountAccountSection().catch(err => console.error("[xgoose] account init failed", err));
  mountSetup();
  const settings = await loadSettings();
  const connectionModeEl = $<HTMLSelectElement>("#connectionMode");
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
  const languageEl=$<HTMLSelectElement>("#language");
  languageEl.value=settings.language;
  languageEl.addEventListener("change",async()=>{
    languageEl.disabled=true;
    try{await saveLanguage(languageEl.value as LanguagePreference);}
    catch{document.querySelector("#saveStatus")!.textContent=translate("Language could not be saved. Please try again.");}
    finally{languageEl.disabled=false;}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes[SETTINGS_KEY])languageEl.value=(changes[SETTINGS_KEY].newValue as any)?.language??"auto";});
  await mountAnswerLanguage($<HTMLSelectElement>("#answerLanguage"),document.querySelector<HTMLElement>("#answerLanguageStatus"));
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
      !confirm(translate("Reset the floating button position and panel size to defaults?"))
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
  connectionModeEl.value = settings.provider === "xgoose-hosted" ? "hosted" : "byok";
  let lastByokProvider: Provider = settings.provider === "xgoose-hosted" ? "gemini" : settings.provider;
  connectionModeEl.addEventListener("change", () => {
    if (providerEl.value !== "xgoose-hosted") lastByokProvider = providerEl.value as Provider;
    providerEl.value = connectionModeEl.value === "hosted" ? "xgoose-hosted" : lastByokProvider;
    providerEl.dispatchEvent(new Event("change"));
  });
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
    apiKeyTestRowEl.hidden = false;
    $("#providerRow").hidden = isHosted;
    $("#modelCustomToggleRow").hidden = isHosted;
    $("#modelGrid").classList.toggle("two", !isHosted);
    connectionModeEl.value = isHosted ? "hosted" : "byok";
    testApiKeyBtn.textContent = isHosted ? "Test hosted AI" : "Test API key";
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
      testApiKeyStatus.style.color = "light-dark(#b42318, #fda29b)";
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
  modelEl.addEventListener("change", clearTestStatus);
  modelCustomEl.addEventListener("input", clearTestStatus);
  apiKeyEl.addEventListener("input", clearTestStatus);
  baseUrlEl.addEventListener("input", clearTestStatus);

  testApiKeyBtn.addEventListener("click", async () => {
    const started=Date.now();
    const provider = providerEl.value as Provider;
    const apiKey = apiKeyEl.value;
    const baseUrl = baseUrlEl.value.trim();
    testApiKeyBtn.disabled = true;
    setTestStatus(provider === "xgoose-hosted" ? "Testing Hosted AI… The first connection may take up to 3 minutes." : "Testing…", "info");
    track("options_api_key_test_clicked", { provider });
    try {
      const res = await send("sw:test_api_key", { provider, apiKey, baseUrl, model: readCurrentChoice()?.id });
      if (res.ok) {
        setTestStatus(`✓ ${res.message}`, "ok");
        track("options_api_key_test_succeeded", { provider,duration_ms:Date.now()-started });
      } else {
        setTestStatus(`✗ ${res.error}`, "err");
        track("options_api_key_test_failed", { provider,reason:failureReason(res.error),duration_ms:Date.now()-started });
      }
    } catch (error) {
      track("options_api_key_test_failed",{provider,reason:failureReason(error),duration_ms:Date.now()-started});
      setTestStatus(error instanceof Error ? error.message : String(error), "err");
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
    const res = await send("sw:list_xgoose_models", {}).catch(error => ({ok:false as const, signedIn:true, error:String(error)}));
    if (providerEl.value !== "xgoose-hosted") return; // Ignore results after switching providers.
    if (!res.ok) {
      if (!res.signedIn) {
        hostedStatusHintEl.innerHTML =
          'Sign in above to get started with free Hosted AI. No key to copy.';
      } else {
        hostedStatusHintEl.textContent = `Could not load model list: ${res.error}`;
      }
      hostedStatusHintEl.style.color = "light-dark(#b42318, #fda29b)";
      MODEL_ENTRIES["xgoose-hosted"] = [];
      modelEl.innerHTML = "";
      const opt = document.createElement("option");
      const fallback = DEFAULT_MODEL_BY_PROVIDER["xgoose-hosted"];
      opt.value = fallback;
      opt.textContent = !res.signedIn
        ? translate("Default (sign in required)")
        : translate("Default (model list unavailable)");
      modelEl.appendChild(opt);
      modelEl.disabled = true;
      modelCustomToggleEl.checked = false;
      modelCustomToggleEl.disabled = true;
      modelCustomRowEl.hidden = true;
      return;
    }
    const defaultModel=resolveHostedModel(HOSTED_DEFAULT_CHOICE,res);
    MODEL_ENTRIES["xgoose-hosted"] = [
      {id:HOSTED_DEFAULT_CHOICE,thinking:false,label:translate("Default — {model}").replace("{model}",hostedModelLabel(defaultModel))},
      ...res.models.map((id): ModelEntry => ({id,thinking:false,label:hostedModelLabel(id)})),
    ];
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
      language: languageEl.value as Settings["language"],
      answerLanguage: $<HTMLSelectElement>("#answerLanguage").value as Settings["answerLanguage"],
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
      !confirm(translate("Reset all settings to defaults? Your API key will be cleared."))
    )
      return;
    await persistSettings({ ...DEFAULT_SETTINGS });
    location.reload();
  });

  // Local settings are usable independently of account, consent and catalog requests.
  for (const section of document.querySelectorAll<HTMLElement>("[data-settings-loading]")) {
    section.inert = false;
    section.removeAttribute("data-settings-loading");
  }
  saveBtn.disabled = false;
  resetBtn.disabled = false;

  // ── Skills rendering ──

  async function renderSkillList(): Promise<void> {
    const skills = await loadSkills();
    skillList.innerHTML = "";
    $("#installedSkillSummary").textContent = `Manage ${skills.length} installed skills (${skills.filter(s => s.enabled).length} enabled)`;
    if (!skills.length) {
      skillList.innerHTML = `<div class="empty">No skills yet. Browse website skills or choose <strong>Add custom skill</strong> to create one.</div>`;
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
        ${s.userAuthored ? `<div class="skill-row-actions"><button class="skill-edit" data-name="${escAttr(s.name)}">Edit</button><button class="skill-uninstall btn secondary compact" type="button"></button></div>` : ""}
      `;
      (row.querySelector(".skill-name") as HTMLElement).textContent = s.name;
      (row.querySelector(".skill-ns") as HTMLElement).textContent =
        ` · ${s.namespace} · v${s.version}`;
      (row.querySelector(".skill-desc") as HTMLElement).textContent =
        s.description || "(no description)";
      (row.querySelector(".skill-matches") as HTMLElement).textContent =
        (s.matches ?? []).join(", ") || "(no URL match — never auto-injects)";
      const cb = row.querySelector("input[type=checkbox]") as HTMLInputElement;
      cb.setAttribute("aria-label", `Enable ${s.name}`);
      cb.addEventListener("change", async () => {
        await setDisabled(s.name, !cb.checked);
      });
      const editBtn = row.querySelector(
        ".skill-edit",
      ) as HTMLButtonElement | null;
      editBtn?.addEventListener("click", async () => {
        await openEditorFor(s.name);
      });
      const uninstall=row.querySelector<HTMLButtonElement>('.skill-uninstall');
      if(uninstall){
        uninstall.textContent=translate('Uninstall');
        uninstall.setAttribute('aria-label',`${translate('Uninstall')} ${s.name}`);
        uninstall.addEventListener('click',async()=>{
          if(!confirm(translate('Uninstall custom skill "{name}"? Export any local edits first. A bundled copy, if present, will remain available.').replace('{name}',s.name)))return;
          uninstall.disabled=true;
          try{
            await send('sw:delete_user_skill',{name:s.name});
            if(editingName===s.name)closeEditor();
            await renderSkillList();
          }catch(error){uninstall.disabled=false;$("#saveStatus").textContent=`${translate('Uninstall failed')}: ${error instanceof Error?error.message:String(error)}`;}
        });
      }
      skillList.appendChild(row);
    }
  }
  await renderSkillList();
  // Remote catalog is optional; it must not delay local import/editor controls.
  mountCatalog();
  mountSkillUpdates();

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
    if (!confirm(translate('Delete custom skill "{name}"? This can\'t be undone.').replace("{name}",editingName!)))
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
    clearTestStatus();
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
// Account section: email confirmation sign-in + signed-in profile.
// All login state lives in the service worker (`background/account.ts`); we
// just render whatever the SW reports, and refresh on storage.onChanged.
