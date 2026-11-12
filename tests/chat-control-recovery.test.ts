import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const path=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
const compile=async(file:string)=>build({entryPoints:[path(file)],bundle:true,write:false,format:'iife',globalName:'module',platform:'node',tsconfig:path('../apps/chrome/tsconfig.json'),plugins:[{name:'host',setup(b){
  b.onResolve({filter:/^(\.\/host|@\/shared\/host)$/},()=>({path:'host',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/platformBridge$/},()=>({path:'bridge',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='host'?'export const isSafari=false;':'export const prepareHost=async()=>{};'}));
}}]});
const [messages,storage]=await Promise.all([compile('../apps/chrome/src/shared/messages.ts'),compile('../apps/chrome/src/background/sessionDb.ts')]);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('chat control calls time out without replay and a later explicit call can recover',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let attempts=0,finish!:(value:unknown)=>void;
  const context:any={setTimeout,clearTimeout,DOMException,chrome:{runtime:{sendMessage:()=>{attempts++;return new Promise(resolve=>{finish=resolve;});}}}};
  vm.runInNewContext(messages.outputFiles[0].text,context);
  for(const kind of ['sw:peer','sw:session','sw:transcript_event','sw:consent_get']){
    const failed=assert.rejects(context.module.send(kind,{operation:{op:'register'}}),new RegExp(`Extension request timed out \\(${kind}\\)`));
    t.mock.timers.tick(25000);await failed;
    finish({late:true});await tick();
  }
  assert.equal(attempts,4,'uncertain requests must not be replayed');
  const retry=context.module.send('sw:session',{});finish({saved:true});
  assert.equal((await retry).saved,true);assert.equal(attempts,5);
  const tool=context.module.send('sw:page_exec',{});t.mock.timers.tick(25000);
  finish({result:'long-running tool'});assert.equal((await tool).result,'long-running tool');
  for(const op of ['spawn','send']){
    const external=context.module.send('sw:peer',{operation:{op}});t.mock.timers.tick(25000);
    finish({delivered:true});assert.equal((await external).delivered,true);
  }
});

function database(){
  const requests:any[]=[],transactions:any[]=[];let closed=0,aborts=0;
  const db={close:()=>{closed++;},transaction:()=>{
    const tx:any={abort:()=>{aborts++;queueMicrotask(()=>tx.onabort());},objectStore:()=>({get:()=>{
      const request:any={result:undefined};queueMicrotask(()=>{request.onsuccess();queueMicrotask(()=>tx.oncomplete());});return request;
    },put:()=>{}})};transactions.push(tx);return tx;
  }};
  const context:any={setTimeout,clearTimeout,crypto,indexedDB:{open:()=>{const request:any={result:db};requests.push(request);return request;}}};
  vm.runInNewContext(storage.outputFiles[0].text,context);
  return{requests,transactions,db,context,closed:()=>closed,aborts:()=>aborts,read:()=>context.module.peerTransaction(()=> 'ready')};
}

test('blocked or stalled database opens reject, retry, and close abandoned late connections',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=database();
  const blocked=assert.rejects(f.read(),/storage is blocked/);f.requests[0].onblocked();await blocked;
  const stalled=assert.rejects(f.read(),/storage did not open/);t.mock.timers.tick(8000);await stalled;
  const recovered=f.read();
  f.requests[0].onsuccess();f.requests[1].onsuccess();
  assert.equal(f.closed(),2,'abandoned opens must not leave live database connections');
  f.requests[2].onsuccess();assert.equal(await recovered,'ready');
});

test('a stalled database transaction aborts and later operations remain usable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=database();
  const first=f.read();f.requests[0].onsuccess();assert.equal(await first,'ready');
  const original=f.db.transaction;
  f.db.transaction=()=>{
    const tx=original();tx.objectStore=()=>({get:()=>({}),put:()=>{}});return tx;
  };
  const stalled=assert.rejects(f.read(),/storage timed out/);await tick();
  t.mock.timers.tick(8000);await stalled;assert.equal(f.aborts(),1);
  f.db.transaction=original;assert.equal(await f.read(),'ready');
});
