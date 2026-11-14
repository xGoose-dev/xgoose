import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {emptyPeerState,invalidatePeer,settlePeer,queuePeerTask} from '../packages/core/src/peerAgents';
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
function broker(incognito: boolean | ((id:number)=>boolean)=false, alarms=new Map<string,any>(),peerState=emptyPeerState()) {
  peerState.agents.page??=agent();
  let liveNonce:string|null='document-a',updated:(id:number,change:any)=>void,removed:(id:number)=>void,alarm:(value:{name:string})=>void;
  const sender={id:'extension',frameId:0,tab:{id:1},url:'https://example.test/'};
  const chrome={runtime:{id:'extension',getURL:(p:string)=>'chrome-extension://extension/'+p},alarms:{get:async(name:string)=>alarms.get(name),create:(name:string,{periodInMinutes}:any)=>{alarms.set(name,{name,scheduledTime:Date.now()+periodInMinutes*60000});},onAlarm:{addListener:(f:any)=>alarm=f}},tabs:{
    get:async(id:number)=>({id,url:'https://example.test/',title:'Page',incognito:typeof incognito==='function'?incognito(id):incognito}),
    query:async()=>[1,2].map(id=>({id,url:'https://example.test/',title:'Page',incognito:typeof incognito==='function'?incognito(id):incognito})),
    sendMessage:async(id:number)=>id===2?{nonce:'document-b'}:liveNonce?{nonce:liveNonce}:null,
    onRemoved:{addListener:(f:any)=>removed=f},onUpdated:{addListener:(f:any)=>updated=f},
  }};
  const context:any={chrome,peerState,crypto,console,DOMException,Date,setTimeout,clearTimeout};vm.runInNewContext(background.outputFiles[0].text,context);
  context.module.installPeerEvents();
  return {peerState,setNonce:(v:string|null)=>liveNonce=v,
    probe:(fn:typeof chrome.tabs.sendMessage)=>{chrome.tabs.sendMessage=fn;},
    updated:async(status:string)=>{updated!(1,{status});await tick();},closed:async()=>{removed!(1);await tick();},
    startupAlarm:async()=>{alarm!({name:'xgoose-peer-startup'});await tick();},
    call:(operation:any,nonce='document-a',agentId='page')=>context.module.peerCommand({nonce,agentId,operation},{...sender,tab:{id:peerState.agents[agentId]?.tabId??1}})};
}

test('a private page can register, run a chat, appear in tabs, and receive a peer task',async()=>{
  const f=broker(true);
  const registered=await f.call({op:'register',sessionId:'conversation',model});
  assert.equal(registered.agent.id,'page');
  await f.call({op:'begin',runId:'private-chat',model});
  assert.equal(f.peerState.agents.page.status,'running');
  await f.call({op:'settle',runId:'private-chat',outcome:'completed',text:'Chat response'});
  assert.equal(f.peerState.agents.page.status,'idle');
  assert.equal((await f.call({op:'tabs'})).tabs[0].tabId,1);
  f.peerState.agents.other={...agent('other','document-b'),tabId:2,status:'idle'};
  const assigned=await f.call({op:'spawn',tabId:2,requestId:'private-task',task:'Read this page'});
  assert.equal(assigned.agent.id,'other');
  assert.equal((await f.call({op:'take'},'document-b','other')).message.text,'Read this page');
});

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
test('a first complete probe can miss document_idle injection without losing the pending task',async()=>{
  const f=broker();f.peerState.agents.page.documentKey=null;f.peerState.agents.page.status='idle';
  f.peerState.agents.other={...agent('other','document-b'),tabId:2};
  queuePeerTask(f.peerState,'startup-task','other','page','Read the new page');
  f.setNonce(null);await f.updated('loading');await f.updated('complete');
  assert.equal(f.peerState.tasks['startup-task'].status,'queued');
  f.setNonce('document-a');const registered=await f.call({op:'register',sessionId:'conversation',model});
  assert.equal(registered.agent.id,'page');
  assert.equal((await f.call({op:'take'})).message.taskId,'startup-task');
});
test('startup expiry wakes the requester once, including after a missed page load event',async()=>{
  const f=broker();f.peerState.agents.page.documentKey=null;f.peerState.agents.page.status='idle';
  f.peerState.agents.other={...agent('other','document-b'),tabId:2};
  queuePeerTask(f.peerState,'startup-task','other','page','Read the new page');
  f.peerState.messages[0].sentAt=Date.now()-60001;
  await f.startupAlarm();await f.startupAlarm();
  assert.equal(f.peerState.tasks['startup-task'].status,'unavailable');
  assert.equal(f.peerState.messages.filter(m=>m.kind==='result').length,1);
  const result=await f.call({op:'wait',agentIds:['page']},'document-b','other');
  assert.equal(result.waiting,false);assert.match(result.messages[0].text,/did not start xgoose/);
});
test('worker restarts retain the scheduled startup alarm and expired tasks can still settle',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000000});
  const alarms=new Map<string,any>();let f=broker(false,alarms);
  f.peerState.agents.page.documentKey=null;f.peerState.agents.page.status='idle';
  f.peerState.agents.other={...agent('other','document-b'),tabId:2};
  queuePeerTask(f.peerState,'startup-task','other','page','Read the new page');await tick();
  const due=alarms.get('xgoose-peer-startup').scheduledTime;
  for(let i=0;i<6;i++){
    t.mock.timers.tick(45000);f=broker(false,alarms,f.peerState);await tick();
    assert.equal(alarms.get('xgoose-peer-startup').scheduledTime,due);
  }
  await f.startupAlarm();assert.equal(f.peerState.tasks['startup-task'].status,'unavailable');
});
test('startup checks preserve a page still registering and a registered long-running task',async()=>{
  const f=broker();f.peerState.agents.page.documentKey=null;f.peerState.agents.page.status='idle';
  f.peerState.agents.other={...agent('other','document-b'),tabId:2};
  queuePeerTask(f.peerState,'startup-task','other','page','Read the new page');
  await f.updated('loading');await f.updated('complete');await f.startupAlarm();
  assert.equal(f.peerState.tasks['startup-task'].status,'queued');
  await f.call({op:'register',sessionId:'conversation',model});
  f.peerState.messages[0].sentAt=Date.now()-60001;
  await f.startupAlarm();assert.equal(f.peerState.tasks['startup-task'].status,'queued');
});
test('a page registering after startup expiry gets a fresh identity and can begin a new chat',async()=>{
  const f=broker();f.peerState.agents.page.documentKey=null;f.peerState.agents.page.status='idle';
  f.peerState.agents.other={...agent('other','document-b'),tabId:2};
  queuePeerTask(f.peerState,'expired-task','other','page','Read the new page');
  f.peerState.messages[0].sentAt=Date.now()-60001;await f.startupAlarm();
  const result=await f.call({op:'register',requestedId:'page',sessionId:'fresh-chat',model});
  assert.notEqual(result.agent.id,'page');assert.equal(result.agent.status,'idle');
  await f.call({op:'begin',runId:'fresh-run',model},'document-a',result.agent.id);
  assert.equal(f.peerState.agents[result.agent.id].status,'running');
  assert.equal(f.peerState.tasks['expired-task'].status,'unavailable');
  assert.equal(f.peerState.messages.filter(m=>m.kind==='result').length,1);
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

function page(register?:()=>Promise<unknown>) {
  const calls:any[]=[],statuses:string[]=[],locks:number[]=[];let ignored=false,failStop=false;
  let busy=false;
  const fresh=agent('fresh');fresh.status='idle';
  const context:any={crypto,console,URL,location:{href:'https://example.test/'},chrome:{runtime:{getURL:(p:string)=>'chrome-extension://extension/'+p,onMessage:{addListener(){}}}},
    send:async(_kind:string,{operation}:any)=>{
      calls.push(operation);
      if(operation.op==='register')return register?await register():{agent:{...fresh}};
      if(operation.op==='begin')return{agent:{...fresh,status:'running',runId:operation.runId}};
      if(operation.op==='wait')return{waiting:true,agents:[{...fresh,url:'https://www.flyertalk.com/forum/',title:'FlyerTalk'}]};
      if(operation.op==='stop'&&failStop)throw Error('Background unavailable');
      if(operation.op==='settle')return ignored?{ignored:true}:{};
      return{message:null};
    }};
  vm.runInNewContext(content.outputFiles[0].text,context);
  const peers=new context.module.PagePeers({sessionId:()=>'conversation',model:()=>model,busy:()=>busy,lock:()=>locks.push(1),unlock:()=>locks.push(-1),receive:async()=>{},status:(s:string)=>statuses.push(s)});
  return {peers,calls,statuses,locks,setBusy:(value:boolean)=>{busy=value;},ignore:()=>ignored=true,failStop:()=>failStop=true};
}
test('starting a new user run refreshes a cached page identity before begin',async()=>{
  const f=page();f.peers.agent=agent('stale');await f.peers.begin('next-run');
  assert.deepEqual(f.calls.map(c=>c.op),['register','begin']);assert.equal(f.peers.agent.id,'fresh');assert.equal(f.peers.agent.runId,'next-run');
});
test('an idle inbox pull refreshes identity and unlocks even without a peer message',async()=>{
  const f=page();f.peers.agent=agent('stale');f.peers.kick();await tick();
  assert.deepEqual(f.calls.map(c=>c.op),['register','take']);assert.deepEqual(f.locks,[1,-1]);
});
test('pending housekeeping does not reserve the user queue or unlock a user turn that started meanwhile',async()=>{
  let finish!:(value:unknown)=>void;
  const f=page(()=>new Promise(resolve=>{finish=resolve;}));
  f.peers.kick();await tick();
  assert.deepEqual(f.locks,[]);
  f.setBusy(true);finish({agent:agent()});await tick();
  assert.deepEqual(f.locks,[]);
  assert.deepEqual(f.calls.map(c=>c.op),['register']);
});
test('a failed housekeeping registration leaves the user queue unlocked and can be retried',async()=>{
  let attempts=0;
  const f=page(async()=>{if(++attempts===1)throw Error('Worker timed out');return{agent:agent()};});
  f.peers.kick();await tick();
  assert.deepEqual(f.locks,[]);assert.match(f.statuses.at(-1)!,/Worker timed out/);
  f.peers.kick();await tick();assert.deepEqual(f.locks,[1,-1]);
});

test('an unresponsive tab releases the shared broker so another tab can run',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=broker();f.peerState.agents.other={...agent('other','document-b'),tabId:2};
  f.probe(async()=>await new Promise(()=>{}));
  const blocked=assert.rejects(f.call({op:'register',sessionId:'conversation',model}),/Peer tab 1 did not respond/);
  const other=f.call({op:'begin',runId:'other-run',model},'document-b','other');
  await tick();t.mock.timers.tick(3000);await blocked;await other;
  assert.equal(f.peerState.agents.other.runId,'other-run');
});
test('a timed-out navigation probe preserves a running peer and does not stall later requests',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=broker();f.probe(async()=>await new Promise(()=>{}));
  await f.updated('loading');await f.updated('complete');
  const pending=f.call({op:'list'});
  t.mock.timers.tick(3000);await pending;
  assert.equal(f.peerState.agents.page.status,'running');
});
test('ignored cleanup clears waiting/run state and conversation reset clears stale identity even on failure',async()=>{
  const f=page();await f.peers.begin('one');f.peers.waiting=true;f.ignore();await f.peers.finish('completed','late');
  assert.equal(f.peers.agent,undefined);assert.equal(f.peers.waiting,false);assert.deepEqual(f.statuses,[]);
  const count=f.calls.length;await f.peers.finish('completed','duplicate');assert.equal(f.calls.length,count);
  const reset=page();reset.peers.agent=agent('stale');reset.failStop();await assert.rejects(reset.peers.reset(),/Background unavailable/);assert.equal(reset.peers.agent,undefined);
});

test('waiting yields immediately with a named destination, and stop or failure ends the wait',async()=>{
  const f=page();await f.peers.begin('waiting-run');
  const wait=f.peers.tools().find((tool:any)=>tool.name==='wait_agents');
  const result=await wait.execute({agentIds:['flyertalk']});
  assert.equal(result.waiting,true);assert.equal(f.peers.waiting,true);
  assert.match(f.peers.waitingLabel,/flyertalk.com/);
  await f.peers.finish('completed','');assert.match(f.statuses.at(-1)!,/You can keep chatting/);
  await f.peers.stop();assert.equal(f.peers.waiting,false);
  await f.peers.begin('failed-run');await wait.execute({agentIds:['flyertalk']});
  await f.peers.finish('failed','Network error');assert.equal(f.peers.waiting,false);
});

test('normal and private pages can assign work and return results in both directions',async()=>{
  for(const privateTab of [1,2]){
    const f=broker(id=>id===privateTab);
    f.peerState.agents.other={...agent('other','document-b'),tabId:2,status:'idle',runId:undefined};
    const task=await f.call({op:'spawn',tabId:2,requestId:'cross-window',task:'Read peer page'});
    const delivery=await f.call({op:'take'},'document-b','other');assert.equal(delivery.message.taskId,task.taskId);
    await f.call({op:'begin',runId:'peer-run',model},'document-b','other');
    await f.call({op:'settle',runId:'peer-run',outcome:'completed',text:'Peer evidence'},'document-b','other');
    const result=await f.call({op:'wait',agentIds:['other']});
    assert.equal(result.messages[0].text,'Peer evidence');assert.equal(result.waiting,false);
    assert.equal((await f.call({op:'tabs'})).tabs.length,2);
  }
});
