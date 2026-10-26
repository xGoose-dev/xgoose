import '../../chrome/src/page/pageBridgeEntry';
const bridge=(globalThis as any).__xgoose;
if(bridge&&!bridge.publicReaderFetch)bridge.publicReaderFetch=(url:string,{signal}:{signal?:AbortSignal}={})=>new Promise<Response>((resolve,reject)=>{
 const id=crypto.randomUUID();
 const cleanup=()=>{clearTimeout(timer);window.removeEventListener('xgoose:public-reader-response',receive);signal?.removeEventListener('abort',abort);};
 const abort=()=>{cleanup();reject(new Error('Public read cancelled'));};
 const receive=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.id!==id)return;cleanup();const reply=detail.reply;if(reply?.error){reject(new Error(reply.error));return;}resolve(new Response(reply.body,{status:reply.status,headers:reply.headers}));};
 const timer=setTimeout(()=>{cleanup();reject(new Error('Public read timed out'));},19000);
 window.addEventListener('xgoose:public-reader-response',receive);signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted){abort();return;}
 window.dispatchEvent(new CustomEvent('xgoose:public-reader',{detail:{id,url}}));
});
