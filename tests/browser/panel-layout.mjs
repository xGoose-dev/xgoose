import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('artifacts/layout');await mkdir(out,{recursive:true});
const bundle=await build({stdin:{contents:"import {createPanel} from './packages/ui/src/panel.ts';window.panel=createPanel();",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,520,640,1024]) {
  const page=await browser.newPage({viewport:{width,height:800},deviceScaleFactor:2});
  await page.setContent('<style>html{font-size:24px}body{margin:0;background:#edf4f8;min-height:1800px;font-family:Arial}header{padding:18px;background:#39748f;color:white}main{padding:24px}button,textarea{font:inherit}</style><header>首页　美卡指南　HotelFT</header><main><h2>欢迎来到论坛</h2><p>页面内容保持原样。Floating panel layout regression.</p></main>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
   panel.setTheme('light');panel.open();panel.setSkills([{name:'discourse-forum',namespace:'discourse'},{name:'uscardforum',namespace:'uscf'}]);
   panel.setShortcuts([{label:'最近羊毛',text:'最近羊毛'},{label:'延误险报销',text:'延误险报销'}]);
   panel.addUserMessage('延误险怎么报销');const bubble=panel.addAssistantBubble();bubble.updateMarkdown('先查论坛里的理赔流程、所需材料和常见拒赔／补件情况，再比较不同卡种。\n\n'+ 'https://example.com/'+ 'long-evidence-'.repeat(20));bubble.finalize();
   panel.addToolCard('js_exec',{purpose:'搜索论坛中的理赔流程与补件案例',code:'return await Promise.allSettled([]);',parallel_safe:true});panel.setGenerating(true);
  });
  await page.locator('#xgoose-root .in-text').fill('检查输入框焦点和窄窗口');
  await page.evaluate(()=>{panel.setSending(true);for(const a of document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel').getAnimations({subtree:true}))if(a.animationName==='halo')a.currentTime=3500;document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel').scrollLeft=24;document.querySelector('#xgoose-root').shadowRoot.querySelector('.in-text').focus();});
  const metrics=await page.evaluate(()=>{
   const s=document.querySelector('#xgoose-root').shadowRoot,p=s.querySelector('.panel'),r=p.getBoundingClientRect();
   const bounds=sel=>{const e=s.querySelector(sel),b=e.getBoundingClientRect();return {selector:sel,left:b.left,right:b.right,top:b.top,bottom:b.bottom,visible:b.width>0&&b.height>0};};
   return {panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollLeft:p.scrollLeft},viewport:innerWidth,children:['.hdr','.skills-bar','.msgs','.input-area','.in-text','.btn-send','.btn-stop'].map(bounds),borderTransform:getComputedStyle(p,'::before').transform,composer:{scroll:s.querySelector('.in-text').scrollHeight,client:s.querySelector('.in-text').clientHeight}};
  });
  await page.screenshot({path:resolve(out,`panel-${width}.png`),animations:'disabled'});
  console.log(JSON.stringify({width,outerScrollLeft:metrics.panel.scrollLeft,borderTransform:metrics.borderTransform,visibleControls:metrics.children.filter(c=>c.visible).length}));
  if(process.env.BASELINE!=='1') {
   assert.ok(metrics.panel.left>=0&&metrics.panel.right<=width+1,`panel outside ${width}px viewport`);
   assert.equal(metrics.panel.scrollLeft,0,'outer panel must not scroll horizontally');
   for(const child of metrics.children.filter(child=>child.visible))assert.ok(child.left>=metrics.panel.left-1&&child.right<=metrics.panel.right+1,`${child.selector} escaped ${width}px panel`);
   assert.ok(metrics.composer.scroll<=metrics.composer.client+1,'short input must remain fully visible after Stop appears');
   assert.equal(metrics.borderTransform,'none','border must not rotate through message content');
  }
  await page.close();
 }
}finally{await browser.close();}
