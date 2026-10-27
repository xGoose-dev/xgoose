import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const calls=[],requests=[];
const topics=[
 {id:1,title:'Synthetic Card A success',card:'A',outcome:'approved',body:'Synthetic evidence: Card A covers qualifying Trip Delay meals and lodging. Submit online with itinerary, paid fare, delay letter and itemized receipts. A claimant was approved; this does not guarantee approval.'},
 {id:2,title:'Synthetic Card B documents requested',card:'B',outcome:'additional_documents',body:'Synthetic evidence: Card B administrator requested carrier delay reason and payment proof. Trip Delay is distinct from trip cancellation. Eligibility differs from Card A. The claim is pending, not successful.'},
 {id:3,title:'Synthetic denial and disagreement',card:'A',outcome:'denied',body:'Synthetic evidence: A claim for non-covered personal purchases was denied. An older poster reports broader coverage; current terms were not available to verify that assertion. Exact thresholds and deadlines are unknown.'},
];
let turn=0;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/v1/chat/completions'){
    let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);
    const i=turn++;
    const queries=['延误险 报销','Trip Delay 补件','延误险 拒赔'];
    let delta,finish;
    if(i<6){const code=i<3?`return await xgoose.skills.fixture.search({query:${JSON.stringify(queries[i])}});`:`return await xgoose.skills.fixture.read({id:${i-2}});`;delta={tool_calls:[{index:0,id:`call-${i}`,type:'function',function:{name:'js_exec',arguments:JSON.stringify({code,purpose:i<3?'Searched claims':'Read claim evidence',parallel_safe:true})}}]};finish='tool_calls';}
    else{delta={content:`Synthetic test summary: Card A has an approved Trip Delay claim for meals and lodging, submitted online with itinerary, paid fare, carrier delay letter and itemized receipts [1](${base}/t/topic/1). Card B required additional carrier and payment documents and remains pending [2](${base}/t/topic/2). Personal purchases were denied; older contradictory experience does not establish current terms [3](${base}/t/topic/3). Trip Delay differs from cancellation insurance. Specific eligibility thresholds and deadlines are unknown. Individual approval is not guaranteed.`};finish='stop';}
    res.writeHead(200,{'content-type':'text/event-stream'});
    const frame=(choices,usage)=>`data: ${JSON.stringify({id:`mock-${i}`,object:'chat.completion.chunk',created:1,model:'luna',choices,...(usage?{usage}:{})})}\n\n`;
    res.write(frame([{index:0,delta:{role:'assistant',...delta},finish_reason:null}]));
    res.write(frame([{index:0,delta:{},finish_reason:finish}]));
    res.end(frame([],{prompt_tokens:100,completion_tokens:40,total_tokens:140})+'data: [DONE]\n\n');return;
  }
  if(url.pathname==='/search'){calls.push({type:'search',query:url.searchParams.get('q')});res.setHeader('content-type','application/json');res.end(JSON.stringify(topics.map(({id,title})=>({id,title}))));return;}
  if(url.pathname.startsWith('/topic/')){const id=Number(url.pathname.split('/').at(-1));calls.push({type:'read',id});res.setHeader('content-type','application/json');res.end(JSON.stringify(topics.find(t=>t.id===id)));return;}
  res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><title>Synthetic forum</title></head><body><h1>Synthetic Trip Delay forum</h1><p>This test uses fictional evidence only.</p></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-acceptance-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:process.env.HEADED!=='1',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(30000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const extensionId=sw.url().split('/')[2];
 const extensions=await context.newPage();await extensions.goto(`chrome://extensions/?id=${extensionId}`);
 // Chrome 138+ exposes the per-extension Allow User Scripts toggle.
 const toggle=extensions.locator('#allow-user-scripts').locator('cr-toggle');
 if(await toggle.count()){if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();}
 else{
  const labels=await extensions.locator('body').innerText();
  throw new Error('Allow User Scripts toggle not found: '+labels.slice(-2000));
 }
 const bridge=await context.newPage();await bridge.goto(`chrome-extension://${extensionId}/options.html`);
 const source=`// ==XGooseSkill==\n// @name fixture-forum\n// @namespace fixture\n// @version 1.0.0\n// @description Synthetic forum research\n// @match ${base}/*\n// ==/XGooseSkill==\nimport { defineSkill, fn } from '@xgoose/skill';\nimport { z } from 'zod';\nexport default defineSkill({\nsearch:fn({summary:'Search forum',input:z.object({query:z.string()}),handler:async({query})=>fetch('/search?q='+encodeURIComponent(query)).then(r=>r.json())}),\nread:fn({summary:'Read topic',input:z.object({id:z.number()}),handler:async({id})=>fetch('/topic/'+id).then(r=>r.json())})\n});`;
 await bridge.evaluate(async({base,source})=>{
  await chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'synthetic-test'},baseUrls:{'openai-compat':base},model:'luna',thinking:false,analyticsEnabled:false,launcherVisibility:'always'}});
  const result=await chrome.runtime.sendMessage({kind:'sw:edit_skill',payload:{name:'fixture-forum',source}});if(!result.ok)throw new Error(JSON.stringify(result));
 },{base,source});
 const page=await context.newPage();await page.goto(base);await page.locator('#xgoose-root').waitFor({state:'attached'});
 await page.waitForFunction(()=>typeof window.xgoose?.skills?.fixture?.search==='function');
 await page.locator('.toggle').click();await page.locator('.in-text').fill('延误险怎么报销');await page.locator('.btn-send').click();
 await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.textContent?.includes('Individual approval is not guaranteed.'),{},{timeout:60000});
 assert.equal(new Set(calls.filter(c=>c.type==='search').map(c=>c.query)).size,3);
 assert.equal(new Set(calls.filter(c=>c.type==='read').map(c=>c.id)).size,3);
 assert.deepEqual(requests[0].messages.filter(m=>m.role==='user').at(-1).content,[{type:'text',text:'延误险怎么报销'}]);
 for(const id of [1,2,3])assert.ok(await page.locator(`.msgs a[href="${base}/t/topic/${id}"]`).count());
 const journal=await sw.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('xgoose-sessions',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const q=r.result.transaction('events').objectStore('events').getAll();q.onsuccess=()=>resolve(q.result);};}));
 const skillsEvent=journal.find(e=>e.event.type==='skills');
 assert.ok(skillsEvent?.event.clientVersion);
 assert.ok(skillsEvent.event.skills.some(s=>s.name==='fixture-forum'&&s.namespace==='fixture'&&/^\d+\.\d+\.\d+/.test(s.version)&&s.source==='user'),JSON.stringify(skillsEvent?.event));
 const second=await context.newPage();await second.goto(base);await second.locator('#xgoose-root').waitFor({state:'attached'});assert.equal(await second.locator('.msg.user').count(),0);
 // A disabled skill must invalidate a function cached by page code.
 await page.evaluate(()=>{window.savedFixture=window.xgoose.skills.fixture.search;});
 await bridge.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:set_skill_disabled',payload:{name:'fixture-forum',disabled:true}}));
 await page.waitForFunction(()=>!window.xgoose?.skills?.fixture);
 assert.equal(await page.evaluate(()=>{try{window.savedFixture({query:'must-not-run'});return false;}catch{return true;}}),true);
 await mkdir('artifacts/synthetic',{recursive:true});await page.screenshot({path:'artifacts/synthetic/acceptance.png'});
 await writeFile('artifacts/synthetic/report.json',JSON.stringify({kind:'synthetic-only',passed:true,calls,requests:requests.length,liveHosted:false},null,2));
 console.log(JSON.stringify({passed:true,searches:3,topicsRead:3,providerRequests:requests.length,liveHosted:false}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
