import {createEngagementClock} from './engagementClock';
const clock=createEngagementClock();
let initialized=false,active=false;
export function analyticsDevice(){
  if(typeof window==='undefined')return undefined;
  const language=navigator.language;
  const width=window.screen?.width,height=window.screen?.height;
  return {
    ...(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(language)?{language}:{}),
    ...(width>=100&&height>=100&&width<=32768&&height<=32768?{screen_resolution:`${width}x${height}`}:{})
  };
}
export const takeEngagement=()=>clock.take(performance.now());
export function setActivity(enabled:boolean,emit:(ms:number)=>void){
  if(typeof document==='undefined')return;
  if(!initialized){
    initialized=true;
    const visible=()=>!document.hidden&&document.hasFocus();
    clock.visible(visible(),performance.now());
    const flush=()=>{const ms=takeEngagement();if(ms>0)emit(ms);};
    const visibility=()=>{flush();clock.visible(visible(),performance.now());};
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('focus',visibility);
    window.addEventListener('blur',visibility);
    window.addEventListener('pagehide',()=>{flush();clock.visible(false,performance.now());});
    for(const event of ['pointerdown','keydown','wheel'])document.addEventListener(event,()=>{if(active)clock.interact(performance.now());},{passive:true,capture:true});
    window.setInterval(flush,15000);
  }
  active=enabled;clock.enabled(enabled,performance.now());
}
