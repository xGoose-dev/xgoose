import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-notifications-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await expect.poll(()=>sw.evaluate(()=>typeof setTimeout==='function'&&!!chrome.permissions),{timeout:20000}).toBe(true);
 await sw.evaluate(async()=>{
  if(!chrome.permissions)throw new Error("Worker bindings missing: "+JSON.stringify({keys:Object.keys(chrome),url:location.href}));
  const original=fetch,contains=chrome.permissions.contains.bind(chrome.permissions);
  globalThis.notificationFixture={created:[],uploads:[],permission:true,clicked:null};
  chrome.permissions.contains=opts=>opts.permissions?.includes('notifications')?Promise.resolve(notificationFixture.permission):contains(opts);
  chrome.notifications={create:async(id,options)=>{notificationFixture.created.push({id,options});return id;},clear:async()=>true,onClicked:{addListener:fn=>notificationFixture.clicked=fn}};
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init);if(!req.url.startsWith('https://api.xgoose.org'))return original(input,init);
   if(req.url.endsWith('/me/transcript-consent'))return Response.json({hosted:true,byok:false});
   if(req.url.endsWith('/transcripts/events')){const batch=await req.json();notificationFixture.uploads.push(batch);return Response.json({acknowledged:batch.events.map(e=>e.id)});}
   if(req.url.endsWith('/me/quota'))return Response.json({granted_micros:5000000,remaining_micros:5000000,expires_at:'2100-01-01',platform_paused:false});
   return Response.json({items:[],data:[]});
  };
  await chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},model:'luna',language:'en',analyticsEnabled:false},'xgoose.account':{user:{id:'owner',email:'fixture@example.test',name:'Fixture',avatar_url:null,email_verified:true,is_admin:false},accessToken:'fixture',refreshToken:'fixture',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:0},'xgoose.transcript-consent:owner':{hosted:true,byok:false}});
 });
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 assert.equal(await options.locator('#notificationsEnabled').isChecked(),false);
 await options.evaluate(()=>{globalThis.permissionRequests=0;chrome.permissions.request=async()=>{permissionRequests++;return true;};});
 await options.locator('#notificationsEnabled').check();
 await options.waitForFunction(async()=>(await chrome.storage.local.get('xgoose.notifications.enabled'))['xgoose.notifications.enabled']===true);
 assert.equal(await options.evaluate(()=>permissionRequests),1);
 const agent=await context.newPage();await agent.goto(`chrome-extension://${id}/agent.html`);
 const tabId=await agent.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
 const explicit=await agent.evaluate(tabId=>chrome.runtime.sendMessage({kind:'sw:notification_emit',payload:{mode:'explicit',runId:'explicit-run',tabId,title:'Research ready',message:'Read your sources.'}}),tabId);
 assert.equal(explicit.sent,true);
 await options.bringToFront();
 await agent.evaluate(async tabId=>{
  const record=(type,extra={})=>chrome.runtime.sendMessage({kind:'sw:transcript_event',payload:{id:crypto.randomUUID(),sessionId:'notification-session',runId:'auto-run',provider:'hosted',at:Date.now(),event:{type,...extra}}});
  await record('tool-call',{toolName:'search_web',input:{query:'PUBLIC_QUERY'}});
  await record('tool-result',{toolName:'search_web',output:{provider:'exa',results:[{url:'https://example.org',highlights:['PUBLIC_SOURCE']}],charged_micros:7000}});
  await record('tool-call',{toolName:'emit_notification',input:{title:'Research ready',message:'Read your sources.'}});
  await record('tool-result',{toolName:'emit_notification',output:{sent:true,reason:'sent'}});
  await record('run-end',{outcome:'completed',sourceTabId:tabId});
 },tabId);
 await expect.poll(()=>sw.evaluate(()=>notificationFixture.uploads.flatMap(b=>b.events).some(e=>e.kind==='notification')),{timeout:20000}).toBe(true);
 const state=await sw.evaluate(()=>notificationFixture);
 assert.equal(state.created.length,2);const events=state.uploads.flatMap(b=>b.events);
 const automatic=events.find(e=>e.kind==='notification'&&e.body.receipt.sent===true);assert.ok(automatic);assert.equal(automatic.body.receipt.title,'xgoose task complete');assert.equal(typeof automatic.body.receipt.message,'string');
 assert.match(JSON.stringify(events),/PUBLIC_QUERY/);assert.match(JSON.stringify(events),/PUBLIC_SOURCE/);assert.match(JSON.stringify(events),/emit_notification/);
 await options.locator('#notificationsEnabled').uncheck();
 await options.waitForFunction(async()=>(await chrome.storage.local.get('xgoose.notifications.enabled'))['xgoose.notifications.enabled']===false);
 const disabled=await agent.evaluate(tabId=>chrome.runtime.sendMessage({kind:'sw:notification_emit',payload:{mode:'explicit',runId:'disabled-run',tabId,title:'Ignored',message:'Disabled'}}),tabId);
 assert.equal(disabled.reason,'disabled');
 console.log(JSON.stringify({passed:true,syntheticOnly:true,defaultOff:true,userGesturePermission:true,explicitAndBackgroundCompletion:true,transcriptKinds:events.map(e=>e.kind),searchAndNotificationContentUploaded:true,disableStopsDelivery:true}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
