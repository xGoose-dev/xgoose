import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const profile=await mkdtemp(resolve(tmpdir(),'xgoose-review-regressions-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try {
  // Exercise the production finalizer on a page that permits inline scripts.
  const bundle=await build({stdin:{contents:"import {createPanel} from './packages/ui/src/panel.ts';window.panel=createPanel();",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
  const markdown=await context.newPage();await markdown.setContent('<title>Markdown fixture</title>');
  await markdown.addScriptTag({content:bundle.outputFiles[0].text});
  await markdown.evaluate(()=>{
    panel.open();const bubble=panel.addAssistantBubble();
    bubble.updateMarkdown('[source](https://example.test/" onmouseover="globalThis.reviewXss=1) [blocked](javascript:globalThis.reviewXss=2)');bubble.finalize();
  });
  await markdown.locator('.msg-ai a').hover();
  assert.equal(await markdown.evaluate(()=>globalThis.reviewXss),undefined);
  assert.equal(await markdown.locator('.msg-ai a').count(),1);
  assert.equal(await markdown.locator('.msg-ai a').getAttribute('onmouseover'),null);
  await markdown.close();

  const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
  await sw.evaluate(async()=>{
    const original=fetch,send=chrome.tabs.sendMessage.bind(chrome.tabs);
    globalThis.reviewFixture={calls:[],pending:[],frozenTab:null};
    chrome.tabs.sendMessage=(tabId,message,...args)=>reviewFixture.frozenTab===tabId&&message.kind==='cs:peer_identity'?new Promise(()=>{}):send(tabId,message,...args);
    globalThis.fetch=async(input,init)=>{
      const req=new Request(input,init),url=new URL(req.url);
      if(url.hostname==='review-provider.fixture.test'){
        const body=await req.json(),prompt=JSON.stringify(body.messages.filter(m=>m.role==='user').at(-1)?.content);
        reviewFixture.calls.push(prompt);
        return new Promise((resolve,reject)=>{
          req.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
          reviewFixture.pending.push(()=>{
            const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
            resolve(new Response(frame({content:'Fixture answer'})+frame({},'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
          });
        });
      }
      if(url.hostname==='api.xgoose.org')return Response.json({items:[],data:[],acknowledged:[]});
      return original(input,init);
    };
    await chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',model:'fixture',language:'en',thinking:false,analyticsEnabled:false,launcherVisibility:'always',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':'https://review-provider.fixture.test/v1'}}});
  });
  await context.route('https://review-page.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Queue fixture</title><p>Local fixture</p>'}));
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  const open=async path=>{const page=await context.newPage();await page.goto(`https://review-page.fixture.test/${path}`);await page.locator('#xgoose-root').waitFor({state:'attached'});if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();return page;};
  const page=await open('queue');
  const send=async(page,text)=>{await page.locator('.in-text').fill(text);await page.locator('.btn-send').click();};
  const count=()=>sw.evaluate(()=>reviewFixture.calls.length);
  const called=async n=>expect.poll(count,{timeout:20000}).toBe(n);
  const release=async index=>sw.evaluate(i=>reviewFixture.pending[i](),index);
  const lastPrompt=()=>sw.evaluate(()=>reviewFixture.calls.at(-1));

  for(const action of ['stop','new']){
    const before=await count();
    await send(page,`${action} A`);await called(before+1);
    await send(page,`${action} B`);await send(page,`${action} C`);
    await release(before);await called(before+2);
    await page.locator(action==='stop'?'.btn-stop':'.btn-new').click();
    if(action==='new')await expect(page.locator('.msg-user')).toHaveCount(0);
    await page.locator('.btn-stop').waitFor({state:'hidden'});
    await send(page,`${action} D`);await called(before+3);
    assert.match(await lastPrompt(),new RegExp(`${action} D`),'cancelled C must never start, including after a conversation switch');
    await release(before+2);await page.locator('.btn-stop').waitFor({state:'hidden'});
  }

  // A frozen identity probe must not keep another tab's user turn waiting.
  const other=await open('other');
  const tabId=await options.evaluate(async()=> (await chrome.tabs.query({url:'https://review-page.fixture.test/queue'}))[0].id);
  await sw.evaluate(tabId=>{reviewFixture.frozenTab=tabId;},tabId);
  const before=await count();await send(page,'Frozen page');await send(other,'Healthy peer');
  await expect(page.locator('.msg-err')).toContainText('did not respond');
  await called(before+1);assert.match(await lastPrompt(),/Healthy peer/);
  await release(before);await other.locator('.btn-stop').waitFor({state:'hidden'});
  await sw.evaluate(()=>{reviewFixture.frozenTab=null;});
  console.log(JSON.stringify({passed:true,markdownNoExecution:true,stopDiscardsQueue:true,newDiscardsQueue:true,frozenTabIsolated:true}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
