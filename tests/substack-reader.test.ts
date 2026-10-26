import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';
import {readSubstackPublication} from '../apps/chrome/src/background/substackReader.ts';
import {installSubstackReadContentBridge,installSubstackReadPageBridge} from '../apps/chrome/src/shared/substackReadBridge.ts';
const source=readFileSync(new URL('../apps/chrome/skills/substack.xgs.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default defineSkill','globalThis.skill=defineSkill').replace('minIntervalMs: 1000','minIntervalMs: 0');
const pub={id:13145,name:'a16z',subdomain:'a16z',custom_domain:'www.a16z.news',hero_text:"It's time to build.",unused_metadata:'x'.repeat(50000)};
const post={id:221697140,title:'Patch or Die',slug:'patch-or-die',post_date:'2026-10-23T12:00:00Z',body_html:'<p>An article body</p>',audience:'everyone'};
class FixtureParser {
 parseFromString(input:string,type:string){
  if(type==='application/xml')return {querySelector:()=>null,querySelectorAll:()=>[]};
  return {body:{textContent:input.replace(/<[^>]*>/g,'')},querySelectorAll:()=>[]};
 }
}
function fixture({url='https://substack.com/home',preloads={},status=200}={}) {
 const requests:any[]=[],relays:any[]=[],store=new Map();
 const respond=(url:string)=>url.includes('/publication/search')?JSON.stringify({results:[pub]}):url.includes('/archive')?JSON.stringify([post]):url.includes('/feed')?'<rss><channel/></rss>':JSON.stringify(post);
 const context:any={z,URL,URLSearchParams,Headers,Response,Request,AbortController,AbortSignal,TextEncoder,TextDecoder,structuredClone,setTimeout,clearTimeout,DOMParser:FixtureParser,
  location:new URL(url),document:{title:'Substack',cookie:'',querySelector:()=>null},navigator:{},_preloads:preloads,
  localStorage:{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v)},
  fn:(spec:any)=>spec,defineSkill:(spec:any)=>Object.fromEntries(Object.entries(spec).map(([k,v]:any)=>[k,v.handler])),
  fetch:async(url:string,options:any)=>{requests.push({url,options});return new Response(respond(String(url)),{status,headers:{'content-type':'application/json'}});},
  __xgoose:{substackRead:async(request:any)=>{relays.push(request);return {ok:true,status,body:respond(request.path),url:'https://www.a16z.news'+request.path,headers:{'content-type':'application/json'}};}},
 };
 runInNewContext(source,context);return {skill:context.skill,context,requests,relays};
}
test('Substack home search produces compact usable publication results, followed by publication API reads',async()=>{
 const {skill,requests,relays}=fixture();const found=await skill.searchPublications({query:'a16z',limit:1});
 assert.equal(found.results[0].publication,'https://www.a16z.news');assert.equal(found.results[0].subdomain,'a16z');assert.equal(found.truncated,undefined);assert.ok(JSON.stringify(found).length<2500);
 const selection={publication:found.results[0].publication};const archive=await skill.getArchive({...selection,limit:2});
 assert.equal(archive.sources[0].title,'Patch or Die');assert.equal(archive.sources[0].url,'https://www.a16z.news/p/patch-or-die');assert.equal(archive.sources[0].access,'public');
 const article=await skill.getPost({...selection,slug:'patch-or-die'});assert.equal(article.sources[0].text,'An article body');assert.equal(article.sources[0].complete,true);
 await skill.getFeed(selection);
 assert.equal(requests.length,1);assert.match(requests[0].url,/publication\/search/);
 assert.deepEqual(relays.map(x=>x.path.split('?')[0]),['/api/v1/archive','/api/v1/posts/patch-or-die','/feed']);
 assert.ok(relays.every(x=>x.subdomain==='a16z'));
 const metadata=await skill.getPublication(selection);assert.equal(metadata.sources[0].title,'a16z');assert.equal(metadata.sources[0].url,'https://www.a16z.news/about');
});
test('home pages cannot accidentally call publication-only endpoints on substack.com',async()=>{
 const {skill,requests,relays}=fixture();
 for(const [name,args] of [['getArchive',{}],['getFeed',{}],['getPost',{slug:'patch-or-die'}],['getPublication',{}]] as const)
  await assert.rejects(Promise.resolve().then(()=>skill[name](args)),/publication_required/);
 await assert.rejects(skill.readApi({path:'posts',params:{publication_id:13145}}),/unsupported_endpoint/);
 assert.equal(requests.length+relays.length,0);
});
test('profile primary publications resolve custom domains, and ordinary publication pages retain their session',async()=>{
 const profile=fixture({url:'https://substack.com/@a16z',preloads:{profile:{primaryPublication:pub}}});
 const result=await profile.skill.getArchive({});assert.equal(profile.relays[0].subdomain,'a16z');assert.match(result.sources[0].url,/www.a16z.news/);
 const local=fixture({url:'https://www.a16z.news/p/patch-or-die',preloads:{pub}});const full=await local.skill.getPost({slug:'patch-or-die'});
 assert.equal(local.relays.length,0);assert.match(local.requests[0].url,/^https:\/\/www.a16z.news\/api\/v1\/posts\/patch-or-die/);assert.equal(local.requests[0].options.credentials,'include');assert.equal(full.sources[0].access,'session');
});
test('cross-publication errors remain errors without retries, navigation or fallback requests',async()=>{
 for(const status of [401,403,404,429]){
  const {skill,relays,requests,context}=fixture({status});await assert.rejects(skill.getArchive({publication:'a16z'}),new RegExp('HTTP '+status));
  assert.equal(relays.length,1);assert.equal(requests.length,0);assert.equal(context.location.href,'https://substack.com/home');
 }
});
test('background follows the verified publication redirect using GET without cookies or caller headers',async()=>{
 const calls:any[]=[];const fetcher=async(url:any,options:any)=>{
  calls.push({url:String(url),options});const response=new Response(JSON.stringify([post]),{headers:{'content-type':'application/json','set-cookie':'must-not-expose','retry-after':'5'}});Object.defineProperty(response,'url',{value:'https://www.a16z.news/api/v1/archive?sort=new&limit=2'});return response;
 };
 const reply=await readSubstackPublication({subdomain:'a16z',path:'/api/v1/archive?sort=new&limit=2'},'https://substack.com/home',fetcher as any);
 assert.equal(reply.ok,true);if(!reply.ok)return;
 assert.equal(reply.status,200);assert.equal(reply.url,'https://www.a16z.news/api/v1/archive?sort=new&limit=2');assert.equal(reply.headers['set-cookie'],undefined);assert.equal(reply.headers['retry-after'],'5');
 assert.equal(calls.length,1);for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.credentials,'omit');assert.equal(call.options.headers,undefined);assert.equal(call.options.redirect,'follow');}
});
test('public relay rejects unrelated senders, write/auth routes and redirects to private or changed paths',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response('[]');};
 for(const [request,sender]of [[{subdomain:'a16z',path:'/feed'},'https://example.com'],[{subdomain:'evil.com',path:'/feed'},'https://substack.com'],[{subdomain:'a16z',path:'/api/v1/drafts'},'https://substack.com'],[{subdomain:'a16z',path:'//evil.com/feed'},'https://substack.com'],[{subdomain:'a16z',path:'/feed?token=secret'},'https://substack.com']] as const)
  assert.equal((await readSubstackPublication(request,sender,fetcher as any)).ok,false);
 assert.equal(calls,0);
 for(const location of ['http://www.a16z.news/feed','https://127.0.0.1/feed','https://localhost/feed','https://example.com/auth','https://user:pass@example.com/feed']){
  const reply=await readSubstackPublication({subdomain:'a16z',path:'/feed'},'https://substack.com',async()=>{const response=new Response('[]');Object.defineProperty(response,'url',{value:location});return response;});assert.equal(reply.ok,false);
 }
});
test('public relay returns 404 and rate limits once and enforces a bounded response',async()=>{
 for(const status of [404,429]){
  let calls=0;const reply=await readSubstackPublication({subdomain:'a16z',path:'/feed'},'https://substack.com',async()=>{calls++;return new Response('unavailable',{status});});
  assert.equal(calls,1);assert.equal(reply.ok,true);if(reply.ok)assert.equal(reply.status,status);
 }
 const big=await readSubstackPublication({subdomain:'a16z',path:'/feed'},'https://substack.com',async()=>new Response('x'.repeat(2*1024*1024+1)));
 assert.equal(big.ok,false);if(!big.ok)assert.match(big.error,/2 MiB/);
});
test('MAIN and isolated-world bridge exchange only publication coordinates; abort cleans up',async()=>{
 const bus=new EventTarget(),bridge:any={},calls:any[]=[];
 installSubstackReadPageBridge(bridge,bus as any);installSubstackReadContentBridge(async req=>{calls.push(req);return {ok:true,status:200,body:'[]',headers:{},url:'https://a16z.substack.com/feed'};},bus as any);
 const result=await bridge.substackRead({subdomain:'a16z',path:'/feed',headers:{cookie:'not-allowed'}});
 assert.equal(result.status,200);assert.deepEqual(calls,[{subdomain:'a16z',path:'/feed'}]);
 const controller=new AbortController();controller.abort();await assert.rejects(bridge.substackRead({subdomain:'a16z',path:'/feed'},{signal:controller.signal}),/cancelled/);assert.equal(calls.length,1);
});

test('publication skill reaches the background reader through both bridge worlds',async()=>{
 const {skill,context}=fixture();const bus=new EventTarget(),requests:any[]=[];
 context.__xgoose={};installSubstackReadPageBridge(context.__xgoose,bus as any);
 installSubstackReadContentBridge(request=>readSubstackPublication(request,'https://substack.com/home',async(url,options)=>{
  requests.push({url:String(url),options});
  const response=Response.json([post]);Object.defineProperty(response,'url',{value:'https://www.a16z.news'+request.path});return response;
 }),bus as any);
 const found=await skill.searchPublications({query:'a16z',limit:1});
 const result=await skill.getArchive({publication:found.results[0].publication});
 assert.equal(requests.length,1);assert.equal(result.sources[0].url,'https://www.a16z.news/p/patch-or-die');
 assert.equal(result.sources[0].access,'public');assert.ok(requests.every(r=>r.options.credentials==='omit'));
});

test('Chromium opaque redirect failures never become an invalid Response(status:0)',async()=>{
 const opaque={status:0,url:'',body:null} as Response;
 const reply=await readSubstackPublication({subdomain:'a16z',path:'/feed'},'https://substack.com',async()=>opaque);
 assert.equal(reply.ok,false);if(!reply.ok)assert.match(reply.error,/readable response/);
});
