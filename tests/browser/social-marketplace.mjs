// Live marketplace acceptance, no model key or personal browser profile.
// Installs each release once into a disposable extension profile.
import {chromium} from '@playwright/test';
import {mkdtemp, rm, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=text=>createHash('sha256').update(text).digest('hex');
const cases=[['v2ex','v2ex',20,'0.2.1'],['weibo','weibo',11,'0.2.2'],['nga','nga',8,'0.1.3'],['reddit','reddit',13,'0.1.1']];
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-marketplace-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{
  channel:'chromium',headless:true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),
  args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],
});
const report=[];
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const extensionId=worker.url().split('/')[2];
  const permissions=await context.newPage();await permissions.goto(`chrome://extensions/?id=${extensionId}`);
  const toggle=permissions.locator('#allow-user-scripts').locator('cr-toggle');
  if(await toggle.count()&&await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
  const installer=await context.newPage();await installer.goto(`chrome-extension://${extensionId}/options.html`);
  for(const[slug,namespace,count,version]of cases){
    const response=await fetch(`https://api.xgoose.org/skills/${slug}`,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);const detail=await response.json();
    const release=detail.latest_version;
    assert.equal(release.version,version);assert.equal(detail.namespace,namespace);
    assert.equal(release.functions.length,count);
    const source=await readFile(resolve('../xgoose-skills',`${slug}.xgs.js`),'utf8');
    assert.equal(sha(release.source),sha(source));
    const raw=await fetch(`https://api.xgoose.org/skills/${slug}.xgs.js`,{signal:AbortSignal.timeout(30000)});
    assert.equal(raw.status,200);const download=await raw.text();
    assert.match(download,new RegExp('@name\\s+'+slug));
    // Exercise the same raw-file handoff and confirmation page as the site's
    // Install link, rather than bypassing it with the background RPC.
    const installPage=await context.newPage();
    await installPage.goto(`https://api.xgoose.org/skills/${slug}.xgs.js`);
    await installPage.waitForURL(`chrome-extension://${extensionId}/install.html?stash=*`);
    await installPage.locator('#installBtn').click();
    await installPage.locator('#installStatus').filter({hasText:`Installed · ${slug}@${version}`}).waitFor();
    await installPage.close();
    const stored=await installer.evaluate(({slug})=>chrome.runtime.sendMessage({kind:'sw:get_user_skill',payload:{name:slug}}),{slug});
    assert.ok(stored?.identity,JSON.stringify(stored));assert.equal(stored.identity.skillId,detail.id);
    assert.equal(stored.identity.authorId,detail.owner.id);
    assert.equal(stored.sourceSha,sha(source));assert.equal(stored.actions.length,slug==='nga'?5:4);
    assert.equal(sha(stored.bundled),stored.bundleSha);
    report.push({slug,version:release.version,functions:count,sourceSha:sha(source),installed:true});
    console.log(`PASS published metadata + download + catalog installation: ${slug} (${count} functions)`);
  }
  const list=await installer.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:list_skills'}));
  assert.ok(Array.isArray(list));
  for(const[slug,,count]of cases){const skill=list.find(skill=>skill.name===slug);assert.ok(skill?.enabled);// Local static summaries may not recognize helper declarations. Verify all
    // callable schemas from the injected runtime below instead.
    assert.ok(Array.isArray(skill.functions));}
  const probe=await context.newPage();
  await probe.route('**/*',route=>new URL(route.request().url()).pathname==='/ajax/statuses/hot_band'?route.fulfill({json:{data:{band_list:[{word:'Fixture search'}]}}}):route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Installed reader execution</title></head><body><main><p>Test page.</p></main></body></html>'}));
  const hosts={v2ex:'www.v2ex.com',weibo:'weibo.com',nga:'bbs.nga.cn',reddit:'www.reddit.com'};
  for(const[slug,namespace,count,version]of cases){
    await probe.goto(`https://${hosts[slug]}/`);
    await probe.waitForFunction(ns=>typeof window.xgoose?.skills?.[ns]?.__describe__==='function',namespace);
    const result=await probe.evaluate(async ns=>({functions:Object.keys(window.xgoose.skills[ns].__describe__()).length,quota:await (ns==='weibo'?window.xgoose.skills[ns].getHotSearch({limit:1}):window.xgoose.skills[ns].getRateLimit({}))}),namespace);
    assert.equal(result.functions,count);assert.ok(result.quota);
    console.log(`PASS marketplace-installed code executes on matching page: ${namespace}`);
  }
  await mkdir('artifacts/marketplace',{recursive:true});
  await writeFile('artifacts/marketplace/social-readers-report.json',JSON.stringify({passed:true,kind:'live-marketplace',report},null,2));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
