// Verify the actual published artifacts in a disposable extension profile.
// Website API bodies are fixtures; marketplace metadata/install packages are live.
import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=s=>createHash('sha256').update(s).digest('hex');
const cases=[['weibo','0.2.4',11,'weibo.com'],['nga','0.1.5',8,'bbs.nga.cn']];
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-skill-fixes-marketplace-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(30000);
const report=[];
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=sw.url().split('/')[2];
 const permissions=await context.newPage();await permissions.goto(`chrome://extensions/?id=${id}`);
 const toggle=permissions.locator('#allow-user-scripts').locator('cr-toggle');
 if(await toggle.count()&&await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 for(const[name,version,count,host]of cases){
  const r=await fetch(`https://api.xgoose.org/skills/${name}`);assert.equal(r.status,200);const detail=await r.json();
  const source=await readFile(`apps/chrome/skills/${name}.xgs.js`,'utf8');
  assert.equal(detail.latest_version.version,version);assert.equal(detail.latest_version.functions.length,count);assert.equal(sha(source),sha(detail.latest_version.source));
  const install=await context.newPage();await install.goto(`https://api.xgoose.org/skills/${name}.xgs.js`);
  await install.waitForURL(`chrome-extension://${id}/install.html?stash=*`);await install.locator('#installBtn').click();
  await install.locator('#installStatus').filter({hasText:`Installed · ${name}@${version}`}).waitFor();
  const stored=await settings.evaluate(name=>chrome.runtime.sendMessage({kind:'sw:get_user_skill',payload:{name}}),name);
  assert.equal(stored.version,version);assert.equal(stored.sourceSha,sha(source));assert.equal(stored.identity.skillId,detail.id);assert.equal(sha(stored.bundled),stored.bundleSha);
  await install.close();
  let apiCalls=0;const page=await context.newPage();
  await page.route(`https://${host}/**`,route=>{
   const url=new URL(route.request().url());
   if(name==='weibo'&&url.pathname==='/ajax/statuses/search'){
    apiCalls++;assert.equal(url.searchParams.get('atten'),'0');assert.equal(url.searchParams.get('q'),'济南 居民养老保险');
    return route.fulfill({json:{ok:1,statuses:[{id:1,idstr:'1',mblogid:'abc',text:'Published Weibo search hit',user:{id:2,screen_name:'Fixture'}}]}});
   }
   if(name==='nga'&&url.pathname==='/read.php'){
    apiCalls++;if(apiCalls===1)return route.fulfill({contentType:'application/json',body:'{"data":{"__R":[{"content":"bad\\u'});
    assert.ok(url.searchParams.has('_'));return route.fulfill({json:{data:{__PAGE:1,__ROWS:1,__T:{tid:47786615,subject:'Published NGA recovery'},__R:[{pid:0,lou:0,content:'Published NGA body read'}]}}});
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Published skill execution</title><main>Fixture website</main>'});
  });
  await page.goto(`https://${host}/`);await page.waitForFunction(name=>typeof window.xgoose?.skills?.[name]?.__describe__==='function',name);
  const value=await page.evaluate(async name=>name==='weibo'?await xgoose.skills.weibo.searchStatuses({query:'济南 居民养老保险'}):await xgoose.skills.nga.getTopic({tid:'47786615',limit:1}),name);
  assert.ok(JSON.stringify(value).includes(name==='weibo'?'Published Weibo search hit':'Published NGA body read'));
  assert.equal(apiCalls,name==='weibo'?1:2);assert.equal(page.url(),`https://${host}/`);
  report.push({name,version,sourceSha256:sha(source),publishedPackageInstalled:true,executed:true,apiCalls,fixtureWebsiteOnly:true});await page.close();
 }
 await mkdir('artifacts/skill-fixes',{recursive:true});await writeFile('artifacts/skill-fixes/marketplace-report.json',JSON.stringify({passed:true,report},null,2));
 console.log(JSON.stringify({passed:true,report}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
