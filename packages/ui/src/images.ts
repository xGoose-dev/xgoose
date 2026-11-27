export type ImageAttachment = {name:string; data:string; mimeType:"image/jpeg"; width:number; height:number};
export const MAX_ATTACHMENTS=3;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const JPEG_PREFIX = "data:image/jpeg;base64,";

async function encodeImage(blob: Blob, maxUrlChars: number) {
  const bitmap=await createImageBitmap(blob);
  try {
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40_000_000)throw Error("Image dimensions are too large. Choose a smaller image.");
    let scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d")!;
    for(let attempt=0;attempt<5;attempt++){
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const url=canvas.toDataURL("image/jpeg",attempt===0?.85:.75);
      if(url.startsWith(JPEG_PREFIX)&&url.length<=maxUrlChars)return {url,width:canvas.width,height:canvas.height};
      scale*=.75;
    }
  } finally {bitmap.close();}
}

/** Decode locally and re-encode: bounded dimensions/bytes, no EXIF metadata. */
export async function prepareImage(file:File):Promise<ImageAttachment> {
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw Error("Choose a PNG, JPEG or WebP image.");
  if(file.size>MAX_FILE_BYTES)throw Error("Choose an image smaller than 20 MB.");
  const image=await encodeImage(file,320_000+JPEG_PREFIX.length);
  if(!image)throw Error("This image is too detailed to attach. Try a smaller crop.");
  const {url,width,height}=image;
  return {name:file.name.slice(0,150),data:url.slice(JPEG_PREFIX.length),mimeType:"image/jpeg",width,height};
}

export async function compressHostedImage(url: string, maxUrlChars: number): Promise<string | undefined> {
  const header = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(url);
  if (!header || url.length - header[0].length > Math.ceil(MAX_FILE_BYTES / 3) * 4) return;
  try {
    const bytes = Uint8Array.from(atob(url.slice(header[0].length)), character => character.charCodeAt(0));
    if (bytes.length > MAX_FILE_BYTES) return;
    const image = await encodeImage(new Blob([bytes], {type: header[1]}), maxUrlChars);
    return image?.url;
  } catch {
    // Corrupt or undecodable images become a text placeholder in the Hosted request.
    return undefined;
  }
}
export const imageDataUrl=(image:ImageAttachment)=>`data:${image.mimeType};base64,${image.data}`;
