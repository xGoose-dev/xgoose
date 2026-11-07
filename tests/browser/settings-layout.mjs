import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-settings-layout-')),dist=resolve('apps/chrome/dist'),out=resolve('test-results/appearance');await mkdir(out,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:1000},colorScheme:'light',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{const original=fetch;globalThis.fetch=async(input,init)=>String(input).startsWith('https://api.xgoose.org/')?Response.json({data:[]}):original(input,init);});
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/options.html#section-appearance`);await expect(page.locator('#saveBtn')).toBeEnabled();
 assert.equal(await page.locator('#section-personalization #appearance').count(),0);
 await page.locator('.settings-nav a[href="#section-appearance"]').click();await expect(page.locator('#section-appearance')).toBeInViewport();
 const measured=[];
 for(const language of ['en','zh-CN','es'])for(const width of [1280,390,320]) {
  await page.setViewportSize({width,height:1000});
  await page.evaluate(async language=>{const key='xgoose.settings',s=(await chrome.storage.local.get(key))[key];await chrome.storage.local.set({[key]:{...s,language,analyticsEnabled:false}});},language);
  // A reload also exercises the locale's initial rendering and restored maximum font size.
  for(const preset of ['default','glass','notebook','soft','bold']) {
   await page.evaluate(async preset=>{const key='xgoose.settings',s=(await chrome.storage.local.get(key))[key];await chrome.storage.local.set({[key]:{...s,theme:'light',appearance:{preset,font:'default',fontScale:1.3}}});},preset);
   await page.reload();await expect(page.locator(`[data-preset=${preset}]`)).toHaveAttribute('aria-pressed','true');await expect(page.locator('#saveBtn')).toBeEnabled();
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+0.5||r.left<-.5)&&!el.closest(".settings-nav")}).slice(0,12).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth})),controls:[...document.querySelectorAll('#appearance button,#appearance select,#appearance input,.footer button')].filter(el=>!el.hidden).map(el=>{const r=el.getBoundingClientRect();return {name:el.textContent.trim()||el.getAttribute('aria-label'),left:r.left,right:r.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth};})}));
   assert.ok(layout.scroll<=layout.width,JSON.stringify({language,width,preset,layout}));
   for(const control of layout.controls)assert.ok(control.left>=-1&&control.right<=width+1&&control.scroll<=control.client+1,JSON.stringify({language,width,preset,control}));
   measured.push({language,width,preset});
  }
 }
 // The ordinary Save action still saves its fields and retains the optional appearance choice.
 await page.setViewportSize({width:1280,height:1000});await page.evaluate(async()=>{const key='xgoose.settings',s=(await chrome.storage.local.get(key))[key];await chrome.storage.local.set({[key]:{...s,language:'zh-CN',appearance:{preset:'default',font:'default',fontScale:1}}});});await page.reload();await expect(page.locator('#saveBtn')).toBeEnabled();
 const columns=await page.locator('#section-personalization .preference-row > select').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().left));assert.ok(Math.max(...columns)-Math.min(...columns)<1);
 await page.locator('#launcherVisibility').selectOption('never');await page.locator('#saveBtn').click();await expect.poll(()=>page.evaluate(async()=>((await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']).launcherVisibility)).toBe('never');
 assert.deepEqual(await page.evaluate(async()=>((await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']).appearance),{preset:'default',font:'default',fontScale:1});
 await page.locator('#section-appearance').screenshot({path:resolve(out,'settings-aligned-desktop.png')});
 await page.locator('#section-personalization').screenshot({path:resolve(out,'personalization-aligned-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('#section-appearance').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-76));await page.screenshot({path:resolve(out,'settings-aligned-mobile.png')});
 console.log(JSON.stringify({passed:true,layouts:measured.length,locales:3,smallestWidth:320,maxFontScale:1.3,navigation:true,alignedControls:true,ordinarySavePreservesAppearance:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
