import {prepareImageParts} from '../shared/imageParts';

type Capture = {tabId?:number;selector?:string;fullPage?:boolean};
let captures: Promise<unknown> = Promise.resolve();
export function capturePage(args: Capture, sender: chrome.runtime.MessageSender) {
  const run = captures.catch(() => {}).then(() => capture(args, sender));
  captures = run;
  return run;
}
async function capture(args: Capture, sender: chrome.runtime.MessageSender) {
  const tabId = args.tabId ?? sender.tab!.id!;
  const tab = await chrome.tabs.get(tabId);
  const [previous] = await chrome.tabs.query({active:true,windowId:tab.windowId});
  if (previous.id !== tabId) await chrome.tabs.update(tabId,{active:true});
  let state: {x:number;y:number;visibility:string;behavior:string}|undefined;
  try {
    const [{result:page}] = await chrome.scripting.executeScript({target:{tabId},func:(selector?:string,fullPage?:boolean)=>{
      const root=document.getElementById('xgoose-root');
      const saved={x:scrollX,y:scrollY,visibility:root?.style.visibility??'',behavior:document.documentElement.style.scrollBehavior};
      const element=selector?document.querySelector(selector):null;
      if(selector&&!element)throw Error('Screenshot element not found');
      const rect=element?.getBoundingClientRect();
      if(root)root.style.visibility='hidden';
      document.documentElement.style.scrollBehavior='auto';
      const area=rect?{x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height}:fullPage?{x:0,y:0,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}:{x:scrollX,y:scrollY,width:innerWidth,height:innerHeight};
      return {saved,area,viewport:{width:innerWidth,height:innerHeight}};
    },args:[args.selector ?? "",args.fullPage ?? false]});
    state=page!.saved;
    const {area,viewport}=page!;
    const canvas=new OffscreenCanvas(Math.ceil(area.width),Math.ceil(area.height)),ctx=canvas.getContext('2d')!;
    for(let y=area.y;y<area.y+area.height;y+=viewport.height)for(let x=area.x;x<area.x+area.width;x+=viewport.width){
      const [{result:position}]=await chrome.scripting.executeScript({target:{tabId},func:async(x:number,y:number)=>{
        scrollTo(x,y);await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
        return {x:scrollX,y:scrollY};
      },args:[x,y]});
      const data=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
      const bitmap=await createImageBitmap(await(await fetch(data)).blob());
      try {
        const w=Math.min(viewport.width,area.x+area.width-x),h=Math.min(viewport.height,area.y+area.height-y);
        const sx=bitmap.width/viewport.width,sy=bitmap.height/viewport.height;
        ctx.drawImage(bitmap,(x-position!.x)*sx,(y-position!.y)*sy,w*sx,h*sy,x-area.x,y-area.y,w,h);
      } finally {bitmap.close();}
      if(y+viewport.height<area.y+area.height||x+viewport.width<area.x+area.width)await new Promise(r=>setTimeout(r,550));
    }
    const blob=await canvas.convertToBlob({type:'image/png'});
    return prepareImageParts(new Uint8Array(await blob.arrayBuffer()),blob.type,3);
  } finally {
    if(state)await chrome.scripting.executeScript({target:{tabId},func:(saved)=>{
      scrollTo(saved.x,saved.y);document.documentElement.style.scrollBehavior=saved.behavior;
      const root=document.getElementById('xgoose-root');if(root)root.style.visibility=saved.visibility;
    },args:[state]});
    if(previous.id!==tabId)await chrome.tabs.update(previous.id!,{active:true});
  }
}
