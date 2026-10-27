import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// Exercise actual model -> skill_call -> packaged MAIN-world file -> HTTP ->
// model result wiring. All website/model responses are synthetic fixtures.
const cases=[
 {name:'v2ex',url:'https://www.v2ex.com/',fn:'getNodes',args:{query:'OpenAI'},path:'/api/nodes/all.json',
  response:[{id:1,name:'openai',title:'OpenAI fixture node',parent_node_name:'ai'}],expected:'OpenAI fixture node'},
 {name:'nga',url:'https://bbs.nga.cn/',fn:'getForums',args:{query:'fixture'},path:'/app_api.php',
  response:{data:[{name:'Technology',groups:[{name:'Boards',forums:[{fid:-202020,name:'NGA fixture board'}]}]}]},expected:'NGA fixture board'},
 {name:'weibo',url:'https://weibo.com/',fn:'getComments',args:{id:'123',uid:'45',count:2},path:'/ajax/statuses/buildComments',
  response:{data:Array.from({length:5},(_,i)=>({id:String(i+1),text:`Weibo fixture comment ${i+1}`})),max_id:'99999999999999999',total_number:100},expected:'Weibo fixture comment 2',absent:'Weibo fixture comment 3'},
 {name:'weibo',url:'https://weibo.com/',fn:'searchStatuses',args:{query:'济南 居民养老保险',sortBy:'time',count:3},path:'/ajax/statuses/search',
  response:{ok:1,statuses:[{idstr:'123',mblogid:'abc',text:'济南居民养老保险搜索命中',user:{id:456,screen_name:'Fixture publisher'}}]},expected:'济南居民养老保险搜索命中'},
 {name:'nga',url:'https://bbs.nga.cn/',fn:'getTopic',args:{tid:'47786615',limit:2,maxChars:1000,includeImages:true,maxImages:1},path:'/read.php',malformedFirst:true,
  response:{data:{__PAGE:1,__ROWS:1,__T:{tid:47786615,subject:'Recovered NGA topic'},__R:[{pid:0,lou:0,content:'Recovered complete NGA topic body [img]./mon_202610/26/context.png[/img]'}]}},expected:'Recovered complete NGA topic body'},
 {name:'reddit',url:'https://www.reddit.com/',fn:'getComments',args:{id:'abc'},path:'/comments/abc.json',
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
 const imagePage=await context.newPage();await imagePage.setContent('<body style="background:#ec5849">NGA image fixture</body>');
 const imageBytes=await imagePage.screenshot({clip:{x:0,y:0,width:160,height:100}});await imagePage.close();
 const registry=JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8'));
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 await sw.evaluate(base64=>{
  const original=fetch;globalThis.ngaImageCalls=0;
  globalThis.fetch=async(input,init)=>{
   const url=typeof input==='string'?input:String(input.url??input);
   if(url.startsWith('https://img.nga.178.com/attachments/')){globalThis.ngaImageCalls++;return new Response(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});}
   return original(input,init);
  };
 },imageBytes.toString('base64'));
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);
 await settings.waitForFunction(()=>!!chrome.storage?.local);
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},model:'luna',language:'en',analyticsEnabled:false,launcherVisibility:'skill-sites'}}),base);
 assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
 const results=[];
 for(const fixture of cases){
  active=fixture;requests=[];let apiCalls=0;console.log(`Checking ${fixture.name}.${fixture.fn}`);
  const entry=registry.find(s=>s.name===fixture.name);assert.ok(entry?.version);
  assert.equal(entry.filePath,`skills/${fixture.name}.xgs.js`);assert.ok(entry.functions.some(f=>f.name===fixture.fn));
  await context.route(`${new URL(fixture.url).origin}/**`,route=>{
   const url=new URL(route.request().url());
   if(url.pathname===fixture.path){
    apiCalls++;
    if(fixture.fn==='searchStatuses'){assert.equal(url.searchParams.get('q'),'济南 居民养老保险');assert.equal(url.searchParams.get('atten'),'0');}
    if(fixture.malformedFirst&&apiCalls===1)return route.fulfill({contentType:'application/json',body:'{"data":{"__R":[{"content":"bad\\u'});
    if(fixture.malformedFirst)assert.ok(url.searchParams.has('_'));
    return route.fulfill({json:fixture.response});
   }
   return route.fulfill({contentType:'text/html',headers:{'content-security-policy':"default-src 'self'; script-src 'none'; connect-src 'self'"},body:'<!doctype html><title>Social fixture</title><main>Fixture website</main>'});
  });
  const page=await context.newPage();await page.goto(fixture.url);
  await page.waitForFunction(name=>typeof window.xgoose?.skills?.[name]?.__describe__==='function',fixture.name);
  if(!await page.locator('.in-text').isVisible())await page.locator('.toggle').click();assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);
  await page.locator('.in-text').fill(`Verify ${fixture.name} with its packaged skill.`);await page.locator('.btn-send').click();
  await page.waitForFunction(name=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes(`Verified ${name} without User Scripts.`),fixture.name).catch(async error=>{console.error(JSON.stringify({fixture:fixture.name,function:fixture.fn,requests:requests.length,errors:await page.locator('.msg-err').allTextContents(),tools:await page.locator('.tool-card').allTextContents()}));throw error;});
  await page.locator('.btn-stop').waitFor({state:'hidden'});
  assert.equal(requests.length,3);assert.equal(apiCalls,fixture.malformedFirst?2:1);assert.equal(await page.locator('.msg-err').count(),0);
  assert.equal(page.url(),fixture.url);
  assert.match(JSON.stringify(requests[0].messages),/Use the active search skill for research on the current website/);
  const toolResults=requests[2].messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  assert.ok(toolResults.includes(fixture.expected),toolResults);
  if(fixture.absent)assert.ok(!toolResults.includes(fixture.absent));
  if(fixture.name==='weibo'&&fixture.fn==='getComments'){assert.match(toolResults,/nextOffset/);assert.match(toolResults,/\"nextOffset\":2/);}
  if(fixture.name==='reddit'){assert.ok(toolResults.includes('ghi'));assert.ok(toolResults.includes('jkl'));}
  if(fixture.args.includeImages){
   assert.equal(await sw.evaluate(()=>globalThis.ngaImageCalls),1);assert.match(toolResults,/image_parts/);assert.match(toolResults,/\"attached\":1/);
   const parts=requests[2].messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
   const image=parts.find(p=>p.type==='image_url');assert.ok(image);assert.match(image.image_url.url,/^data:image\/jpeg;base64,/);assert.ok(image.image_url.url.length<=320050);
   // A follow-up turn keeps the fetched image, just like an uploaded image.
   await page.locator('.in-text').fill('Compare the NGA source image again.');await page.locator('.btn-send').click();
   await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.querySelectorAll('.msg-ai').length===2);await page.locator('.btn-stop').waitFor({state:'hidden'});
   assert.equal(requests.length,4);assert.ok(JSON.stringify(requests[3].messages).includes('data:image/jpeg;base64,'));
  }
  assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);
  await mkdir('artifacts/social-builtins',{recursive:true});await page.screenshot({path:`artifacts/social-builtins/${fixture.name}-${fixture.fn}-permission-off.png`});
  results.push({skill:fixture.name,function:fixture.fn,version:entry.version,structuredInvocation:true,returnedToModel:true,permissionOff:true});
  await page.close();
 }
 assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
 await settings.locator('#userScriptsAlert').waitFor({state:'visible'});
 console.log(JSON.stringify({passed:true,strictCsp:true,settingsReminder:true,syntheticOnly:true,results}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
