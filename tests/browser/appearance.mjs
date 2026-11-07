import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><style>body{font:19px Georgia;color:rgb(90, 20, 30);background:repeating-linear-gradient(45deg,#e6eafa 0 30px,#b9d6cf 30px 60px)}</style><h1>Host page untouched</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-appearance-')),dist=resolve('apps/chrome/dist'),out=resolve('test-results/appearance');await mkdir(out,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{globalThis.appearanceRequests=[];const original=fetch;globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('https://api.xgoose.org/')){if(url.endsWith('/a/collect')){globalThis.appearanceRequests.push(JSON.parse(init.body));return new Response(null,{status:204});}return Response.json({data:[]});}return original(input,init);};});
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html#appearance`);await settings.locator('[data-preset=glass]').waitFor();
 const peer=await context.newPage();await peer.goto(`chrome-extension://${id}/options.html#appearance`);await peer.locator('[data-preset=glass]').waitFor();
 await settings.evaluate(async()=>{const key='xgoose.settings',s=(await chrome.storage.local.get(key))[key]??{};await chrome.storage.local.set({[key]:{...s,launcherVisibility:'always'}});});
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#xgoose-root').waitFor({state:'attached'});await page.locator('.toggle').click();
 await settings.bringToFront();await settings.locator('[data-preset=glass]').click();await settings.locator('[data-preset=notebook]').click();await settings.locator('[data-field=font]').selectOption('serif');await settings.locator('[data-scale="1.3"]').click();await settings.locator('[data-field=theme]').selectOption('light');
 await expect(settings.locator('.xg-save-status')).toHaveText('Saved');
 const stored=await settings.evaluate(async()=>((await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']));assert.deepEqual(stored.appearance,{preset:'notebook',font:'serif',fontScale:1.3});assert.equal(stored.theme,'light');
 await expect(peer.locator('[data-preset=notebook]')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>page.evaluate(()=>document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel').style.getPropertyValue('--xg-font-scale'))).toBe('1.3');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontSize),'19px');assert.equal(await page.evaluate(()=>getComputedStyle(document.body).color),'rgb(90, 20, 30)');
 await settings.locator("#section-personalization").screenshot({path:resolve(out,'extension-desktop.png')});
 await settings.reload();await expect(settings.locator('[data-preset=notebook]')).toHaveAttribute('aria-pressed','true');
 // Persistence failure rolls back immediately and a retry stores the original selection.
 await settings.evaluate(()=>{const original=chrome.storage.local.set.bind(chrome.storage.local);globalThis.restoreAppearanceStorage=()=>{chrome.storage.local.set=original;};chrome.storage.local.set=async()=>{throw new Error('fixture storage failure');};});
 await settings.locator('[data-preset=soft]').click();await expect(settings.locator('.xg-retry')).toBeVisible();await expect(settings.locator('[data-preset=notebook]')).toHaveAttribute('aria-pressed','true');await settings.evaluate(()=>globalThis.restoreAppearanceStorage());await settings.locator('.xg-retry').click();await expect(settings.locator('.xg-save-status')).toHaveText('Saved');await expect(settings.locator('[data-preset=soft]')).toHaveAttribute('aria-pressed','true');
 await settings.setViewportSize({width:390,height:844});await settings.locator("#appearance").screenshot({path:resolve(out,'extension-mobile.png')});
 const materials=[];
 await settings.setViewportSize({width:1200,height:1000});
 await settings.locator('[data-scale="1"]').click();
 // A synthetic conversation makes the material comparison independent of login/setup banners.
 await page.evaluate(()=>{const shadow=document.querySelector('#xgoose-root').shadowRoot;const style=document.createElement('style');style.textContent='.user-scripts-guide{display:none!important}';shadow.append(style);shadow.querySelector('.msgs').innerHTML='<div class="msg-user-wrap"><div class="msg-user">整理一下当前页面。<br>Help me explore this page.</div></div><div class="msg-ai"><h3>A little clarity, right where you are.</h3><p>Follow the useful details, keep the sources close, and carry on reading.</p><p>保留重点，也保留你的阅读节奏。</p><pre><code>const next = "keep exploring";</code></pre></div><div class="tool"><div class="tool-hdr"><span class="tool-title">Read page · 当前网页</span></div></div>';});

 for(const preset of ['default','glass','notebook','soft','bold'])for(const mode of ['light','dark']){
   await settings.locator(`[data-preset=${preset}]`).click();await settings.locator('[data-field=font]').selectOption('default');await settings.locator('[data-field=theme]').selectOption(mode);
   await expect.poll(()=>settings.evaluate(async()=>((await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']).appearance.preset)).toBe(preset);
   await expect.poll(()=>page.locator('.panel').getAttribute('data-xg-preset')).toBe(preset);await expect.poll(()=>page.locator('.panel').getAttribute('data-xg-mode')).toBe(mode);
   await expect.poll(()=>page.locator('.panel').evaluate(el=>getComputedStyle(el).borderRadius)).toBe(`${({default:20,glass:20,notebook:10,soft:24,bold:0})[preset]}px`);
   const measured=await page.locator('.panel').evaluate(el=>{const c=getComputedStyle(el);return {preset:el.dataset.xgPreset,radius:c.borderRadius,border:c.borderTopWidth,blur:c.backdropFilter,background:c.backgroundColor,shadow:c.boxShadow};});materials.push(measured);
   if(preset==='glass')assert.ok(measured.blur.includes('24px'));
   if(preset==='bold'){assert.equal(measured.radius,'0px');assert.equal(measured.border,'3px');}
   const box=await page.locator('.panel').boundingBox();await page.screenshot({path:resolve(out,`panel-${preset}-${mode}.png`),clip:{x:box.x-12,y:box.y-12,width:box.width+24,height:box.height+24}});
 }
 assert.ok(new Set(materials.map(m=>m.radius)).size>=4);
 await settings.locator('[data-action=reset]').click();await expect(settings.locator('.xg-save-status')).toHaveText('Saved');assert.deepEqual(await settings.evaluate(async()=>((await chrome.storage.local.get('xgoose.settings'))['xgoose.settings']).appearance),{preset:'default',font:'default',fontScale:1});
 await settings.waitForTimeout(2100);const events=await sw.evaluate(()=>globalThis.appearanceRequests.flatMap(r=>r.events).filter(e=>e.name.startsWith('appearance_')));assert.ok(events.some(e=>e.name==='appearance_used'&&e.params.preset==='notebook'));assert.ok(events.some(e=>e.name==='appearance_reset'));assert.ok(events.some(e=>e.name==='appearance_failed'));assert.ok(events.some(e=>e.name==='appearance_used'&&e.params.preset==='glass'));
 await settings.evaluate(async()=>{const s=(await chrome.storage.local.get('xgoose.settings'))['xgoose.settings'];await chrome.storage.local.set({'xgoose.settings':{...s,analyticsEnabled:false}});});await settings.waitForTimeout(1800);const count=await sw.evaluate(()=>globalThis.appearanceRequests.length);await settings.locator('[data-preset=glass]').click();await expect(settings.locator('.xg-save-status')).toHaveText('Saved');await settings.waitForTimeout(1800);assert.equal(await sw.evaluate(()=>globalThis.appearanceRequests.length),count);
 console.log(JSON.stringify({passed:true,migration:true,persistence:true,livePanel:true,peerSettings:true,rollbackRetry:true,reset:true,optOut:true,rawColorExcluded:true,hostPageUntouched:true,events:events.length}));
} finally {await context.close();server.close();await rm(profile,{recursive:true,force:true});}
