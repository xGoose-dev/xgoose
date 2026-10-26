import {send} from '@/shared/messages';
import {track} from '@/shared/analytics';
import {userScriptsSetup} from '@/shared/userScriptsSetup';
/** Native UI stays available even when the model omits a link or page JS cannot run. */
export function mountUserScriptsGuide(onPermissionChange:()=>void) {
 const root=document.querySelector('#xgoose-root')!.shadowRoot!;
 const {detailsUrl,guideUrl,steps}=userScriptsSetup(chrome.runtime.id);
 const style=document.createElement('style');style.textContent=`.user-scripts-guide{flex-shrink:0;margin:10px 14px;padding:12px 14px;border:1px solid #c99124;border-radius:10px;background:var(--bg-input);color:var(--text);font:13px/1.5 system-ui,sans-serif;max-height:36vh;overflow:auto}.user-scripts-guide[hidden]{display:none}.user-scripts-guide p{margin:6px 0}.user-scripts-guide ol{margin:8px 0;padding-left:20px}.user-scripts-guide a,.user-scripts-guide button{color:var(--text);text-decoration:underline;cursor:pointer}.user-scripts-guide button{font:inherit;background:transparent;border:0;padding:0}.user-scripts-guide .guide-actions{display:flex;flex-wrap:wrap;gap:8px 16px}.user-scripts-guide strong{font-weight:650}`;root.append(style);
 function card(inline=false){const box=document.createElement('aside');box.className='user-scripts-guide';box.dataset.userScriptsGuide=inline?'inline':'banner';box.hidden=true;box.setAttribute('role',inline?'note':'alert');box.innerHTML=`<strong>Enable Allow User Scripts</strong><p>Built-in skills and page reading work now. Enable this for community skills, edited or online-updated scripts, and custom JavaScript actions.</p><div class="guide-actions"><a href="${detailsUrl}">Open extension settings</a><a href="${guideUrl}">Illustrated guide</a><button type="button">Check again</button></div><details${inline?' open':''}><summary>How to enable</summary><ol>${steps.map(step=>`<li>${step}</li>`).join('')}</ol></details>`;box.querySelector('button')!.addEventListener('click',()=>void check());return box;}
 const banner=card();root.querySelector('.msgs')!.before(banner);
 let enabled:boolean|undefined;
 // Keep the initial check quiet until skill detection finishes, avoiding a flash.
 let builtinSite:boolean|undefined;
 function render(){
  const hidden=enabled!==false||builtinSite!==false;
  root.querySelectorAll<HTMLElement>('[data-user-scripts-guide="inline"]').forEach(el=>el.hidden=hidden);
  banner.hidden=hidden||!!root.querySelector('[data-user-scripts-guide="inline"]');
 }
 function setBuiltinSite(value:boolean){builtinSite=value;render();}
 async function check(){try{const state=await send('sw:user_scripts_status',undefined);const before=enabled;enabled=state.enabled;render();if(before!==enabled)track(enabled?'permission_enabled':'permission_blocked',{page:'chat',reason:enabled?'enabled':'permission'});if(before!==undefined&&before!==enabled)onPermissionChange();return enabled;}catch{return true;}}
 root.addEventListener('click',event=>{const anchor=(event.target as Element)?.closest?.('a');if(!anchor||![detailsUrl,guideUrl].includes(anchor.getAttribute('href')??''))return;event.preventDefault();event.stopPropagation();track('permission_settings_opened',{page:'chat'});void send('sw:open_user_scripts_setup',{guide:anchor.getAttribute('href')===guideUrl}).catch(()=>{render();});});
 new MutationObserver(()=>{if(enabled!==false||builtinSite!==false){render();return;}banner.hidden=false;for(const bubble of root.querySelectorAll('.msg-ai')){if(!/allow[\s_-]*user[\s_-]*scripts|允许.{0,3}用户脚本|用户脚本.{0,6}(权限|开|启)/i.test(bubble.textContent??''))continue;if((bubble.nextElementSibling as HTMLElement)?.dataset.userScriptsGuide==='inline')continue;const guide=card(true);guide.hidden=false;bubble.after(guide);}if(root.querySelector('[data-user-scripts-guide="inline"]'))banner.hidden=true;}).observe(root.querySelector('.msgs')!,{childList:true,subtree:true,characterData:true});
 window.addEventListener('xgoose:user-scripts-required',()=>void check());
 window.addEventListener('focus',()=>void check());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void check();});
 void check();return {check,setBuiltinSite};
}
