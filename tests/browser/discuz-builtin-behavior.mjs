import {chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-discuz-builtin-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=sw.url().split('/')[2];
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await options.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{analyticsEnabled:false,launcherVisibility:'skill-sites'}}));
 const cases=[{host:'discuz-meta.test',marker:'<meta name="generator" content="Discuz! X3.5">',active:true},{host:'discuz-legacy.test',marker:'<script>var discuz_uid="0";</script>',active:true},{host:'plain.test',marker:'',active:false}];
 for(const item of cases){
  await context.route(`https://${item.host}/**`,route=>{
   const url=new URL(route.request().url());
   if(url.pathname.includes('/api/mobile/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({Variables:{thread:{tid:'7',subject:'Built-in topic',replies:'0'},ppp:'20',postlist:[{pid:'90',number:'1',dbdateline:'1700000000',message:'Built-in body <img src="https://images.test/original.png?keep=yes">'}]}})});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head>${item.marker}<title>Discuz fixture</title></head><body><main>Forum</main></body></html>`});
  });
  const page=await context.newPage();await page.goto(`https://${item.host}/forum.php?mod=viewthread&tid=7`);
  await page.locator('#xgoose-root').waitFor({state:'attached'});
  if(item.active){
   await page.waitForFunction(()=>typeof window.xgoose?.skills?.discuz?.getPost==='function');
   const result=await page.evaluate(()=>window.xgoose.skills.discuz.getThread({threadId:7}));
   assert.equal(result.posts[0].text,'Built-in body [image 1]');
   const image=await page.evaluate(()=>window.xgoose.skills.discuz.readPostImages({threadId:7,postId:90,images:[1]}));
   assert.equal(image.imageContext.images[0].url,'https://images.test/original.png?keep=yes');
   assert.deepEqual(await page.locator('#xgoose-root .skill-chip').allTextContents(),['discuz']);
  }else{
   await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.loading-status')?.classList.contains('active')===false);
   assert.equal(await page.evaluate(()=>typeof window.xgoose?.skills?.discuz),'undefined');
  }
  await page.close();
 }
 console.log(JSON.stringify({passed:true,cases:cases.length,packagedDiscuz:true,userScriptsPermissionNotEnabled:true,threadAndImageRead:true,plainPageNotActivated:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
