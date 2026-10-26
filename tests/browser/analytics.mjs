import {chromium} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const releaseVersion=JSON.parse(await readFile('apps/chrome/dist/manifest.json','utf8')).version;
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/chat/completions'){
  for await(const chunk of req){};
  res.writeHead(200,{'content-type':'text/event-stream'});
  const frame=(choices,usage)=>`data: ${JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:'luna',choices,...(usage?{usage}:{})})}\n\n`;
  res.end(frame([{index:0,delta:{role:'assistant',content:'Analytics fixture response.'},finish_reason:null}])+frame([{index:0,delta:{},finish_reason:'stop'}])+frame([],{prompt_tokens:10,completion_tokens:5,total_tokens:15})+'data: [DONE]\n\n');return;
 }
 res.setHeader('content-type','text/html');res.end('<!doctype html><title>Analytics fixture</title><h1>Synthetic page</h1>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-analytics-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(15000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=sw.url().split('/')[2];
 await sw.evaluate(()=>{
  globalThis.analyticsFixture={requests:[],failed:false};const original=fetch;
  globalThis.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input.url;if(!url.startsWith('https://api.xgoose.org'))return original(input,init);
   if(url.endsWith('/a/collect')){globalThis.analyticsFixture.requests.push({body:JSON.parse(init.body),headers:init.headers});return new Response(null,{status:globalThis.analyticsFixture.failed?503:204});}
   if(url.endsWith('/me/transcript-consent'))return Response.json({hosted:true,byok:false});
   return Response.json({data:[{id:'luna'}]});
  };
 });
 const bridge=await context.newPage();await bridge.goto(`chrome-extension://${id}/options.html`);
 await bridge.waitForFunction(()=>!document.querySelector('#saveBtn').disabled);await new Promise(r=>setTimeout(r,1800));await sw.evaluate(()=>globalThis.analyticsFixture.failed=true);
 await bridge.evaluate(async base=>{
  await chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'synthetic-key'},baseUrls:{'openai-compat':base},model:'luna',thinking:false,analyticsEnabled:true,launcherVisibility:'always'},'xgoose.account':{user:{id:'fixture',email:'private@example.test',name:null,avatar_url:null,is_admin:false,email_verified:true},accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:0}});
  await chrome.runtime.sendMessage({kind:'sw:track',payload:{event:'analytics_fixture_started',params:{provider:'openai-compat',model:'x'.repeat(90000),message:'private message',email:'private@example.test',url:'https://example.com/private',reason:'network'}}});
 },base);
 await bridge.waitForFunction(async()=>((await chrome.storage.local.get('xgoose.analytics.queue-v2'))['xgoose.analytics.queue-v2']??[]).some(e=>e.name==='analytics_fixture_started'));
 await bridge.waitForFunction(async()=>!!(await chrome.storage.local.get('xgoose.analytics.clientId'))['xgoose.analytics.clientId']);
 await new Promise(r=>setTimeout(r,1800));
 const failed=await sw.evaluate(()=>globalThis.analyticsFixture.requests.filter(r=>r.body.events.some(e=>e.name==='analytics_fixture_started')));assert.ok(failed.length);
 const event=failed[0].body.events.find(e=>e.name==='analytics_fixture_started');assert.ok(event.at);assert.ok(event.params.session_id>0);assert.equal(event.params.extension_version,releaseVersion);
 for(const key of ['message','email','url','model'])assert.equal(event.params[key],undefined);assert.equal(failed[0].headers.authorization,'Bearer synthetic-access');
 await sw.evaluate(()=>globalThis.analyticsFixture.failed=false);
 await bridge.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:track',payload:{event:'analytics_fixture_retry'}}));
 await new Promise(r=>setTimeout(r,2200));
 await bridge.waitForFunction(async()=>!((await chrome.storage.local.get('xgoose.analytics.queue-v2'))['xgoose.analytics.queue-v2']??[]).length);
 const retries=await sw.evaluate(()=>globalThis.analyticsFixture.requests.flatMap(r=>r.body.events).filter(e=>e.name==='analytics_fixture_started'));assert.ok(retries.length>=2);assert.equal(retries[0].params.event_id,retries.at(-1).params.event_id);
 const page=await context.newPage();await page.goto(base+'/private-path?secret=private');await page.locator('#xgoose-root').waitFor({state:'attached'});
 await page.locator('.toggle').click();await page.locator('.in-text').fill('Synthetic private prompt');await page.locator('.btn-send').click();
 await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.textContent?.includes('Analytics fixture response.'));
 await new Promise(r=>setTimeout(r,2200));
 await bridge.waitForFunction(async()=>!((await chrome.storage.local.get('xgoose.analytics.queue-v2'))['xgoose.analytics.queue-v2']??[]).length);
 const events=await sw.evaluate(()=>globalThis.analyticsFixture.requests.flatMap(r=>r.body.events));const sent=events.find(e=>e.name==='chat_message_sent');assert.ok(sent);for(const name of ['chat_first_response','chat_turn_finished'])assert.ok(events.some(e=>e.name===name&&e.params.flow_id===sent.params.flow_id));
 assert.ok(!JSON.stringify(events).includes('Synthetic private prompt'));assert.ok(!JSON.stringify(events).includes('/private-path'));
 const journal=await sw.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('xgoose-sessions',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const q=r.result.transaction('events').objectStore('events').getAll();q.onsuccess=()=>resolve(q.result);};}));
 assert.ok(journal.length);assert.ok(journal.every(e=>e.event.site==='127.0.0.1'));assert.ok(!JSON.stringify(journal.map(e=>e.event.site)).includes('secret'));
 await bridge.evaluate(async()=>{const settings=(await chrome.storage.local.get('xgoose.settings'))['xgoose.settings'];await chrome.storage.local.set({'xgoose.settings':{...settings,analyticsEnabled:false}});});
 await new Promise(r=>setTimeout(r,100));const count=await sw.evaluate(()=>globalThis.analyticsFixture.requests.length);
 await bridge.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:track',payload:{event:'analytics_fixture_opted_out'}}));await new Promise(r=>setTimeout(r,2000));
 assert.equal(await sw.evaluate(()=>globalThis.analyticsFixture.requests.length),count);
 console.log(JSON.stringify({passed:true,durableRetry:true,deduplicationId:true,verifiedAccountHeader:true,privateParamsRemoved:true,chatFlow:true,trustedTranscriptHostname:true,optOut:true,syntheticOnly:true}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
