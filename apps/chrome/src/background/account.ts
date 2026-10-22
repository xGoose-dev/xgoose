/**
 * Device-flow login orchestration. Lives in the service worker so the polling
 * loop survives popup / options page close, and so all extension contexts see
 * the same authoritative account state through storage.onChanged.
 *
 * The flow:
 *   1. start() POSTs /auth/device/code → cache device_code + user_code
 *   2. open the website's /account?user_code=<user_code> tab so the user can
 *      sign in and approve
 *   3. poll /auth/device/poll every `interval` seconds for up to expires_in
 *   4. on approval, GET /me, persist {user, tokens} as the Account
 *
 * Mirrors xgoose-safari/src/background/account.ts almost verbatim; the only
 * delta is CLIENT_ID = 'xgoose-extension-chrome' so the gateway can
 * attribute traffic.
 */
/// <reference types="chrome" />

import {
  apiFetch,
  clearAccount,
  getAccount,
  setAccount,
  type Account,
  type AccountUser,
  XGOOSE_WEB_URL,
} from "@/shared/account";

// ── Public API surface (used by message handlers) ───────────────────────

export type LoginPhase =
  | "idle"
  | "pending" // /code issued, polling for approval
  | "denied" // user explicitly denied
  | "expired" // device_code TTL elapsed before approval
  | "error"; // unrecoverable fetch failure

export interface LoginState {
  phase: LoginPhase;
  userCode: string | null;
  verificationUri: string | null;
  expiresAt: number | null; // unix-ms
  intervalMs: number;
  error: string | null;
}

interface DevicePending {
  deviceCode: string;
  userCode: string;
  clientId: string;
  expiresAt: number;
  intervalMs: number;
  pollTimer: ReturnType<typeof setTimeout> | null;
}

let pending: DevicePending | null = null;
let lastPhase: LoginPhase = "idle";
let lastError: string | null = null;

const CLIENT_ID = "xgoose-extension-chrome";

export function getLoginState(): LoginState {
  return {
    phase: lastPhase,
    userCode: pending?.userCode ?? null,
    verificationUri: pending ? buildVerificationUri(pending.userCode) : null,
    expiresAt: pending?.expiresAt ?? null,
    intervalMs: pending?.intervalMs ?? 5000,
    error: lastError,
  };
}

function buildVerificationUri(userCode: string): string {
  // The website's /account page reads `?user_code=…` (and `?code=…`) to
  // prefill the device approval form. The worker's `verification_uri_complete`
  // ships `?device=…` which the site ignores — so we build our own URL here.
  return `${XGOOSE_WEB_URL}/account/?user_code=${encodeURIComponent(userCode)}`;
}

/**
 * Begin a fresh device-flow login. If a pending flow already exists, returns
 * its state instead of starting a new one (so the UI clicking "Sign in"
 * twice does the right thing).
 */
export async function startLogin(): Promise<LoginState> {
  if (pending) return getLoginState();

  const res = await apiFetch<{
    device_code: string;
    user_code: string;
    expires_in: number;
    interval: number;
    verification_uri: string;
    verification_uri_complete: string;
  }>("/auth/device/code", {
    method: "POST",
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "plugin" }),
  });
  if (!res.ok) {
    lastPhase = "error";
    lastError = res.error;
    return getLoginState();
  }

  pending = {
    deviceCode: res.data.device_code,
    userCode: res.data.user_code,
    clientId: CLIENT_ID,
    expiresAt: Date.now() + res.data.expires_in * 1000,
    intervalMs: Math.max(2000, res.data.interval * 1000),
    pollTimer: null,
  };
  lastPhase = "pending";
  lastError = null;

  // Open the approval URL in a new tab. If the popup that called us is
  // closing simultaneously the new tab still wins, which is what we want.
  void chrome.tabs
    .create({ url: buildVerificationUri(pending.userCode) })
    .catch(() => {
      /* user may have closed the popup before tab creation resolved */
    });

  schedulePoll();
  return getLoginState();
}

/** Immediate one-shot poll. Returns the current state after the call. */
export async function pollOnce(): Promise<LoginState> {
  if (!pending) return getLoginState();
  await runPoll();
  return getLoginState();
}

export async function logout(): Promise<void> {
  const account = await getAccount();
  if (account) {
    // Best-effort: the worker rotates refresh tokens, so logout invalidates
    // the active server-side session. If the network is down we still wipe
    // the local copy below.
    await apiFetch("/auth/logout", {
      method: "POST",
      body: "{}",
      bearer: account.accessToken,
    }).catch(() => undefined);
  }
  await clearAccount();
  cancelPending();
  lastPhase = "idle";
  lastError = null;
}

/**
 * Try to mint a new access token from the refresh token. Returns the updated
 * Account on success, or null if the refresh failed (caller should treat as
 * "session expired, prompt re-login").
 */
export async function refreshTokens(): Promise<Account | null> {
  const account = await getAccount();
  if (!account) return null;
  const res = await apiFetch<{
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
  }>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: account.refreshToken }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      await clearAccount();
    }
    return null;
  }
  const next: Account = {
    ...account,
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    accessTokenExpiresAt: res.data.access_token_expires_at,
    lastSeenAt: Date.now(),
  };
  await setAccount(next);
  return next;
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 120_000;

function msUntilAccessTokenExpiry(account: Account): number {
  const t = Date.parse(account.accessTokenExpiresAt);
  return Number.isFinite(t) ? t - Date.now() : -1;
}

/** Return an account whose access token is ready to use. */
export async function getFreshAccount(): Promise<Account | null> {
  const account = await getAccount();
  if (!account) return null;
  if (msUntilAccessTokenExpiry(account) >= ACCESS_TOKEN_REFRESH_BUFFER_MS) {
    return account;
  }
  const refreshed = await refreshTokens();
  return refreshed ?? (msUntilAccessTokenExpiry(account) > 0 ? account : null);
}

// ── Polling internals ───────────────────────────────────────────────────

function schedulePoll(): void {
  if (!pending) return;
  if (pending.pollTimer) clearTimeout(pending.pollTimer);
  pending.pollTimer = setTimeout(() => void runPoll(), pending.intervalMs);
}

function cancelPending(): void {
  if (pending?.pollTimer) clearTimeout(pending.pollTimer);
  pending = null;
}

async function runPoll(): Promise<void> {
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    cancelPending();
    lastPhase = "expired";
    lastError = "device code expired — try signing in again";
    return;
  }

  const res = await apiFetch<{
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
    token_type: string;
  }>("/auth/device/poll", {
    method: "POST",
    body: JSON.stringify({
      device_code: pending.deviceCode,
      client_id: pending.clientId,
    }),
  });

  if (res.ok) {
    const tokens = res.data;
    // Fetch profile with the just-issued bearer.
    const me = await apiFetch<{ user: AccountUser }>("/me", {
      bearer: tokens.access_token,
    });
    if (!me.ok) {
      lastPhase = "error";
      lastError = `signed in but /me failed: ${me.error}`;
      cancelPending();
      return;
    }
    const account: Account = {
      user: me.data.user,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: tokens.access_token_expires_at,
      lastSeenAt: Date.now(),
    };
    await setAccount(account);
    cancelPending();
    lastPhase = "idle";
    lastError = null;
    return;
  }

  // Worker returns 400 with { error: 'authorization_pending' } until approved.
  if (res.status === 400 && /authorization_pending/i.test(res.error)) {
    schedulePoll();
    return;
  }
  // slow_down — back off and reschedule.
  if (res.status === 429) {
    pending.intervalMs = Math.min(pending.intervalMs + 2000, 15_000);
    schedulePoll();
    return;
  }
  // expired / denied / fatal
  if (res.status === 400 && /expired/i.test(res.error)) {
    cancelPending();
    lastPhase = "expired";
    lastError = res.error;
    return;
  }
  if (res.status === 401 || res.status === 403) {
    cancelPending();
    lastPhase = "denied";
    lastError = res.error;
    return;
  }
  // Transient — try one more time then bail.
  schedulePoll();
  lastError = res.error;
}
