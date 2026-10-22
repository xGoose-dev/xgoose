/// <reference types="chrome" />
//
// Toolbar popup. Mirrors the safari layout: header / current-page status /
// account status row (sign in / sign out) / "Open chat panel" / "Settings".
//
// Fine-grained provider switching now lives only in the options page —
// the popup is intentionally small so flipping the panel from any tab
// doesn't lose the chat state. Power users open Settings to change
// provider/model/API key.

import { send } from "@/shared/messages";
import { onAccountChange, type Account } from "@/shared/account";
import { track } from "@/shared/analytics";

async function renderStatus(): Promise<void> {
  const statusEl = document.querySelector(".status") as HTMLDivElement;
  try {
    const info = await send("sw:get_page_info", undefined);
    if (info?.url) {
      const u = new URL(info.url);
      statusEl.textContent = u.host;
    } else {
      statusEl.textContent = "No page detected";
    }
  } catch {
    statusEl.textContent = "No page detected";
  }
}

async function renderAccount(): Promise<void> {
  const root = document.getElementById("account") as HTMLDivElement | null;
  if (!root) return;
  const account: Account | null = await send("sw:account_get", undefined);
  root.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "dot-status";
  root.appendChild(dot);

  if (account) {
    root.classList.add("signedin");
    root.classList.remove("signedout");
    const email = document.createElement("span");
    email.className = "email";
    email.textContent = account.user.email;
    email.title = account.user.email;
    root.appendChild(email);
    const out = document.createElement("button");
    out.className = "link";
    out.type = "button";
    out.textContent = "Sign out";
    out.addEventListener("click", async () => {
      track("popup_signout_clicked");
      await send("sw:account_logout", undefined);
      await renderAccount();
    });
    root.appendChild(out);
  } else {
    root.classList.add("signedout");
    root.classList.remove("signedin");
    const label = document.createElement("span");
    label.className = "email";
    label.textContent = "Not signed in";
    root.appendChild(label);
    const inBtn = document.createElement("button");
    inBtn.className = "link";
    inBtn.type = "button";
    inBtn.textContent = "Sign in";
    inBtn.addEventListener("click", async () => {
      track("popup_signin_clicked");
      await send("sw:open_options", undefined);
      // Email sign-in lives in extension settings; no website registration hop.
      window.close();
    });
    root.appendChild(inBtn);
  }
}

document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  const action = t.dataset.action;
  if (action === "toggle") {
    track("popup_open_panel_clicked");
    await send("sw:toggle_panel", undefined);
    window.close();
  } else if (action === "options") {
    track("popup_open_settings_clicked");
    await send("sw:open_options", undefined);
    window.close();
  }
});

track("popup_opened");
void renderStatus();
void renderAccount();
onAccountChange(() => void renderAccount());
