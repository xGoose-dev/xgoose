import {prepareImageParts} from '../shared/imageParts';
import {withDeadline} from '../shared/deadline';

type Capture = {requestId:string;tabId?:number;selector?:string;fullPage?:boolean};
const active = new Map<string,{owner:string;controller:AbortController}>();
const owner = (sender:chrome.runtime.MessageSender) => JSON.stringify([sender.tab?.id,sender.frameId,sender.documentId??sender.url]);
let captures: Promise<unknown> = Promise.resolve();

function untilStopped<T>(work:Promise<T>, signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject) => {
    const stopped = () => reject(signal.reason);
    signal.addEventListener('abort',stopped,{once:true});
    work.then(resolve,reject).finally(() => signal.removeEventListener('abort',stopped));
    if(signal.aborted) stopped();
  });
}

export function abortCapture({requestId}:{requestId:string}, sender:chrome.runtime.MessageSender) {
  const job = active.get(requestId);
  if(job?.owner===owner(sender)) job.controller.abort(new DOMException('Screenshot stopped','AbortError'));
}

export function capturePage(args:Capture, sender:chrome.runtime.MessageSender) {
  const controller = new AbortController();
  active.set(args.requestId,{owner:owner(sender),controller});
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(new DOMException('Screenshot timed out after 60000ms','TimeoutError')),60000);
  const deadline = Date.now()+60000;
  const run = captures.then(() => capture(args,sender,signal,deadline));
  // Keep cleanup serialized too, including when the caller stops waiting.
  captures = run.catch(() => {});
  return untilStopped(run,signal).finally(() => {clearTimeout(timer);active.delete(args.requestId);});
}

async function capture(args:Capture, sender:chrome.runtime.MessageSender, signal:AbortSignal, deadline:number) {
  signal.throwIfAborted();
  const wait = <T>(work:Promise<T>) => untilStopped(work,signal);
  const tabId = args.tabId ?? sender.tab!.id!;
  const tab = await wait(chrome.tabs.get(tabId));
  const [previous] = await wait(chrome.tabs.query({active:true,windowId:tab.windowId}));
  let restoreTabId = previous.id;
  const selected = (info:chrome.tabs.OnActivatedInfo) => {
    if(info.windowId===tab.windowId && info.tabId!==tabId) restoreTabId=info.tabId;
  };
  chrome.tabs.onActivated.addListener(selected);
  const stillActive = async () => {
    const [current] = await wait(chrome.tabs.query({active:true,windowId:tab.windowId}));
    if(current?.id!==tabId) throw new Error('Screenshot stopped because the active tab changed.');
  };
  let prepared = false;
  try {
    // Chrome cannot retract an activation already sent. The outer RPC settles
    // on Stop, but its serialized cleanup must wait for this side effect.
    if(previous.id!==tabId) await chrome.tabs.update(tabId,{active:true});
    signal.throwIfAborted();
    prepared = true;
    const [{result:page}] = await wait(chrome.scripting.executeScript({target:{tabId},func:(id:string,deadline:number,selector:string,fullPage:boolean) => {
      const jobs = ((globalThis as any).__xgooseCaptures ??= new Map());
      if(Date.now()>=deadline || jobs.has(id)) throw Error('Screenshot stopped before page preparation.');
      const element = selector ? document.querySelector(selector) : null;
      if(selector&&!element) throw Error('Screenshot element not found');
      const root = document.getElementById('xgoose-root');
      jobs.set(id,{deadline,saved:{x:scrollX,y:scrollY,visibility:root?.style.visibility??'',behavior:document.documentElement.style.scrollBehavior}});
      const rect = element?.getBoundingClientRect();
      document.documentElement.style.scrollBehavior='auto';
      const area = rect ? {x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height}
        : fullPage ? {x:0,y:0,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}
        : {x:scrollX,y:scrollY,width:innerWidth,height:innerHeight};
      return {area,viewport:{width:innerWidth,height:innerHeight}};
    },args:[args.requestId,deadline,args.selector??'',args.fullPage??false]}));
    const {area,viewport} = page!;
    if(area.width<=0 || area.height<=0 || Math.ceil(area.width)*Math.ceil(area.height)>40_000_000) {
      throw new Error('Screenshot dimensions exceed the image budget. Capture the viewport or a smaller element.');
    }
    const canvas = new OffscreenCanvas(Math.ceil(area.width),Math.ceil(area.height)), ctx = canvas.getContext('2d')!;
    for(let y=area.y;y<area.y+area.height;y+=viewport.height) for(let x=area.x;x<area.x+area.width;x+=viewport.width) {
      await stillActive();
      const [{result:position}] = await wait(chrome.scripting.executeScript({target:{tabId},func:async(id:string,x:number,y:number) => {
        const job = (globalThis as any).__xgooseCaptures?.get(id);
        if(!job?.saved || Date.now()>=job.deadline) throw Error('Screenshot stopped or the page changed.');
        scrollTo(x,y);
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        if((globalThis as any).__xgooseCaptures?.get(id)!==job || Date.now()>=job.deadline) throw Error('Screenshot stopped or the page changed.');
        const root = document.getElementById('xgoose-root'); if(root) root.style.visibility='hidden';
        return {x:scrollX,y:scrollY};
      },args:[args.requestId,x,y]}));
      await stillActive();
      const data = await wait(chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'}));
      await stillActive();
      await wait(chrome.scripting.executeScript({target:{tabId},func:(id:string) => {
        const saved = (globalThis as any).__xgooseCaptures?.get(id)?.saved;
        const root = document.getElementById('xgoose-root'); if(saved&&root) root.style.visibility=saved.visibility;
      },args:[args.requestId]}));
      const bitmap = await wait(createImageBitmap(await (await wait(fetch(data))).blob()));
      try {
        const w = Math.min(viewport.width,area.x+area.width-x), h = Math.min(viewport.height,area.y+area.height-y);
        const sx = bitmap.width/viewport.width, sy = bitmap.height/viewport.height;
        ctx.drawImage(bitmap,(x-position!.x)*sx,(y-position!.y)*sy,w*sx,h*sy,x-area.x,y-area.y,w,h);
      } finally {bitmap.close();}
      if(y+viewport.height<area.y+area.height || x+viewport.width<area.x+area.width) await wait(new Promise(r => setTimeout(r,550)));
    }
    const blob = await wait(canvas.convertToBlob({type:'image/png'}));
    return await wait(prepareImageParts(new Uint8Array(await wait(blob.arrayBuffer())),blob.type,3));
  } finally {
    if(prepared) {
      try {
        await withDeadline(chrome.scripting.executeScript({target:{tabId},func:(id:string,deadline:number) => {
          const jobs = ((globalThis as any).__xgooseCaptures ??= new Map()), saved = jobs.get(id)?.saved;
          // A late preparation cannot hide the panel after cancellation cleanup.
          jobs.set(id,{deadline});
          for(const [key,job] of jobs) if(job.deadline<Date.now()) jobs.delete(key);
          if(!saved) return;
          scrollTo(saved.x,saved.y); document.documentElement.style.scrollBehavior=saved.behavior;
          const root = document.getElementById('xgoose-root'); if(root) root.style.visibility=saved.visibility;
        },args:[args.requestId,deadline]}),3000,'Screenshot page cleanup timed out');
      } catch(error) {console.warn('[xgoose:screenshot] page cleanup failed',error);}
    }
    if(restoreTabId!==tabId) {
      try {
        // Respect a tab the user selected while the screenshot was running.
        const [current] = await withDeadline(chrome.tabs.query({active:true,windowId:tab.windowId}),3000,'Screenshot tab cleanup timed out');
        if(current?.id===tabId) await withDeadline(chrome.tabs.update(restoreTabId!,{active:true}),3000,'Screenshot tab restore timed out');
      } catch(error) {console.warn('[xgoose:screenshot] tab cleanup failed',error);}
    }
    chrome.tabs.onActivated.removeListener(selected);
  }
}
