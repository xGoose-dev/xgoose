// Typed RPC envelopes between content scripts, background SW, popup, and
// options. Mirrors xgoose-safari/src/shared/messages.ts shape (kind +
// payload + Envelope) — sharing the wire shape means the skill tools and
// options-page code can be ported with minimal diffs.
//
// Unlike safari, the Chrome host:
//   - uses chrome.runtime.connect for streaming fetch (port-based, not
//     RPC), so `sw:proxy_fetch_stream_open` only ACKs the port handshake
//   - has the same skill registry + account message set as safari
//
// The MAIN-world DOM tools (page_info, read_page, …) go through the
// @xgoose/page-controller bridge directly rather than via SW routing,
// so there are no `cs:page_info` / `cs:console_logs` envelopes here.

import {isSafari} from "./host";
import {prepareHost} from "./platformBridge";
import type { Account } from "./account";
import type { LoginState } from "@/background/account";
import type { Provider, RegistrySkill, UserSkill } from "./types";

export type HeaderBag = Record<string, string>;

const contentGlobals=globalThis as typeof globalThis & {__xgooseDocumentNonce?:string;__xgooseNonceListener?:boolean};
export const documentNonce = isSafari && typeof document !== "undefined" && /^https?:/.test(location.protocol) ? (contentGlobals.__xgooseDocumentNonce ??= crypto.randomUUID()) : "";
if(isSafari && documentNonce){
 document.documentElement.dataset.xgooseDocument=documentNonce;
 // Skill discovery precedes the main content router. Respond immediately, and only once per document.
 if(!contentGlobals.__xgooseNonceListener){contentGlobals.__xgooseNonceListener=true;chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
  if(message?.kind!=="cs:document_nonce")return false;
  reply(documentNonce);return true;
 });}
}
export type MessageMap = {
  "sw:peer": {request: import("./peers").PeerRequest; response: import("./peers").PeerReply};
 "sw:public_read":{request:{url:string};response:{status:number;body:string;headers:Record<string,string>}};
  "cs:document_nonce":{request:void;response:string};
  "sw:host_prepare":{request:void;response:void};
  "sw:host_layout":{request:{layout:import('@xgoose/ui').Layout};response:void};
  "sw:native_credentials":{request:{provider:string};response:{apiKey:string}};
  "sw:host_progress":{request:{kind:"page"|"answer"|"diagnostic";error?:string};response:void};
  'sw:read_images': {request:{urls:string[]};response:import('@/background/images').ImageReadResult[]};
  'sw:nga_images': {request:{urls:string[]};response:import('@/background/ngaImages').NgaImageResult[]};
  "sw:user_scripts_status": {request:void;response:{enabled:boolean}};
  "sw:open_user_scripts_setup": {request:{guide?:boolean};response:void};
  "sw:substack_read": {
    request: import("./substackReadBridge").SubstackReadRequest;
    response: import("./substackReadBridge").SubstackReadReply;
  };
  "sw:hosted_status": { request: { claim?: boolean; useHosted?: boolean }; response: Awaited<ReturnType<typeof import("@/background/hosted").hostedStatus>> };
  "sw:claim_skill_notice": { request: void; response: boolean };
  "sw:skill_updates": {request:{check?:boolean};response:import("@/background/skillUpdates").UpdateState};
  "sw:update_skill": {request:import("@/background/skillUpdates").SkillUpdate;response:void};
  "sw:skill_catalog": {request:void;response:import("@/background/catalog").CatalogSkill[]};
  "sw:install_catalog_skill": {request:{slug:string;version:string};response:void};
  "sw:open_skill_catalog": {request:{slugs:string[]};response:void};

  "sw:transcript_event": { request: import("@/background/sessionDb").JournalEvent; response: void };
  "sw:consent_get": { request: void; response: {hosted:boolean;byok:boolean} };
  "sw:consent_set": { request: {hosted:boolean;byok:boolean}; response: {hosted:boolean;byok:boolean} };

  "sw:reconcile_skills": { request: void; response: void };
  "sw:session": { request: { op: "list" | "get" | "save" | "delete" | "event"; id?: string; value?: any }; response: any };
  "sw:page_exec": { request: { code: string; args?: unknown[]; timeoutMs?: number; execId: string }; response: any };
  "sw:page_abort": { request: { execId: string }; response: void };

  // ── skill registry (background → caller) ─────────────────────────────
  "sw:list_skills": {
    request: void;
    response: Array<
      RegistrySkill & { enabled: boolean; userAuthored: boolean }
    >;
  };
  "sw:active_skills_for_url": {
    request: { url: string };
    response: RegistrySkill[];
  };
  "sw:get_disabled_skills": { request: void; response: string[] };
  "sw:set_skill_disabled": {
    request: { name: string; disabled: boolean };
    response: { ok: true };
  };

  // ── user-skill CRUD ──────────────────────────────────────────────────
  "sw:list_user_skills": { request: void; response: UserSkill[] };
  "sw:get_user_skill": {
    request: { name: string };
    response: UserSkill | null;
  };
  "sw:save_user_skill": {
    request: { skill: UserSkill };
    response: { ok: true };
  };
  "sw:delete_user_skill": { request: { name: string }; response: { ok: true } };

  "sw:get_skill_source": {
    request: { name: string };
    response:
      | { ok: true; source: string; origin: "user" | "builtin" }
      | { ok: false; error: string };
  };

  "sw:edit_skill": {
    request: { name: string; source: string };
    response:
      | {
          ok: true;
          name: string;
          namespace: string;
          version: string;
          bodyChanged: boolean;
        }
      | { ok: false; error: string };
  };

  // ── install page handoff ─────────────────────────────────────────────
  // Stash the raw `.xgs.js` source in `chrome.storage.session` keyed by a
  // one-shot uuid so the content script can navigate the tab to the
  // extension-served install page without forcing the install page to
  // re-fetch the source (which would re-trigger the content script and
  // any auth headers the original navigation had).
  "sw:stash_install_source": {
    request: { source: string; originUrl?: string };
    response: { ok: true; key: string } | { ok: false; error: string };
  };
  // Convenience for the content script: stash the source AND swap the
  // current tab to `install.html?stash=<key>` in one round-trip.
  "sw:open_install_page": {
    request: { source: string; originUrl?: string };
    response: { ok: true } | { ok: false; error: string };
  };
  "sw:open_install_url": {
    request: { sourceUrl: string; originUrl?: string };
    response: { ok: true } | { ok: false; error: string };
  };

  // ── provider fetch proxy (one-shot + streaming) ──────────────────────
  "sw:proxy_fetch": {
    request: { url: string; method: string; headers: HeaderBag; body?: string; hostedAccountId?: string };
    response:
      | { ok: true; status: number; headers: HeaderBag; body: string }
      | { ok: false; error: string };
  };
  "sw:proxy_fetch_stream_open": {
    request: {
      hostedAccountId?: string;
      streamId: string;
      url: string;
      method: string;
      headers: HeaderBag;
      body?: string;
    };
    response: { ok: true } | { ok: false; error: string };
  };

  // ── xgoose cloud account (email confirmation login) ─────────────────────────
  /** Returns the currently-persisted account, or null when signed out. */
  "sw:account_get": { request: void; response: Account | null };
  /**
   * Returns the current login flow status. `phase` mirrors RFC-8628
   * vocabulary plus an `idle` sentinel for "no flow in progress". Use
   * this from the UI to render a polling spinner.
   */
  "sw:account_login_state": { request: void; response: LoginState };
  /**
   * Start email confirmation login. Without an email, the legacy device flow opens a tab and
   * begins polling. Safe to call multiple times — returns the existing
   * flow if one is already in progress.
   */
  "sw:account_cancel_login": { request: void; response: LoginState };
  "sw:account_start_login": { request: {email:string} | void; response: LoginState };
  /** Force one extra poll (in addition to the timer-driven polling loop). */
  "sw:account_poll_now": { request: void; response: LoginState };
  /** Revoke server session + wipe local account state. */
  "sw:account_logout": { request: void; response: { ok: true } };
  /** Manually rotate the access/refresh tokens. */
  "sw:account_refresh": { request: void; response: Account | null };
  /**
   * Fetch the list of models the signed-in user can call through the
   * xgoose-hosted AI gateway. Backed by `GET /ai/v1/models` on the
   * xgoose-web worker (which mirrors LiteLLM's catalogue). Cached
   * server-side for 5 min so it's safe to call from the options page
   * on every render.
   */
  "sw:list_xgoose_models": {
    request: { refresh?: boolean };
    response:
      | { ok: true; models: string[]; defaultModel?: string; contextWindows?: Record<string,number> }
      | { ok: false; error: string; signedIn: boolean };
  };

  /**
   * Validate a user-supplied provider API key by issuing a lightweight
   * `GET /models` call against the relevant provider:
   *   - `gemini`         → https://generativelanguage.googleapis.com/v1beta/models
   *   - `gemini-litellm` → <baseUrl>/v1beta/models (proxy must speak Google REST)
   *   - `openai-compat`  → <baseUrl>/v1/models (baseUrl auto-normalised, same
   *                        rule as `createModel` in @xgoose/core: add /v1 if
   *                        missing, strip trailing slashes)
   *
   * Returns the model count on success so the UI can confirm we hit a real
   * provider (and not e.g. a 200 from a captive-portal page). The
   * `xgoose-hosted` provider has no user-supplied key — its credential is
   * the signed-in account token. Its test sends a small chat request to verify
   * actual inference and trial readiness, not just model discovery.
   */
  "sw:test_api_key": {
    request: { provider: Provider; apiKey: string; baseUrl: string; model?: string };
    response:
      | { ok: true; message: string; modelCount: number | null }
      | { ok: false; error: string };
  };

  // ── popup / options ──────────────────────────────────────────────────
  "sw:open_options": { request: void; response: void };
  "sw:get_page_info": {
    request: void;
    response: { url: string; title: string } | null;
  };
  "sw:toggle_panel": { request: void; response: { ok: true } };
  "sw:inject_page_bridge": {
    request: void;
    response: { ok: true } | { ok: false; error: string };
  };

  // ── skill injection (Chrome-specific) ────────────────────────────────
  // Files are extension-relative paths (e.g. 'skills/aa-awards.xgs.js')
  // that the SW resolves with chrome.scripting.executeScript({world:'MAIN'}).
  "sw:skill_snapshot": {
    request: void;
    response: Record<string, {functions?: Record<string, any>; instructions?: string}>;
  };
  "sw:inject_skill_files": {
    request: { files: string[] };
    response: { ok: true } | { ok: false; error: string };
  };
  // User skills always use chrome.userScripts.execute in the sender document;
  // enabling Allow User Scripts is required for dynamic source.
  "sw:inject_skill_code": {
    request: { code: string };
    response: { ok: true } | { ok: false; error: string };
  };
  // Direct skill function invocation. The SW reaches into the MAIN world
  // via `chrome.scripting.executeScript({func, args})` — Chrome serializes
  // the func and its args natively (no blob URL, no eval), so strict-CSP
  // pages like global.americanexpress.com (no `unsafe-eval`, no `blob:` in
  // script-src) can still call skill functions through the agent's
  // `skill_call` tool.
  "sw:skill_invoke": {
    request: {
      namespace: string;
      functionName: string;
      args: unknown;
      timeoutMs?: number;
    };
    response:
      | { ok: true; result: unknown }
      | { ok: false; error: string; stack?: string }
      | {
          ok: false;
          notLoaded: true;
          namespace: string;
        }
      | {
          ok: false;
          fnMissing: true;
          namespace: string;
          function: string;
          available: string[];
        };
  };

  // ── analytics (UI contexts → background) ─────────────────────────────
  // Forward a funnel event to the background worker, which batches + flushes
  // to the worker's GA4 Measurement Protocol proxy. Fire-and-forget.
  "sw:track": {
    request: {
      event: string;
      params?: Record<string, string | number | boolean>;
      device?: {language?:string;screen_resolution?:string};
    };
    response: void;
  };

  // ── background → content script push (per-tab) ───────────────────────
  "cs:set_active_skills": {
    request: { skills: RegistrySkill[] };
    response: void;
  };
  "cs:toggle_panel": { request: void; response: void };
};

export type MessageKey = keyof MessageMap;

export type Envelope<K extends MessageKey = MessageKey> = {
  kind: K;
  payload: MessageMap[K]["request"];
};

export async function send<K extends MessageKey>(
  kind: K,
  payload: MessageMap[K]["request"],
): Promise<MessageMap[K]["response"]> {
  const envelope = { kind, payload, ...(isSafari && documentNonce ? {documentNonce} : {}) };
  const response = await chrome.runtime.sendMessage(envelope);
  if (response?.__error) throw new Error(response.__error);
  return response as MessageMap[K]["response"];
}

export async function sendToTab<K extends MessageKey>(
  tabId: number,
  kind: K,
  payload: MessageMap[K]["request"],
): Promise<MessageMap[K]["response"]> {
  const envelope = { kind, payload, ...(isSafari && documentNonce ? {documentNonce} : {}) };
  return (await chrome.tabs.sendMessage(
    tabId,
    envelope,
  )) as MessageMap[K]["response"];
}

export type Handler<K extends MessageKey> = (
  payload: MessageMap[K]["request"],
  sender: chrome.runtime.MessageSender,
) => Promise<MessageMap[K]["response"]> | MessageMap[K]["response"];

type AnyHandlerMap = { [K in MessageKey]?: Handler<K> };

export function registerRouter(handlers: AnyHandlerMap): void {
  chrome.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
    const env = rawMsg as Envelope;
    if (!env?.kind) return false;
    if(isSafari && sender.tab)(sender as any).__xgooseDocumentNonce = (rawMsg as any).documentNonce;
    const handler = (handlers as any)[env.kind];
    if (!handler) return false;
    Promise.resolve()
      .then(async () => {
        if (isSafari && env.kind.startsWith("sw:")) {
          const denied = new Set(["sw:page_exec","sw:page_abort","sw:inject_skill_code","sw:edit_skill","sw:save_user_skill","sw:delete_user_skill","sw:install_catalog_skill","sw:update_skill","sw:open_install_page","sw:open_install_url","sw:stash_install_source","sw:open_user_scripts_setup"]);
          if(denied.has(env.kind)) throw new Error("This Safari release supports packaged skills only.");
          await prepareHost();
        }
        return handler(env.payload, sender);
      })
      .then((value) => sendResponse(value))
      .catch((err) => sendResponse({ __error: err?.message ?? String(err) }));
    return true;
  });
}
