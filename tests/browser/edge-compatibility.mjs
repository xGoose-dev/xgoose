import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Exercise an official Microsoft Edge runtime in a disposable profile.
const executablePath=process.env.EDGE_EXECUTABLE_PATH;
if(!executablePath)throw new Error('Set EDGE_EXECUTABLE_PATH to the Microsoft Edge executable.');
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-edge-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{
  executablePath,
  headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],
});
context.setDefaultTimeout(20000);
try {
  const ownWorker=w=>w.url().startsWith('chrome-extension://')&&w.url().endsWith('/background.js');
  const sw=context.serviceWorkers().find(ownWorker)??await context.waitForEvent('serviceworker',{predicate:ownWorker,timeout:20000});
  const id=sw.url().split('/')[2];
  const onboarding=await context.newPage();await onboarding.goto(`chrome-extension://${id}/onboarding.html`);
  await onboarding.waitForFunction(()=>document.querySelector('#extensionDetailsUrl')?.textContent?.startsWith('edge://extensions/'));
  assert.equal(await onboarding.locator('#extensionDetailsUrl').textContent(),`edge://extensions/?id=${id}`);
  const ua=await onboarding.evaluate(()=>navigator.userAgent);assert.match(ua,/Edg\//);
  await onboarding.locator('#openExtensions').click();
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
  await settings.locator('#openUserScriptsSettings').click();
  await settings.waitForFunction(async id=>(await chrome.tabs.query({})).filter(tab=>tab.url===`edge://extensions/?id=${id}`).length>=2,id);
  await context.route('https://www.v2ex.com/**',route=>route.request().url().includes('/api/nodes/all.json')
    ?route.fulfill({json:[{id:1,name:'edge-test',title:'Edge fixture node'}]})
    :route.fulfill({contentType:'text/html',body:'<!doctype html><title>Edge test</title><main>Fixture website</main>'}));
  const website=await context.newPage();await website.goto('https://www.v2ex.com/');
  await website.waitForFunction(()=>typeof window.xgoose?.skills?.v2ex?.getNodes==='function');
  const result=await website.evaluate(()=>window.xgoose.skills.v2ex.getNodes({query:'Edge'}));
  assert.match(JSON.stringify(result),/Edge fixture node/);
  assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
  await mkdir('artifacts/edge',{recursive:true});
  await onboarding.screenshot({path:'artifacts/edge/onboarding.png',fullPage:true});
  console.log(JSON.stringify({passed:true,realEdge:!!executablePath,userAgent:ua,permissionLinks:true,builtinWithoutUserScripts:true,fixtureWebsiteOnly:true}));
} finally {
  await context.close();await rm(profile,{recursive:true,force:true});
}
