import {chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-acres-builtin-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=sw.url().split('/')[2];
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await options.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{analyticsEnabled:false,launcherVisibility:'skill-sites'}}));
 const cases=[{host:'www.1point3acres.com',path:'/home/thread/7',active:true},{host:'www.1point3acres.com',path:'/bbs/thread-7-1-1.html',active:true},{host:'plain.test',path:'/',active:false}];
 await context.route('https://api.1point3acres.com/**',route=>{
  const path=new URL(route.request().url()).pathname;
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'https://www.1point3acres.com','access-control-allow-credentials':'true'},body:JSON.stringify(path.includes('nested-posts')?{posts:[{pid:90,message_html:'Reply'}],total:1}:{thread:{tid:7,subject:'Native topic',message_html:'Native body <img src="https://images.test/original.png?keep=yes">'}})});
 });
 for(const item of cases){
  await context.route(`https://${item.host}/**`,route=>{
   const url=new URL(route.request().url());

   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Discuz fixture</title></head><body><main>Forum</main></body></html>`});
  });
  const page=await context.newPage();await page.goto(`https://${item.host}${item.path}`);
  await page.locator('#xgoose-root').waitFor({state:'attached'});
  if(item.active){
   await page.waitForFunction(()=>typeof window.xgoose?.skills?.acres?.getThread==='function');
   const result=await page.evaluate(()=>window.xgoose.skills.acres.readThread({tid:7}));
   assert.equal(result.thread.text,'Native body [image 1]');assert.equal(result.replies.posts[0].text,'Reply');
   const image=await page.evaluate(()=>window.xgoose.skills.acres.readImages({key:'thread:7',images:[1]}));
   assert.equal(image.imageContext.images[0].url,'https://images.test/original.png?keep=yes');
   assert.deepEqual(await page.locator('#xgoose-root .skill-chip').allTextContents(),['acres']);
  }else{
   await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.loading-status')?.classList.contains('active')===false);
   assert.equal(await page.evaluate(()=>typeof window.xgoose?.skills?.acres),'undefined');
  }
  await page.close();
 }
 console.log(JSON.stringify({passed:true,cases:cases.length,packagedAcres:true,userScriptsPermissionNotEnabled:true,threadAndImageRead:true,plainPageNotActivated:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
