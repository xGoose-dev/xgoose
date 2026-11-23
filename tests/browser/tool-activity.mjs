import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
// Two page reads (the second fails), then an answer. Tool calls stay one collapsed
// line that does not advertise failures; the expanded list keeps the failed call
// marked after the turn ends and after history replay.
const calls=[{format:'text'},{format:'text',selector:'#missing'}];let turn=0;
const server=createServer(async(req,res)=>{
  if(req.url==='/v1/chat/completions'){
    for await(const _ of req);const i=turn++;
    const delta=i<calls.length?{tool_calls:[{index:0,id:`call-${i}`,type:'function',function:{name:'read_page',arguments:JSON.stringify(calls[i])}}]}:{content:'Read the page once; the second selector matched nothing.'};
    const frame=(choices,usage)=>`data: ${JSON.stringify({id:`r${i}`,object:'chat.completion.chunk',created:1,model:'luna',choices,...(usage?{usage}:{})})}\n\n`;
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end(frame([{index:0,delta:{role:'assistant',...delta},finish_reason:null}])+frame([{index:0,delta:{},finish_reason:i<calls.length?'tool_calls':'stop'}])+frame([],{prompt_tokens:10,completion_tokens:5,total_tokens:15})+'data: [DONE]\n\n');return;
  }
  res.setHeader('content-type','text/html');res.end('<!doctype html><title>Activity fixture</title><h1>Synthetic page</h1><p>Fixture text.</p>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,profile=await mkdtemp(resolve(tmpdir(),'xgoose-activity-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(15000);
try{
  const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
  await sw.evaluate(()=>{const original=fetch;globalThis.fetch=(input,init)=>String(typeof input==='string'?input:input.url).startsWith('https://api.xgoose.org')?Promise.resolve(Response.json({data:[]})):original(input,init);});
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
  await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'synthetic-key'},baseUrls:{'openai-compat':base},model:'luna',thinking:false,analyticsEnabled:false,launcherVisibility:'always'}}),base);
  const page=await context.newPage();await page.goto(base);await page.locator('.toggle').click();
  await page.locator('.in-text').fill('Read this page');await page.locator('.btn-send').click();
  await page.locator('.msg-ai').filter({hasText:'matched nothing'}).waitFor();await page.locator('.btn-stop').waitFor({state:'hidden'});
  const check=async stage=>{
    await expect(page.locator('.steps')).toHaveCount(1);
    assert.equal(await page.locator('.steps-label').innerText(),'2 actions',stage);
    assert.doesNotMatch(await page.locator('.steps-hdr').innerText(),/fail|error/i,stage);
    assert.deepEqual(await page.locator('.tool').evaluateAll(els=>els.map(el=>el.className)),['tool done','tool error'],stage);
    await expect(page.locator('.steps-list')).toBeHidden();
    assert.match(await page.locator('.tool.error .tool-sub').textContent(),/No element matched selector: #missing/,stage);
  };
  await check('after the turn');
  // One line of activity is far shorter than the two cards it replaces.
  assert.ok((await page.locator('.steps').boundingBox()).height<40);
  await page.locator('.steps-hdr').click();await expect(page.locator('.steps-list')).toBeVisible();
  assert.equal(await page.locator('.steps-hdr').getAttribute('aria-expanded'),'true');
  await page.locator('.tool.error .tool-hdr').click();await expect(page.locator('.tool.error .tool-detail')).toContainText('No element matched selector');
  await page.locator('.steps-hdr').click();
  // Saved conversations replay with the same grouping and failure state.
  await page.locator('.btn-new').click();await expect(page.locator('.steps')).toHaveCount(0);
  await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('.history-item').first().click();
  await page.locator('.msg-ai').filter({hasText:'matched nothing'}).waitFor();await check('after history replay');
  console.log(JSON.stringify({passed:true,collapsedByDefault:true,failureSurvivesTurnEnd:true,failureSurvivesReplay:true,expandable:true}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
