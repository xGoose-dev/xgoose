import {isSafari,providerHeaders} from "@/shared/host";
import {prepareHost,nativeCommand} from "@/shared/platformBridge";
import {extensionDetailsUrl} from '@/shared/browser';
import {assertLiveDocument,executableSkillsForUrl, injectPackagedSkills, reconcileSkills, skillSnapshot, pageTarget} from "./packagedSkills";
import { installSkillUpdateChecks, checkSkillUpdates, skillUpdateState, updateSkill } from "./skillUpdates";
import { hostedStatus } from "./hosted";
import { readSubstackPublication } from "./substackReader";
import { readNgaImages } from './ngaImages';
import { skillCatalog, installCatalogSkill } from "./catalog";
import { recordJournal, getConsent, setConsent } from "./transcripts";
import { sessionCommand } from "./sessionDb";
import { executeUserScript, executePage } from "./userScripts";
// MV3 service worker for xgoose-extension-chrome.
//
// Responsibilities:
//   1. Provider HTTP proxy — `sw:proxy_fetch` + streaming
//      (`sw:proxy_fetch_stream_open` plus `xgoose:stream:<id>` port).
//   2. Page-bridge inject fallback — `sw:inject_page_bridge`
//      (chrome.scripting.executeScript into MAIN world).
//   3. Skill registry — `sw:list_skills`, `sw:active_skills_for_url`,
//      `sw:get_skill_source`, `sw:set_skill_disabled`,
//      `sw:edit_skill`, `sw:list_user_skills`, `sw:get_user_skill`,
//      `sw:save_user_skill`, `sw:delete_user_skill`,
//      `sw:get_disabled_skills`.
//   4. Options-page jump — `sw:open_options`.
//   5. Toolbar button → toggle panel in active tab — `sw:toggle_panel`
//      (also fires via `chrome.action.onClicked` for the popup-less path).
//   6. Storage-change watcher: when skill enable/disable or user-skill
//      changes, push `cs:set_active_skills` to every open tab so the
//      content script re-injects without a page reload.

import { registerRouter, sendToTab, type MessageMap } from "@/shared/messages";
import {
  activeSkillsForUrl,
  deleteUserSkill,
  editSkillFromSource,
  getDisabledSkills,
  getSkillSource,
  getUserSkillCode,
  listSkillsWithEnabled,
  listUserSkills,
  saveUserSkill,
  setSkillDisabled,
} from "./skillRegistry";
import {
  getFreshAccount,
  getLoginState,
  logout as accountLogout,
  pollOnce,
  refreshTokens,
  startLogin,
  cancelLogin,
} from "./account";
import { apiFetch } from "@/shared/account";
import { installConfigSyncListeners } from "./configSync";
import { testApiKey } from "./testApiKey";
import { recordEvent } from "@/shared/analytics";

// Push the user's local Settings to api.xgoose.org whenever they change
// (and once on SW boot). The website's /account page reads them back so
// the user can audit "which device has which model selected" without
// hopping between browsers. No-op when signed out.
if (!isSafari) installConfigSyncListeners();
if (!isSafari) installSkillUpdateChecks();

// Serialize claims across tabs so the brief skill notice appears only once per install.
let noticeQueue = Promise.resolve(false);
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (!isSafari && reason === "install") void chrome.tabs.create({url:chrome.runtime.getURL("onboarding.html")});
});

registerRouter({
  "sw:public_read": async (payload,sender)=>{
    if(!isSafari)throw new Error("Public native transport is unavailable");
    await assertLiveDocument(sender);
    return nativeCommand("public-read",{url:payload.url,pageUrl:sender.url});
  },
  "sw:host_prepare": () => prepareHost(),
  "sw:host_layout": async payload=>{if(isSafari){await nativeCommand("patch",payload);await prepareHost();}},
  "sw:native_credentials": payload => nativeCommand("credentials",payload),
  "sw:host_progress": async (payload,sender) => {
    if(!isSafari || !sender.tab || !/^https?:/.test(sender.url ?? "")) return;
    await assertLiveDocument(sender);
    let allWebsites=false;
    if(payload.kind==='page')try{allWebsites=await chrome.permissions.contains({origins:['<all_urls>']});}catch{}
    await nativeCommand("progress",{...payload,hostname:new URL(sender.url!).hostname,allWebsites});
  },
  'sw:nga_images': (request,sender)=>readNgaImages(request.urls,sender.url??''),
  "sw:user_scripts_status": async () => {try{await chrome.userScripts.getScripts();return {enabled:true};}catch{return {enabled:false};}},
  "sw:open_user_scripts_setup": async ({guide}) => {await chrome.tabs.create({url:guide?chrome.runtime.getURL("onboarding.html"):extensionDetailsUrl(chrome.runtime.id)});},
  "sw:skill_updates": ({check}) => check ? checkSkillUpdates() : skillUpdateState(),
  "sw:update_skill": request => updateSkill(request),
  "sw:substack_read": (request, sender) => readSubstackPublication(request, sender.url ?? ""),
  "sw:hosted_status": async ({claim, useHosted}) => {if(isSafari && useHosted)await nativeCommand("hosted-ready");return hostedStatus(claim,useHosted);},
  "sw:claim_skill_notice": () => {
    noticeQueue = noticeQueue.catch(() => false).then(async () => {
      const key = "xgoose.skills.notice-seen-v1";
      if ((await chrome.storage.local.get(key))[key]) return false;
      await chrome.storage.local.set({[key]:true});
      return true;
    });
    return noticeQueue;
  },
  "sw:skill_catalog": () => skillCatalog(),
  "sw:install_catalog_skill": ({slug,version}) => installCatalogSkill(slug,version),
  "sw:open_skill_catalog": async ({slugs}) => { await chrome.tabs.create({url:"https://xgoose.org/skills/"}); },
  "sw:transcript_event": (value,sender) => recordJournal(value,sender),
  "sw:consent_get": () => getConsent(),
  "sw:consent_set": value => setConsent(value),
  "sw:reconcile_skills": async (_payload, sender) => reconcileSkills(sender),
  "sw:skill_snapshot": async (_payload, sender) => skillSnapshot(sender),
  "sw:session": (payload) => sessionCommand(payload),
  "sw:page_exec": (payload, sender) => executePage(sender, payload),
  "sw:page_abort": async ({ execId }, sender) => {
    await executeUserScript(sender, `globalThis.__xgooseExecutions?.get(${JSON.stringify(execId)})?.abort()`);
  },
  // ── provider fetch proxy ────────────────────────────────────────────
  "sw:proxy_fetch": async (payload) => {
    try {
      const resp = await fetch(payload.url, {
        method: payload.method,
        headers: providerHeaders(payload.headers),
        body: payload.body,
      });
      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => (headers[k] = v));
      return { ok: true, status: resp.status, headers, body };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },
  "sw:proxy_fetch_stream_open": (payload) => handleStreamOpen(payload),

  // ── page-bridge inject ──────────────────────────────────────────────
  "sw:inject_page_bridge": async (_payload, sender) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number")
      return { ok: false, error: "no tab id on sender" };
    try {
      await assertLiveDocument(sender);
      await chrome.scripting.executeScript({
        target: pageTarget(sender),
        world: "MAIN",
        files: ["pageBridge.js"],
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  // ── skill injection (MAIN-world via chrome.scripting) ───────────────
  "sw:inject_skill_files": async ({ files }, sender) => {
    try {
      await injectPackagedSkills(sender, files);
      return { ok: true };
    } catch (error: any) { return { ok: false, error: error.message }; }
  },
  "sw:inject_skill_code": async ({ code }, sender) => {
    try { await executeUserScript(sender, code); return { ok: true }; }
    catch (error: any) { return { ok: false, error: error.message }; }
  },
  "sw:skill_invoke": async (
    { namespace, functionName, args, timeoutMs },
    sender,
  ) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number")
      return { ok: false, error: "no tab id on sender" };
    const active = await executableSkillsForUrl(sender.url ?? "");
    if (!active.some(s => s.namespace === namespace)) return { ok: false, error: "Skill is disabled, missing a dependency, or unavailable on this page" };
    if (!/^[A-Za-z_$][\w$]*$/.test(functionName) || functionName.startsWith("__") || ["constructor", "prototype"].includes(functionName)) return {ok:false,error:"Invalid exported skill function"};
    try {
      await assertLiveDocument(sender);
      const results = await chrome.scripting.executeScript({
        target: pageTarget(sender),
        world: "MAIN",
        // `func` is serialized by Chrome's IPC, not by `new Function` —
        // the page's `script-src` CSP doesn't apply to it. That's why this
        // path works on global.americanexpress.com where the blob-URL
        // import inside `pageBridge.exec()` is blocked.
        func: async (ns: string, fn: string, callArgs: unknown, t: number, nonce: string) => {
          if(nonce && document.documentElement.dataset.xgooseDocument!==nonce)throw new Error("The page changed.");
          const w = window as any;
          const skill = w.xgoose && w.xgoose.skills && w.xgoose.skills[ns];
          if (!skill) {
            return { __notLoaded: true } as const;
          }
          const callable = Object.hasOwn(skill, fn) ? skill[fn] : undefined;
          if (typeof callable !== "function") {
            return {
              __fnMissing: true,
              available: Object.keys(skill).filter(
                (k) => typeof skill[k] === "function" && !k.startsWith("__"),
              ),
            } as const;
          }
          // Cap each invocation so a hung skill can't pin the SW reply
          // forever — mirrors `pageBridge.exec`'s default 30 s budget.
          let timer: ReturnType<typeof setTimeout>;
          const racer = new Promise<{ __timeout: true }>((resolve) => {
            timer = setTimeout(() => resolve({ __timeout: true }), Math.max(1, t));
          });
          try {
            const out = await Promise.race([
              Promise.resolve(callable(callArgs)),
              racer,
            ]);
            if ((out as any)?.__timeout) {
              return { __timeout: true, timeoutMs: t } as const;
            }
            return { __ok: true, result: out } as const;
          } catch (err: any) {
            return {
              __error: true,
              message: err?.message ?? String(err),
              stack:
                typeof err?.stack === "string"
                  ? err.stack.split("\n").slice(0, 6).join("\n")
                  : undefined,
            } as const;
          } finally { clearTimeout(timer!); }
        },
        args: [namespace, functionName, args ?? {}, Math.min(120000, Math.max(100, timeoutMs ?? 30_000)), (sender as any).__xgooseDocumentNonce ?? ""],
      });
      await assertLiveDocument(sender);
      const raw = results[0]?.result as any;
      if (!raw) return { ok: false, error: "no result from injected script" };
      if (raw.__notLoaded) {
        return { ok: false, notLoaded: true, namespace } as any;
      }
      if (raw.__fnMissing) {
        return {
          ok: false,
          fnMissing: true,
          namespace,
          function: functionName,
          available: raw.available,
        } as any;
      }
      if (raw.__timeout) {
        return {
          ok: false,
          error: `skill_call timed out after ${raw.timeoutMs}ms`,
        };
      }
      if (raw.__error) {
        return { ok: false, error: raw.message, stack: raw.stack };
      }
      return { ok: true, result: raw.result };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  // ── skill registry ──────────────────────────────────────────────────
  "sw:list_skills": async () => listSkillsWithEnabled(),
  "sw:active_skills_for_url": async ({ url }) => executableSkillsForUrl(url),
  "sw:get_disabled_skills": async () => getDisabledSkills(),
  "sw:set_skill_disabled": async ({ name, disabled }) => {
    if(isSafari){await nativeCommand("patch",{skillToggle:{name,disabled}});await prepareHost();return {ok:true};}
    await setSkillDisabled(name, disabled);
    return { ok: true };
  },
  "sw:list_user_skills": async () => listUserSkills(),
  "sw:get_user_skill": async ({ name }) => getUserSkillCode(name),
  "sw:save_user_skill": async ({ skill }) => {
    await saveUserSkill(skill);
    return { ok: true };
  },
  "sw:delete_user_skill": async ({ name }) => {
    await deleteUserSkill(name);
    return { ok: true };
  },
  "sw:get_skill_source": async ({ name }) => {
    const got = await getSkillSource(name);
    return got
      ? { ok: true, ...got }
      : { ok: false, error: `Unknown skill: ${name}` };
  },
  "sw:edit_skill": async ({ name, source }) =>
    editSkillFromSource({ name, source }),

  // ── install page handoff ────────────────────────────────────────────
  "sw:stash_install_source": async ({ source, originUrl }) => {
    try {
      const key = newStashKey();
      await chrome.storage.session.set({
        [key]: { source, originUrl, at: Date.now() },
      });
      return { ok: true, key } as const;
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) } as const;
    }
  },
  "sw:open_install_page": async ({ source, originUrl }, sender) => {
    try {
      const key = newStashKey();
      await chrome.storage.session.set({
        [key]: { source, originUrl, at: Date.now() },
      });
      const url = chrome.runtime.getURL(
        `install.html?stash=${encodeURIComponent(key)}`,
      );
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        await chrome.tabs.update(tabId, { url });
      } else {
        await chrome.tabs.create({ url });
      }
      return { ok: true } as const;
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) } as const;
    }
  },
  "sw:open_install_url": async ({ sourceUrl, originUrl }, sender) => {
    try {
      const url = new URL(sourceUrl);
      if (!/^https?:$/.test(url.protocol)) {
        return { ok: false, error: "Install URL must be http(s)" } as const;
      }
      const res = await fetch(url.toString(), { credentials: "omit" });
      if (!res.ok) {
        return {
          ok: false,
          error: `Skill source fetch failed: HTTP ${res.status}`,
        } as const;
      }
      const source = await res.text();
      const key = newStashKey();
      await chrome.storage.session.set({
        [key]: { source, originUrl: res.url, at: Date.now() },
      });
      const installUrl = chrome.runtime.getURL(
        `install.html?stash=${encodeURIComponent(key)}`,
      );
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        await chrome.tabs.update(tabId, { url: installUrl });
      } else {
        await chrome.tabs.create({ url: installUrl });
      }
      return { ok: true } as const;
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) } as const;
    }
  },

  // ── xgoose cloud account (device-flow login) ────────────────────────
  "sw:account_get": async () => getFreshAccount(),
  "sw:account_login_state": async () => getLoginState(),
  "sw:account_cancel_login": async () => cancelLogin(),
  "sw:account_start_login": async (payload) => startLogin(payload?.email),
  "sw:account_poll_now": async () => pollOnce(),
  "sw:account_logout": async () => {
    await accountLogout();
    return { ok: true } as const;
  },
  "sw:account_refresh": async () => refreshTokens(),
  "sw:test_api_key": async (payload) => testApiKey(payload),
  "sw:list_xgoose_models": async ({ refresh }) => {
    // Backed by the worker's `GET /ai/v1/models` route. The worker
    // requires an authenticated user; without an account we cannot
    // populate the dropdown, so report that distinctly so the UI can
    // render a "Sign in to populate" CTA instead of a vague error.
    const account = await getFreshAccount();
    if (!account) {
      return { ok: false, error: "Not signed in", signedIn: false };
    }
    const path = `/ai/v1/models${refresh ? "?refresh=1" : ""}`;
    const res = await apiFetch<{ data?: Array<{ id?: unknown; context_window?: unknown }> }>(path, {
      method: "GET",
      bearer: account.accessToken,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: res.error || `HTTP ${res.status}`,
        signedIn: true,
      };
    }
    const data = res.data?.data ?? [];
    const models = data
      .map((m) => (typeof m?.id === "string" ? m.id : null))
      .filter((s): s is string => !!s)
      .sort();
    const contextWindows=Object.fromEntries(data.flatMap(m=>typeof m.id==='string'&&typeof m.context_window==='number'&&Number.isSafeInteger(m.context_window)&&m.context_window>=8192&&m.context_window<=16_000_000?[[m.id,m.context_window]]:[]));
    return { ok: true, models, contextWindows };
  },

  // ── options / panel ─────────────────────────────────────────────────
  "sw:open_options": async () => {
    if (isSafari) { await chrome.tabs.create({url:"xgoose://settings"}); return; }
    if (chrome.runtime.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
    } else {
      const url = chrome.runtime.getURL("options.html");
      await chrome.tabs.create({ url });
    }
  },
  "sw:get_page_info": async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return null;
    return { url: tab.url, title: tab.title ?? "" };
  },
  // ── analytics ───────────────────────────────────────────────────────
  "sw:track": (payload) => {
    recordEvent(payload.event, payload.params ?? {});
  },

  "sw:toggle_panel": async (_payload, sender) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      // Called from popup with no tab in sender — fall back to active tab.
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id != null) {
        try {
          await sendToTab(tab.id, "cs:toggle_panel", undefined);
        } catch {}
      }
      return { ok: true };
    }
    try {
      await sendToTab(tabId, "cs:toggle_panel", undefined);
    } catch {}
    return { ok: true };
  },
});

if(isSafari)chrome.permissions?.onRemoved?.addListener(()=>{void nativeCommand("permissions-removed").catch(()=>{});});

// Toolbar action button → toggle panel in the active tab. The popup has
// the same behavior, but if the popup is removed from manifest (or fails
// to open), the action click falls back to this listener.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await sendToTab(tab.id, "cs:toggle_panel", undefined);
  } catch {}
});

// Storage watcher → push active-skills update to all tabs.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (!changes["xgoose.skills.disabled"] && !changes["xgoose.skills.user"])
    return;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !t.url || !/^https?:/.test(t.url)) continue;
    try {
      const skills = await activeSkillsForUrl(t.url);
      await sendToTab(t.id, "cs:set_active_skills", { skills });
    } catch {}
  }
});

// ── streaming fetch proxy (port-based) ───────────────────────────────

const earlyPorts = new Map<string, chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("xgoose:stream:")) return;
  const streamId = port.name.slice("xgoose:stream:".length);
  earlyPorts.set(streamId, port);
  port.onDisconnect.addListener(() => {
    earlyPorts.delete(streamId);
  });
});

function handleStreamOpen(
  req: MessageMap["sw:proxy_fetch_stream_open"]["request"],
): MessageMap["sw:proxy_fetch_stream_open"]["response"] {
  const portName = `xgoose:stream:${req.streamId}`;
  const buffered = earlyPorts.get(req.streamId);
  if (buffered) {
    earlyPorts.delete(req.streamId);
    runStream(buffered, req);
    return { ok: true };
  }
  const onConnect = (port: chrome.runtime.Port): void => {
    if (port.name !== portName) return;
    chrome.runtime.onConnect.removeListener(onConnect);
    clearTimeout(timer);
    earlyPorts.delete(req.streamId);
    runStream(port, req);
  };
  chrome.runtime.onConnect.addListener(onConnect);
  const timer = setTimeout(() => {
    chrome.runtime.onConnect.removeListener(onConnect);
  }, 5000);
  return { ok: true };
}

async function runStream(
  port: chrome.runtime.Port,
  req: MessageMap["sw:proxy_fetch_stream_open"]["request"],
): Promise<void> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error("Provider request timed out")), 180000);
  const heartbeat = setInterval(() => safePost(port,{kind:"heartbeat"}),20000);
  const cleanup = () => { clearTimeout(timeout); clearInterval(heartbeat); };
  port.onDisconnect.addListener(() => { ac.abort(); cleanup(); });

  let resp: Response;
  try {
    resp = await fetch(req.url, {
      method: req.method,
      headers: providerHeaders(req.headers),
      body: req.body,
      signal: ac.signal,
    });
  } catch (err: any) {
    safePost(port, {
      kind: "error",
      error: `provider fetch failed for ${req.url}: ${err?.message ?? String(err)}`,
    });
    cleanup();
    safeDisconnect(port);
    return;
  }

  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => (headers[k] = v));
  safePost(port, { kind: "head", status: resp.status, headers });

  const reader = resp.body?.getReader();
  if (!reader) {
    safePost(port, { kind: "end" });
    cleanup();
    safeDisconnect(port);
    return;
  }

  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      safePost(port, {
        kind: "chunk",
        data: decoder.decode(value, { stream: true }),
      });
    }
    const tail = decoder.decode();
    if (tail) safePost(port, { kind: "chunk", data: tail });
    safePost(port, { kind: "end" });
  } catch (err: any) {
    safePost(port, { kind: "error", error: ac.signal.aborted ? "Provider request stopped or timed out; it was not replayed" : err?.message ?? String(err) });
  } finally {
    cleanup();
    safeDisconnect(port);
  }
}

function newStashKey(): string {
  // Namespaced under `xgoose.install:` so an accidental wildcard
  // `storage.session.get(null)` in dev mode makes the origin obvious.
  return `xgoose.install:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safePost(port: chrome.runtime.Port, msg: unknown): void {
  try {
    port.postMessage(msg);
  } catch {}
}
function safeDisconnect(port: chrome.runtime.Port): void {
  try {
    port.disconnect();
  } catch {}
}
