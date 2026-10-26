import {send} from "./messages";
import {ACCOUNT_KEY,onAccountChange,type Account} from "./account";
import {translate} from "./locale";

type LoginPhase = "idle" | "pending" | "denied" | "expired" | "error";
interface LoginState {
  phase: LoginPhase;
  userCode: string | null;
  email: string | null;
  verificationUri: string | null;
  expiresAt: number | null;
  intervalMs: number;
  error: string | null;
}

export async function mountAccountSection(): Promise<void> {
  const found = document.getElementById(
    "accountState",
  ) as HTMLDivElement | null;
  if (!found) return;
  const root: HTMLDivElement = found;

  // Local UI poll handle — we tick a re-render while a login is pending so the
  // countdown stays fresh and we pick up the SW's polling result.
  let pendingTicker: ReturnType<typeof setInterval> | null = null;
  let emailDraft="";
  let renderedKey="";
  let renderedMinutes=-1;

  const remainingMinutes=(login:LoginState)=>Math.max(0,Math.ceil(((login.expiresAt??0)-Date.now())/60000));
  const pendingMessage=(login:LoginState)=>`Email sent to ${login.email??"your inbox"}. Click the confirmation link and this extension will sign in automatically. The link expires in ${remainingMinutes(login)} minutes. You can close this settings page.`;

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
    // Polling must not replace focused controls every two seconds. Keep the
    // pending form stable; only its countdown text needs periodic updates.
    const nextKey=JSON.stringify(account?{user:account.user}:login);
    if(nextKey===renderedKey){
      const minutes=remainingMinutes(login);
      if(!account&&login.phase==="pending"&&minutes!==renderedMinutes){
        const text=root.parentElement?.querySelector('.device-code-card')?.firstChild;
        if(text?.nodeType===Node.TEXT_NODE)text.textContent=pendingMessage(login);
        renderedMinutes=minutes;
      }
      return;
    }
    renderedKey=nextKey;
    renderedMinutes=remainingMinutes(login);
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
      `<div class="name" data-no-i18n>${escHtml(displayName)}${badges.join("")}</div>` +
      `<div class="meta">${escHtml(account.user.email)} · Connected</div>`;

    const actions = document.createElement("div");
    actions.className = "actions";
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "btn danger";
    logoutBtn.textContent = "Sign out";
    logoutBtn.addEventListener("click", async () => {
      if (!confirm(translate(`Sign out of ${account.user.email}?`))) return;
      logoutBtn.disabled = true;
      await send("sw:account_logout", undefined);
      logoutBtn.disabled = false;
      await refresh();
    });
    actions.append(logoutBtn);
    host.append(avatar, body, actions);
  }

  function renderSignedOut(host: HTMLElement, login: LoginState): void {
    const body = document.createElement("div");
    body.className = "account-state-body";
    body.innerHTML = '<div class="name">Sign in with email</div>' +
      '<div class="meta">New here? Your account is created when you confirm your email. No password or website registration needed.</div>';
    const form=document.createElement("form");form.className="actions";
    form.style.cssText="display:flex;gap:10px;flex-wrap:wrap;align-items:center";
    const email=document.createElement("input");email.type="email";email.id="loginEmail";email.placeholder="you@example.com";email.autocomplete="email";email.required=true;email.setAttribute("aria-label","Email address");email.value=login.email??emailDraft;email.disabled=login.phase==="pending";
    email.addEventListener("input",()=>{emailDraft=email.value;});
    const signIn=document.createElement("button");signIn.type="submit";signIn.className="btn primary";signIn.textContent=login.phase==="pending"?"Check your email":"Send sign-in email";signIn.disabled=login.phase==="pending";
    form.addEventListener("submit",async event=>{event.preventDefault();if(!email.reportValidity())return;emailDraft=email.value;signIn.disabled=true;signIn.textContent="Sending…";await send("sw:account_start_login",{email:email.value});await refresh();});
    form.append(email,signIn);body.append(form);host.append(body);
    if(login.phase==="pending"){
      const card=document.createElement("div");card.className="device-code-card";
      card.textContent=pendingMessage(login);
      const change = document.createElement("button");
      change.type = "button"; change.className = "btn secondary";
      change.textContent = "Change email or request another link";
      change.addEventListener("click", async () => {
        change.disabled = true;
        await send("sw:account_cancel_login", undefined);
        await refresh();
      });
      card.append(document.createElement("br"), change);
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

function humanPhase(p: LoginPhase): string {
  if (p === "denied") return "Sign-in denied";
  if (p === "expired") return "Sign-in expired";
  if (p === "error") return "Sign-in error";
  return "Sign in";
}

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

