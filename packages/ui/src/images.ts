export type ImageAttachment = {name:string; data:string; mimeType:"image/jpeg"; width:number; height:number};
export const MAX_ATTACHMENTS=3;
/** Decode locally and re-encode: bounded dimensions/bytes, no EXIF metadata. */
export async function prepareImage(file:File):Promise<ImageAttachment> {
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw Error("Choose a PNG, JPEG or WebP image.");
  if(file.size>20*1024*1024)throw Error("Choose an image smaller than 20 MB.");
  const bitmap=await createImageBitmap(file);
  try {
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40_000_000)throw Error("Image dimensions are too large. Choose a smaller image.");
    let scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d")!;
    for(let attempt=0;attempt<5;attempt++){
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const url=canvas.toDataURL("image/jpeg",attempt===0?.85:.75),data=url.split(",")[1];
      if(data.length<=320000)return {name:file.name.slice(0,150),data,mimeType:"image/jpeg",width:canvas.width,height:canvas.height};
      scale*=.75;
    }
    throw Error("This image is too detailed to attach. Try a smaller crop.");
  } finally {bitmap.close();}
}
export const imageDataUrl=(image:ImageAttachment)=>`data:${image.mimeType};base64,${image.data}`;
