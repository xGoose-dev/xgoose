import { send } from "@/shared/messages";

/** One brief introduction per install; ongoing skill management lives in Settings. */
export async function showRecommendations() {
  try {
    const root = document.querySelector("#xgoose-root")?.shadowRoot;
    const bar = root?.querySelector(".skills-bar");
    if (!root || !bar) return;
    // Wait until the panel is actually visible before consuming the notice.
    const observer = new IntersectionObserver(async entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      try {
        if (!await send("sw:claim_skill_notice", undefined)) return;
        const notice = document.createElement("div");
        notice.className = "skill-recommendations";
        notice.setAttribute("role", "status");
        notice.style.cssText = "display:flex;align-items:center;gap:8px;flex-basis:100%;font:inherit;font-size:12px;padding:6px 0;color:inherit";
        const text = document.createElement("span"); text.textContent = "Manage website skills in Settings.";
        const settings = document.createElement("button"); settings.textContent = "Settings";
        settings.style.cssText = "font:inherit;color:inherit;background:none;border:0;text-decoration:underline;cursor:pointer;padding:4px";
        settings.addEventListener("click", () => { notice.remove(); void send("sw:open_skill_catalog", {slugs:[]}); });
        const dismiss = document.createElement("button"); dismiss.textContent = "×"; dismiss.setAttribute("aria-label", "Dismiss skill tip");
        dismiss.style.cssText = "font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:4px;margin-left:auto";
        dismiss.addEventListener("click", () => notice.remove());
        notice.append(text, settings, dismiss); bar.append(notice);
        setTimeout(() => notice.remove(), 12000);
      } catch { /* An optional tip must never block chat. */ }
    });
    observer.observe(bar);
  } catch { /* Optional introduction. */ }
}
