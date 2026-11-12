import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const compiled=await build({entryPoints:[fileURLToPath(new URL('../apps/chrome/src/background/account.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'module',platform:'node',tsconfig:fileURLToPath(new URL('../apps/chrome/tsconfig.json',import.meta.url)),plugins:[{name:'host',setup(b){
  b.onResolve({filter:/^@\/shared\/(host|platformBridge|analytics|account)$/},a=>({path:a.path.split('/').at(-1)!,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:{
    host:'export const isSafari=false;',platformBridge:'export const nativeCommand=async()=>{};',
    analytics:'export const recordEvent=()=>{};export const failureReason=()=>"fixture";',
    account:'export const apiFetch=(...args)=>globalThis.api(...args);export const getAccount=async()=>null;export const setAccount=async()=>{};export const clearAccount=async()=>{};export const XGOOSE_WEB_URL="https://xgoose.org";',
  }[a.path]!}));
}}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const success=(token='fixture')=>({ok:true,data:{poll_token:token,expires_in:600,interval:5}});
function fixture(){
  const data:Record<string,any>={},requests:{path:string;resolve:(value:any)=>void}[]=[],tabs:string[]=[];
  let holdWrite=false,holdRemove=false,release!:()=>void;
  const context:any={console,Date,crypto,setTimeout:()=>1,clearTimeout(){},
    api:(path:string)=>new Promise(resolve=>requests.push({path,resolve})),
    chrome:{storage:{local:{get:async()=>({...data}),set:async(patch:any)=>{
      if(holdWrite){holdWrite=false;await new Promise<void>(resolve=>{release=resolve;});}
      Object.assign(data,patch);
    },remove:async(key:string)=>{
      if(holdRemove){holdRemove=false;await new Promise<void>(resolve=>{release=resolve;});}
      delete data[key];
    }}},alarms:{create(){},onAlarm:{addListener(){}}},tabs:{create:async({url}:{url:string})=>{tabs.push(url);}}},
  };
  vm.runInNewContext(compiled.outputFiles[0].text,context);
  return {account:context.module,requests,tabs,data,holdWrite:()=>{holdWrite=true;},holdRemove:()=>{holdRemove=true;},release:()=>release(),writeHeld:()=>!!release};
}
test('cancel ignores both success and failure from a delayed initial email request',async()=>{
  for(const response of [success(),{ok:false,status:502,error:'Old request failed'}]){
    const f=fixture(),request=f.account.startLogin('a@example.test');await tick();
    await f.account.cancelLogin();f.requests[0].resolve(response);await request;
    assert.equal((await f.account.getLoginState()).phase,'idle');assert.equal(f.data['xgoose.pending-email-login'],undefined);
  }
});
test('a newer email request wins when older network responses arrive last',async()=>{
  const f=fixture(),old=f.account.startLogin('old@example.test');await tick();
  const fresh=f.account.startLogin('new@example.test');await tick();
  f.requests[1].resolve(success('new'));await fresh;f.requests[0].resolve(success('old'));await old;
  assert.equal((await f.account.getLoginState()).email,'new@example.test');assert.equal(f.data['xgoose.pending-email-login'].deviceCode,'new');
});
test('duplicate in-flight requests for the same normalized email send once',async()=>{
  const f=fixture(),a=f.account.startLogin(' A@example.test '),b=f.account.startLogin('a@example.test');await tick();
  assert.equal(f.requests.length,1);f.requests[0].resolve(success());await Promise.all([a,b]);
  assert.equal((await f.account.getLoginState()).phase,'pending');
});
test('cancel during pending-login persistence removes the late stored snapshot',async()=>{
  const f=fixture(),request=f.account.startLogin('a@example.test');await tick();
  f.holdWrite();f.requests[0].resolve(success());await tick();assert.equal(f.writeHeld(),true);
  const cancelled=f.account.cancelLogin();await tick();f.release();await Promise.all([request,cancelled]);
  assert.equal((await f.account.getLoginState()).phase,'idle');assert.equal(f.data['xgoose.pending-email-login'],undefined);
});
test('logout and legacy-flow cancellation also discard delayed initial replies',async()=>{
  const f=fixture(),request=f.account.startLogin('a@example.test');await tick();await f.account.logout();f.requests[0].resolve(success());await request;
  assert.equal((await f.account.getLoginState()).phase,'idle');
  const legacy=f.account.startLogin();await tick();await f.account.cancelLogin();
  f.requests[1].resolve({ok:true,data:{device_code:'old',user_code:'OLD',expires_in:600,interval:5}});await legacy;
  assert.deepEqual(f.tabs,[]);assert.equal((await f.account.getLoginState()).phase,'idle');
});

test('an old poll finishing cleanup cannot overwrite a newer email attempt',async()=>{
  for(const reply of [{ok:false,status:403,error:'Old flow denied'},{ok:false,status:400,error:'Old flow expired'}]){
    const f=fixture(),login=f.account.startLogin('old@example.test');await tick();f.requests[0].resolve(success());await login;
    const poll=f.account.pollOnce();await tick();f.holdRemove();f.requests[1].resolve(reply);await tick();
    const newer=f.account.startLogin('new@example.test');await tick();f.release();await tick();
    const state=await f.account.getLoginState();assert.equal(state.phase,'idle');assert.equal(state.error,null);
    f.requests[2].resolve(success('new'));await Promise.all([poll,newer]);
    assert.equal((await f.account.getLoginState()).email,'new@example.test');
  }
});
