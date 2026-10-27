import {chromium} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// NGA BBCode bodies from the read.php JSON API. All responses are synthetic.
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-nga-content-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
const tid=47786615,reads=[];
const posts=[
 {pid:0,lou:0,tid,authorid:42,postdatetimestamp:1793000000,content:'开箱[img]./mon_202610/26/a.jpg[/img]<br/>[s:ac:哭笑]外链[img]https://example.com/x.png[/img] [url=https://example.com/doc]说明[/url] [url]https://example.com/raw[/url]<br/>[collapse=剧透]结局[/collapse]'},
 {pid:811,lou:1,tid,authorid:43,postdatetimestamp:1793000300,content:'[quote][pid=0,47786615,1]Reply[/pid] [b]Post by [uid=42]楼主[/uid] (2026-10-26 12:00):[/b]<br/><br/>开箱[img]./mon_202610/26/a.jpg[/img][/quote]<br/>[b]好[/b]看 [color=red]$&[/color]'},
 {pid:812,lou:2,tid,authorid:44,postdatetimestamp:1793000600,content:'[b]Reply to [pid=811,47786615,1]Reply[/pid] Post by [uid=43]路人[/uid] (2026-10-26 12:05)[/b]<br/>同意 [uid=42]楼主[/uid]'},
 {pid:813,lou:3,tid,authorid:45,postdatetimestamp:1793000900,content:'[b]Reply to [pid=0,47786615,1]Reply[/pid] Post by [uid=-1]#anony_abc[/uid] (2026-10-26 12:10)[/b]<br/>匿名回复主楼'},
];
const users={42:{username:'楼主'},43:{username:'路人'},44:{username:'第三人'},45:{username:'#anony_abc'}};
try{
 const registry=JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8')),skill=registry.find(s=>s.name==='nga');
 assert.ok(skill.functions.some(f=>f.name==='readPostImages'));assert.match(skill.instructions,/readPostImages/);
 await context.route('https://bbs.nga.cn/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/read.php'&&url.searchParams.get('__output')==='11'){
   reads.push(Object.fromEntries(url.searchParams));
   const one=url.searchParams.get('pid');
   return route.fulfill({json:{data:{__PAGE:1,__ROWS:posts.length,__T:{tid,subject:'开箱贴',authorid:42},__U:users,__R:one?posts.filter(p=>String(p.pid)===one):posts}}});
  }
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>NGA fixture</title><main>NGA</main>'});
 });
 const page=await context.newPage();await page.goto(`https://bbs.nga.cn/read.php?tid=${tid}`);
 await page.waitForFunction(()=>typeof window.xgoose?.skills?.nga?.readPostImages==='function');
 const topic=await page.evaluate(tid=>window.xgoose.skills.nga.getTopic({tid,includeImages:true}),tid);
 assert.deepEqual(topic.sources.map(s=>[s.id,s.parentId,s.postNumber]),[[`${tid}:0`,undefined,0],['811',`${tid}:0`,1],['812','811',2],['813',`${tid}:0`,3]]);
 assert.equal(topic.sources[0].text,'开箱 [image 1]\n外链 [image 2] 说明 (https://example.com/doc) https://example.com/raw\n\n剧透: 结局');
 assert.equal(topic.sources[1].text,`[quote @楼主 pid ${tid}:0: 开箱]\n好 看 $&`);
 assert.equal(topic.sources[2].text,'同意 @楼主');
 assert.equal(topic.sources[3].text,'匿名回复主楼');
 assert.ok(topic.sources.every(s=>s.images===undefined&&s.pid===undefined&&s.postIndex===undefined));
 assert.deepEqual(topic.imageContext,{requested:true,delivery:'urls_only_until_host_attaches',totalImages:1,
  images:[{image:1,url:'https://img.nga.178.com/attachments/mon_202610/26/a.jpg',postUrl:`https://bbs.nga.cn/read.php?tid=${tid}`,postNumber:0}]});
 const opening=await page.evaluate(tid=>window.xgoose.skills.nga.readPostImages({id:`${tid}:0`}),tid);
 assert.equal(reads.at(-1).tid,String(tid));assert.equal(opening.totalImages,2);
 assert.deepEqual(opening.imageContext.images.map(i=>[i.image,i.url]),[[1,'https://img.nga.178.com/attachments/mon_202610/26/a.jpg']]);
 assert.deepEqual(opening.skipped,[{image:2,url:'https://example.com/x.png',postUrl:`https://bbs.nga.cn/read.php?tid=${tid}`,postNumber:0,error:'Only NGA attachments can be attached; open the URL to view it.'}]);
 const reply=await page.evaluate(()=>window.xgoose.skills.nga.readPostImages({id:'811',images:[1,4]}));
 assert.equal(reads.at(-1).pid,'811');assert.equal(reply.url,'https://bbs.nga.cn/read.php?pid=811');
 assert.deepEqual(reply.imageContext.images.map(i=>i.image),[1]);assert.match(reply.skipped[0].error,/has 1 images/);
 console.log(JSON.stringify({passed:true,builtinVersion:skill.version,bbcodeQuotes:true,replyTargets:true,openingPostReplies:true,imageMarkers:true,readPostImages:true,syntheticOnly:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
