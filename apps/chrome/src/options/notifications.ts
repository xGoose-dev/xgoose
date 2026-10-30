import {send} from "@/shared/messages";
import {NOTIFICATIONS_KEY} from "@/shared/notifications";
import {translate} from "@/shared/locale";
export async function mountNotifications() {
  const input=document.querySelector<HTMLInputElement>("#notificationsEnabled");
  const status=document.querySelector<HTMLElement>("#notificationStatus");
  if(!input||!status)return;
  const state=await send("sw:notification_status",undefined);
  input.checked=state.enabled;input.disabled=!state.supported;
  input.addEventListener("change",async()=>{
    const enabled=input.checked;
    try {
      // Keep the permission request directly in the user gesture, before storage/network awaits.
      const granted=!enabled||await chrome.permissions.request({permissions:["notifications"]});
      input.checked=enabled&&granted;
      await chrome.storage.local.set({[NOTIFICATIONS_KEY]:input.checked});
      status.textContent=translate(granted?"Saved automatically.":"Notification permission was denied. You can enable it in browser settings.");
    } catch {input.checked=false;await chrome.storage.local.set({[NOTIFICATIONS_KEY]:false});status.textContent=translate("Notifications are unavailable in this browser.");}
  });
}
