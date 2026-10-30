import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const path=(value:string)=>fileURLToPath(new URL(value,import.meta.url));
const compiled=await build({entryPoints:[path('../apps/chrome/src/background/notifications.ts')],bundle:true,write:false,format:'iife',globalName:'notify',platform:'node',tsconfig:path('../apps/chrome/tsconfig.json'),plugins:[{name:'host',setup(b){b.onResolve({filter:/^@\/shared\/host$/},()=>({path:'host',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const isSafari=globalThis.safari===true;'}));}}]});
function fixture(safari=false){
 const stored:Record<string,unknown>={},created:any[]=[],focused:any[]=[];
 let granted=false,active=false,windowFocused=true,closed=false,click:(id:string)=>Promise<void>;
 const chrome={
  storage:{local:{get:async()=>({...stored}),set:async(value:any)=>Object.assign(stored,value)}},
  permissions:{contains:async()=>granted,onAdded:{addListener(){}}},
  notifications:{create:async(id:string,options:any)=>{created.push({id,options});return id;},clear:async()=>true,onClicked:{addListener(fn:any){click=fn;}}},
  runtime:{getURL:(p:string)=>'chrome-extension://fixture/'+p},
  tabs:{get:async(id:number)=>{if(closed)throw Error('closed');return{id,windowId:7,active,title:'Research page',url:'chrome-extension://fixture/agent.html'};},update:async(id:number,options:any)=>{focused.push({id,...options});}},
  windows:{get:async()=>({focused:windowFocused}),update:async(id:number,options:any)=>{focused.push({windowId:id,...options});}},
 };
 const sandbox:any={chrome,safari,Error};vm.runInNewContext(compiled.outputFiles[0].text,sandbox);
 return {stored,created,focused,notify:sandbox.notify,permission:(v:boolean)=>granted=v,active:(v:boolean)=>active=v,windowFocused:(v:boolean)=>windowFocused=v,close:()=>closed=true,click:(id:string)=>click!(id)};
}
const source={tab:{id:2},url:'https://example.org'};
const request=(runId='run-1',mode:'explicit'|'completion'='completion')=>({mode,runId,title:'Ready',message:'Your task is ready.'});
test('notifications default off, require permission, and stay disabled on Safari',async()=>{
 const f=fixture();assert.equal((await f.notify.notificationStatus()).enabled,false);
 assert.equal((await f.notify.emitNotification(request(),source)).reason,'disabled');
 f.stored['xgoose.notifications.enabled']=true;assert.equal((await f.notify.emitNotification(request(),source)).reason,'permission_denied');
 f.permission(true);assert.equal((await f.notify.notificationStatus()).enabled,true);assert.equal(f.created.length,0);
 const safari=fixture(true);safari.permission(true);safari.stored['xgoose.notifications.enabled']=true;
 assert.equal((await safari.notify.notificationStatus()).supported,false);assert.equal((await safari.notify.emitNotification(request(),source)).reason,'disabled');
});
test('completion only alerts inactive tabs or unfocused windows; explicit alerts can target the foreground',async()=>{
 const f=fixture();f.permission(true);f.stored['xgoose.notifications.enabled']=true;f.active(true);
 assert.equal((await f.notify.emitNotification(request(),source)).reason,'active');
 assert.equal((await f.notify.emitNotification(request('manual','explicit'),source)).sent,true);
 f.windowFocused(false);assert.equal((await f.notify.emitNotification(request('unfocused'),source)).sent,true);
 f.active(false);f.windowFocused(true);assert.equal((await f.notify.emitNotification(request('background'),source)).sent,true);
 assert.equal(f.created.length,3);assert.equal(f.created.at(-1).options.message,'Research page');
});
test('concurrent explicit and automatic completions deduplicate and clicks focus the source tab',async()=>{
 const f=fixture();f.permission(true);f.stored['xgoose.notifications.enabled']=true;
 const receipts=await Promise.all([f.notify.emitNotification(request('one','explicit'),source),f.notify.emitNotification(request('one'),source)]);
 assert.equal(receipts.filter(r=>r.sent).length,1);assert.equal(f.created.length,1);
 await f.click(f.created[0].id);assert.deepEqual(f.focused,[{windowId:7,focused:true},{id:2,active:true}]);
 f.close();assert.equal((await f.notify.emitNotification(request('closed'),source)).reason,'unavailable');
});
test('deduplication survives restarts, revoking permission takes effect immediately, and arbitrary tabs are rejected',async()=>{
 const f=fixture();f.permission(true);f.stored['xgoose.notifications.enabled']=true;
 f.stored['xgoose.notifications.sent']=['xgoose-task:2:old'];
 assert.equal((await f.notify.emitNotification(request('old'),source)).reason,'duplicate');
 f.permission(false);assert.equal((await f.notify.emitNotification(request('new'),source)).reason,'permission_denied');
 f.permission(true);
 assert.equal((await f.notify.emitNotification({...request('other'),tabId:99},{url:'chrome-extension://fixture/options.html'})).reason,'unavailable');
 assert.equal((await f.notify.emitNotification({...request('agent'),tabId:2},{url:'chrome-extension://fixture/agent.html'})).sent,true);
});
