import {chromium} from '@playwright/test';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const useOpenai=process.env.XGOOSE_IMAGE_TEST_OPENAI==='1',provider=useOpenai?'openai-compat':'gemini',model=useOpenai?'gpt-4.1-mini':'gemini-2.5-flash';
const key=useOpenai?process.env.OPENAI_API_KEY:process.env.XGOOSE_IMAGE_TEST_SECONDARY==='1'?process.env.XGOOSE_SECRET_GEMINI_API_KEY:(process.env.GEMINI_API||process.env.XGOOSE_SECRET_GEMINI_API_KEY);if(!key)throw Error('Vision test key is unavailable');
const imageUrl='https://tiebapic.baidu.com/forum/pic/item/d8679055564e9258afd870e9da82d158cdbf4e8b.jpg?tbpicau=2026-11-09-05_452e5f1b3085f1d495fb5216a99d0011';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-images-live-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(20000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(({key,provider,model})=>chrome.storage.local.set({'xgoose.settings':{provider,apiKeys:{[provider]:key},baseUrls:{'openai-compat':'https://api.openai.com/v1'},model,thinking:false,analyticsEnabled:false,launcherVisibility:'always'}}),{key,provider,model});
 const page=await context.newPage();await page.goto('https://tieba.baidu.com/p/11146457953');await page.locator('#xgoose-root').waitFor({state:'attached'});
 if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
 await page.locator('.btn-new').click();
 await page.locator('.in-text').fill(`这是图片通道回归测试。请必须使用 read_images 工具读取这张图片的像素：${imageUrl} 。只根据实际看到的图片回答：图中最顶部的问题是什么？列出图中至少两个吧名或讨论对象，并引用两句清楚可读的文字。不要把网页DOM正文当成图片内容，也不要使用搜索工具。用中文回答。`);await page.locator('.btn-send').click();
 let snap,last='',stable=0;const start=Date.now();
 for(let i=0;i<80;i++){
  await new Promise(r=>setTimeout(r,2500));
  snap=await page.evaluate(()=>{const r=document.querySelector('#xgoose-root').shadowRoot;return {answer:[...r.querySelectorAll('.msg-ai')].map(n=>n.textContent.trim()).filter(Boolean).at(-1)||'',loading:r.querySelector('.loading-text')?.textContent||'',errors:[...r.querySelectorAll('.msg-err')].map(n=>n.textContent),tools:[...r.querySelectorAll('.tool')].map(n=>n.textContent),status:r.querySelector('.status')?.textContent||''};});
  if(snap.errors.length)break;if(snap.answer&&snap.answer===last&&!snap.loading)stable++;else stable=0;last=snap.answer;if(stable>=3)break;
 }
 await mkdir('artifacts/shared-images-live',{recursive:true});await writeFile('artifacts/shared-images-live/result.json',JSON.stringify({provider,model,liveSite:true,liveCdn:true,liveModel:true,elapsedMs:Date.now()-start,...snap},null,2));await page.screenshot({path:'artifacts/shared-images-live/browser.png',fullPage:false});
 console.log(JSON.stringify({provider,model,liveSite:true,liveCdn:true,liveModel:true,elapsedMs:Date.now()-start,...snap}));
 assert.equal(snap.errors.length,0);assert.ok(snap.tools.some(t=>/Read image pixels/.test(t)));assert.ok(snap.tools.some(t=>/image_parts/.test(t)));assert.ok(snap.answer.length>40);
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
