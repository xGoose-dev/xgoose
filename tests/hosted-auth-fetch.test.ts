import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createAccountSession} from '../apps/chrome/src/background/accountSession.ts';
import type {Account} from '../apps/chrome/src/shared/account.ts';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../apps/chrome/src/background/providerFetch.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'providerTest',platform:'node',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^\.\/account$/},()=>({path:'account',namespace:'fixture'}));
 b.onResolve({filter:/^@\/shared\/account$/},()=>({path:'api',namespace:'fixture'}));
 b.onResolve({filter:/^@\/shared\/host$/},()=>({path:'host',namespace:'fixture'}));
 b.onResolve({filter:/^@\/shared\/hosted$/},()=>({path:fileURLToPath(new URL('../apps/chrome/src/shared/hosted.ts',import.meta.url))}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='account'?`export const getFreshAccount=()=>globalThis.fixture.session.fresh();export const refreshTokens=t=>globalThis.fixture.session.refresh(t);`:path==='api'?`export const XGOOSE_API_URL='https://api.xgoose.org';`:`export const providerHeaders=h=>h;`,loader:'js'}));
}}]});
const token=(accessToken:string,user='owner'):Account=>({user:{id:user,email:'fixture@example.test',name:null,avatar_url:null,email_verified:true,is_admin:false},accessToken,refreshToken:accessToken+'-refresh',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:0});
function fixture(handler:(r:{url:string;init:RequestInit})=>Promise<Response>){
 let account:Account|null=token('A'),refreshes=0;
 const f:any={renew:async()=>({ok:true,account:token('B')})};
 f.session=createAccountSession({read:async()=>account,save:async a=>{account=a;},clear:async()=>{account=null;},renew:async()=>{refreshes++;return f.renew();}});
 const calls:any[]=[];
 const sandbox:any={fixture:f,Headers,URL,Response,AbortSignal,Error,fetch:async(url:string,init:RequestInit)=>{calls.push({url,init});return handler({url,init});}};
 vm.runInNewContext(compiled.outputFiles[0].text,sandbox);
 return {fetch:sandbox.providerTest.providerFetch,session:f.session,f,refreshes:()=>refreshes,calls,read:()=>account};
}
const req={url:'https://api.xgoose.org/ai/v1/chat/completions',method:'POST',headers:{authorization:'Bearer stale-sdk-placeholder','content-type':'application/json'},body:'{"messages":[{"role":"tool","content":"completed action"}]}',hostedAccountId:'owner'};
test('a running agent reads the newly saved session for every model request',async()=>{
 const f=fixture(async()=>new Response('ok'));await f.fetch(req);await f.session.replace(token('B'));await f.fetch(req);
 assert.deepEqual(f.calls.map(c=>new Headers(c.init.headers).get('authorization')),['Bearer A','Bearer B']);assert.equal(f.refreshes(),0);
});
test('parallel 401s and a delayed stale rejection rotate once; exact payload retained',async()=>{
 let rejected=0,release!:()=>void;const barrier=new Promise<void>(r=>release=r);
 const f=fixture(async({init})=>{if(new Headers(init.headers).get('authorization')==='Bearer A'){if(++rejected===2)release();await barrier;return new Response('session_revoked_or_expired',{status:401});}return new Response('ok');});
 const result=await Promise.all([f.fetch(req),f.fetch(req)]);assert.ok(result.every(r=>r.ok));assert.equal(f.refreshes(),1);assert.equal(f.calls.length,4);
 assert.ok(f.calls.every(c=>c.init.body===req.body));assert.ok(f.calls.every(c=>c.init.redirect==='error'));
});
test('permanent authentication rejection stops after one replay and clearly reports listening stopped',async()=>{
 const f=fixture(async()=>new Response('revoked',{status:401}));const response=await f.fetch(req);assert.equal(response.status,401);assert.match(await response.text(),/stopped listening and taking actions/);assert.equal(f.refreshes(),1);assert.equal(f.calls.length,2);
});
test('revoked refresh token does not send another model request',async()=>{
 const f=fixture(async()=>new Response('revoked',{status:401}));f.f.renew=async()=>({ok:false,status:401});const response=await f.fetch(req);assert.equal(response.status,401);assert.match(await response.text(),/Sign in again/);assert.equal(f.calls.length,1);assert.equal(f.read(),null);
});
test('BYOK 401s never read or refresh the Hosted account or replace its key',async()=>{
 const f=fixture(async()=>new Response('BYOK unauthorized',{status:401}));const result=await f.fetch({...req,hostedAccountId:undefined});assert.equal(result.status,401);assert.equal(f.refreshes(),0);assert.equal(new Headers(f.calls[0].init.headers).get('authorization'),'Bearer stale-sdk-placeholder');
});
test('network errors, 403, 429, 500 and successful streaming responses are never replayed',async()=>{
 for(const status of [403,429,500,200]){const f=fixture(async()=>new Response('fixture',{status}));assert.equal((await f.fetch(req)).status,status);assert.equal(f.calls.length,1);assert.equal(f.refreshes(),0);}
 const f=fixture(async()=>{throw new Error('offline');});await assert.rejects(f.fetch(req),/offline/);assert.equal(f.calls.length,1);assert.equal(f.refreshes(),0);
});
test('aborting during refresh prevents the retry, without cancelling other requests refresh',async()=>{
 let done!:(value:any)=>void;const f=fixture(async()=>new Response('revoked',{status:401}));f.f.renew=()=>new Promise(r=>done=r);const ac=new AbortController();const pending=f.fetch(req,ac.signal);while(!done)await new Promise(r=>setTimeout(r,0));ac.abort();done({ok:true,account:token('B')});await assert.rejects(pending,e=>(e as Error).name==='AbortError');assert.equal(f.calls.length,1);assert.equal(f.read()?.accessToken,'B');
});
test('changing accounts during recovery never sends previous conversation to the new account',async()=>{
 const f=fixture(async()=>{await f.session.replace(token('C','another-user'));return new Response('revoked',{status:401});});const response=await f.fetch(req);assert.equal(response.status,401);assert.match(await response.text(),/stopped listening/);assert.equal(f.calls.length,1);assert.equal(f.refreshes(),0);
});
test('Hosted credentials are confined to the fixed HTTPS model endpoint',async()=>{
 const f=fixture(async()=>new Response('should not be called'));
 for(const url of ['https://other.test/ai/v1/chat/completions','http://api.xgoose.org/ai/v1/chat/completions','https://api.xgoose.org/other','https://user@api.xgoose.org/ai/v1/chat/completions'])await assert.rejects(f.fetch({...req,url}),/cannot be sent/);
 assert.equal(f.calls.length,0);
});
