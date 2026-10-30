import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createAccountSession} from '../apps/chrome/src/background/accountSession.ts';
const path=(value:string)=>fileURLToPath(new URL(value,import.meta.url));
const compile=async(entry:string,fixtures:Record<string,string>)=>(await build({entryPoints:[path(entry)],bundle:true,write:false,format:'iife',globalName:'searchTest',platform:'node',tsconfig:path('../apps/chrome/tsconfig.json'),plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/.*/},args=>args.path in fixtures?{path:args.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path],loader:'js'}));
}}]})).outputFiles[0].text;
const background=await compile('../apps/chrome/src/background/search.ts',{
  './account':`export const getFreshAccount=()=>fixture.session.fresh();export const refreshTokens=t=>fixture.session.refresh(t);`,
  '@/shared/account':`export const apiFetch=(path,init)=>fixture.request(path,init);`,
  '@/shared/hosted':`export const HOSTED_AUTH_STOPPED='Sign in again: account changed or session revoked';`,
});
const tool=await compile('../apps/chrome/src/content/agent/searchTool.ts',{
  '@/shared/messages':`export const send=(...args)=>fixture.send(...args);`,
});
const sender={tab:{id:1},frameId:0,documentId:'document-a'};
function setup(request:(path:string,init:any)=>Promise<any>){
  let account:any={user:{id:'owner'},accessToken:'A',refreshToken:'refresh-A',accessTokenExpiresAt:'2100-01-01'};
  const f:any={request,renew:async()=>({ok:true,account:{...account,accessToken:'B'}})};
  f.session=createAccountSession({read:async()=>account,save:async a=>{account=a;},clear:async()=>{account=null;},renew:()=>f.renew()});
  const sandbox:any={fixture:f,AbortController,AbortSignal,crypto:webcrypto,TextEncoder,TextDecoder,Error};
  vm.runInNewContext(background,sandbox);
  return {...sandbox.searchTest,f};
}
const input=()=>({query:'public topic',requestId:webcrypto.randomUUID(),accountId:'owner'});
test('search refreshes one rejected session with the same idempotency key and exact minimal body',async()=>{
  const calls:any[]=[];const s=setup(async(path,init)=>{calls.push({path,init});return init.bearer==='A'?{ok:false,status:401,error:'expired'}:{ok:true,status:200,data:{provider:'exa',results:[],charged_micros:7000}};});
  const request=input();assert.equal((await s.searchWeb(request,sender)).provider,'exa');assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.path==='/ai/v1/search'&&c.init.redirect==='error'&&c.init.headers['Idempotency-Key']===request.requestId));
  assert.ok(calls.every(c=>c.init.body===JSON.stringify({query:request.query})));
});
test('account switching, logout and missing login never charge a different account',async()=>{
  const s=setup(async()=>{await s.f.session.replace({user:{id:'other'},accessToken:'C',refreshToken:'C',accessTokenExpiresAt:'2100-01-01'} as any);return{ok:false,status:401};});
  await assert.rejects(s.searchWeb(input(),sender),/account changed/);
  await s.f.session.replace(null);await assert.rejects(s.searchWeb(input(),sender),/account changed/);
});
test('paid provider failures are never retried and cancellation is scoped to its originating document',async()=>{
  for(const status of [403,409,429,502]){
    let calls=0;const s=setup(async()=>{calls++;return{ok:false,status,error:'Unavailable'};});
    await assert.rejects(s.searchWeb(input(),sender),/Unavailable/);assert.equal(calls,1);
  }
  let signal:AbortSignal|undefined;const s=setup(async(_path,init)=>new Promise((_resolve,reject)=>{signal=init.signal;signal!.addEventListener('abort',()=>reject(new Error('cancelled')));}));
  const request=input();const pending=s.searchWeb(request,sender);
  while(!signal)await new Promise(r=>setTimeout(r,0));
  s.abortSearch(request,{...sender,documentId:'other'});assert.equal(signal.aborted,false);
  s.abortSearch(request,sender);await assert.rejects(pending,/cancelled/);
});
test('the one-argument tool respects stop, requires login and retains bounded source output',async()=>{
  const calls:any[]=[];let release!:(value:any)=>void;
  const sandbox:any={fixture:{send:(kind:string,payload:any)=>{calls.push({kind,payload});return kind==='sw:search_web'?new Promise(r=>release=r):Promise.resolve();}},AbortController,AbortSignal,crypto:webcrypto,TextEncoder,TextDecoder,Error};
  vm.runInNewContext(tool,sandbox);
  const create=sandbox.searchTest.createSearchTool;
  await assert.rejects(create().definition.execute({query:'public'},{}),/Sign in/);
  const ac=new AbortController();ac.abort();await assert.rejects(create('owner').definition.execute({query:'public'},{abortSignal:ac.signal}));assert.equal(calls.length,0);
  const search=create('owner');const control=new AbortController();const pending=search.definition.execute({query:'public'},{abortSignal:control.signal});control.abort();
  release({provider:'exa',results:[],charged_micros:7000});await assert.rejects(pending);
  assert.equal(calls[0].payload.requestId,calls[1].payload.requestId);assert.equal(calls[1].kind,'sw:search_abort');
  assert.equal(search.name,'search_web');assert.equal(search.meta.label({}),'Public web search · Exa');
  const output={provider:'exa',results:[{url:'https://example.org',highlights:['Source evidence']}],charged_micros:7000};
  assert.deepEqual(JSON.parse(search.definition.toModelOutput(output)[0].text),output);
});
test('site-first rules stay small and the tool is present on website and dedicated agent pages',()=>{
  const prompt=readFileSync(path('../packages/core/src/systemPrompt.ts'),'utf8');
  const rule=prompt.match(/Use search_web only[^\n]+?as external\./)![0];
  const source=readFileSync(path('../apps/chrome/src/content/agent/searchTool.ts'),'utf8');
  const description=source.match(/description:"([^"]+)"/)![1];
  // Conservative ~4 characters/token proxy; schema adds only one short query field.
  assert.ok((rule.length+description.length)/4<180);
  for(const phrase of ['site evidence is insufficient or unavailable','public web search is explicitly requested','Never use it for site-only requests','exclude private details'])assert.ok(rule.includes(phrase));
  const composition=readFileSync(path('../apps/chrome/src/content/agent/createAgent.ts'),'utf8');
  assert.match(composition,/isAgentPage\(\) \? \[\] : buildLegacyTools\(\)/);
  assert.match(composition,/createSearchTool\(searchAccountId\)/);
});
