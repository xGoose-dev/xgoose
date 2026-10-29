import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const imageUrl='https://tiebapic.baidu.com/forum/pic/item/d8679055564e9258afd870e9da82d158cdbf4e8b.jpg?tbpicau=2026-11-09-05_452e5f1b3085f1d495fb5216a99d0011';
const requests=[];let mode='direct';
const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);
 const first=requests.length===1;
 const delta=first?{tool_calls:[{index:0,id:'tieba-image',type:'function',function:{name:mode==='skill'?'skill_call':'read_images',arguments:JSON.stringify(mode==='skill'?{skill:'tieba',function:'readImages',args:{urls:[imageUrl]}}:{urls:[imageUrl]})}}]}:{content:'Tieba image bytes received by model transport.'};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({role:'assistant',...delta})+frame({},first?'tool_calls':'stop')+'data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-tieba-image-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(30000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},model:'vision-fixture',analyticsEnabled:false,launcherVisibility:'always'}}),base);
 // Only the Tieba document is synthetic; its image is fetched from the real Baidu CDN by the extension.
 await context.route('https://tieba.baidu.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Tieba image regression</title><main><div class="image-text"><div class="pb-title">Image post</div><div class="pb-content-wrap"><img src="${imageUrl.replaceAll('&','&amp;')}"></div></div></main>`}));
 await context.route('https://example.org/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>No skill image regression</title><main>Generic image reads</main>'}));
 const results=[];
 for(const scenario of [{url:'https://tieba.baidu.com/p/11146457953',mode:'direct'},{url:'https://example.org/',mode:'direct'},{url:'https://tieba.baidu.com/p/11146457953',mode:'skill'}]){
 mode=scenario.mode;requests.length=0;
 const page=await context.newPage();await page.goto(scenario.url);
 if(scenario.mode==='skill')await page.waitForFunction(()=>typeof window.xgoose?.skills?.tieba?.readImages==='function');
 await page.locator('#xgoose-root').waitFor({state:'attached'});
 if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
 await page.locator('.btn-new').click();await page.locator('.in-text').fill('Read this Tieba picture.');await page.locator('.btn-send').click();
 await page.locator('.msg-ai').filter({hasText:'Tieba image bytes received'}).waitFor();
 assert.equal(requests.length,2);
 const parts=requests[1].messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
 const allImages=parts.filter(p=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/jpeg;base64,'));
 const image=parts.find(p=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/jpeg;base64,'));

 assert.ok(image,'The continuation sent to the model must include actual image bytes');
 const toolText=requests[1].messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('');
 assert.match(toolText,/image_parts/);assert.match(toolText,/"attached":1/);assert.ok(!toolText.includes(image.image_url.url.split(',')[1]));
 await mkdir('artifacts/tieba-images',{recursive:true});
 for(const [i,part] of allImages.entries())await writeFile(`artifacts/tieba-images/model-part-${i+1}.jpg`,Buffer.from(part.image_url.url.split(',')[1],'base64'));
 const dimensions=await page.evaluate(async data=>{const b=await createImageBitmap(await(await fetch(data)).blob());const d={width:b.width,height:b.height};b.close();return d;},image.image_url.url);
 assert.equal(allImages.length,2);assert.equal(dimensions.width,1828);assert.equal(dimensions.height,1733);
 for(const part of allImages)assert.ok(part.image_url.url.length<=320050,'Hosted image transport limit');
 const result={passed:true,liveBaiduCdn:true,mockedModel:true,syntheticTiebaDocument:true,modelReceivedImageBytes:true,dimensions,segments:allImages.length,encodedBytes:Buffer.from(image.image_url.url.split(',')[1],'base64').length,imageBytesExcludedFromToolText:true,unchangedPage:page.url()};
 await mkdir('artifacts/tieba-images',{recursive:true});await writeFile('artifacts/tieba-images/result.json',JSON.stringify(result,null,2));await page.screenshot({path:'artifacts/tieba-images/transport.png'});results.push({...result,mode:scenario.mode});await page.close();
 }
 await writeFile('artifacts/tieba-images/result.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
