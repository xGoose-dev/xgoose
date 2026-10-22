/**
 * Cloud-sync of the extension's local Settings to the signed-in xgoose
 * account. The website's /account page reads these back from
 * `GET /me/configurations` so a user can see which device is configured
 * which way without having to open each browser's extension options.
 *
 * Design choices:
 *   - We deliberately STRIP every secret (API keys for self-hosted
 *     providers) before pushing. Only neutral preferences like provider
 *     id, model id, theme, timeouts, etc. travel. This is enforced in
 *     `redactedSnapshot` below.
 *   - Pushes are always best-effort: a failed sync NEVER surfaces to the
 *     user and never blocks the SW. The plugin keeps working with its
 *     local copy; the cloud row just won't update until the next push.
 *   - Triggered on (a) successful login, (b) every settings change after
 *     login, and (c) once on SW startup if we're already signed in. We
 *     also debounce changes so a rapid-fire typing burst in the options
 *     page collapses into one network call.
 */
/// <reference types="chrome" />

import {
  apiFetch,
  getAccount,
  getOrCreateDeviceId,
  type Account,
} from "@/shared/account";
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from "@/shared/types";

const CLIENT_ID = "xgoose-extension-chrome";
const SETTINGS_KEY = "xgoose.settings";

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a sync. Multiple calls inside the debounce window collapse
 * into one network request — the OPTIONS page can write the settings
 * blob many times during a single Save click (per-provider migrations
 * + final write), and we don't want a flurry of PUTs.
 */
export function scheduleConfigSync(delayMs = 800): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void runConfigSync();
  }, delayMs);
}

export async function runConfigSync(): Promise<void> {
  const account = await getAccount();
  if (!account) return; // signed out; nothing to sync
  const settings = await loadSettings();
  if (!settings) return;
  const payload = {
    client_id: CLIENT_ID,
    device_id: await getOrCreateDeviceId(),
    label: detectLabel(),
    config: redactedSnapshot(settings),
  };
  await apiFetch("/me/configurations", {
    method: "PUT",
    body: JSON.stringify(payload),
    bearer: account.accessToken,
  }).catch(() => {
    // best-effort — never surface to the user
  });
}

async function loadSettings(): Promise<Settings | null> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = data[SETTINGS_KEY];
  if (!raw) return { ...DEFAULT_SETTINGS };
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Project the local Settings into the JSON blob we're willing to upload.
 *
 * The redaction list is conservative on purpose: anything that even
 * smells like a credential is dropped. We send back URLs (base URLs
 * are user-curated config, not secrets) but never per-provider keys.
 * The cloud row is read by the user themselves on the account page and
 * by admins (in aggregate) — both audiences should never see keys.
 */
function redactedSnapshot(s: Settings): Record<string, unknown> {
  return {
    provider: s.provider,
    model: s.model,
    thinking: s.thinking,
    theme: s.theme,
    jsExecTimeoutMs: s.jsExecTimeoutMs,
    redactSensitiveHeaders: s.redactSensitiveHeaders,
    redactSensitiveHeaderKeys: s.redactSensitiveHeaderKeys,
    baseUrls: s.baseUrls,
    // Track which providers have a key WITHOUT exposing the key itself —
    // useful on the account page to surface "Chrome on my laptop has a
    // Gemini key configured" without leaking the secret.
    apiKeyProviders: Object.entries(s.apiKeys ?? {})
      .filter(([, v]) => typeof v === "string" && v.length > 0)
      .map(([k]) => k),
  };
}

function detectLabel(): string | undefined {
  // chrome.runtime is namespaced; the platform is occasionally useful to
  // tell apart desktop / mobile / Chromebook installs in the listing.
  const ua = navigator.userAgent ?? "";
  if (/Macintosh/.test(ua)) return "Chrome on macOS";
  if (/Windows/.test(ua)) return "Chrome on Windows";
  if (/CrOS/.test(ua)) return "Chrome on ChromeOS";
  if (/Linux/.test(ua)) return "Chrome on Linux";
  if (/Android/.test(ua)) return "Chrome on Android";
  return undefined;
}

/**
 * Wire up the SW-side listeners. Calls into here at module load so the
 * registrations happen exactly once per SW lifetime.
 *
 *   - storage.onChanged on `xgoose.settings` → debounced push
 *   - storage.onChanged on `xgoose.account`  → push immediately after a
 *     successful sign-in (the SW writes the account row from the device
 *     poll loop in `background/account.ts`)
 *   - One-shot on SW boot when we're already signed in, to heal users
 *     whose plugin was installed BEFORE this feature shipped and never
 *     uploaded anything yet.
 */
export function installConfigSyncListeners(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (SETTINGS_KEY in changes) scheduleConfigSync();
    if ("xgoose.account" in changes) {
      const next = changes["xgoose.account"]?.newValue as Account | undefined;
      // Only kick off a sync when we GAIN an account (or rotate tokens
      // for an existing one). A sign-out (newValue == null) deliberately
      // skips — there's nothing to push.
      if (next) scheduleConfigSync(0);
    }
  });
  // Heal-on-boot.
  void runConfigSync();
}
