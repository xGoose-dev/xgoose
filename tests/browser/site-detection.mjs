import {chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-detection-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{analyticsEnabled:false,launcherVisibility:'skill-sites'}}));
 const permissions=await context.newPage();await permissions.goto(`chrome://extensions/?id=${id}`);
 assert.notEqual(await permissions.locator('#allow-user-scripts cr-toggle').getAttribute('aria-pressed'),'true');
 const cases=[
  {host:'substack.com',marker:'',skills:['substack']},
  {host:'newsletter.substack.com',marker:'',skills:['substack']},
  {host:'newsletter.example.test',marker:'<script>window._preloads={pub:{subdomain:"newsletter",name:"Publication"}}</script>',skills:['substack']},
  {host:'forum.example.test',marker:'<meta name="generator" content="Discourse 3.5">',skills:['discourse']},
  {host:'plain.example.test',marker:'<a href="https://newsletter.substack.com">Newsletter</a>',skills:[]},
  {host:'evilsubstack.com',marker:'',skills:[]},
 ];
 for(const item of cases) {
  await context.route(`https://${item.host}/**`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Detection fixture</title>${item.marker}</head><body><main>Local site-detection fixture.</main></body></html>`}));
  const page=await context.newPage();
  page.on('pageerror',e=>console.log('pageerror',item.host,e.message));
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('console',item.host,m.text());});
  await page.goto(`https://${item.host}/`);
  await page.locator('#xgoose-root').waitFor({state:'attached'});
  await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.loading-status')?.classList.contains('active')===false);
  assert.deepEqual(await page.locator('#xgoose-root .skill-chip').allTextContents(),item.skills,item.host);
  assert.equal(await page.locator('#xgoose-root .toggle').isVisible(),item.skills.length>0,item.host);
  assert.equal(await page.evaluate(()=>typeof window.xgoose?.skills?.substack==='object'),item.skills.includes('substack'),item.host);
  // The SW pushes URL candidates after registry edits. That path must also
  // retain detected-only chips and launcher visibility.
  await settings.evaluate(async url=>{
   const [tab]=await chrome.tabs.query({url});
   const skills=await chrome.runtime.sendMessage({kind:'sw:active_skills_for_url',payload:{url}});
   await chrome.tabs.sendMessage(tab.id,{kind:'cs:set_active_skills',payload:{skills}});
  },`https://${item.host}/`);
  assert.deepEqual(await page.locator('#xgoose-root .skill-chip').allTextContents(),item.skills,`${item.host}: push refresh`);
  await page.close();
 }
 console.log(JSON.stringify({passed:true,cases:cases.length,substackDomains:true,substackCustomDomain:true,discourseCustomDomain:true,ordinarySitesHidden:true,pushRefresh:true,liveSites:false}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
