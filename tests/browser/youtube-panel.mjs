import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"import {createPanel} from './packages/ui/src/panel.ts';window.panel=createPanel();",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({headless:true});
await mkdir('artifacts/youtube-panel',{recursive:true});
try {
 for(const [width,height] of [[1380,968],[1280,720],[1024,600],[640,480],[390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  // YouTube uses a fixed masthead and chips above the page. Reproduce the
  // reported overlap, including a restored panel larger than this viewport.
  await page.setContent('<style>body{margin:0;background:#101010;color:#eee}#masthead{position:fixed;inset:0 0 auto;height:126px;background:#202020;z-index:2020}</style><header id="masthead">YouTube · Search · Create</header><main>Video recommendations</main>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{panel.applyLayout({buttonCorner:'br',buttonOffset:{h:2000,v:1500},panelCorner:'br',panelSize:{w:1150,h:1200}});panel.open();});
  await page.locator('.in-text').fill('Draft remains available');
  for(const overlay of [false,true]){
   if(overlay)await page.locator('.btn-expand').evaluate(e=>e.click());
   const controls=await page.evaluate(()=>{
    const root=document.querySelector('#xgoose-root'),shadow=root.shadowRoot;
    return ['.hdr','.btn-close','.btn-settings','.in-text','.btn-send'].map(selector=>{
     const el=shadow.querySelector(selector),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
     return {selector,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,hit:document.elementFromPoint(x,y)===root&&shadow.elementFromPoint(x,y)?.closest(selector)===el};
    });
   });
   for(const control of controls){assert.equal(control.visible,true,`${width}x${height} overlay=${overlay}: ${control.selector} outside viewport`);assert.equal(control.hit,true,`${width}x${height}: ${control.selector} covered`);}
   if(overlay)await page.locator('.btn-expand').evaluate(e=>e.click());
  }
  await page.screenshot({path:`artifacts/youtube-panel/${width}x${height}.png`});
  await page.locator('.btn-close').click();
  // A large saved launcher offset must recover automatically, without Reset.
  const button=await page.locator('.toggle').boundingBox();
  assert.ok(button.x>=0&&button.y>=0&&button.x+button.width<=width&&button.y+button.height<=height);
  await page.locator('.toggle').click();assert.equal(await page.locator('.in-text').inputValue(),'Draft remains available');
  await page.setViewportSize({width:Math.max(320,width-150),height:Math.max(400,height-150)});
  await page.locator('.btn-close').click();await page.locator('.toggle').click();
  assert.equal(await page.locator('.in-text').inputValue(),'Draft remains available');
  console.log(JSON.stringify({width,height,controlsReachable:true,oversizedLayoutRestored:true,resize:true}));await page.close();
 }
} finally {await browser.close();}
