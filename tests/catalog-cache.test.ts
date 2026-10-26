import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const source=process.env.XGOOSE_CATALOG_SOURCE??fileURLToPath(new URL('../apps/chrome/src/background/catalog.ts',import.meta.url));
const compiled=await build({entryPoints:[source],bundle:true,write:false,format:'iife',globalName:'catalogTest',platform:'node',plugins:[{name:'fixture-services',setup(b){
 b.onResolve({filter:/^@\/shared\/account$/},()=>({path:'account',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/skillRegistry$/},()=>({path:'registry',namespace:'fixture'}));
 b.onResolve({filter:/^@\/shared\/types$/},()=>({path:fileURLToPath(new URL('../apps/chrome/src/shared/types.ts',import.meta.url))}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='account'?'export const apiFetch=(...args)=>globalThis.fixture.apiFetch(...args);':`export const editSkillFromSource=(...args)=>globalThis.fixture.edit(...args);export const getUserSkillCode=()=>globalThis.fixture.installed;export const saveUserSkill=s=>globalThis.fixture.save(s);export const loadRegistry=()=>[];`,loader:'js'}));
}}]});
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture({cached='0.4.0',latest='0.4.3',offline=false,author='owner',tamper=false,headerVersion='0.4.3'}={}){
 const item=(version:string)=>({id:'skill-id',authorId:'owner',slug:'amex-chat',name:'amex-chat',namespace:'amexchat',description:'Amex chat',version,matches:['https://global.americanexpress.com/*'],include:[],exclude:[],dependencies:[]});
 const storage:Record<string,any>={'xgoose.skill-catalog-v1':{at:Date.now(),items:[item(cached)]}};
 const requests:{path:string;init?:RequestInit}[]=[];
 let writes=0;
 const f:any={installed:undefined,apiFetch:async(path:string,init?:RequestInit)=>{
  requests.push({path,init});
  if(path==='/skills/catalog'){if(offline)throw new Error('network offline');return {ok:true,data:{version:1,items:[item(latest)]}};}
  const body=`// ==XGooseSkill==\n// @name amex-chat\n// @namespace amexchat\n// @version ${headerVersion}\n// @match https://global.americanexpress.com/*\n// ==/XGooseSkill==\nexport default {};`;
  return {ok:true,data:{identity:{authorId:author,skillId:'skill-id'},version:'0.4.3',skill:{source:body,bundled:'bundle'},source_sha256:tamper?'bad':sha(body),bundle_sha256:sha('bundle')}};
 },edit:async({name,source}:any)=>{writes++;f.installed={name,source,bundled:'local-bundle'};return {ok:true};},save:async(s:any)=>{f.installed=s;}};
 const sandbox:any={fixture:f,crypto:webcrypto,TextEncoder,chrome:{storage:{local:{get:async(key:string)=>({[key]:storage[key]}),set:async(obj:any)=>Object.assign(storage,obj)}}}};
 vm.runInNewContext(compiled.outputFiles[0].text,sandbox);
 return {api:sandbox.catalogTest,requests,storage,fixture:f,writes:()=>writes};
}

test('newly published reviewed version refreshes stale local catalog once and installs exact version',async()=>{
 const f=fixture();await f.api.installCatalogSkill('amex-chat','0.4.3');
 const refreshes=f.requests.filter(r=>r.path==='/skills/catalog');assert.equal(refreshes.length,1);assert.equal(refreshes[0].init?.cache,'no-store');
 assert.ok(f.requests.some(r=>r.path==='/skills/amex-chat/install?version=0.4.3'));
 assert.equal(f.writes(),1);assert.equal(f.fixture.installed.identity.authorId,'owner');assert.equal(f.storage['xgoose.skill-catalog-v1'].items[0].version,'0.4.3');
});
test('matching cached version avoids an unnecessary catalog request',async()=>{
 const f=fixture({cached:'0.4.3'});await f.api.installCatalogSkill('amex-chat','0.4.3');assert.equal(f.requests.filter(r=>r.path==='/skills/catalog').length,0);assert.equal(f.writes(),1);
});
test('version truly changed still requires review; does not substitute the newest version',async()=>{
 const f=fixture({latest:'0.4.4'});await assert.rejects(f.api.installCatalogSkill('amex-chat','0.4.3'),/catalog version changed/);assert.equal(f.requests.length,1);assert.equal(f.writes(),0);
});
test('failed forced refresh does not silently fall back to stale catalog',async()=>{
 const f=fixture({offline:true});await assert.rejects(f.api.installCatalogSkill('amex-chat','0.4.3'),/network offline/);assert.equal(f.requests.length,1);assert.equal(f.writes(),0);
});
test('refresh preserves author, digest and source metadata protections',async()=>{
 for(const options of [{author:'impostor'},{tamper:true},{headerVersion:'0.4.2'}]){
  const f=fixture(options);await assert.rejects(f.api.installCatalogSkill('amex-chat','0.4.3'),/identity or version mismatch|digest mismatch|metadata does not match/);assert.equal(f.writes(),0);
 }
});
test('explicit refresh bypasses local storage and HTTP cache, normal browsing keeps its cache',async()=>{
 const f=fixture();assert.equal((await f.api.skillCatalog())[0].version,'0.4.0');assert.equal(f.requests.length,0);
 assert.equal((await f.api.skillCatalog(true))[0].version,'0.4.3');assert.equal(f.requests[0].init?.cache,'no-store');
});
