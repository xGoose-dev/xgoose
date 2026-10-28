/** Shared image transport for tools and skills. No page CORS or cookies are involved. */
export type PreparedImage = {type:'image';data:string;mimeType:'image/jpeg';width:number;height:number;originalWidth:number;originalHeight:number;crop?:{top:number;left:number;width:number;height:number}};
export type ImageReadResult = {url:string;images:PreparedImage[]}|{url:string;error:string};
const MAX_BYTES=10*1024*1024, MAX_ENCODED=240000;
const cache=new Map<string,{until:number;value:ImageReadResult}>();
const inFlight=new Map<string,Promise<ImageReadResult>>();
let tail:Promise<unknown>=Promise.resolve(),last=0,blockedUntil=0,queued=0;
const times:number[]=[];
const encode=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
export async function prepareImageParts(bytes:Uint8Array,mime:string,budget=3):Promise<PreparedImage[]> {
 const bitmap=await createImageBitmap(new Blob([bytes as BlobPart],{type:mime}));
 try{
  const {width,height}=bitmap;if(!width||!height||width*height>40_000_000)throw Error('Image dimensions exceed 40 megapixels');
  const count=height>width*1.8?Math.min(budget,Math.ceil(height/(width*1.2))):1;
  const images:PreparedImage[]=[];
  for(let i=0;i<count;i++){
   const top=Math.floor(i*height/count),bottom=Math.floor((i+1)*height/count),cropHeight=bottom-top;
   let scale=Math.min(1,2048/Math.max(width,cropHeight));let prepared:PreparedImage|undefined;
   for(let attempt=0;attempt<8;attempt++){
    const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(cropHeight*scale));
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(bitmap,0,top,width,cropHeight,0,0,w,h);
    const blob=await canvas.convertToBlob({type:'image/jpeg',quality:Math.max(.46,.85-attempt*.13)});
    if(blob.size<=MAX_ENCODED){prepared={type:'image',data:encode(new Uint8Array(await blob.arrayBuffer())),mimeType:'image/jpeg',width:w,height:h,originalWidth:width,originalHeight:height,...(count>1?{crop:{top,left:0,width,height:cropHeight}}:{})};break;}
    if(attempt>=3)scale*=.75;
   }
   if(!prepared)throw Error('Image could not fit the model image budget');images.push(prepared);
  }
  return images;
 }finally{bitmap.close();}
}
export async function readImages(urls:string[],fetcher:typeof fetch=fetch,prepare=prepareImageParts):Promise<ImageReadResult[]> {
 if(!Array.isArray(urls)||!urls.length||urls.length>3||urls.some(u=>typeof u!=='string'))throw Error('Choose one to three image URLs');
 const unique=[...new Set(urls)],budget=Math.max(1,Math.floor(3/unique.length));
 return Promise.all(unique.map(async raw=>{
  try{
   const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('Expected an HTTPS image URL');
   const key=`${u.href}|${budget}`,existing=cache.get(key);if(existing&&existing.until>Date.now())return existing.value;
   const running=inFlight.get(key);if(running)return running;
   if(queued>=20)throw Error('Image request queue is full');queued++;
   const operation=tail.catch(()=>{}).then(async():Promise<ImageReadResult>=>{
    const now=Date.now();while(times.length&&times[0]<=now-3600000)times.shift();
    if(blockedUntil>now||times.filter(t=>t>now-60000).length>=60||times.length>=600)throw Error('Image rate limit; wait before requesting more');
    const delay=Math.max(0,last+250-now);if(delay)await new Promise(r=>setTimeout(r,delay));last=Date.now();times.push(last);
    const response=await fetcher(u.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.status===429){const h=response.headers.get('retry-after')||'',seconds=Number(h);blockedUntil=Date.now()+Math.max(60000,Number.isFinite(seconds)?seconds*1000:Date.parse(h)-Date.now()||0);}
    if(!response.ok)throw Error(`Image returned HTTP ${response.status}`);
    const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||'';
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(mime))throw Error('Expected a JPEG, PNG, WebP or GIF image');
    if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Image exceeds 10 MB');
    const reader=response.body?.getReader();if(!reader)throw Error('Empty image response');const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_BYTES)throw Error('Image exceeds 10 MB');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const value:ImageReadResult={url:raw,images:await prepare(bytes,mime,budget)};
    cache.delete(key);cache.set(key,{until:Date.now()+300000,value});while(cache.size>8)cache.delete(cache.keys().next().value!);return value;
   }).catch(error=>({url:raw,error:error instanceof Error?error.message:String(error)}));
   tail=operation;inFlight.set(key,operation);try{return await operation;}finally{queued--;inFlight.delete(key);}
  }catch(error){return {url:raw,error:error instanceof Error?error.message:String(error)};}
 }));
}
