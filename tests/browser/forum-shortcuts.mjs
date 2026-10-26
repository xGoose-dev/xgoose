import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-shortcuts-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{analyticsEnabled:false,launcherVisibility:'skill-sites'}}));
 const permissions=await context.newPage();await permissions.goto(`chrome://extensions/?id=${id}`);
 assert.notEqual(await permissions.locator('#allow-user-scripts cr-toggle').getAttribute('aria-pressed'),'true');
 await context.route(/^https:\/\/(www\.uscardforum\.com|linux\.do|forum\.example\.test|plain\.example\.test)\//,route=>{
  const forum=!route.request().url().includes('plain.example.test');
  return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Forum shortcut test</title>${forum?'<meta name="generator" content="Discourse">':''}</head><body><main><h1>Forum fixture</h1><p>Local shortcut display test.</p></main></body></html>`});
 });
 await mkdir('artifacts/shortcuts',{recursive:true});
 const generic=['Latest topics','Summarize this thread','Surprise me randomly'];
 for(const host of ['www.uscardforum.com','linux.do','forum.example.test','plain.example.test']) {
  const page=await context.newPage();await page.goto(`https://${host}/t/fixture/42`);
  await page.locator('#xgoose-root').waitFor({state:'attached'});
  await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.loading-status')?.classList.contains('active')===false);
  if(host==='plain.example.test') {
   await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.shortcuts')?.children.length===0);
   assert.equal(await page.locator('#xgoose-root .shortcuts button').count(),0);
   assert.equal(await page.locator('#xgoose-root .skill-chip').count(),0);
   assert.equal(await page.locator('#xgoose-root .toggle').isVisible(),false);
  } else {
   assert.deepEqual(await page.locator('#xgoose-root .skill-chip').allTextContents(),host==='www.uscardforum.com'?['discourse','uscf']:['discourse']);
   await page.locator('#xgoose-root .toggle').click();
   const shortcuts=page.locator('#xgoose-root .shortcuts button');
   await shortcuts.filter({hasText:'Surprise me randomly'}).waitFor();
   assert.deepEqual(await shortcuts.allTextContents(),host==='www.uscardforum.com'?[...generic,'Recent deals']:generic);
   await page.screenshot({path:`artifacts/shortcuts/${host}-desktop.png`});
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:`artifacts/shortcuts/${host}-mobile.png`});
  }
  await page.close();
 }
 console.log(JSON.stringify({passed:true,sharedDiscourseActions:true,uscfDeals:true,customDiscourseDomain:true,noActionsOnNonDiscourse:true,liveForum:false}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
