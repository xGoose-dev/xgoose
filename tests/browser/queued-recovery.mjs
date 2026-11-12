import {chromium,expect as baseExpect} from '@playwright/test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Exercise the built extension. All pages, credentials and provider responses are fixtures.
const expect=baseExpect.configure({timeout:40000});
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-queued-recovery-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(40000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await expect.poll(()=>sw.evaluate(()=>!!chrome.tabs?.sendMessage)).toBe(true);
 await sw.evaluate(async()=>{
  const original=fetch,send=chrome.tabs.sendMessage.bind(chrome.tabs);
  globalThis.queueFixture={freezeIdentity:true,requests:0};
  const suspended=[];
  chrome.tabs.sendMessage=(tabId,message,...rest)=>queueFixture.freezeIdentity&&message.kind==='cs:peer_identity'?new Promise((resolve,reject)=>suspended.push({resolve,reject,args:[tabId,message,...rest]})):send(tabId,message,...rest);
  globalThis.resumeQueuePeer=async()=>{
   queueFixture.freezeIdentity=false;
   for(const pending of suspended.splice(0)){
    try {pending.resolve(await send(...pending.args));}catch(error){pending.reject(error);}
   }
  };
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url);
   if(url.hostname==='queue-provider.fixture.test'){
    queueFixture.requests++;
    const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
    return new Response(frame({content:`QUEUE_RECOVERED_${queueFixture.requests}`})+frame({},'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }
   if(url.hostname==='api.xgoose.org')return Response.json({items:[],data:[],acknowledged:[]});
   return original(input,init);
  };
  await chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',model:'fixture-model',language:'en',thinking:false,analyticsEnabled:false,launcherVisibility:'always',apiKeys:{'openai-compat':'fixture-key'},baseUrls:{'openai-compat':'https://queue-provider.fixture.test/v1'}}});
 });
 await context.route('https://queued.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Queue recovery fixture</title><p>Local queue recovery evidence.</p>'}));
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 const page=await context.newPage();await page.goto('https://queued.fixture.test/first');
 await page.locator('#xgoose-root').waitFor({state:'attached'});if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
 const send=async(text)=>{await page.locator('.in-text').fill(text);await page.locator('.btn-send').click();};
 const idle=()=>page.locator('.btn-stop').waitFor({state:'hidden'});
 await send('First question while peer registration is unresponsive');
 await expect(page.locator('.msg-user')).toContainText('First question');
 await expect(page.locator('.btn-stop')).toBeVisible();
 await expect(page.locator('.msg-err')).toContainText('did not respond');await idle();
 assert.equal(await page.locator('.queued-pill').count(),0);
 assert.equal(await sw.evaluate(()=>queueFixture.requests),0);
 await sw.evaluate(()=>resumeQueuePeer());
 await send('Retry after the peer is reachable');
 await expect(page.locator('.msg-ai')).toContainText('QUEUE_RECOVERED_1');await idle();

 // Drop one control response in the content script's actual isolated world.
 // The operation is not sent or replayed; the real RPC deadline must release the UI.
 const tabId=await options.evaluate(async()=> (await chrome.tabs.query({url:'https://queued.fixture.test/first'}))[0].id);
 const fault=async(mode)=>options.evaluate(async({tabId,mode})=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:(mode)=>{
  const original=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=(message,...args)=>{
   const match=mode==='save'?message.kind==='sw:session'&&message.payload.op==='save':message.kind==='sw:transcript_event'&&message.payload.event.type==='run-end';
   if(match){chrome.runtime.sendMessage=original;return new Promise(()=>{});}
   return original(message,...args);
  };
 },args:[mode]}),{tabId,mode});
 await page.locator('.btn-new').click();await expect(page.locator('.msg-user')).toHaveCount(0);
 await fault('save');await send('Question whose initial save never responds');
 await expect(page.locator('.msg-user')).toContainText('initial save');
 await expect(page.locator('.btn-stop')).toBeVisible();
 await expect(page.locator('.msg-err')).toContainText('Extension request timed out (sw:session)');await idle();
 assert.equal(await sw.evaluate(()=>queueFixture.requests),1,'failed startup must not send a model request');
 await send('Retry after the storage timeout');await expect(page.locator('.msg-ai')).toContainText('QUEUE_RECOVERED_2');await idle();

 await fault('finish');await send('Complete even when final bookkeeping stops responding');
 await expect(page.locator('.msg-ai').last()).toContainText('QUEUE_RECOVERED_3');
 await send('Queued follow-up must drain after the cleanup deadline');
 await expect(page.locator('.queued-pill')).toHaveCount(1);
 await expect(page.locator('.msg-ai').last()).toContainText('QUEUE_RECOVERED_4');await idle();
 assert.equal(await page.locator('.queued-pill').count(),0);
 assert.equal(await sw.evaluate(()=>queueFixture.requests),4,'no completed model request was replayed');

 const second=await context.newPage();await second.goto('https://queued.fixture.test/second');
 await second.locator('#xgoose-root').waitFor({state:'attached'});if(await second.locator('.toggle').isVisible())await second.locator('.toggle').click();
 await second.locator('.in-text').fill('A second page should still work');await second.locator('.btn-send').click();
 await expect(second.locator('.msg-ai')).toContainText('QUEUE_RECOVERED_5');await second.locator('.btn-stop').waitFor({state:'hidden'});
 await mkdir('artifacts/queued-recovery',{recursive:true});
 await page.locator('.panel').screenshot({path:'artifacts/queued-recovery/recovered.png'});
 const report={passed:true,syntheticOnly:true,peerRegistrationTimeout:true,initialSaveTimeout:true,cleanupTimeout:true,queuedFollowupDrained:true,secondPageRecovered:true,providerRequests:await sw.evaluate(()=>queueFixture.requests),modelRequestsReplayed:0};
 await writeFile('artifacts/queued-recovery/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
 for(const page of context.pages().filter(page=>page.url().startsWith('https://queued.fixture.test/'))){
  console.error('Queue recovery panel:',await page.locator('.panel').innerText());
 }
 throw error;
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
