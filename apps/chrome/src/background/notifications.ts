import {isSafari} from "@/shared/host";
import {NOTIFICATIONS_KEY,type NotificationRequest,type NotificationReceipt} from "@/shared/notifications";
const SENT_KEY="xgoose.notifications.sent";
let queue=Promise.resolve<unknown>(undefined),listening=false;
export async function notificationStatus() {
  if(isSafari)return {supported:false,enabled:false};
  const stored=await chrome.storage.local.get(NOTIFICATIONS_KEY);
  const granted=await chrome.permissions.contains({permissions:["notifications"]}).catch(()=>false);
  return {supported:true,enabled:stored[NOTIFICATIONS_KEY]===true&&granted};
}
export function installNotificationEvents() {
  if(isSafari||listening||!chrome.notifications)return;
  listening=true;
  chrome.notifications.onClicked.addListener(async id=>{
    const match=/^xgoose-task:(\d+):/.exec(id);if(!match)return;
    try {const tab=await chrome.tabs.get(Number(match[1]));if(tab.windowId!==undefined)await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tab.id!,{active:true});await chrome.notifications.clear(id);}catch{/* The source tab may have closed. */}
  });
}
if(!isSafari)chrome.permissions.onAdded.addListener(installNotificationEvents);
export function emitNotification(input:NotificationRequest,sender:chrome.runtime.MessageSender):Promise<NotificationReceipt> {
  const job=queue.then(async():Promise<NotificationReceipt>=>{
    const stored=await chrome.storage.local.get([NOTIFICATIONS_KEY,SENT_KEY]);
    if(isSafari||stored[NOTIFICATIONS_KEY]!==true)return {sent:false,reason:"disabled"};
    if(!await chrome.permissions.contains({permissions:["notifications"]}))return {sent:false,reason:"permission_denied"};
    if(!chrome.notifications)return {sent:false,reason:"unavailable"};
    let tab=sender.tab;
    if(!tab&&input.tabId!==undefined&&sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL("agent.html")){
      const candidate=await chrome.tabs.get(input.tabId);
      if(candidate.url?.split(/[?#]/)[0]===chrome.runtime.getURL("agent.html"))tab=candidate;
    }
    if(tab?.id===undefined||!input.runId||input.runId.length>100)return {sent:false,reason:"unavailable"};
    tab=await chrome.tabs.get(tab.id);
    if(input.mode==="completion"&&tab.active&&(await chrome.windows.get(tab.windowId!)).focused)return {sent:false,reason:"active"};
    const id=`xgoose-task:${tab.id}:${input.runId}`,sent:string[]=Array.isArray(stored[SENT_KEY])?stored[SENT_KEY] as string[]:[];
    if(sent.includes(id))return {sent:false,reason:"duplicate"};
    installNotificationEvents();
    const notice={type:"basic" as const,iconUrl:chrome.runtime.getURL("images/icon-128.png"),
      title:input.mode==="completion"?"xgoose task complete":String(input.title??"xgoose").slice(0,80),
      message:input.mode==="completion"?String(tab.title||"Your browser task is complete.").slice(0,240):String(input.message??"").slice(0,240)};
    await chrome.notifications.create(id,notice);
    await chrome.storage.local.set({[SENT_KEY]:[...sent.slice(-39),id]});
    return {sent:true,reason:"sent",notificationId:id,title:notice.title,message:notice.message};
  }).catch(():NotificationReceipt=>({sent:false,reason:"unavailable"}));
  queue=job;return job;
}
