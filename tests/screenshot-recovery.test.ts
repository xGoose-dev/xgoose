import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const path=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
const compile=async(file:string)=>build({entryPoints:[path(file)],bundle:true,write:false,format:'iife',globalName:'module',platform:'node',tsconfig:path('../apps/chrome/tsconfig.json'),plugins:[{name:'transport',setup(b){
  b.onResolve({filter:/(?:^|\/)imageParts$/},()=>({path:'images',namespace:'fixture'}));
  b.onResolve({filter:/^@\/shared\/messages$/},()=>({path:'messages',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='images'?'export const prepareImageParts=async()=>[{type:"image",data:"pixels"}];':'export const send=(...args)=>globalThis.send(...args);'}));
}}]});
const [background,content]=await Promise.all([compile('../apps/chrome/src/background/pageScreenshot.ts'),compile('../apps/chrome/src/content/hostPorts/capturePort.ts')]);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sender={tab:{id:1},frameId:0,documentId:'document-one',url:'https://fixture.test/'};

function fixture({holdFrames=false,initialTab=1,height=600,afterScroll=()=>{},activate=async(_id:number)=>{}}={}) {
  let selected=initialTab,captured=0,allocated=0;
  const selectionListeners=new Set<(info:{tabId:number;windowId:number})=>void>();
  const select=(id:number)=>{selected=id;for(const listener of selectionListeners)listener({tabId:id,windowId:7});};
  const root={style:{visibility:'visible'}},style={scrollBehavior:'smooth'};
  const page:any={console,Date,Map,scrollX:10,scrollY:20,innerWidth:800,innerHeight:600,
    document:{getElementById:()=>root,querySelector:()=>null,documentElement:{style,scrollWidth:800,scrollHeight:height}},
    scrollTo:(x:number,y:number)=>{page.scrollX=x;page.scrollY=y;},
    requestAnimationFrame:(fn:()=>void)=>{afterScroll();if(!holdFrames)queueMicrotask(fn);return 1;},
  };
  vm.createContext(page);
  const chrome={tabs:{get:async(id:number)=>({id,windowId:7}),query:async()=>[{id:selected}],update:async(id:number)=>{await activate(id);select(id);return{id};},
    onActivated:{addListener:(fn:any)=>selectionListeners.add(fn),removeListener:(fn:any)=>selectionListeners.delete(fn)},
    captureVisibleTab:async()=>{captured++;return'data:image/png;base64,fixture';}},
    scripting:{executeScript:async({func,args}:any)=>[{documentId:'document-one',result:await vm.runInContext(`(${func.toString()})(...${JSON.stringify(args)})`,page)}]},
  };
  const context:any={chrome,AbortController,DOMException,Date,console,setTimeout,clearTimeout,
    fetch:async()=>new Response(new Blob(['pixels'])),
    createImageBitmap:async()=>({width:800,height:600,close(){}}),
    OffscreenCanvas:class {constructor(){allocated++;}getContext(){return{drawImage(){}};}async convertToBlob(){return new Blob(['pixels']);}},
  };
  vm.runInNewContext(background.outputFiles[0].text,context);
  return {capture:(requestId:string,args={})=>context.module.capturePage({requestId,...args},sender),
    abort:(requestId:string,from:any=sender)=>context.module.abortCapture({requestId},from),
    root,style,page,selected:()=>selected,select,captured:()=>captured,allocated:()=>allocated};
}

test('screenshots restore page state and the previous tab after a successful capture',async()=>{
  const f=fixture({initialTab:2});
  const result=await f.capture('success');
  assert.equal(result[0].data,'pixels');assert.equal(f.captured(),1);
  assert.equal(f.root.style.visibility,'visible');assert.equal(f.style.scrollBehavior,'smooth');
  assert.equal(f.page.scrollX,10);assert.equal(f.page.scrollY,20);assert.equal(f.selected(),2);
});

test('Stop cancels a frozen screenshot, restores the panel, and releases queued captures',async()=>{
  const f=fixture({holdFrames:true});
  const stalled=f.capture('stalled');const rejected=assert.rejects(stalled,/Screenshot stopped/);
  await tick();assert.equal(f.root.style.visibility,'visible');
  // Another document cannot cancel this page's request.
  f.abort('stalled',{...sender,documentId:'other-document'});await tick();
  assert.equal(f.root.style.visibility,'visible');
  const queued=f.capture('queued');const cancelled=assert.rejects(queued,/Screenshot stopped/);
  f.abort('queued');f.abort('stalled');await Promise.all([rejected,cancelled]);await tick();
  assert.equal(f.root.style.visibility,'visible');assert.equal(f.style.scrollBehavior,'smooth');assert.equal(f.captured(),0);
});

test('the worker deadline settles a frozen frame wait and permits the next screenshot',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture({holdFrames:true});
  const rejected=assert.rejects(f.capture('timeout'),/Screenshot timed out/);
  await tick();t.mock.timers.tick(60000);await rejected;await tick();
  assert.equal(f.root.style.visibility,'visible');assert.equal(f.style.scrollBehavior,'smooth');
  const next=assert.rejects(f.capture('next'),/Screenshot stopped/);await tick();f.abort('next');await next;
});

test('a user tab switch discards the capture without photographing or reselecting another tab',async()=>{
  let f:ReturnType<typeof fixture>;
  f=fixture({initialTab:2,afterScroll:()=>f.select(3)});
  await assert.rejects(f.capture('switch'),/active tab changed/);
  assert.equal(f.captured(),0);assert.equal(f.selected(),3);assert.equal(f.root.style.visibility,'visible');
});
test('a cancelled pending activation restores the latest user selection before another capture can run',async()=>{
  let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const f=fixture({initialTab:2,activate:async id=>{if(id===1){entered();await pending;}}});
  const rejected=assert.rejects(f.capture('pending-activation'),/Screenshot stopped/);
  await started;f.select(3);f.abort('pending-activation');await rejected;
  assert.equal(f.selected(),3);release();await tick();
  assert.equal(f.selected(),3);assert.equal(f.captured(),0);
  await f.capture('healthy');assert.equal(f.captured(),1);assert.equal(f.selected(),3);
});

test('an oversized page fails before allocating a giant canvas and restores its panel',async()=>{
  const f=fixture({height:100000});
  await assert.rejects(f.capture('oversized',{fullPage:true}),/dimensions exceed/);
  assert.equal(f.allocated(),0);assert.equal(f.captured(),0);assert.equal(f.root.style.visibility,'visible');
});

test('the content transport forwards Stop once and ignores a late image reply',async()=>{
  const calls:any[]=[];let release!:(value:unknown)=>void;
  const context:any={crypto,console,send:(kind:string,args:any)=>{
    calls.push({kind,args});return kind==='sw:capture_page'?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  }};
  vm.runInNewContext(content.outputFiles[0].text,context);
  const stopped=new AbortController();stopped.abort();
  await assert.rejects(context.module.capturePageImages({},stopped.signal));assert.equal(calls.length,0);
  const ac=new AbortController(),request=context.module.capturePageImages({fullPage:true},ac.signal);
  const rejected=assert.rejects(request,{name:'AbortError'});ac.abort();await rejected;
  assert.deepEqual(calls.map(c=>c.kind),['sw:capture_page','sw:capture_abort']);
  assert.equal(calls[0].args.requestId,calls[1].args.requestId);
  release([{data:'late pixels'}]);await tick();assert.equal(calls.length,2);
});
