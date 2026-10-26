import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const requests=[];let searches=0;
const steps=[
 ['help',{skill:'hacker-news',function:'search'}],
 ['skill_call',{skill:'hacker-news',function:'search',args:{query:'builtin fixture',limit:1}}],
 ['read_page',{format:'text',selector:'main'}],
];
const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);
 const step=steps[requests.length-1];
 const delta=step?{tool_calls:[{index:0,id:`builtin-${requests.length}`,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{content:'Built-in research succeeded without Allow User Scripts.'};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({role:'assistant',...delta})+frame({},step?'tool_calls':'stop')+'data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-builtins-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(20000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.locator('#userScriptsAlert').waitFor({state:'visible'});assert.match(await settings.locator('#userScriptsAlert').innerText(),/Built-in skills and page reading are ready/);
 assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
 const all=await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:list_skills'}));assert.equal(all.length,34);assert.ok(all.every(s=>s.enabled&&!s.userAuthored));
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},model:'luna',analyticsEnabled:false,launcherVisibility:'skill-sites'}}),base);
 await context.route('https://news.ycombinator.com/**',route=>route.fulfill({contentType:'text/html',headers:{'content-security-policy':"default-src 'self'; script-src 'none'; connect-src 'self' https://hn.algolia.com"},body:'<!doctype html><title>Built-in fixture</title><main>Visible page evidence for the built-in test.</main>'}));
 await context.route('https://hn.algolia.com/api/v1/search?**',route=>{searches++;return route.fulfill({json:{hits:[{objectID:'19',title:'Built-in fixture story',url:'https://fixture.test/source',author:'fixture',points:10,num_comments:0}],nbHits:1,page:0,nbPages:1},headers:{'access-control-allow-origin':'*'}});});
 const page=await context.newPage();await page.goto('https://news.ycombinator.com/');await page.locator('.skill-chip').filter({hasText:'hn'}).waitFor({state:'attached'});assert.equal(await page.locator('.toggle').isVisible(),true);
 await page.locator('.toggle').click();assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);await page.locator('.in-text').fill('Find the built-in fixture and read this page.');await page.locator('.btn-send').click();
 await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes('Built-in research succeeded without Allow User Scripts.'));await page.locator('.btn-stop').waitFor({state:'hidden'});
 assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);assert.equal(requests.length,4);assert.equal(searches,1);assert.equal(await page.locator('.msg-err').count(),0);
 const tools=requests[0].tools.map(t=>t.function.name);assert.ok(tools.includes('skill_call'));
 const sent=JSON.stringify(requests[0].messages);assert.match(sent,/Built-in skills ARE available/);assert.match(sent,/Do not proactively warn about User Scripts/);assert.match(sent,/input schema:/);
 const helpText=requests[1].messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('');assert.match(helpText,/"source":"live"/);assert.match(JSON.stringify(requests[2].messages),/Built-in fixture story/);assert.match(JSON.stringify(requests[3].messages),/Visible page evidence/);
 await mkdir('artifacts/builtin-skills',{recursive:true});await page.screenshot({path:'artifacts/builtin-skills/permission-off.png'});await settings.locator('#userScriptsAlert').screenshot({path:'artifacts/builtin-skills/settings-reminder.png'});
 // Ensure cleanup also runs when the last matching candidate is disabled.
 await settings.evaluate(async()=>{for(const name of ['substack','discourse-forum'])await chrome.runtime.sendMessage({kind:'sw:set_skill_disabled',payload:{name,disabled:true}});});
 // Disabled skills stay disabled; built-in registration is not an auto-install reset.
 await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:set_skill_disabled',payload:{name:'hacker-news',disabled:true}}));await page.waitForFunction(()=>!window.xgoose?.skills?.hn);await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelectorAll('.skill-chip').length===0);
 await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:set_skill_disabled',payload:{name:'hacker-news',disabled:false}}));await page.locator('.skill-chip').filter({hasText:'hn'}).waitFor({state:'attached'});
 // A local edit shadows the reviewed bundle and must not bypass Chrome's toggle.
 const source='// ==XGooseSkill==\n// @name hacker-news\n// @namespace hn\n// @version 9.0.0\n// @description Local edited fixture\n// @match https://news.ycombinator.com/*\n// ==/XGooseSkill==\nimport {defineSkill,fn} from "@xgoose/skill";\nimport {z} from "zod";\nexport default defineSkill({read:fn({summary:"Local fixture",input:z.object({}),handler:()=>"custom"})});';
 const edited=await settings.evaluate(source=>chrome.runtime.sendMessage({kind:'sw:edit_skill',payload:{name:'hacker-news',source}}),source);assert.equal(edited.ok,true);
 await page.waitForFunction(()=>!window.xgoose?.skills?.hn);await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelectorAll('.skill-chip').length===0);
 const details=await context.newPage();await details.goto(`chrome://extensions/?id=${id}`);await details.locator('#allow-user-scripts cr-toggle').click();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>typeof window.xgoose?.skills?.hn?.read==='function');assert.equal(await page.evaluate(()=>window.xgoose.skills.hn.read({})),'custom');
 await settings.bringToFront();await settings.evaluate(()=>window.dispatchEvent(new Event('focus')));await settings.locator('#userScriptsAlert').waitFor({state:'hidden'});
 await details.bringToFront();await details.locator('#allow-user-scripts cr-toggle').click();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!window.xgoose?.skills?.hn);await page.reload();await page.locator('#xgoose-root').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelectorAll('.skill-chip').length===0);
 await settings.bringToFront();await settings.evaluate(()=>window.dispatchEvent(new Event('focus')));await settings.locator('#userScriptsAlert').waitFor({state:'visible'});
 console.log(JSON.stringify({passed:true,builtins:34,permissionOff:true,strictCsp:true,liveSchemas:true,structuredInvocation:true,pageReading:true,defaultLauncher:true,settingsReminder:true,noBuiltinChatWarning:true,noAiMentionPopup:true,disabledStatePreserved:true,localEditRequiresPermission:true,enableWithoutReload:true,syntheticOnly:true}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
