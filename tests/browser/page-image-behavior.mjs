import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const profile=await mkdtemp(resolve(tmpdir(),'xgoose-page-pixels-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const fixture=await context.newPage();await fixture.setContent('<body style="margin:0;background:white"><h1 style="font:50px Arial">MAP TEST 731</h1><div style="width:240px;height:180px;background:red"></div>');
 const bytes=await fixture.screenshot({clip:{x:0,y:0,width:500,height:300}});await fixture.close();
 await context.route('https://example.com/**',route=>route.request().url().endsWith('/map.png')?route.fulfill({contentType:'image/png',body:bytes}):route.fulfill({contentType:'text/html',body:'<!doctype html><title>Image behavior test</title><h1>Weather map</h1><img src="/map.png">'}));
 await sw.evaluate(()=>{
  globalThis.pixelRequests=[];globalThis.imageDownloads=[];globalThis.pixelTool='read_images';globalThis.backgroundImage=undefined;
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
   const url=String(input);
   if(url.startsWith('https://example.com/')){
    globalThis.imageDownloads.push(url);
    return globalThis.backgroundImage ? new Response(Uint8Array.from(globalThis.backgroundImage),{headers:{'content-type':'image/png'}}) : new Response('Forbidden',{status:403});
   }
   if(!url.startsWith('https://api.xgoose.org'))return original(input,init);
   if(url.endsWith('/ai/v1/chat/completions')){
    const request=JSON.parse(init.body);globalThis.pixelRequests.push(request);
    const first=globalThis.pixelRequests.length===1;
    const delta=first?{tool_calls:[{index:0,id:'pixels',type:'function',function:{name:globalThis.pixelTool,arguments:JSON.stringify(globalThis.pixelTool==='screenshot_page'?globalThis.screenshotArgs:{urls:['https://example.com/map.png']})}}]}:{content:'Pixel attachment received.'};
    const frame=(d,finish)=>`data: ${JSON.stringify({choices:[{index:0,delta:d,finish_reason:finish}]})}\n\n`;
    return new Response(frame({role:'assistant',...delta},null)+frame({},first?'tool_calls':'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }
   if(url.endsWith('/ai/v1/models'))return Response.json({data:[{id:'luna'}]});
   if(url.endsWith('/me/quota'))return Response.json({claimable:false,granted_micros:5000000,remaining_micros:5000000,platform_paused:false,expires_at:'2100-01-01T00:00:00Z'});
   if(url.endsWith('/me/transcript-consent'))return Response.json({hosted:true,byok:false});
   return Response.json({acknowledged:[]});
  };
 });
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{provider:'xgoose-hosted',model:'luna',analyticsEnabled:false,launcherVisibility:'always'},'xgoose.account':{user:{id:'pixel-test',email:'fixture@example.test',name:'Image test',avatar_url:null,email_verified:true,is_admin:false},accessToken:'fixture',refreshToken:'fixture',accessTokenExpiresAt:'2100-01-01T00:00:00Z'}}));
 const results=[];
 for(const mode of ['page','download','screenshot','element','full-page','other-tab']){
  const page=await context.newPage();await page.goto('https://example.com/');await page.locator('#xgoose-root').waitFor({state:'attached'});
  await page.locator('img[src="/map.png"]').evaluate(img=>img.decode());
  if(mode==='download')await page.locator('img[src="/map.png"]').evaluate(img=>img.remove());
  if(mode==='full-page')await page.evaluate(()=>document.body.style.minHeight='3000px');
  await sw.evaluate(({mode,bytes})=>{globalThis.pixelRequests=[];globalThis.imageDownloads=[];globalThis.pixelTool=['screenshot','element','full-page','other-tab'].includes(mode)?'screenshot_page':'read_images';globalThis.screenshotArgs=mode==='element'?{selector:'img[src="/map.png"]'}:mode==='full-page'?{fullPage:true}:{};globalThis.backgroundImage=mode==='download'?bytes:undefined;},{mode,bytes:[...bytes]});
  let other;
  if(mode==='other-tab'){
   other=await context.newPage();await other.goto('https://example.com/other');
   await sw.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://example.com/other'});globalThis.screenshotArgs={tabId:tabs[0].id,selector:'h1'};});
  }
  await page.bringToFront();if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
  await page.locator('.btn-new').click();await page.locator('.in-text').fill('Read the image pixels.');await page.locator('.btn-send').click();
  try {await page.locator('.msg-ai').filter({hasText:'Pixel attachment received.'}).waitFor();} catch(error) {console.log(JSON.stringify({mode,panel:await page.locator('.panel').innerText(),requests:await sw.evaluate(()=>globalThis.pixelRequests.length)}));throw error;}
  const {requests,downloads}=await sw.evaluate(()=>({requests:globalThis.pixelRequests,downloads:globalThis.imageDownloads}));
  assert.equal(requests.length,2);
  const images=requests[1].messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url');
  if(!images.length)console.log(JSON.stringify({mode,tool:requests[1].messages.filter(m=>m.role==='tool')}));
  assert.equal(images.length,mode==='full-page'?2:1,`${mode}: Hosted continuation receives image pixels`);
  const data=images[0].image_url.url;assert.ok(data.startsWith('data:image/jpeg;base64,'));
  const toolText=requests[1].messages.filter(m=>m.role==='tool').map(m=>JSON.stringify(m.content)).join('');
  assert.match(toolText,/image_parts/);assert.ok(!toolText.includes(data.split(',')[1]));
  assert.equal(downloads.length,mode==='download'?1:0,`${mode}: loaded pixels and screenshots need no URL download`);
  await mkdir('artifacts/page-image-pixels',{recursive:true});await writeFile(`artifacts/page-image-pixels/${mode}-model.jpg`,Buffer.from(data.split(',')[1],'base64'));
  results.push({mode,modelReceivedPixels:true,urlDownloads:downloads.length,hostedRequestCaptured:true,mockedModel:true});
  if(other)await other.close();await page.close();
 }
 await writeFile('artifacts/page-image-pixels/result.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
