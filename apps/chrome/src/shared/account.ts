/**
 * xgoose cloud account — local state + thin API client.
 *
 * Login uses the OAuth 2.0 device-authorization flow handled by the worker at
 * `https://api.xgoose.org/auth/device/*`. The plugin owns the device side; the
 * user grants the code on the xgoose website (`/account?user_code=…`). On
 * approval, the worker hands us {access_token, refresh_token, expires_at}
 * which we persist in `chrome.storage.local` under `xgoose.account`.
 *
 * All extension contexts (background, popup, options, content) read the same
 * record via storage.onChanged, so a sign-in in the options page lights up
 * the popup and content panel immediately.
 *
 * Wire-compatible with the xgoose-safari implementation: same storage key,
 * same JSON shape, same API endpoints. Only the OAuth client id differs
 * (`xgoose-extension-chrome` vs `xgoose-safari`) so the gateway can attribute traffic.
 */
/// <reference types="chrome" />

import { z } from "zod";

// ── Configuration ────────────────────────────────────────────────────────

/** Cloud API base. The worker is deployed at api.xgoose.org. */
export const XGOOSE_API_URL = "https://api.xgoose.org";

/** Public website base. Used to build the device-flow approval URL. */
export const XGOOSE_WEB_URL = "https://xgoose.org";

// ── Schema + storage ─────────────────────────────────────────────────────

export const AccountUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  email_verified: z.boolean(),
  is_admin: z.boolean(),
});
export type AccountUser = z.infer<typeof AccountUserSchema>;

export const AccountSchema = z.object({
  user: AccountUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  /** ISO-8601 string of access-token expiry. */
  accessTokenExpiresAt: z.string(),
  /** Unix-ms of last successful API call; for diagnostics only. */
  lastSeenAt: z.number().int().nonnegative().default(0),
});
export type Account = z.infer<typeof AccountSchema>;

export const ACCOUNT_KEY = "xgoose.account";

// Stable per-install identifier. The first time the extension runs we
// mint a UUID and persist it here; that id is what the worker uses to
// distinguish a config snapshot pushed from THIS browser from one
// pushed from another browser on the same account. Wiping it (via
// chrome://settings/cookies-and-site-data or a fresh install) creates
// a brand-new "device" — the previously synced config row remains until
// the user explicitly deletes it from the website.
export const DEVICE_ID_KEY = "xgoose.deviceId";

export async function getOrCreateDeviceId(): Promise<string> {
  const got = await chrome.storage.local.get(DEVICE_ID_KEY);
  const existing = got[DEVICE_ID_KEY];
  if (typeof existing === "string" && existing.length > 0) return existing;
  const id = (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

export async function getAccount(): Promise<Account | null> {
  const got = await chrome.storage.local.get(ACCOUNT_KEY);
  const raw = got[ACCOUNT_KEY];
  if (!raw) return null;
  const parsed = AccountSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function setAccount(account: Account): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNT_KEY]: account });
}

export async function clearAccount(): Promise<void> {
  await chrome.storage.local.remove(ACCOUNT_KEY);
}

export function onAccountChange(
  cb: (next: Account | null) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    if (area !== "local" || !(ACCOUNT_KEY in changes)) return;
    const v = changes[ACCOUNT_KEY]?.newValue;
    if (!v) return cb(null);
    const parsed = AccountSchema.safeParse(v);
    cb(parsed.success ? parsed.data : null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ── API client (background-side; direct fetch is fine from the SW) ──────

export type ApiResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/**
 * Single-shot fetch against the xgoose API. Returns a tagged result so
 * callers can pattern-match without juggling try/catch. Lets exceptions
 * propagate only for true network errors (`fetch` threw).
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit & { bearer?: string | null } = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  if (
    !headers.has("content-type") &&
    init.body &&
    typeof init.body === "string"
  ) {
    headers.set("content-type", "application/json");
  }
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  const res = await fetch(`${XGOOSE_API_URL}${path}`, { ...init, headers });
  const ctype = res.headers.get("content-type") ?? "";
  if (res.status === 204) {
    return res.ok
      ? { ok: true, status: res.status, data: undefined as unknown as T }
      : { ok: false, status: res.status, error: "no content" };
  }
  if (ctype.includes("application/json")) {
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // The worker uses {error, message} on failures; some endpoints (the
      // device-flow poll) reply with only {error: "authorization_pending"}.
      // Prefer message but fall back to the error code so callers can pattern
      // match on RFC-8628 strings without losing them to "400 Bad Request".
      const obj =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : null;
      const msg =
        (obj && typeof obj.message === "string" && obj.message) ||
        (obj && typeof obj.error === "string" && obj.error) ||
        `${res.status} ${res.statusText}`;
      return { ok: false, status: res.status, error: String(msg) };
    }
    return { ok: true, status: res.status, data: body as T };
  }
  const text = await res.text();
  if (!res.ok)
    return { ok: false, status: res.status, error: text.slice(0, 240) };
  return { ok: true, status: res.status, data: text as unknown as T };
}
