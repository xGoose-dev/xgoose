import { getFreshAccount } from "./account";
import { apiFetch, getAccount } from "@/shared/account";
import { redactTranscript } from "@/shared/redact";
import { journal, pendingEvents, acknowledgeEvents, clearPending, type JournalEvent } from "./sessionDb";
export interface Consent { hosted:boolean; byok:boolean }
const key=(id:string)=>`xgoose.transcript-consent:${id}`;
export async function getConsent():Promise<Consent> {
  const account=await getFreshAccount();if(!account)return {hosted:false,byok:false};
  const response=await apiFetch<any>("/me/transcript-consent",{bearer:account.accessToken});
  if(!response.ok)throw new Error(response.error);
  const consent={hosted:!!response.data.hosted,byok:!!response.data.byok};
  await chrome.storage.local.set({[key(account.user.id)]:consent});
  for(const provider of ["hosted","byok"] as const)if(!consent[provider])await clearPending(account.user.id,provider);
  return consent;
}
export async function setConsent(consent:Consent):Promise<Consent> {
  const account=await getFreshAccount();if(!account)throw new Error("Sign in before changing transcript consent");
  const response=await apiFetch("/me/transcript-consent",{method:"PUT",body:JSON.stringify(consent),bearer:account.accessToken});
  if(!response.ok)throw new Error(response.error);
  await chrome.storage.local.set({[key(account.user.id)]:consent});
  for(const provider of ["hosted","byok"] as const)if(!consent[provider])await clearPending(account.user.id,provider);
  return consent;
}
export async function recordJournal(value:JournalEvent,sender:chrome.runtime.MessageSender) {
  // Local journaling must work without refreshing a token over the network.
  const account=await getAccount();
  const cached=account?(await chrome.storage.local.get(key(account.user.id)))[key(account.user.id)] as Consent|undefined:undefined;
  // Owner comes from the extension account, never from page-supplied data.
  const event={...value,ownerId:account?.user.id,event:redactTranscript({...value.event,tabId:sender.tab?.id,documentId:sender.documentId})};
  await journal(event,!!account&&!!cached?.[value.provider]);
}
let flushing=false;
export async function flushTranscripts() {
  if(flushing)return;flushing=true;
  try{
    const account=await getFreshAccount();if(!account)return;
    const consent=await getConsent();const rows=await pendingEvents(account.user.id);
    if(!rows.length)return;
    const first=rows[0];if(!consent[first.provider])return;
    const candidates=rows.filter(r=>r.sessionId===first.sessionId&&r.provider===first.provider);
    const group:JournalEvent[]=[];let bytes=1024;
    for(const row of candidates){
      const size=new TextEncoder().encode(JSON.stringify(row)).length;
      // Retain the complete local event; mark an upload omission explicitly.
      const entry=size>800000?{...row,event:{type:"missing",originalType:row.event.type,reason:"event_exceeds_upload_limit",bytes:size}}:row;
      const entryBytes=new TextEncoder().encode(JSON.stringify(entry)).length;
      if(bytes+entryBytes>900000)break;
      group.push(entry);bytes+=entryBytes;
    }
    const response=await apiFetch<{acknowledged:string[]}>("/transcripts/events",{method:"POST",bearer:account.accessToken,body:JSON.stringify({sessionId:first.sessionId,provider:first.provider,events:group.map(e=>({id:e.id,sequence:e.sequence,kind:e.event.type,at:e.at,body:{runId:e.runId,...e.event}}))})});
    if(response.ok)await acknowledgeEvents(response.data.acknowledged.filter(id=>group.some(e=>e.id===id)));
    // Network/service errors retain the persistent queue for the next alarm.
  } finally {flushing=false;}
}
chrome.alarms.create("xgoose-transcripts",{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="xgoose-transcripts")void flushTranscripts().catch(()=>{});});
