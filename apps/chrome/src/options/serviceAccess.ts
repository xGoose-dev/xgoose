import {normalizeProviderBaseUrl} from '@xgoose/core';
import {isSafari} from '@/shared/host';
import type {Provider} from '@/shared/types';

/** A forum-only Site access setting also withholds the separate AI API host. */
export function mountServiceAccess(read:()=>{provider:Provider;baseUrl:string}):()=>void {
 if(isSafari)return ()=>{};
 const card=document.createElement('div');card.className='permission-status';
 card.innerHTML='<div><strong>AI service access</strong><p class="hint" id="serviceAccessStatus" role="status"></p></div><button type="button" class="btn secondary compact" id="allowServiceAccess">Allow AI service access</button>';
 document.querySelector('#apiKeyTestRow')!.after(card);
 const status=card.querySelector<HTMLElement>('#serviceAccessStatus')!,button=card.querySelector<HTMLButtonElement>('button')!;
 const endpoint=()=>{
  const {provider,baseUrl}=read();
  return new URL(provider==='xgoose-hosted'?'https://api.xgoose.org':normalizeProviderBaseUrl(provider,baseUrl));
 };
 const permission=(url:URL)=>({origins:[`${url.protocol}//${url.hostname}/*`]});
 let generation=0;
 const refresh=async()=>{
  const current=++generation;
  try{
   const url=endpoint(),allowed=await chrome.permissions.contains(permission(url));
   if(current!==generation)return;
   status.textContent=allowed?`AI service access allowed: ${url.origin}.`:`Allow access to ${url.origin} to connect to AI. Website access and Allow User Scripts are separate.`;
   button.hidden=allowed;
  }catch(error){if(current===generation){status.textContent=error instanceof Error?error.message:String(error);button.hidden=true;}}
 };
 button.addEventListener('click',async()=>{
  // Request synchronously from the click, scoped to the selected service host.
  const url=endpoint(),request=chrome.permissions.request(permission(url));
  button.disabled=true;
  try{
   if(await request)await refresh();
   else status.textContent=`Access to ${url.origin} was not granted. Allow it in your browser’s xgoose Site access settings, then try again.`;
  }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
  finally{button.disabled=false;}
 });
 chrome.permissions.onAdded.addListener(()=>void refresh());
 chrome.permissions.onRemoved.addListener(()=>void refresh());
 window.addEventListener('focus',()=>void refresh());
 void refresh();return ()=>void refresh();
}
