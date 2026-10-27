import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {z} from 'zod';
import {parseFragment} from 'parse5';
const source=readFileSync(new URL('../apps/chrome/skills/linkedin.xgs.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default defineSkill','globalThis.skill=defineSkill');
const flight=(names=['Jingtao Zheng','Another Person'])=>[
 '1:I["module",[],"Link"]',
 ...names.map((name,i)=>`${(i+2).toString(16)}:${JSON.stringify(['$','$L1',null,{href:`/in/person-${i}/?tracking=ignored`,children:`$${(i+50).toString(16)}`}])}`),
 ...names.map((name,i)=>`${(i+50).toString(16)}:${JSON.stringify(['$','span',null,{children:[name,' · Quant Researcher at Two Sigma']}])}`),
].join('\n');
function fixture({body=flight(),status=200,cookie='JSESSIONID="synthetic-csrf"'}={}) {
 const requests:any[]=[];const store=new Map();
 const context:any={z,parseFragment,Map,Set,URL,URLSearchParams,Headers,Response,Request,AbortController,AbortSignal,TextEncoder,TextDecoder,structuredClone,setTimeout,clearTimeout,console,
  location:new URL('https://www.linkedin.com/notifications/'),document:{cookie},navigator:{},
  localStorage:{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v)},
  fn:(spec:any)=>spec,defineSkill:(spec:any)=>Object.fromEntries(Object.entries(spec).map(([k,v]:any)=>[k,v.handler])),
  fetch:async(url:string,options:any)=>{requests.push({url,options});return new Response(body,{status,headers:{'content-type':'application/octet-stream'}});},
 };
 runInNewContext(source.replace('minIntervalMs:2000','minIntervalMs:0'),context);return {skill:context.skill,requests,context};
}
test('LinkedIn people search calls the current API with a native search packet, without navigation',async()=>{
 const {skill,requests,context}=fixture();
 const result=await skill.search({query:'Two Sigma',type:'people',count:5});
 assert.equal(requests.length,1);const req=requests[0];const url=new URL(req.url);
 assert.equal(url.pathname,'/flagship-web/search/results/people/');assert.equal(url.searchParams.get('keywords'),'Two Sigma');
 assert.equal(req.options.method,'POST');assert.equal(req.options.credentials,'include');assert.equal(req.options.headers['x-li-rsc-stream'],'true');
 const packet=JSON.parse(req.options.body);assert.equal(packet.requestedArguments.payload.keywords,'Two Sigma');
 assert.equal(packet.requestedArguments.states[0].value,1);assert.equal(packet.screenId,'com.linkedin.sdui.flagshipnav.search.SearchResultsPeople');
 assert.equal(result.sources.length,2);assert.match(result.sources[0].title,/Jingtao Zheng/);
 assert.equal(result.sources[0].url,'https://www.linkedin.com/in/person-0/');assert.equal(result.sources[0].complete,false);
 assert.equal(context.location.pathname,'/notifications/');
});
test('SDUI result cards resolve text props and primary navigation, excluding menus and mutual profiles',async()=>{
 const jsx=(props:any)=>['$','$L1',null,props];
 const navigate=(url:string)=>({actions:[{$type:'proto.sdui.actions.core.Navigate',value:{content:{screen:{url}}}}]});
 const rows=[
  ['1',jsx({href:'/in/account-owner/',children:'Account menu'})],
  ['2',jsx({viewTrackingSpecs:{viewName:'people-search-result'},children:'$L3'})],
  ['3',jsx({triggers:[{action:navigate('/in/jingtao/')}],children:'$L4'})],
  ['4',jsx({children:[jsx({textProps:{children:['Jingtao Zheng']}}),jsx({children:'Quantitative Researcher at Two Sigma'}),jsx({href:'/in/mutual/',children:'Mutual Person'})]})],
  ['5',jsx({viewTrackingSpecs:'$2:props:viewTrackingSpecs',children:'$L6'})],
  ['6',jsx({triggers:[{action:navigate('/in/second/')}],children:jsx({textProps:{children:'Second Person'}})})],
 ];
 const body=rows.map(([id,node])=>`${id}:${JSON.stringify(node)}`).join('\n');
 const {skill}=fixture({body});const output=await skill.search({query:'Two Sigma',type:'people',count:10});
 assert.deepEqual(Array.from(output.sources,(s:any)=>s.url),['https://www.linkedin.com/in/jingtao/','https://www.linkedin.com/in/second/']);
 assert.match(output.sources[0].text,/Jingtao Zheng.*Quantitative Researcher at Two Sigma/);
 assert.equal(output.sources[1].title,'Second Person');
});
test('Flight root order wins over chunk arrival; post excerpts come from the full result card',async()=>{
 const jsx=(props:any)=>['$','$L1',null,props];
 const card=(name:string,url:string)=>jsx({viewTrackingSpecs:{viewName:'people-search-result'},href:url,children:name});
 const ordered=fixture({body:[['a',card('Arrives first','/in/late/')],['b',card('Displayed first','/in/first/')],['0',{children:['$Lb','$La']}]].map(([id,node])=>`${id}:${JSON.stringify(node)}`).join('\n')});
 assert.match((await ordered.skill.search({query:'test',type:'people'})).sources[0].text,/Displayed first/);
 const post=jsx({viewTrackingSpecs:{viewName:'feed-full-update'},children:[jsx({href:'/in/author/',children:'Post author'}),jsx({textProps:{children:'An actual Two Sigma post excerpt'}}),jsx({href:'/posts/author-two-sigma-activity-123',children:'Repost with thoughts'})]});
 const {skill}=fixture({body:`0:${JSON.stringify(post)}`});const output=await skill.search({query:'Two Sigma',type:'posts'});
 assert.equal(output.sources.length,1);assert.equal(output.sources[0].kind,'post');assert.match(output.sources[0].text,/An actual Two Sigma post excerpt/);
 assert.match(output.sources[0].url,/linkedin.com\/posts\//);
});
test('combined search keeps its matching company hero before related-company clusters',async()=>{
 const jsx=(props:any)=>['$','$L1',null,props];
 const body=[['1',jsx({viewTrackingSpecs:{viewName:'companies-search-result'},href:'/company/related/',children:'Related company'})],['2',jsx({viewTrackingSpecs:{viewName:'search-results-kcard-v2-hero-entity'},href:'/company/two-sigma-investments/',children:'Two Sigma'})]].map(([id,node])=>`${id}:${JSON.stringify(node)}`).join('\n');
 const {skill}=fixture({body});const output=await skill.search({query:'Two Sigma'});
 assert.equal(output.sources[0].title,'Two Sigma');
});
test('LinkedIn search preserves punctuation and Unicode and applies page offsets',async()=>{
 const {skill,requests}=fixture();await skill.search({query:'张 & (AI)',type:'people',start:10,count:1});
 const req=requests[0];assert.equal(new URL(req.url).searchParams.get('keywords'),'张 & (AI)');
 const packet=JSON.parse(req.options.body);assert.equal(packet.requestedArguments.payload.keywords,'张 & (AI)');assert.equal(packet.requestedArguments.states[0].value,2);
});
test('API access and rate-limit errors are not replaced by another endpoint or page fallback',async()=>{
 for(const status of [401,403,429,404]){
  const {skill,requests}=fixture({status,body:'unavailable'});
  await assert.rejects(skill.search({query:'Jingtao',type:'people'}),new RegExp(`HTTP ${status}`));
  assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).pathname,'/flagship-web/search/results/people/');
 }
});
test('empty results and unexpected response formats remain distinct',async()=>{
 const empty=fixture({body:'0:{"children":"No results found"}'});
 assert.equal((await empty.skill.search({query:'missing',type:'people'})).sources.length,0);
 const broken=fixture({body:'<html>Unexpected response</html>'});
 await assert.rejects(broken.skill.search({query:'Two Sigma',type:'people'}),/unexpected_search_response/);
});
test('search requires a session and never returns credentials',async()=>{
 const missing=fixture({cookie:''});await assert.rejects(missing.skill.search({query:'Jingtao',type:'people'}),/login_required/);assert.equal(missing.requests.length,0);
 const good=fixture();assert.equal(JSON.stringify(await good.skill.search({query:'Jingtao',type:'people'})).includes('synthetic-csrf'),false);
});

test('job search parses inert raw cards even when page DOMParser strips every tag',async()=>{
 const body=`<!DOCTYPE html><li><div data-entity-urn="urn:li:jobPosting:123"><a href="https://www.linkedin.com/jobs/view/123/?tracking=ignore"><span>Software Engineer</span></a><h3>Software Engineer</h3><h4>Example &amp; Company</h4><span>Chicago, IL</span><time datetime="2026-10-23"></time></div></li><script>throw new Error('must never run')</script>`;
 const {skill,context,requests}=fixture({body});context.DOMParser=class {parseFromString(){throw new Error('page DOMParser must not be used')}};
 const result=await skill.searchJobs({keywords:'Software Engineer',location:'Chicago',count:1});
 assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,'123');assert.equal(result.sources[0].title,'Software Engineer');assert.equal(result.sources[0].author,'Example & Company');assert.equal(result.sources[0].url,'https://www.linkedin.com/jobs/view/123/');assert.match(result.sources[0].text,/Chicago, IL/);assert.equal(result.nextStart,1);
 assert.equal(new URL(requests[0].url).pathname,'/jobs-guest/jobs/api/seeMoreJobPostings/search');
});
test('job details read public responsibilities and requirements without DOMParser',async()=>{
 const body='<h2>Research Engineer</h2><a class="topcard__org-name-link">Example</a><div class="show-more-less-html__markup"><p>Build useful tools.</p><p>Requirements: Python &amp; C++.</p></div>';
 const {skill}=fixture({body});const result=await skill.getJob({id:123});
 assert.equal(result.sources[0].title,'Research Engineer');assert.match(result.sources[0].text,/Requirements: Python & C\+\+/);assert.equal(result.sources[0].scope,'body');
});

test('profile details use the target profile identity and preserve dates and offer qualifications',async()=>{
 const {skill,context,requests}=fixture();
 const jsx=(props:any)=>['$','$L1',null,props];
 const header=jsx({viewTrackingSpecs:{viewName:'profile-top-card'},children:'Jingtao Zheng · Building AI for Finance',identity:{vanityName:'jingtaozheng',vieweeProfileId:'target-profile-id'}});
 const sections:any={about:'About Building useful systems',experience:'Experience AI Reasoning MTS xAI Nov 2025 – Present Offer date: 2025-11-28',education:'Education University of Chicago PhD Finance'};
 context.fetch=async(url:string,options:any)=>{
  requests.push({url,options});const component=new URL(url).searchParams.get('componentId');
  const section=component?.includes('ExperienceOnly')?'experience':component?.includes('AboveActivity')?'about':'education';
  return new Response(`0:${JSON.stringify(component?jsx({children:sections[section]}):header)}`,{status:200});
 };
 const result=await skill.getProfile({publicId:'jingtaozheng',sections:['about','experience','education']});
 assert.deepEqual(Array.from(result.loadedSections),['header','about','experience','education']);assert.equal(result.sectionErrors.length,0);
 assert.equal(requests.length,4);assert.equal(new URL(requests[0].url).pathname,'/flagship-web/in/jingtaozheng/');
 const payload=JSON.parse(requests[2].options.body).clientArguments.payload;
 assert.equal(payload.replaceableSectionArgs.vieweeProfileId,'target-profile-id');assert.equal(payload.vanityName,'jingtaozheng');
 assert.match(result.sources.find((s:any)=>s.scope==='experience').text,/xAI.*2025.*Offer date: 2025-11-28/);
 assert.equal(result.instruction,undefined);assert.equal(result.sources.every((s:any)=>s.complete===false),true);
 assert.equal(JSON.stringify(result).includes('synthetic-csrf'),false);
});

test('profile sections report access failures and stop on rate limits without alternate endpoints',async()=>{
 const {skill,context,requests}=fixture();
 context.fetch=async(url:string,options:any)=>{
  requests.push({url,options});return requests.length===1
   ?new Response('0:["$","div",null,{"viewTrackingSpecs":{"viewName":"profile-top-card"},"children":"Target person"}]')
   :new Response('Too many requests',{status:429});
 };
 const result=await skill.getProfile({publicId:'target',sections:['experience','education']});
 assert.equal(requests.length,2);assert.equal(result.sectionErrors[0].section,'experience');assert.equal(result.sectionErrors[0].status,429);
 assert.deepEqual(Array.from(result.loadedSections),['header']);
});
