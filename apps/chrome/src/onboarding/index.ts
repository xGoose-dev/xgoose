import {mountAccountSection} from "@/shared/accountSection";
import {initializeLocale,mountAnswerLanguage} from "@/shared/locale";
void initializeLocale(document.body);
import {send} from "@/shared/messages";
import {track} from "@/shared/analytics";
let permissionKnown:boolean|undefined;
track("onboarding_viewed");
async function checkPermission() {
  const status = document.querySelector<HTMLElement>("#permissionState")!;
  const step = document.querySelector<HTMLDetailsElement>("#permissionStep")!;
  const badge = document.querySelector<HTMLElement>("#permissionBadge")!;
  try {
    await chrome.userScripts.getScripts();
    if(permissionKnown!==true){track("permission_enabled",{step:"user_scripts"});permissionKnown=true;}
    status.textContent = "Enabled. Built-in and user-installed skills are ready.";
    status.classList.add("saved");
    badge.textContent = "✓ Enabled";
    badge.classList.add("enabled");
    const restoreFocus = step.contains(document.activeElement);
    step.open = false;
    if (restoreFocus) document.querySelector<HTMLElement>("#permissionStepSummary")!.focus();
  } catch {
    if(permissionKnown!==false){track("permission_blocked",{step:"user_scripts",reason:"permission"});permissionKnown=false;}
    status.textContent = "Built-in skills are ready. Turn on Allow User Scripts for custom scripts, then check again.";
    status.classList.remove("saved");
    badge.textContent = "Recommended";
    badge.classList.remove("enabled");
    step.open = true;
  }
}
const detailsUrl = `chrome://extensions/?id=${chrome.runtime.id}`;
document.querySelector("#extensionDetailsUrl")!.textContent = detailsUrl;
document.querySelector(".chrome-guide-address")!.textContent = detailsUrl;
document.querySelector("#openExtensions")!.addEventListener("click", async () => {
  track("permission_settings_opened");
  try { await chrome.tabs.create({url:detailsUrl}); }
  catch {
    document.querySelector("#permissionState")!.textContent = "Chrome could not open the page. Use the address under Open it manually below.";
    document.querySelector<HTMLDetailsElement>(".permission-manual")!.open = true;
  }
});
document.querySelector("#checkPermission")!.addEventListener("click", () => void checkPermission());
window.addEventListener("focus", () => void checkPermission());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkPermission();
});
void checkPermission();

document.querySelectorAll<HTMLAnchorElement>("[data-start-site]").forEach(link=>link.addEventListener("click",()=>track("onboarding_website_opened",{target:link.dataset.startSite!})));

void mountAccountSection().catch(()=>{document.querySelector("#accountState")!.textContent="Sign-in could not load. Open Settings to try again.";});
void mountAnswerLanguage(document.querySelector<HTMLSelectElement>("#answerLanguage")!,document.querySelector<HTMLElement>("#answerLanguageStatus"));
