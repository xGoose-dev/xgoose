import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeState,normalizeAppearance,PRESETS,FONTS,appearanceColors,appearanceMaterial,contrast,appearanceParams} from '../packages/ui/src/appearance';
import {AppearanceController,createAppearanceUsage} from '../packages/ui/src/appearanceController';
const state=(preset='default',fontScale=1)=>normalizeState({theme:'system',appearance:{preset,fontScale}});
test('old settings retain mode, unknown appearance values normalize without discarding other preferences',()=>{
 assert.deepEqual(normalizeState({theme:'dark'}),{theme:'dark',appearance:{preset:'default',font:'default',fontScale:1}});
 assert.deepEqual(normalizeAppearance({preset:'__proto__',font:'constructor',fontScale:Infinity,accentColor:'url(secret)'}),state().appearance);
 assert.equal(normalizeAppearance({fontScale:10}).fontScale,1.3);

});
test('presets differ in real materials and shapes, and their filled controls retain readable contrast',()=>{
 assert.equal(Object.keys(PRESETS).length,5);assert.equal(Object.keys(FONTS).length,4);
 for(const preset of Object.keys(PRESETS))for(const dark of [false,true]){
  const a=normalizeAppearance({preset}),colors=appearanceColors(a,dark);
  assert.ok(contrast(colors.accent,colors.onAccent)>=4.5);
  assert.ok(!JSON.stringify(appearanceParams({theme:'system',appearance:a},dark)).includes('#'));
 }
 assert.equal(appearanceMaterial(state('glass').appearance,false).blur,24);
 assert.ok(appearanceMaterial(state('glass').appearance,false).opacity<1);
 assert.equal(appearanceMaterial(state('notebook').appearance,false).opacity,1);
 assert.equal(appearanceMaterial(state('bold').appearance,false).radius,0);
 assert.equal(appearanceMaterial(state('bold').appearance,false).border,3);
 assert.ok(appearanceMaterial(state('soft').appearance,false).radius>appearanceMaterial(state('notebook').appearance,false).radius);
});
test('sliders coalesce, writes serialize, successful reset emits only reset',async()=>{
 const events:string[]=[],writes:any[]=[];const c=new AppearanceController({initial:state(),save:async s=>{writes.push(s);},apply:()=>{},track:e=>events.push(e),dark:()=>false,entry:'fixture'});
 c.change(state('glass',1.1));c.change(state('notebook',1.15));await c.flush();
 assert.equal(writes.length,1);assert.equal(writes[0].appearance.preset,'notebook');
 assert.deepEqual(events,['appearance_opened','appearance_changed','appearance_saved']);
 c.change(state('notebook',1.15));await c.flush();assert.equal(writes.length,1);
 await c.reset();assert.deepEqual(events.slice(-1),['appearance_reset']);assert.deepEqual(c.saved,state());
});
test('failed storage rolls preview back, exposes retry, and preserves queued newer changes',async()=>{
 let fails=true;const applied:any[]=[],events:string[]=[];
 const c=new AppearanceController({initial:state(),save:async()=>{if(fails)throw new Error('disk full');},apply:s=>applied.push(s),track:e=>events.push(e),dark:()=>false,entry:'fixture'});
 c.change(state('glass'));await c.flush();assert.deepEqual(applied.at(-1),state());assert.equal(c.failed?.appearance.preset,'glass');
 fails=false;await c.retry();assert.equal(c.saved.appearance.preset,'glass');assert.ok(events.includes('appearance_failed'));
 c.change(state('notebook'));const first=c.flush();c.change(state('soft'));const last=c.flush();await Promise.all([first,last]);assert.equal(c.saved.appearance.preset,'soft');assert.equal(c.draft.appearance.preset,'soft');
});
test('visible usage is sampled for final configuration, not repeated reads or hidden surfaces',()=>{
 const events:any[]=[];const use=createAppearanceUsage((event,params)=>events.push({event,params}),'fixture');
 use(state(),false,false);assert.equal(events.length,0);use(state(),false);use(state(),false);assert.equal(events.length,1);
 use(state('glass'),false);assert.equal(events.length,2);
});
test('SwiftUI and browser hosts expose identical preset identifiers',async()=>{
 const {readFile}=await import('node:fs/promises');
 const swift=await readFile(new URL('../apps/safari/Native/App/XGooseApp.swift',import.meta.url),'utf8');
 const presets=JSON.parse(swift.match(/static let presets=(\[[^\n]+\])/)![1]);
 assert.deepEqual(presets,Object.keys(PRESETS));
});
test('bundled upstream snapshots retain their recorded checksums',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const dir=new URL('../packages/ui/src/theme-presets/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('sources.json',dir),'utf8'));
 for(const [file,source] of Object.entries(manifest.sources) as [string,{sha256:string}][])assert.equal(createHash('sha256').update(await readFile(new URL(file,dir))).digest('hex'),source.sha256);
});
