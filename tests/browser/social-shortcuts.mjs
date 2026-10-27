import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const requests=[];
const server=createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));
 const frame=delta=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:delta.content?'stop':null}]})}\n\n`;
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(frame({role:'assistant',content:`Shortcut accepted ${requests.length}`})+'data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,dist=resolve('apps/chrome/dist');
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-social-shortcuts-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});context.setDefaultTimeout(20000);
const cases=[
 ['v2ex','https://www.v2ex.com/t/42',['概括这个帖子','热帖','新帖','随便看看']],
 ['nga','https://bbs.nga.cn/read.php?tid=42',['概括这个帖子','热帖','新帖','随便看看','看图概括此帖']],
 ['weibo','https://weibo.com/123/abc',['概括这条微博','热门微博','最新微博','随便看看']],
 ['reddit','https://www.reddit.com/r/test/comments/abc/fixture/',['Summarize this post','Hot posts','New posts','Surprise me']],
];
try{
 const registry=JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8'));
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);await settings.waitForFunction(()=>!!chrome.storage?.local);
 await settings.evaluate(base=>chrome.storage.local.set({'xgoose.settings':{provider:'openai-compat',apiKeys:{'openai-compat':'fixture'},baseUrls:{'openai-compat':base},model:'luna',language:'en',analyticsEnabled:false,launcherVisibility:'skill-sites'}}),base);
 assert.equal((await settings.evaluate(()=>chrome.runtime.sendMessage({kind:'sw:user_scripts_status'}))).enabled,false);
 const report=[];
 for(const[name,url,labels]of cases){
  const entry=registry.find(s=>s.name===name);assert.deepEqual(entry.actions.map(a=>a.label),labels);assert.ok(entry.actions.every(a=>a.prompt&&!a.js));
  await context.route(`${new URL(url).origin}/**`,r=>r.fulfill({contentType:'text/html',headers:{'content-security-policy':"default-src 'self'; script-src 'none'; connect-src 'self'"},body:'<!doctype html><title>Shortcut fixture</title><main>A current post</main>'}));
  const page=await context.newPage();await page.goto(url);if(!await page.locator('.in-text').isVisible())await page.locator('.toggle').click();
  const buttons=page.locator('.shortcuts button');await buttons.filter({hasText:labels[0]}).waitFor();assert.deepEqual(await buttons.allTextContents(),labels);
  for(const[label,index]of labels.map((s,i)=>[s,i])){
   const before=requests.length;await buttons.filter({hasText:label}).click();
   await page.waitForFunction(n=>document.querySelector('#xgoose-root').shadowRoot.textContent.includes(`Shortcut accepted ${n}`),before+1);await page.locator('.btn-stop').waitFor({state:'hidden'});
   assert.equal(requests.length,before+1);
   assert.ok(JSON.stringify(requests.at(-1).messages).includes(entry.actions[index].prompt),`${name}: ${label} prompt not sent`);
   assert.deepEqual(await page.locator('.msg-err').allTextContents(),[],`${name}/${label}`);assert.equal(await page.locator('.user-scripts-guide:visible').count(),0);
  }
  await settings.evaluate(()=>chrome.storage.local.get('xgoose.settings').then(d=>chrome.storage.local.set({'xgoose.settings':{...d['xgoose.settings'],language:'es'}})));
  await page.waitForFunction(()=>document.querySelector('#xgoose-root').shadowRoot.host.lang==='es');assert.deepEqual(await buttons.allTextContents(),labels);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.shortcuts').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  await mkdir('artifacts/social-shortcuts',{recursive:true});await page.screenshot({path:`artifacts/social-shortcuts/${name}.png`});
  await settings.evaluate(()=>chrome.storage.local.get('xgoose.settings').then(d=>chrome.storage.local.set({'xgoose.settings':{...d['xgoose.settings'],language:'en'}})));
  report.push({name,version:entry.version,labels,allClicksSent:true,permissionOff:true,mobile:true});await page.close();
 }
 console.log(JSON.stringify({passed:true,syntheticOnly:true,requests:requests.length,report}));
}finally{await context.close();server.close();await rm(profile,{recursive:true,force:true});}
