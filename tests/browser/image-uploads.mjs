import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-images-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},colorScheme:'light',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{
  globalThis.imageRequests=[];const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input.url;
   if(!url.startsWith('https://api.xgoose.org'))return original(input,init);
   if(url.endsWith('/ai/v1/chat/completions')){
    const request=JSON.parse(init.body);globalThis.imageRequests.push(request);
    await new Promise(resolve=>setTimeout(resolve,700));
    const data={choices:[{index:0,delta:{role:'assistant',content:'Image received by the Hosted transport.'},finish_reason:null}]};
    return new Response(`data: ${JSON.stringify(data)}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
   }
   if(url.endsWith('/me/transcript-consent'))return Response.json({hosted:true,byok:false});
   if(url.endsWith('/ai/v1/models'))return Response.json({data:[{id:'luna'}]});
   if(url.endsWith('/me/quota'))return Response.json({claimable:false,granted_micros:5000000,remaining_micros:5000000,expires_at:'2100-01-01T00:00:00Z',platform_paused:false});
   return Response.json({acknowledged:[]});
  };
 });
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{provider:'xgoose-hosted',model:'luna',analyticsEnabled:false,launcherVisibility:'always'},'xgoose.account':{user:{id:'image-test',email:'test@example.test',name:'Image test',avatar_url:null,email_verified:true,is_admin:false},accessToken:'fixture',refreshToken:'fixture',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:Date.now()}}));
 await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Image attachment demo</title><h1>Image attachment test</h1>'}));
 const fixture=await context.newPage();await fixture.setContent('<body style="margin:0;background:#eef2ff"><div style="width:600px;height:400px;display:grid;place-items:center;font:48px Arial;color:#31265c">A red circle<div style="width:150px;height:150px;border-radius:50%;background:#e84d4d"></div></div>');
 const image=await fixture.screenshot({clip:{x:0,y:0,width:600,height:400}});await fixture.close();
 const file={name:'circle.png',mimeType:'image/png',buffer:image};
 const page=await context.newPage();await page.goto('https://example.com/');await page.locator('.toggle').click();
 await page.locator('.image-file').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('not image')});await page.locator('.image-error').filter({hasText:'PNG, JPEG or WebP'}).waitFor();
 await page.locator('.image-file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await page.locator('.image-error').waitFor({state:'visible'});
 await page.locator('.image-file').setInputFiles({name:'large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(20*1024*1024+1)});await page.locator('.image-error').filter({hasText:'smaller than 20 MB'}).waitFor();
 await page.evaluate(async base64=>{const blob=await (await fetch('data:image/png;base64,'+base64)).blob();const clipboardData=new DataTransfer();clipboardData.items.add(new File([blob],'circle.png',{type:'image/png'}));document.querySelector('#xgoose-root').shadowRoot.querySelector('.in-text').dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));},image.toString('base64'));await page.locator('.image-preview img').waitFor();
 await page.getByRole('button',{name:'Remove circle.png',exact:true}).click();assert.equal(await page.locator('.image-preview').count(),0);
 await page.locator('.image-file').setInputFiles([file,file,file,file]);await page.locator('.image-error').filter({hasText:'up to 3'}).waitFor();assert.equal(await page.locator('.image-preview').count(),3);
 await page.locator('.btn-new').click();assert.equal(await page.locator('.image-preview').count(),0);
 await page.locator('.image-file').setInputFiles(file);await page.locator('.image-preview img').waitFor();await page.locator('.in-text').fill('Describe this image.');
 await mkdir('artifacts/image-uploads',{recursive:true});await page.locator('.panel').screenshot({path:'artifacts/image-uploads/preview.png'});
 await page.locator('.btn-send').click();await page.locator('.msg-user img').waitFor();
 // A queued image stays with its own prompt and is not discarded between turns.
 await page.locator('.image-file').setInputFiles(file);await page.locator('.image-preview img').waitFor();await page.locator('.in-text').fill('Compare with this second image.');await page.locator('.btn-send').click();
 await page.waitForTimeout(2200);
 await page.locator('.msg-ai').nth(1).waitFor();
 await page.waitForTimeout(1500);
 const requests=await sw.evaluate(()=>globalThis.imageRequests);assert.equal(requests.length,2);assert.equal(requests[0].model,'luna');
 for(const request of requests){const parts=request.messages.filter(message=>message.role==='user').flatMap(message=>Array.isArray(message.content)?message.content:[]);assert.ok(parts.some(part=>part.type==='image_url'&&part.image_url.url.startsWith('data:image/jpeg;base64,')));}
 assert.equal(requests[1].messages.filter(m=>m.role==='user').flatMap(m=>m.content).filter(p=>p?.type==='image_url').length,2);
 await page.reload();await page.locator('#xgoose-root').waitFor({state:'attached'});if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('.history-item').first().click();await page.locator('.msg-user img').first().waitFor();assert.equal(await page.locator('.msg-user img').count(),2);
 // Image-only sends get an actionable default prompt.
 await page.locator('.btn-new').click();await page.locator('.image-file').setInputFiles(file);await page.locator('.image-preview img').waitFor();await page.locator('.btn-send').click();await page.locator('.msg-user').filter({hasText:'What is in this image?'}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('.panel').screenshot({path:'artifacts/image-uploads/mobile.png'});
 console.log(JSON.stringify({passed:true,hostedLunaImagePayload:true,previewAndRemove:true,corruptAndWrongType:true,threeImageLimit:true,oversizedFile:true,clipboardPaste:true,queuedImagesPreserved:true,historyReload:true,imageOnly:true,mobile:true,liveHosted:false}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
