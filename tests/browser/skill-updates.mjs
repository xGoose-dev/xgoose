import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const pinned=JSON.parse(await readFile('apps/chrome/src/shared/builtinCatalog.json','utf8'))['hacker-news'];
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-updates-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(30000);
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=sw.url().split('/')[2];
 await sw.evaluate(()=>{
  globalThis.updateFixture={version:'1.0.0',offline:false,tamper:false};
  const original=fetch;
  const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
  globalThis.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input.url;
   if(!url.startsWith('https://api.xgoose.org'))return original(input,init);
   const f=globalThis.updateFixture;
   if(url.includes('/skills/catalog')){
    if(f.offline)throw new Error('offline fixture');
    return Response.json({version:1,items:[...(f.builtin?[f.builtin]:[]),{id:'community-id',authorId:f.changedAuthor?'impostor':'author-id',slug:'update-test',name:'update-test',namespace:'updateTest',description:'Update fixture',version:f.version,matches:['https://example.test/*'],include:[],exclude:[],dependencies:[]}]});
   }
   if(url.includes('/skills/update-test/install')){
    const source=`// ==XGooseSkill==\n// @name update-test\n// @namespace updateTest\n// @version ${f.version}\n// @match https://example.test/*\n// ==/XGooseSkill==\nimport {defineSkill,fn} from '@xgoose/skill';\nimport {z} from 'zod';\nexport default defineSkill({read:fn({summary:'Read',input:z.object({}),handler:()=> '${f.version}'})});`;
    return Response.json({identity:{authorId:'author-id',skillId:'community-id'},version:f.version,skill:{source,bundled:'verified-bundle'},source_sha256:f.tamper?'bad':await sha(source),bundle_sha256:await sha('verified-bundle')});
   }
   return Response.json({data:[{id:'luna'}]});
  };
 });
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/options.html#section-skills`);
 const send=(kind,payload)=>page.evaluate(({kind,payload})=>chrome.runtime.sendMessage({kind,payload}),{kind,payload});
 await send('sw:install_catalog_skill',{slug:'update-test',version:'1.0.0'});
 await page.evaluate(()=>chrome.storage.local.set({'xgoose.skills.disabled':['update-test']}));
 await sw.evaluate(()=>globalThis.updateFixture.version='1.1.0');
 await page.getByRole('button',{name:'Check for updates',exact:true}).click();
 await page.locator('#skillUpdateList').getByText('1.0.0 → 1.1.0',{exact:true}).waitFor();
 assert.equal(await sw.evaluate(()=>chrome.action.getBadgeText({})),'1');
 await page.getByText('Review update',{exact:true}).click();
 await mkdir('artifacts/skill-updates',{recursive:true});await page.locator('#skillUpdates').screenshot({path:'artifacts/skill-updates/available.png'});
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Update update-test',exact:true}).click();
 assert.equal((await send('sw:get_user_skill',{name:'update-test'})).version,'1.0.0');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Update update-test',exact:true}).click();
 await page.locator('#skillUpdateStatus').filter({hasText:'updated to 1.1.0'}).waitFor();
 assert.equal((await send('sw:get_user_skill',{name:'update-test'})).version,'1.1.0');
 assert.equal((await send('sw:list_skills')).find(s=>s.name==='update-test').enabled,false);
 assert.equal(await sw.evaluate(()=>chrome.action.getBadgeText({})), '');
 // Local modifications remain visible, and corrupted downloads cannot replace them.
 await page.evaluate(async()=>{const k='xgoose.skills.user';const d=await chrome.storage.local.get(k);d[k].find(s=>s.name==='update-test').source+='\n// local edit';await chrome.storage.local.set(d);});
 await sw.evaluate(()=>{globalThis.updateFixture.version='1.2.0';globalThis.updateFixture.tamper=true;});
 await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.getByText('1.1.0 → 1.2.0 · Contains local edits',{exact:true}).waitFor();
 page.once('dialog',async d=>{assert.match(d.message(),/replaces your local edits/);await d.accept();});await page.getByRole('button',{name:'Update update-test',exact:true}).click();
 await page.locator('#skillUpdateStatus').filter({hasText:'digest mismatch'}).waitFor();
 assert.match((await send('sw:get_user_skill',{name:'update-test'})).source,/local edit/);
 await sw.evaluate(()=>globalThis.updateFixture.offline=true);
 await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.locator('#skillUpdateStatus').filter({hasText:'Could not check'}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await sw.evaluate(pinned=>{globalThis.updateFixture.offline=false;globalThis.updateFixture.changedAuthor=true;globalThis.updateFixture.builtin={id:pinned.skillId,authorId:pinned.authorId,slug:'hacker-news',name:'hacker-news',namespace:'hn',description:'Built in update',version:'99.0.0',matches:['https://news.ycombinator.com/*'],include:[],exclude:[],dependencies:[]};},pinned);
 const verified=await send('sw:skill_updates',{check:true});
 assert.equal(verified.updates.some(s=>s.name==='update-test'),false);
 assert.equal(verified.updates.some(s=>s.name==='hacker-news'),true);
 // Legacy local Amex imports must expose an explicit, cancellable link/update.
 const amexPin=JSON.parse(await readFile('apps/chrome/src/shared/builtinCatalog.json','utf8'))['amex-chat'];
 const localSource="// ==XGooseSkill==\n// @name amex-chat\n// @namespace amexchat\n// @version 0.1.0\n// @match https://global.americanexpress.com/*\n// ==/XGooseSkill==\nimport {defineSkill,fn} from '@xgoose/skill';\nimport {z} from 'zod';\nexport default defineSkill({read:fn({summary:'Local fixture',input:z.object({}),handler:()=> 'local'})});";
 const edit=await send('sw:edit_skill',{name:'amex-chat',source:localSource});assert.equal(edit.ok,true,JSON.stringify(edit));
 await page.evaluate(async()=>{const key='xgoose.skills.user',data=await chrome.storage.local.get(key);delete data[key].find(s=>s.name==='amex-chat').identity;await chrome.storage.local.set(data);});
 await sw.evaluate(pin=>{globalThis.updateFixture.builtin={id:pin.skillId,authorId:pin.authorId,slug:'amex-chat',name:'amex-chat',namespace:'amexchat',description:'Pinned Amex fixture',version:'99.0.0',matches:['https://global.americanexpress.com/*'],include:[],exclude:[],dependencies:[]};},amexPin);
 await page.reload();await page.getByRole('button',{name:'Check for updates',exact:true}).click();
 const link=page.getByRole('button',{name:'Link and update amex-chat',exact:true});await link.waitFor();
 page.once('dialog',async d=>{assert.match(d.message(),/links your local skill/);await d.dismiss();});await link.click();
 assert.equal((await send('sw:get_user_skill',{name:'amex-chat'})).version,'0.1.0');
 await page.locator('#installedSkillSummary').click();
 const uninstall=page.getByRole('button',{name:'Uninstall amex-chat',exact:true});await uninstall.waitFor();
 page.once('dialog',d=>d.dismiss());await uninstall.click();assert.equal((await send('sw:get_user_skill',{name:'amex-chat'})).version,'0.1.0');
 page.once('dialog',d=>d.accept());await uninstall.click();await uninstall.waitFor({state:'hidden'});
 assert.equal(await send('sw:get_user_skill',{name:'amex-chat'}),null);
 const restored=(await send('sw:list_skills')).find(skill=>skill.name==='amex-chat');assert.equal(restored.version,JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8')).find(skill=>skill.name==='amex-chat').version);assert.equal(restored.userAuthored,false);
 await mkdir('artifacts/skill-updates',{recursive:true});await page.screenshot({path:'artifacts/skill-updates/uninstalled-restored-builtin.png',fullPage:true});
 console.log(JSON.stringify({passed:true,legacyAmexLink:true,uninstallCancel:true,uninstallRestoresBuiltin:true,detect:true,badge:true,decline:true,update:true,preserveDisabled:true,localEditWarning:true,digestProtection:true,offline:true,mobile:true}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
