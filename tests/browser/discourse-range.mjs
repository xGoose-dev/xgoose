import {chromium} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-discourse-range-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);const reads=[];
const posts=Array.from({length:660},(_,i)=>i+1).filter(n=>n!==640).map(n=>({id:10000+n,topic_id:42,post_number:n,username:'fixture',cooked:`<p>Evidence from floor ${n}</p>`,actions_summary:[{id:2,count:n%7}]}));
try{
 const registry=JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8')),skill=registry.find(s=>s.name==='discourse-forum');
 assert.equal(skill.version,'0.2.3');assert.ok(skill.functions.some(f=>f.name==='readTopicPosts'));assert.equal(skill.actions.length,3);
 const sw=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=sw.url().split('/')[2];
 const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/options.html`);await settings.waitForFunction(()=>!!chrome.storage?.local);
 await settings.evaluate(()=>chrome.storage.local.set({'xgoose.settings':{analyticsEnabled:false,launcherVisibility:'always'}}));
 const permission=await context.newPage();await permission.goto(`chrome://extensions/?id=${id}`);await permission.locator('#allow-user-scripts cr-toggle').click();
 await context.route('https://forum.example.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('.json')){
   reads.push({path:url.pathname,query:url.search,at:Date.now()});
   if(url.pathname==='/t/43/posts.json')return route.fulfill({status:429,headers:{'retry-after':'60'},json:{error:'synthetic_rate_limit'}});
   if(url.pathname.endsWith('/posts.json')){const ids=url.searchParams.getAll('post_ids[]').map(Number);return route.fulfill({json:{post_stream:{posts:posts.filter(p=>ids.includes(p.id)).reverse()}}});}
   const topicId=Number(url.pathname.match(/\/t\/(\d+)/)?.[1]??42),topicPosts=topicId===44?posts.slice(0,19):posts,anchor=Number(url.searchParams.get('post_number')??1),at=Math.max(0,posts.findIndex(p=>p.post_number>=anchor));
   return route.fulfill({json:{id:topicId,title:'Synthetic thread',posts_count:topicPosts.length,highest_post_number:topicId===44?19:660,post_stream:{stream:topicPosts.map(p=>p.id),posts:(topicId===44?topicPosts:posts.slice(Math.max(0,at-5),at+15)).map(p=>({...p,topic_id:topicId}))}}});
  }
  return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="generator" content="Discourse"><title>Range fixture</title><h1>Forum fixture</h1>'});
 });
 const page=await context.newPage();await page.goto('https://forum.example.test/t/fixture/42');await page.waitForFunction(()=>typeof window.xgoose?.skills?.discourse?.readTopicPosts==='function');
 const described=await page.evaluate(()=>window.xgoose.skills.discourse.__describe__());assert.ok(described.readTopicPosts.input);assert.ok(described.readTopicPosts.output);
 const legacy=await page.evaluate(()=>window.xgoose.skills.discourse.getTopicPosts({topicId:42,postNumber:632}));assert.deepEqual(legacy.posts.map(p=>p.post_number),[632,633,634,635,636]);
 const first=await page.evaluate(()=>window.xgoose.skills.discourse.readTopicPosts({topicId:42,fromPostNumber:632,limit:20,maxChars:1000}));
 const last=await page.evaluate(cursor=>window.xgoose.skills.discourse.readTopicPosts({topicId:42,cursor,limit:20}),first.next_cursor);
 assert.deepEqual([...first.posts,...last.posts].map(p=>p.post_number),Array.from({length:29},(_,i)=>632+i).filter(n=>n!==640));assert.equal(last.next_cursor,null);assert.equal(first.origin,'https://forum.example.test');assert.equal(first.posts[0].like_count,632%7);assert.ok(first.posts[0].url.endsWith('/632'));
 const sixth=await page.evaluate(()=>window.xgoose.skills.discourse.getTopicPosts({topicId:44,postNumber:6}));assert.deepEqual(sixth.posts.map(p=>p.post_number),[6,7,8,9,10]);
 const eleventh=await page.evaluate(()=>window.xgoose.skills.discourse.getTopicPosts({topicId:44,postNumber:11}));assert.deepEqual(eleventh.posts.map(p=>p.post_number),[11,12,13,14,15]);
 const all=await page.evaluate(()=>window.xgoose.skills.discourse.readTopicPosts({topicId:44,limit:100}));assert.deepEqual(all.posts.map(p=>p.post_number),Array.from({length:19},(_,i)=>i+1));assert.equal(all.complete,true);
 const partial=await page.evaluate(()=>window.xgoose.skills.discourse.readTopicPosts({topicId:43,limit:40}));assert.equal(partial.status,'rate_limited');assert.ok(partial.posts.length);const before=reads.length;
 const cooldown=await page.evaluate(cursor=>window.xgoose.skills.discourse.readTopicPosts({topicId:43,cursor}),partial.next_cursor);assert.equal(cooldown.status,'rate_limited');assert.equal(reads.length,before);
 assert.ok(reads.filter(r=>r.path.endsWith('/posts.json')).every(r=>new URLSearchParams(r.query).getAll('post_ids[]').length<=20));
 console.log(JSON.stringify({passed:true,builtinVersion:skill.version,agentDiscoverable:true,legacyFloor632:true,whole19PostWindow:true,bulkCursor:true,deletedFloors:true,likesAndSources:true,rateLimitCooldown:true,batchAtMost20:true,syntheticOnly:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
