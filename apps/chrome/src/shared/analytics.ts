import {hostCapabilities,isSafari} from "./host";
// Optional product telemetry through the first-party GA4 proxy. No content or credentials.
import {send} from './messages';
import {loadAll,getSettings} from './storage';
import {getAccount,XGOOSE_API_URL} from './account';
import {analyticsDevice,setActivity,takeEngagement} from './analyticsActivity';
export type TrackParams=Record<string,string|number|boolean>;
const QUEUE='xgoose.analytics.queue-v2',CLIENT='xgoose.analytics.clientId',SESSION='xgoose.analytics.session-v2';
const api:typeof chrome=(globalThis as any).browser??(globalThis as any).chrome;
const backgroundContext=typeof window==='undefined'||isSafari&&typeof location!=='undefined'&&location.protocol==='safari-web-extension:';
interface Event {name:string;at:number;ownerId?:string;device?:ReturnType<typeof analyticsDevice>;params:TrackParams}
const allowed=new Set(['platform','surface','provider','model','version','extension_version','session_id','flow_id','step','outcome','reason','error_kind','http_status','duration_ms','first_response_ms','steps','skill','count','is_fresh_convo','prompt_len','page','target','method','enabled','status','is_new','event_id','engagement_time_msec','client_id_kind']);
const safariAllowed=new Set(['platform','surface','extension_version','session_id','flow_id','step','outcome','reason','error_kind','http_status','enabled','status','is_new','event_id']);
function safeParams(params:TrackParams):TrackParams {return Object.fromEntries(Object.entries(params).filter(([key,value])=>(isSafari?safariAllowed:allowed).has(key)&&(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^[a-zA-Z0-9_./:-]{1,100}$/.test(value)&&!value.includes('://')&&!value.startsWith('sk-'))));}
let job=Promise.resolve();let timer:ReturnType<typeof setTimeout>|undefined;
const enqueue=(fn:()=>Promise<void>)=>{job=job.then(fn).catch(()=>{});};
export function track(event:string,params:TrackParams={}) {
 sendTrack(event,params,backgroundContext?0:takeEngagement());
}
function sendTrack(event:string,params:TrackParams,ms:number){
 const measured={...params,engagement_time_msec:ms};
 if(backgroundContext)recordEvent(event,measured);else void send('sw:track',{event,params:measured,device:analyticsDevice()}).catch(()=>{});
}
export function setAnalyticsActive(enabled:boolean){setActivity(enabled,ms=>sendTrack('extension_engagement',{},ms));}
export function recordEvent(event:string,params:TrackParams={},device?:ReturnType<typeof analyticsDevice>) {
 if(!/^[a-z][a-z0-9_]{0,39}$/.test(event))return;
 enqueue(async()=>{
  await loadAll();if(!getSettings().analyticsEnabled)return;
  const saved=await api.storage.local.get([QUEUE,SESSION,'xgoose.analytics.measurement-v2','xgoose.analytics.installAt']);const now=Date.now();
  let session=saved[SESSION] as {id:number;last:number}|undefined;
  if(!session||now-session.last>1800000)session={id:Math.floor(now/1000),last:now};session.last=now;
  const queue=(saved[QUEUE]??[]) as Event[];
  const account=await getAccount();
  if(!saved['xgoose.analytics.measurement-v2']){
   queue.push({name:saved['xgoose.analytics.installAt']?'extension_first_use':'analytics_measurement_started',at:now,ownerId:account?.user.id,device,params:{surface:'extension',platform:hostCapabilities.platform,extension_version:api.runtime.getManifest().version,session_id:session.id,event_id:crypto.randomUUID(),is_new:!!saved['xgoose.analytics.installAt']}});
  }
  queue.push({name:event,at:now,ownerId:account?.user.id,device,params:{...safeParams(params),platform:hostCapabilities.platform,surface:'extension',extension_version:api.runtime.getManifest().version,session_id:session.id,event_id:crypto.randomUUID()}});
  await api.storage.local.set({[QUEUE]:queue.slice(-500),[SESSION]:session,'xgoose.analytics.measurement-v2':true});
 });
 if(!timer)timer=setTimeout(()=>{timer=undefined;flush();},1500);
}
function flush(){enqueue(async()=>{
 await loadAll();if(!getSettings().analyticsEnabled){await api.storage.local.remove(QUEUE);return;}
 const saved=await api.storage.local.get([QUEUE,CLIENT]);const queue=(saved[QUEUE]??[]) as Event[];if(!queue.length)return;
 const clientId=typeof saved[CLIENT]==='string'?saved[CLIENT]:crypto.randomUUID();await api.storage.local.set({[CLIENT]:clientId});
 let account=await getAccount();const first=queue[0];
 const batch:Event[]=[];
 for(const event of queue.slice(0,25)){if(event.ownerId!==first.ownerId||JSON.stringify(event.device)!==JSON.stringify(first.device))break;batch.push(event);}
 if(account&&first.ownerId===account.user.id){
   account=await (await import('../background/account')).getFreshAccount();
   // A transient renewal failure keeps the durable queue, without relabelling
   // a signed-in user's events as anonymous or attaching a different account.
   if(!account)return;
 }
 const body=JSON.stringify({client_id:clientId,consent:true,identity_version:2,device:first.device,events:batch.map(({name,at,params})=>({name,at,params}))});
 const post=async()=>{await loadAll();if(!getSettings().analyticsEnabled)return new Response(null,{status:204});return fetch(`${XGOOSE_API_URL}/a/collect`,{method:'POST',headers:{'content-type':'application/json',...(account&&first.ownerId===account.user.id?{authorization:`Bearer ${account.accessToken}`}:{})},body,signal:AbortSignal.timeout(10000)});};
 let response=await post();
 if(response.status===401&&account&&first.ownerId===account.user.id){
   account=await (await import('../background/account')).refreshTokens(account.accessToken);
   if(!account||account.user.id!==first.ownerId)return;
   response=await post();
 }
 if(response.ok){await api.storage.local.set({[QUEUE]:queue.slice(batch.length)});if(queue.length>batch.length)setTimeout(flush,0);}
});}
if(backgroundContext&&api?.alarms){
 void api.alarms.get('xgoose-analytics-flush').then(a=>{if(!a)return api.alarms.create('xgoose-analytics-flush',{periodInMinutes:1});});
 api.alarms.onAlarm.addListener(a=>{if(a.name==='xgoose-analytics-flush')flush();});
 api.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&Object.values(changes).some(c=>(c.newValue as any)?.analyticsEnabled===false))enqueue(async()=>{await api.storage.local.remove(QUEUE);});});
 flush();
}
/** Classify locally; raw error messages never enter analytics. */
export function failureReason(error:unknown):string {
 const e=error as {message?:string;name?:string;status?:number;statusCode?:number};const text=String(e?.message??error).toLowerCase();
 if(/concurr|already running|still running/.test(text))return 'concurrency_limit';
 if(/credit|balance|trial/.test(text))return /expir/.test(text)?'trial_expired':'credit_unavailable';
 if(/429|rate|too_many/.test(text))return 'rate_limited';
 if(/user.?scripts|permission/.test(text))return 'permission';
 if(/sign.?in|401|token|authentic/.test(text))return 'authentication';
 if(/timeout|timed out/.test(text)||e?.name==='TimeoutError')return 'timeout';
 if(/network|fetch|connection/.test(text))return 'network';
 if(/digest|identity/.test(text))return 'package_validation';
 return 'other';
}
