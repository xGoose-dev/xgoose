import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const path=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
const compile=(file:string)=>build({entryPoints:[path(file)],bundle:true,write:false,format:'iife',globalName:'module',platform:'node',tsconfig:path('../apps/chrome/tsconfig.json'),plugins:[{name:'host',setup(b){
  b.onResolve({filter:/^\.\/messages$/},()=>({path:'messages',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/host$/},()=>({path:'host',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='messages'?'export const send=(kind,payload)=>globalThis.send(kind,payload);':'export const isSafari=false;'}));
}}]});
const [backend,storage]=await Promise.all([compile('../apps/chrome/src/background/memory.ts'),compile('../apps/chrome/src/shared/storage.ts')]);
const origin='https://fixture.test',key=`xgoose.memory:${origin}`;
async function fixture(){
  const data:Record<string,unknown>={[key]:'Existing note'},listeners:any[]=[];
  let fail=false;
  const local={get:async(k:string|null)=>k?{[k]:data[k]}:{...data},set:async(patch:Record<string,unknown>)=>{
    if(fail){fail=false;throw Error('Storage failed');}
    const changes=Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,{newValue:v}]));
    Object.assign(data,patch);for(const notify of listeners)notify(changes,'local');
  },remove:async(k:string)=>{delete data[k];for(const notify of listeners)notify({[k]:{}},'local');}};
  const chrome={storage:{local,onChanged:{addListener:(f:any)=>listeners.push(f)}}};
  const worker:any={chrome,Date};vm.runInNewContext(backend.outputFiles[0].text,worker);
  let replyGate:{started:()=>void;gate:Promise<void>}|undefined;
  const page=(delayable=false)=>{const context:any={chrome,Date,send:async(kind:string,payload:any)=>{
    assert.equal(kind,'sw:memory');const result=await worker.module.memoryCommand(payload);
    if(delayable && replyGate){const held=replyGate;replyGate=undefined;held.started();await held.gate;}
    return result;
  }};vm.runInNewContext(storage.outputFiles[0].text,context);return context.module;};
  const a=page(true),b=page();await Promise.all([a.loadAll(),b.loadAll()]);
  return {a,b,read:()=>String(data[key]??''),fail:()=>{fail=true;},holdReply:()=>{
    let started!:()=>void,release!:()=>void;
    const reached=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    replyGate={started,gate};return {reached,release};
  }};
}
test('two pages concurrently appending memory preserve both successful notes',async()=>{
  const f=await fixture();await Promise.all([f.a.appendMemoryForOrigin(origin,'From A'),f.b.appendMemoryForOrigin(origin,'From B')]);
  assert.match(f.read(),/Existing note/);assert.match(f.read(),/From A/);assert.match(f.read(),/From B/);
});
test('clear is ordered with appends from other pages and does not resurrect old notes',async()=>{
  const f=await fixture();await Promise.all([f.a.appendMemoryForOrigin(origin,'Before clear'),f.b.clearMemoryForOrigin(origin),f.a.appendMemoryForOrigin(origin,'After clear')]);
  assert.match(f.read(),/After clear/);assert.doesNotMatch(f.read(),/Existing|Before clear/);
});
test('a failed write rejects without poisoning the shared writer or claiming persistence',async()=>{
  const f=await fixture();f.fail();
  const failed=assert.rejects(f.a.appendMemoryForOrigin(origin,'Lost note'),/Storage failed/);
  const next=f.b.appendMemoryForOrigin(origin,'Saved note');await failed;await next;
  assert.match(f.read(),/Existing note/);assert.match(f.read(),/Saved note/);assert.doesNotMatch(f.read(),/Lost note/);
});

test('late append and clear replies cannot overwrite newer storage events in a page mirror',async()=>{
  for(const op of ['append','clear']){
    const f=await fixture(),reply=f.holdReply();
    const older=op==='append'?f.a.appendMemoryForOrigin(origin,'From A'):f.a.clearMemoryForOrigin(origin);
    await reply.reached;await f.b.appendMemoryForOrigin(origin,'From B');
    reply.release();await older;
    assert.match(f.a.getMemoryForOrigin(origin),/From B/);
    assert.equal(f.a.getMemoryForOrigin(origin),f.read());
  }
});
