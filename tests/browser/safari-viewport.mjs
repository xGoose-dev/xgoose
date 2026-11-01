import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"import {createPanel} from './packages/ui/src/panel.ts';window.makePanel=()=>createPanel({visualViewport:true,imageUploads:true});window.panel=makePanel();window.savedLayout=null;panel.onLayoutChange(layout=>{window.savedLayout=layout;});",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
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
  await page.evaluate(()=>panel.close());
  for(const corner of ['bl','tl','tr','br']) {
   const result=await page.evaluate(({v,corner})=>{
    const toggle=document.querySelector('#xgoose-root').shadowRoot.querySelector('.toggle');
    // Observe positions without CSS animation, then exercise the real handlers
    // in client coordinates (including a zoomed/offset visual viewport).
    toggle.style.transition='none';
    const start=toggle.getBoundingClientRect(),size=48/v.scale,margin=20/v.scale;
    const x=v.offsetLeft+(corner.endsWith('l')?margin:v.width-margin-size);
    const y=v.offsetTop+(corner.startsWith('t')?margin:v.height-margin-size);
    const pointer=(type,clientX,clientY)=>toggle.dispatchEvent(new PointerEvent(type,{pointerId:7,pointerType:'touch',button:0,bubbles:true,clientX,clientY}));
    pointer('pointerdown',start.left+start.width/2,start.top+start.height/2);
    pointer('pointermove',x+size/2,y+size/2);
    const during=toggle.getBoundingClientRect();
    pointer('pointerup',x+size/2,y+size/2);
    const after=toggle.getBoundingClientRect(),saved=window.savedLayout;
    panel.applyLayout(saved);
    visualViewport.dispatchEvent(new Event('resize'));
    const restored=toggle.getBoundingClientRect();
    return {x,y,during:{x:during.x,y:during.y},after:{x:after.x,y:after.y},restored:{x:restored.x,y:restored.y},saved,open:document.querySelector('#xgoose-root').shadowRoot.querySelector('.panel').classList.contains('open')};
   },{v:viewport,corner});
   for(const phase of ['during','after','restored']) {
    assert.ok(Math.abs(result[phase].x-result.x)<1,`${corner} ${phase} x: ${JSON.stringify(result)}`);
    assert.ok(Math.abs(result[phase].y-result.y)<1,`${corner} ${phase} y: ${JSON.stringify(result)}`);
   }
   assert.equal(result.saved.buttonCorner,corner);
   assert.ok(Math.abs(result.saved.buttonOffset.h-20)<1);
   assert.ok(Math.abs(result.saved.buttonOffset.v-20)<1);
   assert.equal(result.open,false,'dragging does not open the panel');
  }
  await page.evaluate(()=>panel.open());
 }
 await page.evaluate(()=>panel.close());
 const toggle=page.locator('#xgoose-root .toggle'),start=await toggle.boundingBox();
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
 await page.mouse.down();await page.mouse.move(44,204,{steps:8});await page.mouse.up();
 const dragged=await toggle.boundingBox();
 assert.ok(Math.abs(dragged.x-20)<1&&Math.abs(dragged.y-180)<1,`native pointer capture moves the button with the pointer: ${JSON.stringify(dragged)}`);
 assert.equal(await page.evaluate(()=>panel.isOpen()),false);
 console.log(JSON.stringify({passed:true,initialViewport:true,pinchZoom:true,desktopPageViewport:true,keyboardViewport:true,fourCornerDrag:true,savedOffsets:true,nativePointerCapture:true}));
} finally {await browser.close();}
