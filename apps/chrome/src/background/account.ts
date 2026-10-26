import {isSafari} from '@/shared/host';
import {nativeCommand} from '@/shared/platformBridge';
import {createAccountSession} from './accountSession';
import {recordEvent,failureReason} from "@/shared/analytics";
/**
 * Email-confirmation login runs in the service worker. Pending requests are
 * persisted so polling resumes after a popup closes or the worker restarts.
 * Only the requesting extension receives tokens; the email confirmation page
 * verifies the mailbox without signing that browser into the account.
 * The optional no-email entry point retains legacy device-flow compatibility.
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
  email: string | null;
  verificationUri: string | null;
  expiresAt: number | null; // unix-ms
  intervalMs: number;
  error: string | null;
}

interface DevicePending {
  mode?: "email";
  email?: string;
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

const PENDING_KEY="xgoose.pending-email-login";
const restored=chrome.storage.local.get(PENDING_KEY).then(data=>{
 const stored=data[PENDING_KEY] as DevicePending|undefined;
 if(stored?.mode==="email"&&stored.expiresAt>Date.now()){
  pending={...stored,pollTimer:null};lastPhase="pending";schedulePoll();
 }else if(stored)void chrome.storage.local.remove(PENDING_KEY);
});
chrome.alarms.create("xgoose-email-login",{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="xgoose-email-login")void restored.then(()=>runPoll()).catch(()=>{});});

export async function getLoginState(): Promise<LoginState> {
  await restored;
  return {
    phase: lastPhase,
    userCode: pending?.userCode ?? null,
    email: pending?.email ?? null,
    verificationUri: pending && pending.mode!=="email" ? buildVerificationUri(pending.userCode) : null,
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
 * Begin an email login (or a legacy device flow when email is omitted). If a pending flow already exists, returns
 * its state instead of starting a new one (so the UI clicking "Sign in"
 * twice does the right thing).
 */
export async function startLogin(email?:string): Promise<LoginState> {
  await restored;
  if(email){
    const normalized=email.trim().toLowerCase();
    if(pending?.email===normalized)return getLoginState();
    cancelPending();
    recordEvent("email_login_requested",{method:"extension_email"});
    const response=await apiFetch<{poll_token:string;expires_in:number;interval:number}>("/auth/extension/request",{method:"POST",body:JSON.stringify({email:normalized})})
      .catch(() => ({ok:false as const,status:0,error:"Could not send the email request. Check your connection and try again."}));
    if(!response.ok){recordEvent("email_login_failed",{reason:failureReason(response.error),http_status:response.status});lastPhase="error";lastError=response.error;return getLoginState();}
    recordEvent("email_login_sent");
    pending={mode:"email",email:normalized,deviceCode:response.data.poll_token,userCode:"",clientId:CLIENT_ID,expiresAt:Date.now()+response.data.expires_in*1000,intervalMs:Math.max(5000,response.data.interval*1000),pollTimer:null};
    await chrome.storage.local.set({[PENDING_KEY]:pending});lastPhase="pending";lastError=null;schedulePoll();return getLoginState();
  }
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

export async function cancelLogin():Promise<LoginState>{
 await restored;if(pending)recordEvent("email_login_cancelled");cancelPending();lastPhase="idle";lastError=null;return getLoginState();
}

/** Immediate one-shot poll. Returns the current state after the call. */
export async function pollOnce(): Promise<LoginState> {
  await restored;
  if (!pending) return getLoginState();
  await runPoll();
  return getLoginState();
}

export async function logout(): Promise<void> {
  if(isSafari){await nativeCommand("logout");return;}
  const account=await getAccount();
  await accountSession.replace(null);
  cancelPending();lastPhase="idle";lastError=null;
  if(account)await apiFetch("/auth/logout",{method:"POST",body:JSON.stringify({refresh_token:account.refreshToken}),bearer:account.accessToken}).catch(()=>undefined);
}

/**
 * Try to mint a new access token from the refresh token. Returns the updated
 * Account on success, or null if the refresh failed (caller should treat as
 * "session expired, prompt re-login").
 */
const accountSession=createAccountSession({read:getAccount,save:async(a)=>{if(!isSafari)await setAccount(a);},clear:clearAccount,renew:async(account)=>{
 if(isSafari){
  const next=await nativeCommand("account",{refresh:true});
  return next?{ok:true,account:next}:{ok:false,status:401};
 }
 const res=await apiFetch<{access_token:string;refresh_token:string;access_token_expires_at:string}>("/auth/refresh",{method:"POST",body:JSON.stringify({refresh_token:account.refreshToken})});
 if(!res.ok)return {ok:false,status:res.status};
 return {ok:true,account:{...account,accessToken:res.data.access_token,refreshToken:res.data.refresh_token,accessTokenExpiresAt:res.data.access_token_expires_at,lastSeenAt:Date.now()}};
}});
export const refreshTokens=(rejectedToken?:string)=>accountSession.refresh(rejectedToken);
export const getFreshAccount=()=>accountSession.fresh();

// ── Polling internals ───────────────────────────────────────────────────

function schedulePoll(): void {
  if (!pending) return;
  if (pending.pollTimer) clearTimeout(pending.pollTimer);
  pending.pollTimer = setTimeout(() => void runPoll(), pending.intervalMs);
}

function cancelPending(): void {
  if (pending?.pollTimer) clearTimeout(pending.pollTimer);
  pending = null;
  void chrome.storage.local.remove(PENDING_KEY);
}

let polling=false;
async function runPoll(): Promise<void> {
  if(polling)return;polling=true;
  try { await pollCurrent(); }
  catch { if (pending) { lastError="Connection interrupted; waiting to retry confirmation."; schedulePoll(); } }
  finally { polling=false; }
}
async function pollCurrent():Promise<void>{
  if (!pending) return;
  const flow=pending;
  if (Date.now() > pending.expiresAt) {
    recordEvent("email_login_expired",{reason:"confirmation_timeout"});
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
    user?: AccountUser;
    status?: "pending"|"ok";
  }>(flow.mode==="email"?"/auth/extension/poll":"/auth/device/poll", {
    method: "POST",
    body: JSON.stringify(flow.mode==="email"?{token:flow.deviceCode}:{device_code:flow.deviceCode,client_id:flow.clientId}),
  });

  if(pending!==flow)return;
  if(res.ok&&res.data.status==="pending"){schedulePoll();return;}
  if (res.ok) {
    const tokens = res.data;
    // Fetch profile with the just-issued bearer.
    const me = tokens.user
      ? {ok:true as const,data:{user:tokens.user}}
      : await apiFetch<{ user: AccountUser }>("/me", {bearer:tokens.access_token});
    if (pending !== flow) return;
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
    await accountSession.replace(account);
    recordEvent("email_login_succeeded",{method:flow.mode==="email"?"extension_email":"device",duration_ms:Math.max(0,Date.now()-(flow.expiresAt-600000))});
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
