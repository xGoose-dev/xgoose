// Synthetic transport regression. Model tool choices are scripted; this is not a live-model policy evaluation.
import {chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-search-'));
const dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{...(process.env.EDGE_EXECUTABLE_PATH?{executablePath:process.env.EDGE_EXECUTABLE_PATH}:{channel:'chromium'}),headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try {
  const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
  await sw.evaluate(()=>{
    const original=fetch;
    globalThis.searchFixture={};
    globalThis.fetch=async(input,init)=>{
      const req=new Request(input,init),url=new URL(req.url),f=globalThis.searchFixture;
      if(url.hostname!=='api.xgoose.org')return original(input,init);
      if(url.pathname==='/ai/v1/models')return Response.json({data:[{id:'luna',context_window:1050000}]});
      if(url.pathname==='/me/quota')return Response.json({granted_micros:5000000,remaining_micros:5000000,expires_at:'2100-01-01',platform_paused:false});
      if(url.pathname==='/ai/v1/search'){
        f.searches.push({body:await req.json(),id:req.headers.get('Idempotency-Key')});
        return Response.json({provider:'exa',results:[{title:'Public reference',url:'https://example.org/public-source',highlights:['PUBLIC_REFERENCE_EVIDENCE']}],charged_micros:7000});
      }
      if(url.pathname==='/ai/v1/chat/completions'){
        const body=await req.json();f.requests.push(body);const step=f.step++,name=f.actions[step];
        const delta=name?{tool_calls:[{index:0,id:`tool-${step}`,type:'function',function:{name,arguments:JSON.stringify(name==='read_page'?{format:'text',selector:'#evidence'}:{query:'public missing fact'})}}]}:{content:`SEARCH_FLOW_COMPLETE ${f.mode} [Public reference](https://example.org/public-source)`};
        const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
        return new Response(frame({role:'assistant',...delta})+frame({},name?'tool_calls':'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }
      return Response.json({acknowledged:[],items:[]});
    };
  });
  await context.route('https://search.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Search fixture</title><p id="evidence">SITE_EVIDENCE</p>'}));
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  await options.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{provider:'xgoose-hosted',model:'luna',language:'en',thinking:false,analyticsEnabled:false,launcherVisibility:'always'},'xgoose.account':{user:{id:'owner',email:'fixture@example.test',name:'Fixture',avatar_url:null,email_verified:true,is_admin:false},accessToken:'fixture-token',refreshToken:'fixture-refresh',accessTokenExpiresAt:'2100-01-01T00:00:00Z',lastSeenAt:0}}));
  const reports=[];
  const cases=[['sufficient',['read_page']],['empty',['read_page','search_web']],['insufficient',['read_page','search_web']],['unavailable',['read_page','search_web']],['explicit',['search_web']],['site-only',['read_page']],['agent-page',['search_web']]];
  for(const [mode,actions] of cases){
    await sw.evaluate(({mode,actions})=>{globalThis.searchFixture={mode,actions,step:0,searches:[],requests:[]};},{mode,actions});
    const page=await context.newPage();await page.goto(mode==='agent-page'?`chrome-extension://${id}/agent.html`:`https://search.fixture.test/${mode}`);
    await page.locator('#xgoose-root').waitFor({state:'attached'});
    if(await page.locator('.toggle').isVisible())await page.locator('.toggle').click();
    await page.locator('.in-text').fill(mode==='site-only'?'Only use this website.':mode==='explicit'||mode==='agent-page'?'Search the public web for a missing fact.':'Read this website first and answer the question.');
    await page.locator('.btn-send').click();
    await page.waitForFunction(()=>document.querySelector('#xgoose-root')?.shadowRoot?.textContent?.includes('SEARCH_FLOW_COMPLETE')).catch(async error=>{console.log('SEARCH DEBUG',JSON.stringify({mode,state:await sw.evaluate(()=>globalThis.searchFixture),panel:await page.locator('.panel').innerText()}));throw error;});
    await page.locator('.btn-stop').waitFor({state:'hidden'});
    const state=await sw.evaluate(()=>globalThis.searchFixture);
    assert.ok(state.requests[0].tools.some(t=>t.function.name==='search_web'));
    const expected=actions.includes('search_web')?1:0;assert.equal(state.searches.length,expected);
    if(expected){
      assert.deepEqual(state.searches[0].body,{query:'public missing fact'});assert.match(state.searches[0].id,/^[0-9a-f-]{36}$/);
      assert.equal(await page.locator('.tool[data-tool-name="search_web"] .tool-title').innerText(),'Public web search · Exa');
      assert.match(await page.locator('.tool[data-tool-name="search_web"] .tool-sub').innerText(),/0\.007/);
      assert.match(JSON.stringify(state.requests.at(-1).messages),/PUBLIC_REFERENCE_EVIDENCE/);
    }
    if(actions.includes('read_page'))assert.match(JSON.stringify(state.requests.at(-1).messages),/SITE_EVIDENCE/);
    assert.equal(await page.locator('.msg-err').count(),0);
    reports.push({mode,searches:state.searches.length,passed:true});await page.close();
  }
  console.log(JSON.stringify({passed:true,syntheticOnly:true,realEdge:!!process.env.EDGE_EXECUTABLE_PATH,reports}));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
