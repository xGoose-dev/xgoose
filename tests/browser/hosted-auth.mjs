import {chromium} from '@playwright/test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-hosted-auth-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(20000);
try{
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(()=>{
  const original=fetch;
  globalThis.authFixture={mode:'rotation',refreshes:0,calls:[],normal:0};
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url),f=globalThis.authFixture;
   if(url.hostname!=='api.xgoose.org')return original(input,init);
   if(url.pathname==='/me/quota')return Response.json({claimable:false,granted_micros:5000000,remaining_micros:5000000,expires_at:'2100-01-01T00:00:00Z',platform_paused:false});
   if(url.pathname==='/me/transcript-consent')return Response.json({hosted:true,byok:false});
   if(url.pathname==='/ai/v1/models')return Response.json({data:[{id:'luna',context_window:1050000}]});
   if(url.pathname==='/auth/refresh'){
    f.refreshes++;const data=await req.json();if(data.refresh_token!=='refresh-A')throw Error('Wrong refresh token');
    if(f.mode==='revoked')return Response.json({error:'unauthorized',message:'revoked'},{status:401});
    return Response.json({access_token:'B',refresh_token:'refresh-B',access_token_expires_at:'2100-01-01T00:00:00Z'});
   }
   if(url.pathname==='/ai/v1/chat/completions'){
    const body=await req.json(),credential=req.headers.get('authorization');f.calls.push({body,credential});
    if(f.normal>0&&credential==='Bearer A'&&f.mode!=='rotation')return Response.json({error:'unauthorized',message:'session_revoked_or_expired'},{status:401});
    const tool=f.normal++===0;
    if(tool&&f.mode==='rotation'){
     const account=(await chrome.storage.local.get('xgoose.account'))['xgoose.account'];
     await chrome.storage.local.set({'xgoose.account':{...account,accessToken:'B',refreshToken:'refresh-B'}});
    }
    const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
    const text=tool?{tool_calls:[{index:0,id:'read-once',type:'function',function:{name:'read_page',arguments:JSON.stringify({selector:'#evidence',format:'text',maxBytes:5000})}}]}:{content:'AUTH_RECOVERY_COMPLETE'};
    return new Response(frame(text)+frame({},tool?'tool_calls':'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   }
   return Response.json({acknowledged:[],items:[]});
  };
 });
 await context.route('https://auth-page.fixture.test/**',route=>route.fulfill({contentType:'text/html',headers:{'content-security-policy':"default-src 'self'; script-src 'none'; connect-src 'none'"},body:'<!doctype html><title>Hosted auth fixture</title><p id="evidence">COMPLETED_TOOL_EVIDENCE</p>'}));
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 const reports=[];
 for(const mode of ['rotation','recover','revoked']){
  await sw.evaluate(mode=>{globalThis.authFixture={mode,refreshes:0,calls:[],normal:0};},mode);
  await options.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{provider:'xgoose-hosted',model:'luna',language:'en',thinking:false,analyticsEnabled:false,launcherVisibility:'always'},'xgoose.account':{user:{id:'owner',email:'test@example.test',name:'Fixture',avatar_url:null,email_verified:true,is_admin:false},accessToken:'A',refreshToken:'refresh-A',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:0}}));
  const page=await context.newPage();await page.goto(`https://auth-page.fixture.test/${mode}`);await page.locator('#xgoose-root').waitFor({state:'attached'});if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
  await page.locator('.in-text').fill('Read the evidence, then finish.');await page.locator('.btn-send').click();
  if(mode==='revoked')await page.locator('.msg-err').filter({hasText:'stopped listening and taking actions'}).waitFor().catch(async error=>{console.log('AUTH DEBUG',JSON.stringify({fixture:await sw.evaluate(()=>globalThis.authFixture),panel:await page.locator('.panel').innerText()}));throw error;});
  else await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes('AUTH_RECOVERY_COMPLETE'));
  await page.locator('.btn-stop').waitFor({state:'hidden'});
  const state=await sw.evaluate(()=>globalThis.authFixture);
  assert.equal(state.refreshes,mode==='rotation'?0:1);
  assert.equal(state.calls.length,mode==='recover'?3:2);
  assert.equal(await page.locator('.tool[data-tool-name="read_page"]').count(),1,'completed tool was not replayed');
  assert.ok(state.calls.slice(1).every(c=>JSON.stringify(c.body).includes('COMPLETED_TOOL_EVIDENCE')));
  if(mode==='recover')assert.deepEqual(state.calls[1].body,state.calls[2].body,'retry preserved the exact completed tool context');
  if(mode==='revoked'){
   assert.equal(await options.evaluate(async()=>(await chrome.storage.local.get('xgoose.account'))['xgoose.account']??null),null);
   assert.match(await page.locator('.status').innerText(),/Listening stopped/);
   // A real new login and explicit Continue preserve the completed tool result.
   await options.evaluate(()=>chrome.storage.local.set({'xgoose.account':{user:{id:'owner',email:'test@example.test',name:'Fixture',avatar_url:null,email_verified:true,is_admin:false},accessToken:'B',refreshToken:'refresh-B',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:0}}));
   await page.locator('.in-text').fill('Continue');await page.locator('.btn-send').click();
   await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes('AUTH_RECOVERY_COMPLETE'));await page.locator('.btn-stop').waitFor({state:'hidden'});
   const resumed=await sw.evaluate(()=>globalThis.authFixture);assert.match(JSON.stringify(resumed.calls.at(-1).body),/COMPLETED_TOOL_EVIDENCE/);assert.equal(resumed.normal,2);
  }else assert.equal(await page.locator('.msg-err').count(),0);
  await mkdir('artifacts/hosted-auth',{recursive:true});await page.locator('.panel').screenshot({path:`artifacts/hosted-auth/${mode}.png`});
  reports.push({mode,passed:true,requests:state.calls.length,refreshes:state.refreshes,completedToolCalls:1});await page.close();
 }
 await writeFile('artifacts/hosted-auth/report.json',JSON.stringify({syntheticOnly:true,reports},null,2));console.log(JSON.stringify({passed:true,syntheticOnly:true,reports}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
