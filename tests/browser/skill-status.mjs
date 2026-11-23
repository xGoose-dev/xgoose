import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Local forum and provider fixtures only; no request reaches a real forum/model.
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-skill-status-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try {
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await expect.poll(()=>sw.evaluate(()=>!!chrome.scripting?.executeScript)).toBe(true);
 await sw.evaluate(async()=>{
  const execute=chrome.scripting.executeScript.bind(chrome.scripting),fetchOriginal=fetch;
  globalThis.skillStatusFixture={mode:'startup-empty',snapshots:0,requests:[]};
  chrome.scripting.executeScript=async options=>{
   const result=await execute(options),state=skillStatusFixture;
   if(result.some(entry=>entry.result?.discourse?.functions)) {
    state.snapshots++;
    if(state.snapshots===(state.mode==='startup-empty'?1:2))return result.map(entry=>({...entry,result:{}}));
   }
   return result;
  };
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url);
   if(url.hostname==='skill-status-provider.fixture.test') {
    const state=skillStatusFixture,body=await req.json();state.requests.push(body);
    const call=state.mode==='startup-empty'&&state.requests.length===1;
    const delta=call?{tool_calls:[{index:0,id:'forum-site',type:'function',function:{name:'skill_call',arguments:JSON.stringify({skill:'discourse',function:'getSite',args:{}})}}]}:{content:'SKILL_STATUS_COMPLETE'};
    const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
    return new Response(frame(delta)+frame({},call?'tool_calls':'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }
   if(url.hostname==='api.xgoose.org')return Response.json({items:[],data:[],acknowledged:[]});
   return fetchOriginal(input,init);
  };
  await chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',model:'fixture',language:'zh-CN',thinking:false,analyticsEnabled:false,launcherVisibility:'skill-sites',apiKeys:{'openai-compat':'fixture-key'},baseUrls:{'openai-compat':'https://skill-status-provider.fixture.test/v1'}}});
 });
 await context.route('https://forum.example.test/**',route=>route.request().url().endsWith('/site.json')
  ?route.fulfill({json:{title:'FORUM_SKILL_STATUS',categories:[]}})
  :route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="generator" content="Discourse 3.5"><title>Local forum skill status</title><h1>Forum fixture</h1>'}));
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await mkdir('artifacts/skill-status',{recursive:true});
 for(const mode of ['startup-empty','turn-empty']) {
  await sw.evaluate(mode=>{globalThis.skillStatusFixture={mode,snapshots:0,requests:[]};},mode);
  const url=`https://forum.example.test/t/fixture/42?case=${mode}`,page=await context.newPage();await page.goto(url);
  await page.locator('#xgoose-root').waitFor({state:'attached'});
  await expect.poll(()=>sw.evaluate(()=>skillStatusFixture.snapshots)).toBe(1);
  if(mode==='startup-empty')await expect(page.locator('.skills-list .empty')).toHaveText('当前页面无可用技能');
  else await expect(page.locator('.skill-chip')).toHaveText('discourse');
  await options.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.tabs.sendMessage(tab.id,{kind:'cs:toggle_panel'});},url);
  await page.locator('.in-text').fill('Read the forum site metadata.');await page.locator('.btn-send').click();
  await expect(page.locator('.msg-ai').last()).toHaveText('SKILL_STATUS_COMPLETE');await page.locator('.btn-stop').waitFor({state:'hidden'});
  await expect(page.locator('.msg-err')).toHaveCount(0);
  const requests=await sw.evaluate(()=>skillStatusFixture.requests);
  if(mode==='startup-empty') {
   assert.equal(requests.length,2);assert.match(JSON.stringify(requests[1].messages.filter(m=>m.role==='tool')),/FORUM_SKILL_STATUS/,'real packaged skill must have executed');
   await page.locator('.panel').screenshot({path:'artifacts/skill-status/recovered.png'});
   await expect(page.locator('.skill-chip')).toHaveText('discourse');await expect(page.locator('.skills-list .empty')).toHaveCount(0);
   await expect(page.locator('button[data-skill-action]')).toHaveCount(3);
  } else {
   assert.equal(requests.length,1);await expect(page.locator('.skill-chip')).toHaveCount(0);await expect(page.locator('.skills-list .empty')).toHaveText('当前页面无可用技能');
   await expect(page.locator('button[data-skill-action]')).toHaveCount(0);
  }
  await page.locator('.btn-close').click();await expect(page.locator('.toggle')).toBeVisible({visible:mode==='startup-empty'});
  await page.close();
 }
 const report={passed:true,syntheticOnly:true,initiallyEmptyRecovered:true,packagedSkillExecuted:true,unavailableSkillsRemoved:true,launcherSynchronized:true};
 await writeFile('artifacts/skill-status/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
