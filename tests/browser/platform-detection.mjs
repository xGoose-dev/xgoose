import {chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-platform-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
const source=`// ==XGooseSkill==
// @name         discuz-forum
// @namespace    discuz
// @version      0.0.1
// @description  Platform-detection fixture
// @match        https://*/*
// @detect       !!document.querySelector('meta[name="generator"][content^="Discuz!"]') || typeof window.discuz_uid !== 'undefined'
// @primary      ping
// ==/XGooseSkill==
import {defineSkill,fn,z} from '@xgoose/skill';
export default defineSkill({ping:fn({description:'Fixture call',input:z.object({}),output:z.string(),handler:async()=>'pong'})});
`;
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{analyticsEnabled:false,launcherVisibility:'skill-sites'}}));
 const saved=await settings.evaluate(source=>chrome.runtime.sendMessage({kind:'sw:edit_skill',payload:{name:'discuz-forum',source}}),source);
 assert.equal(saved.ok,true,JSON.stringify(saved));
 const permission=await context.newPage();await permission.goto(`chrome://extensions/?id=${id}`);await permission.locator('#allow-user-scripts cr-toggle').click();
 await permission.close();
 const cases=[
  {host:'bbs.example.test',marker:'<meta name="generator" content="Discuz! X3.5">',active:true},
  {host:'legacy.example.test',marker:'<script>var discuz_uid = \'0\';</script>',active:true},
  {host:'plain.example.test',marker:'<script>var uid = 0;</script>',active:false},
 ];
 for(const item of cases) {
  await context.route(`https://${item.host}/**`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Platform fixture</title>${item.marker}</head><body><main>Local platform-detection fixture.</main></body></html>`}));
  const page=await context.newPage();
  page.on('pageerror',e=>console.log('pageerror',item.host,e.message));
  await page.goto(`https://${item.host}/`);
  await page.locator('#xgoose-root').waitFor({state:'attached'});
  await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.loading-status')?.classList.contains('active')===false);
  assert.deepEqual(await page.locator('#xgoose-root .skill-chip').allTextContents(),item.active?['discuz']:[],item.host);
  if(item.active) assert.equal(await page.evaluate(()=>window.xgoose.skills.discuz.ping({})),'pong',item.host);
  // Rejected pages never receive the bundle or the shared user-skill runtime.
  else assert.deepEqual(await page.evaluate(()=>[typeof window.xgoose?.skills?.discuz,typeof window.__xgooseSkillRuntime]),['undefined','undefined'],item.host);
  await page.close();
 }
 console.log(JSON.stringify({passed:true,cases:cases.length,generatorMeta:true,inlineDiscuzUid:true,plainPageNotInjected:true}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
