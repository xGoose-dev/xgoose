import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-default-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{
  const original=fetch;globalThis.defaultFixture={model:'deepseek-flash',calls:[]};
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url),f=globalThis.defaultFixture;
   if(url.hostname!=='api.xgoose.org')return original(input,init);
   if(url.pathname==='/me/quota')return Response.json({claimable:false,granted_micros:5e6,remaining_micros:5e6,expires_at:'2100-01-01T00:00:00Z',platform_paused:false});
   if(url.pathname==='/me/transcript-consent')return Response.json({hosted:true,byok:false});
   if(url.pathname==='/ai/v1/models')return Response.json({default_model:f.model,data:[{id:'deepseek-flash',context_window:1000000},{id:'claude-haiku-5-5',context_window:1000000},{id:'deepseek-purge',context_window:1000000}]});
   if(url.pathname==='/ai/v1/chat/completions'){
    const body=await req.json();f.calls.push({model:body.model,stream:body.stream,credential:req.headers.get('authorization')});
    if(body.stream===false)return Response.json({choices:[{message:{role:'assistant',content:'OK'}}]});
    const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
    return new Response(frame({content:`Resolved model: ${body.model}`})+frame({},'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }
   return Response.json({acknowledged:[],items:[]});
  };
 });
 await context.route('https://default.fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Default model fixture</title><p>Synthetic evidence</p>'}));
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await options.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{provider:'xgoose-hosted',model:'default',language:'en',analyticsEnabled:false,launcherVisibility:'always'},'xgoose.account':{user:{id:'fixture-default',email:'test@example.test',name:'Fixture',avatar_url:null,email_verified:true,is_admin:false},accessToken:'synthetic-token',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:Date.now()}}));
 for(const scenario of [{choice:'default',server:'deepseek-flash',expected:'deepseek-flash'},{choice:'default',server:'claude-haiku-5-5',expected:'claude-haiku-5-5'},{choice:'claude-haiku-5-5',server:'deepseek-flash',expected:'claude-haiku-5-5'}]){
  await sw.evaluate(model=>{globalThis.defaultFixture.model=model;globalThis.defaultFixture.calls=[];},scenario.server);
  await options.evaluate(choice=>chrome.storage.local.get('xgoose.settings').then(d=>chrome.storage.local.set({'xgoose.settings':{...d['xgoose.settings'],model:choice}})),scenario.choice);
  const test=await options.evaluate(model=>chrome.runtime.sendMessage({kind:'sw:test_api_key',payload:{provider:'xgoose-hosted',apiKey:'',baseUrl:'',model}}),scenario.choice);
  assert.equal(test.ok,true,JSON.stringify(test));assert.match(test.message,new RegExp(scenario.expected));
  const page=await context.newPage();await page.goto('https://default.fixture.test/');await page.locator('#xgoose-root').waitFor({state:'attached'});if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
  await page.locator('.in-text').fill('Reply briefly.');await page.locator('.btn-send').click();
  await page.waitForFunction(expected=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes(`Resolved model: ${expected}`),scenario.expected);await page.locator('.btn-stop').waitFor({state:'hidden'});
  assert.match(await page.locator('.context-meter').getAttribute('title'),/1,000,000 tokens/);
  const calls=await sw.evaluate(()=>globalThis.defaultFixture.calls);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.model===scenario.expected&&c.credential==='Bearer synthetic-token'));
  await page.close();
 }
 await options.reload();await options.locator('#model option').filter({hasText:'Default — DeepSeek Flash'}).waitFor({state:'attached'});
 assert.equal(await options.locator('#model').inputValue(),'claude-haiku-5-5');
 await mkdir('artifacts/hosted-default',{recursive:true});await writeFile('artifacts/hosted-default/report.json',JSON.stringify({passed:true,syntheticOnly:true,defaultFollowsServer:true,explicitChoicePreserved:true,testMatchesConversation:true,contextWindow:1000000},null,2));
 console.log('Hosted default browser regression passed.');
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
