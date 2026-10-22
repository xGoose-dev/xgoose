// Anonymous, opt-out usage analytics.
//
// Events are funneled to the xgoose-web worker (`POST /a/collect`), which
// forwards them to the GA4 Measurement Protocol (web data stream
// `xgoose-extensions`, project xgoose-4ee54). We deliberately do NOT talk to
// google-analytics.com from the extension: keeping it first-party means the
// GA4 api_secret never ships in the bundle and Safari/iOS never hit a domain
// on Apple's tracker list.
//
// Transport model: the background service worker owns the queue + network. UI
// contexts (popup, options, content script) forward each event over the
// `sw:track` RPC so there is a single flush path and a single consent check.

import { send } from "./messages";
import { loadAll, getSettings } from "./storage";
import { getAccount, XGOOSE_API_URL } from "./account";

export type TrackParams = Record<string, string | number | boolean>;

/** Distinguishes this host in GA4 (chrome | firefox | safari_ext). */
const PLATFORM = "chrome";
const COLLECT_URL = `${XGOOSE_API_URL}/a/collect`;
const FLUSH_DEBOUNCE_MS = 1500;
const MAX_BATCH = 25;
const CLIENT_ID_KEY = "xgoose.analytics.clientId";

const browserAPI: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ??
  (globalThis as unknown as { chrome: typeof chrome }).chrome;

/**
 * Stable per-install GA4 client_id. Minted once and persisted in
 * `storage.local`; scopes a "browser/device" in GA4 (the cross-surface
 * User-ID join uses the signed-in account id instead, attached below).
 */
async function getClientId(): Promise<string> {
  const got = await browserAPI.storage.local.get(CLIENT_ID_KEY);
  const existing = got[CLIENT_ID_KEY];
  if (typeof existing === "string" && existing.length > 0) return existing;
  const id = (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  await browserAPI.storage.local.set({ [CLIENT_ID_KEY]: id });
  return id;
}

interface QueuedEvent {
  name: string;
  params: TrackParams;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** True inside the MV3 background service worker (no DOM). */
function isServiceWorker(): boolean {
  return typeof window === "undefined";
}

/**
 * Record a funnel event. Safe to call from any extension context. UI contexts
 * forward to the background worker; the worker queues + flushes. Never throws.
 */
export function track(event: string, params: TrackParams = {}): void {
  if (isServiceWorker()) {
    recordEvent(event, params);
  } else {
    void send("sw:track", { event, params }).catch(() => undefined);
  }
}

/**
 * Background-side queue insert. Called directly by background code and by the
 * `sw:track` RPC handler. Batches a short burst then flushes.
 */
export function recordEvent(event: string, params: TrackParams = {}): void {
  queue.push({ name: event, params });
  if (queue.length >= MAX_BATCH) {
    void flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const events = queue.splice(0, MAX_BATCH);
  if (events.length === 0) return;
  try {
    await loadAll();
    if (getSettings().analyticsEnabled === false) {
      queue = [];
      return;
    }
    const clientId = await getClientId();
    const account = await getAccount();
    const body = JSON.stringify({
      client_id: clientId,
      ...(account?.user.id ? { user_id: account.user.id } : {}),
      consent: true,
      events: events.map((e) => ({
        name: e.name,
        params: { ...e.params, platform: PLATFORM, surface: "extension" },
      })),
    });
    await fetch(COLLECT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // Analytics must never break a flow or surface errors to the user.
  }
}
