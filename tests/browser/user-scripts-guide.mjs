import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const requests=[];let turn=0;
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/chat/completions'){
  let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
  const first=turn++%2===0;
  const delta=first?{tool_calls:[{index:0,id:`fixture-${turn}`,type:'function',function:{name:'js_exec',arguments:JSON.stringify({code:'return 42',purpose:'Read website',parallel_safe:true})}}]}:{content:turn===2?'Please enable Allow User Scripts for custom JavaScript actions.':'Permission is enabled. The website returned 42.'};
  const frame=(choices,usage)=>`data: ${JSON.stringify({id:`r${turn}`,object:'chat.completion.chunk',created:1,model:'luna',choices,...(usage?{usage}:{})})}\n\n`;
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame([{index:0,delta:{role:'assistant',...delta},finish_reason:null}])+frame([{index:0,delta:{},finish_reason:first?'tool_calls':'stop'}])+frame([],{prompt_tokens:10,completion_tokens:5,total_tokens:15})+'data: [DONE]\n\n');return;
 }
 res.setHeader('content-type','text/html');res.end('<!doctype html><title>Permission fixture</title><h1>Synthetic page</h1>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,profile=await mkdtemp(resolve(tmpdir(),'xgoose-permission-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},colorScheme:'light',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(15000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{const original=fetch;globalThis.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url;return url.startsWith('https://api.xgoose.org')?Promise.resolve(Response.json({data:[{id:'luna'}]})):original(input,init);};});
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);await settings.locator('#userScriptsAlert').waitFor({state:'visible'});
 assert.match(await settings.locator('#userScriptsAlert').innerText(),/Built-in skills and page reading are ready to use/);assert.equal(await settings.locator('#userScriptsAlert a').getAttribute('href'),'onboarding.html');
 await mkdir('artifacts/user-scripts-guide',{recursive:true});await settings.locator('#userScriptsAlert').screenshot({path:'artifacts/user-scripts-guide/settings-alert.png'});await settings.screenshot({path:'artifacts/user-scripts-guide/settings-desktop.png',fullPage:true});await settings.setViewportSize({width:390,height:844});assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await settings.screenshot({path:'artifacts/user-scripts-guide/settings-mobile.png',fullPage:true});
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'synthetic-key'},baseUrls:{'openai-compat':base},model:'luna',thinking:false,analyticsEnabled:false,launcherVisibility:'always'}}),base);
 const page=await context.newPage();await page.goto(base);await page.locator('.toggle').click();await page.locator('[data-user-scripts-guide="banner"]').waitFor({state:'visible'});
 await page.locator('.in-text').fill('Read this website');await page.locator('.btn-send').click();await page.locator('[data-user-scripts-guide="inline"]').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.querySelector('.btn-send')?.disabled===false);
 assert.equal(requests.length,2);assert.ok(JSON.stringify(requests[0].messages).includes('Allow User Scripts is currently OFF'));const second=JSON.stringify(requests[1].messages);assert.ok(second.includes('Allow User Scripts is disabled'));assert.ok(second.includes(`chrome://extensions/?id=${id}`));assert.ok(second.includes('Below Site access'));
 await page.screenshot({path:'artifacts/user-scripts-guide/chat-disabled.png'});await page.locator('.panel').screenshot({path:'artifacts/user-scripts-guide/chat-guide.png'});
 const opened=context.waitForEvent('page');await page.locator('[data-user-scripts-guide="inline"]').getByRole('link',{name:'Open extension settings',exact:true}).click();const details=await opened;await details.waitForURL(`chrome://extensions/?id=${id}`);await details.locator('#allow-user-scripts cr-toggle').click();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('[data-user-scripts-guide="banner"]').waitFor({state:'hidden'});await page.locator('[data-user-scripts-guide="inline"]').waitFor({state:'hidden'});
 await settings.bringToFront();await settings.evaluate(()=>window.dispatchEvent(new Event('focus')));await settings.locator('#userScriptsAlert').waitFor({state:'hidden'});
 await page.bringToFront();await page.locator('.in-text').fill('Try again');await page.locator('.btn-send').click();await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.textContent?.includes('The website returned 42.'));assert.equal(requests.length,4);assert.ok(JSON.stringify(requests[3].messages).includes('42'));
 console.log(JSON.stringify({passed:true,settingsAlert:true,inlineAiFallbackCard:true,dynamicExtensionLink:true,illustratedSop:true,preflightPermission:true,failFastTool:true,autoHide:true,recoversAfterEnable:true,mobile:true,syntheticOnly:true}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
