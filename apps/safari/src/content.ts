import '../../chrome/src/content/index';
import {send} from '../../chrome/src/shared/messages';
const scope=globalThis as typeof globalThis & {__xgoosePublicReaderInstalled?:boolean};
if(!scope.__xgoosePublicReaderInstalled){scope.__xgoosePublicReaderInstalled=true;
 window.addEventListener('xgoose:public-reader',async(event:Event)=>{
  const detail=(event as CustomEvent).detail;
  if(typeof detail?.id!=='string'||detail.id.length>100||typeof detail.url!=='string'||detail.url.length>4096)return;
  let reply:unknown;
  try{reply=await send('sw:public_read',{url:detail.url});}catch(error){reply={error:error instanceof Error?error.message:'Public read failed'};}
  window.dispatchEvent(new CustomEvent('xgoose:public-reader-response',{detail:{id:detail.id,reply}}));
 });
}
