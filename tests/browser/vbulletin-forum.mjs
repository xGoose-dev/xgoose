import {chromium} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

// FlyerTalk-shaped vBulletin 3.9 markup, served as ISO-8859-1 like the real board. All responses are synthetic.
const profile=await mkdtemp(resolve(tmpdir(),'xgoose-vbulletin-')),dist=resolve('apps/chrome/dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
context.setDefaultTimeout(20000);
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const page_=(body)=>`<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><meta name="generator" content="vBulletin 3.9.3.9"><title>FlyerTalk Forums</title></head><body>${body}</body></html>`;
const quote=(who,id,text)=>`<div style="margin:1rem; margin-top:0.3rem;"><div><label>Quote:</label></div><div class="panel alt2" style="border:1px inset"><div>Originally Posted by <strong>${who}</strong> <a href="airport-lounges/900-fixture-lounge.html#post${id}" rel="nofollow" title="View Post"><i class="fa-solid fa-circle-arrow-right"></i></a></div><div style="font-style:italic">${text}</div></div></div>`;
const post=(id,floor,who,date,body,likes=0)=>`<div id="edit${id}"><div class="tpost"><div class="trow thead"><div class="tcell">${date} | 6:07 pm #${floor}</div></div><a class="bigusername" href="members/${who}.html">${who}</a><div id="post_message_${id}">${body}</div><span id="post_thanks_button_likes_${id}">${likes}</span></div></div>`;
const thread1=page_(`<h1>Fixture lounge thread</h1><div class="pager"><a class="button" href="airport-lounges/900-fixture-lounge-2.html">Next</a><a class="button" href="airport-lounges/900-fixture-lounge-2.html">Last</a><a href="airport-lounges/900-fixture-lounge-2.html">2</a></div>
${post(101,1,'alice','Dec 2, 2025','Chang\x92s lounge opened<br><img class="post_inline_image" src="https://cimg0.ibsrv.net/gimg/www.flyertalk.com-vbulletin/320x2000/shot.jpg"> <img class="inlineimg" src="images/smilies/smile.gif" alt="">',3)}
${post(102,2,'bob','Dec 3, 2025',`${quote('alice',101,'Chang lounge <img class="post_inline_image" src="https://cimg0.ibsrv.net/gimg/www.flyertalk.com-vbulletin/320x2000/quoted.jpg">')}Agreed, tiny`)}`);
const thread2=page_(`<h1>Fixture lounge thread</h1>${post(103,3,'carol','Jan 13, 2026',`${quote('dave',55,'older text')}${quote('bob',102,'Agreed, tiny')}Still small`,1)}`);
const searchForm=(token)=>page_(`<form action="search.php?do=process" method="post"><input type="hidden" name="securitytoken" value="${token}"><input name="query"></form>`);
const postHits=page_(`<div class="tbox" id="post101"><div class="trow thead"><div class="tcell"><div class="right"> Forum: <a href="airport-lounges-686/">Airport Lounges</a></div><img class="inlineimg" src="images/statusicon/post_new.gif" alt=""><span>Dec 2, 2025, 6:07 pm</span></div></div>
<div class="trow"><div class="tcell alt1"><div class="smallfont right"> Replies: <strong>1,791</strong></div><div><a href="airport-lounges/900-fixture-lounge.html?highlight=lounge"><strong>Fixture lounge thread</strong></a></div><div class="smallfont right"> Views: <strong>521,563</strong></div><div class="smallfont"> Posted By <a href="members/alice.html">alice</a></div>
<div class="panel alt2 smallfont"><em><a href="airport-lounges/900-fixture-lounge-post101.html?highlight=lounge#post101">Lounge opened</a><br>Chang\x92s lounge opened...</em></div></div></div></div>
<a href="search.php?searchid=77&amp;pp=25&amp;page=2">2</a>`);
const threadHits=page_(`<div class="trow text-center"><div class="tcell alt1 text-left" id="td_threadtitle_900" title="Chang lounge preview"><div><h4><a href="airport-lounges/900-fixture-lounge.html?highlight=lounge" id="thread_title_900">Fixture lounge thread</a></h4><span class="smallfont">(<a href="airport-lounges/900-fixture-lounge.html">1</a> <a href="airport-lounges/900-fixture-lounge-2.html">2</a>)</span></div><div class="smallfont"><span style="cursor: pointer" onclick="window.open('members/alice.html', '_self')">alice</span><span class="smallfont jumbo-txt"> on May 26, 2023</span></div></div><div class="tcell alt2 smallfont" title="Replies: 65, Views: 26,897"><div class="smallfont text-right">Yesterday <span class="time">12:54 am</span><br> by <a href="members/bob.html">bob</a></div></div></div>`);
const tokens=['stale','fresh'],posts=[],imageReads=[];
try{
 const registry=JSON.parse(await readFile(resolve(dist,'skills/registry.json'),'utf8'));
 const skill=registry.find(s=>s.name==='vbulletin-forum'),flyertalk=registry.find(s=>s.name==='flyertalk');
 assert.ok(skill.functions.some(f=>f.name==='readPostImages'));assert.match(skill.instructions,/readPostImages/);assert.match(flyertalk.instructions,/summarizeThread/);
 await context.route('https://cimg0.ibsrv.net/**',route=>{imageReads.push(new URL(route.request().url()).pathname);return route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:PNG});});
 await context.route('https://www.flyertalk.com/**',async route=>{
  const url=new URL(route.request().url()),html=(body)=>route.fulfill({headers:{'content-type':'text/html; charset=ISO-8859-1'},body:Buffer.from(body,'latin1')});
  if(url.pathname==='/forum/showthread.php')return html(url.searchParams.get('page')==='2'?thread2:thread1);
  if(url.pathname==='/forum/search.php'&&route.request().method()==='POST'){
   const form=new URLSearchParams(route.request().postData());posts.push(Object.fromEntries(form));
   if(form.get('securitytoken')!=='fresh')return html(page_('<div class="panel">vBulletin Message Your submission could not be processed because you have logged in since the previous page was loaded.</div>'));
   return html(page_(`<meta http-equiv="Refresh" content="0; URL=search.php?searchid=${form.get('showposts')==='1'?77:78}&amp;query=lounge"><div class="panel">Thank you for searching. Please wait while we transfer you to the search results.</div>`));
  }
  if(url.pathname==='/forum/search.php'&&url.searchParams.has('searchid'))return html(url.searchParams.get('searchid')==='77'?postHits:threadHits);
  if(url.pathname==='/forum/search.php')return html(searchForm(tokens.shift()??'fresh'));
  return html(page_('<h1>FlyerTalk fixture</h1>'));
 });
 const page=await context.newPage();await page.goto('https://www.flyertalk.com/forum/');
 await page.waitForFunction(()=>typeof window.xgoose?.skills?.vbulletin?.summarizeThread==='function');
 const thread=await page.evaluate(()=>window.xgoose.skills.vbulletin.summarizeThread({threadId:900}));
 assert.equal(thread.url,'https://www.flyertalk.com/forum/showthread.php?t=900');assert.equal(thread.title,'Fixture lounge thread');
 assert.equal(thread.total_pages,2);assert.deepEqual(thread.pages_read,[1,2]);
 assert.deepEqual(thread.posts.map(p=>[p.post_number,p.post_id,p.username,p.created_at,p.like_count]),[[1,101,'alice','2025-12-02',3],[2,102,'bob','2025-12-03',undefined],[3,103,'carol','2026-01-13',1]]);
 assert.equal(thread.posts[0].text,'Chang’s lounge opened\n[image 1]');
 assert.equal(thread.posts[1].text,'[quote @alice #1: Chang lounge]\nAgreed, tiny');
 assert.equal(thread.posts[2].text,'[quote @dave post 55: older text]\n\n[quote @bob #2: Agreed, tiny]\nStill small');
 assert.equal(thread.posts[0].url,'https://www.flyertalk.com/forum/showthread.php?p=101#post101');
 const pictures=await page.evaluate(()=>window.xgoose.skills.vbulletin.readPostImages({postId:101}));
 assert.equal(pictures.total_images,1);assert.deepEqual(pictures.images.map(i=>[i.image,i.type,i.mimeType,i.width]),[[1,'image','image/jpeg',1]]);
 assert.deepEqual(imageReads,['/gimg/www.flyertalk.com-vbulletin/1600x2000/shot.jpg']);
 const found=await page.evaluate(()=>window.xgoose.skills.vbulletin.searchPosts({query:'lounge'}));
 assert.deepEqual(posts.map(p=>p.securitytoken),['stale','fresh']);assert.equal(found.searchId,77);assert.equal(found.hasMore,true);
 assert.deepEqual(found.results,[{post_id:101,thread_id:900,thread:'Fixture lounge thread',forum:'Airport Lounges',forum_id:686,author:'alice',date:'2025-12-02',replies:1791,views:521563,title:'Lounge opened',snippet:'Chang’s lounge opened...',url:'https://www.flyertalk.com/forum/airport-lounges/900-fixture-lounge-post101.html#post101'}]);
 const titles=await page.evaluate(()=>window.xgoose.skills.vbulletin.searchThreads({query:'lounge',titleOnly:true}));
 assert.equal(posts.at(-1).securitytoken,'fresh');assert.equal(posts.at(-1).titleonly,'1');
 assert.deepEqual({...titles.results[0],last_post:undefined},{id:900,title:'Fixture lounge thread',url:'https://www.flyertalk.com/forum/airport-lounges/900-fixture-lounge.html',starter:'alice',started:'2023-05-26',replies:65,views:26897,pages:2,last_post:undefined,last_poster:'bob',preview:'Chang lounge preview'});
 assert.match(titles.results[0].last_post,/^\d{4}-\d{2}-\d{2}$/);
 console.log(JSON.stringify({passed:true,builtinVersion:skill.version,flyertalkVersion:flyertalk.version,latin1Decoded:true,quotesLinkedToFloors:true,postIdLinks:true,largerImageRendition:true,staleTokenRetried:true,relativeLinksResolved:true,syntheticOnly:true}));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
