import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Disposable browser; all credentials, provider responses and site data are fixtures.
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-byok-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(25000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{
  const original=globalThis.fetch;globalThis.byokFixture={requests:[],normal:0,summaries:0,tests:0,mode:''};
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url),state=globalThis.byokFixture;
   if(url.hostname!=='api.xgoose.org'&&url.hostname!=='byok.fixture.test')return original(input,init);
   if(url.pathname==='/me/transcript-consent')return Response.json({hosted:true,byok:false});
   if(url.pathname==='/me/quota')return Response.json({claimable:false,granted_micros:5000000,remaining_micros:5000000,expires_at:'2100-01-01T00:00:00Z',platform_paused:false});
   if(url.pathname.endsWith('/models')){state.tests++;return Response.json({data:[{id:'luna'}],models:[{name:'models/gemini-2.5-flash'}]});}
   if(url.pathname.endsWith('/chat/completions')||url.pathname.includes(':streamGenerateContent')){
    const body=await req.json(),google=url.pathname.includes(':streamGenerateContent');
    const credential=req.headers.get(google?'x-goog-api-key':'authorization');
    const expected=state.mode==='xgoose-hosted'?'Bearer synthetic-hosted-token':google?'synthetic-byok-key':'Bearer synthetic-byok-key';
    if(credential!==expected)throw new Error('Incorrect provider credential isolation');
    if(!google&&body.stream===false){state.tests++;return Response.json({choices:[{message:{role:'assistant',content:'OK'}}]});}
    const summary=JSON.stringify(body).includes('Summarize this browser-agent history');
    if(summary)state.summaries++;else state.normal++;
    state.requests.push({path:url.pathname,body,credentialCorrect:true,summary});
    if(state.mode==='xgoose-hosted'&&!summary&&state.normal===2)return Response.json({error:{code:'context_length_exceeded',message:'Text context exceeds the gateway limit; compact and retry.'}},{status:400,headers:{'x-xgoose-context-target-bytes':'100000'}});
    const text=summary?'read_page completed. Evidence: BROWSER_PROVIDER_728. Never replay the read.':`Provider browser verified: ${state.mode}.`;
    const call=!summary&&state.normal===1;
    let frames;
    if(google){
     frames=`data: ${JSON.stringify({candidates:[{content:{role:'model',parts:call?[{functionCall:{name:'read_page',args:{format:'text',selector:'#evidence',maxBytes:10000}},thoughtSignature:'c2lnbmF0dXJl'}]:[{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:30,candidatesTokenCount:10,totalTokenCount:40}})}\n\n`;
    }else{
     const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
     frames=frame(call?{tool_calls:[{index:0,id:'read-once',type:'function',function:{name:'read_page',arguments:JSON.stringify({format:'text',selector:'#evidence',maxBytes:10000})}}]}:{content:text})+frame({},call?'tool_calls':'stop')+'data: [DONE]\n\n';
    }
    return new Response(frames,{headers:{'content-type':'text/event-stream'}});
   }
   return Response.json({acknowledged:[],items:[]});
  };
 });
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await context.route('https://page.fixture.test/**',route=>route.fulfill({contentType:'text/html',headers:{'content-security-policy':"default-src 'self'; script-src 'none'; connect-src 'none'"},body:'<!doctype html><title>BYOK release fixture</title><p id="evidence">BROWSER_PROVIDER_728</p>'}));
 const reports=[];
 for(const provider of ['gemini','gemini-litellm','openai-compat','xgoose-hosted']){
  await sw.evaluate(mode=>{globalThis.byokFixture={requests:[],normal:0,summaries:0,tests:0,mode};},provider);
  await options.evaluate(provider=>chrome.storage.local.set({
   'xgoose.settings':{provider,model:provider==='xgoose-hosted'?'luna':'gemini-2.5-flash',language:'en',thinking:false,analyticsEnabled:false,launcherVisibility:'always',apiKeys:{gemini:'synthetic-byok-key','gemini-litellm':'synthetic-byok-key','openai-compat':'synthetic-byok-key'},baseUrls:{gemini:'https://byok.fixture.test','gemini-litellm':'https://byok.fixture.test/v1beta','openai-compat':'https://byok.fixture.test/v1beta/openai'}},
   'xgoose.account':{user:{id:'byok-fixture',email:'test@example.test',name:'Fixture',avatar_url:null,email_verified:true,is_admin:false},accessToken:'synthetic-hosted-token',refreshToken:'synthetic-refresh',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:Date.now()},
  }),provider);
  const result=await options.evaluate(provider=>chrome.runtime.sendMessage({kind:'sw:test_api_key',payload:{provider,apiKey:'synthetic-byok-key',baseUrl:provider==='gemini-litellm'?'https://byok.fixture.test/v1beta':provider==='openai-compat'?'https://byok.fixture.test/v1beta/openai':'https://byok.fixture.test',model:'luna'}}),provider);
  assert.equal(result.ok,true,JSON.stringify(result));
  const page=await context.newPage();await page.goto('https://page.fixture.test/');await page.locator('#xgoose-root').waitFor({state:'attached'});if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
  await page.locator('.in-text').fill('Read the fixture evidence.');await page.locator('.btn-send').click();
  await page.waitForFunction(provider=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes(`Provider browser verified: ${provider}.`),provider);
  await page.locator('.btn-stop').waitFor({state:'hidden'});assert.equal(await page.locator('.msg-err').count(),0);
  await page.locator('.in-text').fill('Continue from the same evidence.');await page.locator('.btn-send').click();await page.locator('.msg-ai').nth(1).waitFor();await page.locator('.btn-stop').waitFor({state:'hidden'});
  const state=await sw.evaluate(()=>globalThis.byokFixture);
  assert.ok(state.tests>=1);assert.equal(state.normal,provider==='xgoose-hosted'?4:3);assert.equal(state.summaries,provider==='xgoose-hosted'?1:0);
  const second=state.requests.filter(r=>!r.summary)[1];assert.match(JSON.stringify(second.body),/BROWSER_PROVIDER_728/);
  if(provider==='gemini'||provider==='gemini-litellm')assert.match(JSON.stringify(state.requests.at(-1).body),/c2lnbmF0dXJl/);
  assert.ok(state.requests.every(r=>r.credentialCorrect));assert.equal(await page.locator('.msg-err').count(),0);
  await mkdir('artifacts/byok',{recursive:true});await page.locator('.panel').screenshot({path:`artifacts/byok/${provider}-browser.png`});
  reports.push({provider,passed:true,testButton:true,strictCsp:true,backgroundTransport:true,structuredToolResult:true,followUp:true,credentialIsolation:true,compaction:state.summaries===1});await page.close();
 }
 await writeFile('artifacts/byok/browser-report.json',JSON.stringify({syntheticOnly:true,reports},null,2));console.log(JSON.stringify({passed:true,syntheticOnly:true,reports}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
