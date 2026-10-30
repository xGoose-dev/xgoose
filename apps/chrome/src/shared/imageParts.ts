export type PreparedImage = {type:'image';data:string;mimeType:'image/jpeg';width:number;height:number;originalWidth:number;originalHeight:number;crop?:{top:number;left:number;width:number;height:number}};
const MAX_ENCODED=240000;
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
