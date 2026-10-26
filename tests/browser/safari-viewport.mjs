import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"import {createPanel} from './packages/ui/src/panel.ts';window.panel=createPanel({visualViewport:true,imageUploads:true});",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:440,height:850},isMobile:true,hasTouch:true});
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><h1>Viewport fixture</h1>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>panel.open());
 assert.equal(await page.locator('.in-text').evaluate(e=>e.getRootNode().activeElement===e),false,'opening Safari panel must not force input zoom or keyboard');
 for(const viewport of [{width:440,height:850,offsetLeft:0,offsetTop:0,scale:1},{width:220,height:400,offsetLeft:120,offsetTop:100,scale:2},{width:980,height:1800,offsetLeft:0,offsetTop:0,scale:440/980},{width:440,height:360,offsetLeft:0,offsetTop:160,scale:1}]) {
  const metrics=await page.evaluate(v=>{
   for(const [k,value] of Object.entries(v))Object.defineProperty(visualViewport,k,{get:()=>value,configurable:true});
   visualViewport.dispatchEvent(new Event('resize'));
   const s=document.querySelector('#xgoose-root').shadowRoot,p=s.querySelector('.panel'),r=p.getBoundingClientRect();
   return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,controls:['.in-text','.btn-send','.hdr'].map(sel=>{const e=s.querySelector(sel),b=e.getBoundingClientRect();return {sel,left:b.left,right:b.right,top:b.top,bottom:b.bottom};})};
  },viewport);
  assert.ok(metrics.left>=viewport.offsetLeft-1);assert.ok(metrics.right<=viewport.offsetLeft+viewport.width+1);
  assert.ok(metrics.top>=viewport.offsetTop-1);assert.ok(metrics.bottom<=viewport.offsetTop+viewport.height+1);
  for(const c of metrics.controls)assert.ok(c.left>=metrics.left-1&&c.right<=metrics.right+1&&c.bottom<=metrics.bottom+1,JSON.stringify(c));
 }
 console.log(JSON.stringify({passed:true,initialViewport:true,pinchZoom:true,desktopPageViewport:true,keyboardViewport:true}));
} finally {await browser.close();}
