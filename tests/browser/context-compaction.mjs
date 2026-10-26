import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const requests=[];let researchRequests=0,gatewayRequests=0,summaries=0;
const evidence='中文证据'.repeat(20000)+' SOURCE https://fixture.test/t/19';
const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/chat/completions'){
  let body='';for await(const chunk of req)body+=chunk;
  res.setHeader('x-xgoose-context-unit','utf8_bytes');res.setHeader('x-xgoose-context-limit-bytes','190000');res.setHeader('x-xgoose-context-text-bytes','57000');res.setHeader('x-xgoose-context-target-bytes','175000');
  const request=JSON.parse(body);requests.push(request);assert.ok(Buffer.byteLength(body)<190000,'Client sent oversized wire request');
  const text=JSON.stringify(request.messages);
  if(text.includes('Summarize this browser-agent history')){
   summaries++;await new Promise(resolve=>setTimeout(resolve,250));res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({role:'assistant',content:'Prior read_page completed. Research the long page. Source https://fixture.test/t/19 is recorded; never replay actions or claim omitted evidence was read.'})+frame({},'stop')+'data: [DONE]\n\n');return;
  }
  if(text.includes('Force gateway rejection')){
   gatewayRequests++;
   if(gatewayRequests===1){res.writeHead(400,{'content-type':'application/json','x-xgoose-context-target-bytes':'100000'});res.end(JSON.stringify({error:{code:'context_length_exceeded',message:'Text context exceeds the gateway limit; compact and retry.',context:{unit:'utf8_bytes',max_text_bytes:100000}}}));return;}
   res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({role:'assistant',content:'Gateway recovery completed.'})+frame({},'stop')+'data: [DONE]\n\n');return;
  }
  researchRequests++;res.writeHead(200,{'content-type':'text/event-stream'});
  if(researchRequests===1)res.end(frame({role:'assistant',tool_calls:[{index:0,id:'read-long-page',type:'function',function:{name:'read_page',arguments:JSON.stringify({format:'text',selector:'#evidence',maxBytes:100000})}}]})+frame({},'tool_calls')+'data: [DONE]\n\n');
  else res.end(frame({role:'assistant',content:'Compaction browser fixture completed. Evidence source: https://fixture.test/t/19'})+frame({},'stop')+'data: [DONE]\n\n');return;
 }
 res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><title>Context compaction fixture</title><h1>Long page</h1><p id="evidence">${evidence}</p>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-context-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},colorScheme:'light',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(30000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},model:'luna',analyticsEnabled:false,launcherVisibility:'always'}}),base);
 const page=await context.newPage();await page.goto(base);await page.locator('.toggle').click();await page.locator('.in-text').fill('Research this long page and preserve source links.');await page.locator('.btn-send').click();
 await page.locator('.loading-text').filter({hasText:'Compacting conversation'}).waitFor();await mkdir('artifacts/context-compaction',{recursive:true});await page.locator('.panel').screenshot({path:'artifacts/context-compaction/compacting.png'});
 await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes('Compaction browser fixture completed.'));
 await page.locator('.btn-stop').waitFor({state:'hidden'});assert.equal(researchRequests,2);assert.ok(summaries>=3);assert.equal(await page.locator('.msg-err').count(),0);
 const stored=await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:session',payload:{op:'list'}}));
 assert.ok(JSON.stringify(stored).includes(evidence));assert.ok(JSON.stringify(stored[0].modelContext).length<175000);assert.ok(!JSON.stringify(stored[0].modelContext).includes('中文证据'.repeat(100)));
 await page.locator('.panel').screenshot({path:'artifacts/context-compaction/continued.png'});
 await page.locator('.btn-new').click();await page.locator('.in-text').fill('Force gateway rejection once, then continue.');await page.locator('.btn-send').click();
 await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes('Gateway recovery completed.'));
 await page.locator('.context-meter').waitFor();assert.match(await page.locator('.context-meter').getAttribute('title'),/Estimated current input.*1,050,000 tokens/);assert.doesNotMatch(await page.locator('.context-meter').getAttribute('title'),/UTF-8 bytes/);
 assert.equal(gatewayRequests,2);assert.equal(await page.locator('.msg-err').count(),0);
 console.log(JSON.stringify({passed:true,largeChineseToolResult:true,visibleCompactionStatus:true,boundedWireRequests:true,boundedSummaryChunks:true,completeLocalHistory:true,compactedModelHistory:true,gatewayRejectionAutoRetry:true,noToolReplay:researchRequests===2,syntheticOnly:true,requests:requests.length}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
