/** Bounded NGA attachment reads. Cookies and authorization never leave the tab. */
const forums = new Set(['bbs.nga.cn','ngabbs.com','nga.178.com']);
const hosts = new Set(['img.nga.178.com','img.nga.cn','img4.nga.cn']);
const maxBytes = 5 * 1024 * 1024;
export type NgaImage = {url:string;type:'image';data:string;mimeType:'image/jpeg';width:number;height:number};
export type NgaImageResult = NgaImage | {url:string;error:string};
const base64 = (bytes:Uint8Array) => {
  let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(text);
};
export async function prepareNgaImage(bytes:Uint8Array,mimeType:string):Promise<Omit<NgaImage,'url'|'type'>> {
  const bitmap=await createImageBitmap(new Blob([bytes as BlobPart],{type:mimeType}));
  try {
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40_000_000)throw new Error('Image dimensions exceed the supported limit');
    let scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    for(let attempt=0;attempt<5;attempt++){
      const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d')!;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
      const blob=await canvas.convertToBlob({type:'image/jpeg',quality:attempt===0?.85:.75});
      if(blob.size<=240000)return {data:base64(new Uint8Array(await blob.arrayBuffer())),mimeType:'image/jpeg',width,height};
      scale*=.75;
    }
    throw new Error('Image is too detailed for the model context');
  } finally {bitmap.close();}
}
export async function readNgaImages(urls:string[],senderUrl:string,fetcher:typeof fetch=fetch,prepare=prepareNgaImage):Promise<NgaImageResult[]> {
  if(!forums.has(new URL(senderUrl).hostname))throw new Error('NGA image reads require an NGA page');
  if(!Array.isArray(urls)||urls.length>3||urls.some(u=>typeof u!=='string'))throw new Error('Choose at most three NGA images');
  return Promise.all([...new Set(urls)].map(async raw=>{
    try {
      const url=new URL(raw);
      if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.username||url.password||url.port||!url.pathname.startsWith('/attachments/'))throw new Error('Unsupported NGA attachment URL');
      const response=await fetcher(url.href,{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(`NGA image returned HTTP ${response.status}`);
      const mimeType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||'';
      if(!['image/png','image/jpeg','image/webp'].includes(mimeType))throw new Error('Expected a PNG, JPEG or WebP attachment');
      if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('NGA image exceeds 5 MB');
      const reader=response.body?.getReader();if(!reader)throw new Error('Empty NGA image response');
      const chunks:Uint8Array[]=[];let size=0;
      try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes)throw new Error('NGA image exceeds 5 MB');chunks.push(part.value);}}
      finally {await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      return {url:url.href,type:'image' as const,...await prepare(bytes,mimeType)};
    } catch(error) {return {url:raw,error:error instanceof Error?error.message:String(error)};}
  }));
}
