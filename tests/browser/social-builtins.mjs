import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Exercise actual model -> skill_call -> packaged MAIN-world file -> HTTP ->
// model result wiring. All website/model responses are synthetic fixtures.
const cases=[
 {name:'v2ex',version:'0.2.1',url:'https://www.v2ex.com/',fn:'getNodes',args:{query:'OpenAI'},path:'/api/nodes/all.json',
  response:[{id:1,name:'openai',title:'OpenAI fixture node',parent_node_name:'ai'}],expected:'OpenAI fixture node'},
 {name:'nga',version:'0.1.1',url:'https://bbs.nga.cn/',fn:'getForums',args:{query:'fixture'},path:'/app_api.php',
  response:{data:[{name:'Technology',groups:[{name:'Boards',forums:[{fid:-202020,name:'NGA fixture board'}]}]}]},expected:'NGA fixture board'},
 {name:'weibo',version:'0.2.1',url:'https://weibo.com/',fn:'getComments',args:{id:'123',uid:'45',count:2},path:'/ajax/statuses/buildComments',
  response:{data:Array.from({length:5},(_,i)=>({id:String(i+1),text:`Weibo fixture comment ${i+1}`})),max_id:'99999999999999999',total_number:100},expected:'Weibo fixture comment 2',absent:'Weibo fixture comment 3'},
 {name:'reddit',version:'0.1.1',url:'https://www.reddit.com/',fn:'getComments',args:{id:'abc'},path:'/comments/abc.json',
  response:[{kind:'Listing',data:{children:[]}},{kind:'Listing',data:{children:[
   {kind:'t1',data:{id:'def',name:'t1_def',body:'Reddit fixture comment',author:'fixture',parent_id:'t3_abc',link_id:'t3_abc',permalink:'/r/test/comments/abc/fixture/def/'}},
   {kind:'more',data:{children:['ghi','jkl'],parent_id:'t3_abc'}},
  ]}}],expected:'Reddit fixture comment'},
];
let active,requests=[];
const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 requests.push(JSON.parse(body));
 const steps=[['help',{skill:active.name,function:active.fn}],['skill_call',{skill:active.name,function:active.fn,args:active.args}]];
 const step=steps[requests.length-1];
 const delta=step?{tool_calls:[{index:0,id:`${active.name}-${requests.length}`,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{content:`Verified ${active.name} without User Scripts.`};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({role:'assistant',...delta})+frame({},step?'tool_calls':'stop')+'data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,dist=resolve('apps/chrome/dist');
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-social-builtins-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
try{
 const registry=JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8'));
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.waitForFunction(()=>!!chrome.storage?.local);
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},model:'luna',language:'en',analyticsEnabled:false,launcherVisibility:'skill-sites'}}),base);
 assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
 const results=[];
 for(const fixture of cases){
  active=fixture;requests=[];let apiCalls=0;
  const entry=registry.find(s=>s.name===fixture.name);assert.equal(entry?.version,fixture.version);
  assert.equal(entry.filePath,`skills/${fixture.name}.xgs.js`);assert.ok(entry.functions.some(f=>f.name===fixture.fn));
  await context.route(`${new URL(fixture.url).origin}/**`,route=>{
   const url=new URL(route.request().url());
   if(url.pathname===fixture.path){apiCalls++;return route.fulfill({json:fixture.response});}
   return route.fulfill({contentType:'text/html',headers:{'content-security-policy':"default-src 'self'; script-src 'none'; connect-src 'self'"},body:'<!doctype html><title>Social fixture</title><main>Fixture website</main>'});
  });
  const page=await context.newPage();await page.goto(fixture.url);
  await page.waitForFunction(name=>typeof window.xgoose?.skills?.[name]?.__describe__==='function',fixture.name);
  await page.locator('.toggle').click();assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);
  await page.locator('.in-text').fill(`Verify ${fixture.name} with its packaged skill.`);await page.locator('.btn-send').click();
  await page.waitForFunction(name=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes(`Verified ${name} without User Scripts.`),fixture.name);
  await page.locator('.btn-stop').waitFor({state:'hidden'});
  assert.equal(requests.length,3);assert.equal(apiCalls,1);assert.equal(await page.locator('.msg-err').count(),0);
  const toolResults=requests[2].messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  assert.ok(toolResults.includes(fixture.expected),toolResults);
  if(fixture.absent)assert.ok(!toolResults.includes(fixture.absent));
  if(fixture.name==='weibo'){assert.match(toolResults,/nextOffset/);assert.match(toolResults,/\"nextOffset\":2/);}
  if(fixture.name==='reddit'){assert.ok(toolResults.includes('ghi'));assert.ok(toolResults.includes('jkl'));}
  assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);
  await mkdir('artifacts/social-builtins',{recursive:true});await page.screenshot({path:`artifacts/social-builtins/${fixture.name}-permission-off.png`});
  results.push({skill:fixture.name,version:entry.version,structuredInvocation:true,returnedToModel:true,permissionOff:true});
  await page.close();
 }
 assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
 await settings.locator('#userScriptsAlert').waitFor({state:'visible'});
 console.log(JSON.stringify({passed:true,strictCsp:true,settingsReminder:true,syntheticOnly:true,results}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
