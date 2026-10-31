import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {emptyPeerState,invalidatePeer,settlePeer} from '../packages/core/src/peerAgents';
import type {PeerAgent} from '../packages/core/src/peerAgents';

const path=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
const compile=async(file:string)=>build({entryPoints:[path(file)],bundle:true,write:false,format:'iife',globalName:'module',platform:'node',tsconfig:path('../apps/chrome/tsconfig.json'),plugins:[{name:'host',setup(b){
  b.onResolve({filter:/^\.\/sessionDb$/},()=>({path:'db',namespace:'fixture'}));
  b.onResolve({filter:/^@\/shared\/messages$/},()=>({path:'send',namespace:'fixture'}));
  b.onResolve({filter:/^@xgoose\/core$/},()=>({path:'tool',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='db'?'export const peerTransaction=async update=>update(globalThis.peerState);':args.path==='send'?'export const send=(kind,payload)=>globalThis.send(kind,payload);':'export const defineTool=spec=>spec;'}));
}}]});
const [background,content]=await Promise.all([compile('../apps/chrome/src/background/peers.ts'),compile('../apps/chrome/src/content/peers.ts')]);
const model={provider:'xgoose-hosted',model:'deepseek-flash',thinking:false};
const agent=(id='page',nonce='document-a'):PeerAgent=>({id,sessionId:'conversation',tabId:1,documentKey:nonce,url:'https://example.test/',title:'Page',status:'running',model,runId:'run-1'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function broker() {
  const peerState=emptyPeerState();peerState.agents.page=agent();
  let liveNonce:string|null='document-a',updated:(id:number,change:any)=>void,removed:(id:number)=>void;
  const sender={id:'extension',frameId:0,tab:{id:1},url:'https://example.test/'};
  const chrome={runtime:{id:'extension',getURL:(p:string)=>'chrome-extension://extension/'+p},tabs:{
    get:async(id:number)=>({id,url:'https://example.test/',title:'Page'}),
    sendMessage:async()=>liveNonce?{nonce:liveNonce}:null,
    onRemoved:{addListener:(f:any)=>removed=f},onUpdated:{addListener:(f:any)=>updated=f},
  }};
  const context:any={chrome,peerState,crypto,console};vm.runInNewContext(background.outputFiles[0].text,context);
  context.module.installPeerEvents();
  return {peerState,setNonce:(v:string|null)=>liveNonce=v,
    updated:async(status:string)=>{updated!(1,{status});await tick();},closed:async()=>{removed!(1);await tick();},
    call:(operation:any,nonce='document-a',agentId='page')=>context.module.peerCommand({nonce,agentId,operation},sender)};
}

test('a same-document loading/complete cycle preserves its running peer',async()=>{
  const f=broker();await f.updated('loading');assert.equal(f.peerState.agents.page.status,'running');
  await f.updated('complete');assert.equal(f.peerState.agents.page.status,'running');
  const result=await f.call({op:'list'});assert.equal(result.agents[0].id,'page');
});
test('completion from an older tab load cannot invalidate a newly registered document',async()=>{
  const f=broker();await f.updated('loading');f.setNonce('document-b');
  const result=await f.call({op:'register',sessionId:'next-conversation',model},'document-b');
  assert.notEqual(result.agent.id,'page');assert.equal(f.peerState.agents.page.status,'unavailable');
  await f.updated('complete');assert.equal(f.peerState.agents[result.agent.id].status,'idle');
});
test('a replaced document or closed tab still invalidates the old peer',async()=>{
  const f=broker();await f.updated('loading');f.setNonce(null);await f.updated('complete');
  assert.equal(f.peerState.agents.page.status,'unavailable');
  await assert.rejects(f.call({op:'list'}),/Peer page is no longer available/);
  const closed=broker();await closed.closed();assert.equal(closed.peerState.agents.page.status,'unavailable');
});
test('late stop and settle acknowledge invalidation without reviving the peer or accepting another document',async()=>{
  const f=broker();await f.closed();
  assert.equal((await f.call({op:'settle',runId:'run-1',outcome:'completed',text:'late'})).ignored,true);
  assert.equal((await f.call({op:'stop'})).ignored,true);
  assert.equal(f.peerState.agents.page.status,'unavailable');
  await assert.rejects(f.call({op:'settle',runId:'run-1',outcome:'completed',text:'wrong document'},'document-other'),/identity does not match/);
});
test('a late task settlement preserves the unavailable outcome and sends no duplicate result',()=>{
  const state=emptyPeerState();state.agents.page=agent();state.agents.requester={...agent('requester'),tabId:2};
  state.tasks.task={id:'task',requesterId:'requester',agentId:'page',status:'running'};state.agents.page.activeTaskId='task';
  invalidatePeer(state,'page','Navigated');const messages=state.messages.length;
  settlePeer(state,'page','run-1','completed','Late result');settlePeer(state,'absent','run-1','completed','Late result');
  assert.equal(state.tasks.task.status,'unavailable');assert.equal(state.tasks.task.result,'Navigated');assert.equal(state.messages.length,messages);
});

function page() {
  const calls:any[]=[],statuses:string[]=[],locks:number[]=[];let ignored=false,failStop=false;
  const fresh=agent('fresh');fresh.status='idle';
  const context:any={crypto,console,location:{href:'https://example.test/'},chrome:{runtime:{getURL:(p:string)=>'chrome-extension://extension/'+p,onMessage:{addListener(){}}}},
    send:async(_kind:string,{operation}:any)=>{
      calls.push(operation);
      if(operation.op==='register')return{agent:{...fresh}};
      if(operation.op==='begin')return{agent:{...fresh,status:'running',runId:operation.runId}};
      if(operation.op==='stop'&&failStop)throw Error('Background unavailable');
      if(operation.op==='settle')return ignored?{ignored:true}:{};
      return{message:null};
    }};
  vm.runInNewContext(content.outputFiles[0].text,context);
  const peers=new context.module.PagePeers({sessionId:()=>'conversation',model:()=>model,busy:()=>false,lock:()=>locks.push(1),unlock:()=>locks.push(-1),receive:async()=>{},status:(s:string)=>statuses.push(s)});
  return {peers,calls,statuses,locks,ignore:()=>ignored=true,failStop:()=>failStop=true};
}
test('starting a new user run refreshes a cached page identity before begin',async()=>{
  const f=page();f.peers.agent=agent('stale');await f.peers.begin('next-run');
  assert.deepEqual(f.calls.map(c=>c.op),['register','begin']);assert.equal(f.peers.agent.id,'fresh');assert.equal(f.peers.agent.runId,'next-run');
});
test('an idle inbox pull refreshes identity and unlocks even without a peer message',async()=>{
  const f=page();f.peers.agent=agent('stale');f.peers.kick();await tick();
  assert.deepEqual(f.calls.map(c=>c.op),['register','take']);assert.deepEqual(f.locks,[1,-1]);
});
test('ignored cleanup clears waiting/run state and conversation reset clears stale identity even on failure',async()=>{
  const f=page();await f.peers.begin('one');f.peers.waiting=true;f.ignore();await f.peers.finish('completed','late');
  assert.equal(f.peers.agent,undefined);assert.equal(f.peers.waiting,false);assert.deepEqual(f.statuses,[]);
  const count=f.calls.length;await f.peers.finish('completed','duplicate');assert.equal(f.calls.length,count);
  const reset=page();reset.peers.agent=agent('stale');reset.failStop();await assert.rejects(reset.peers.reset(),/Background unavailable/);assert.equal(reset.peers.agent,undefined);
});
