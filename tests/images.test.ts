import test from 'node:test';import assert from 'node:assert/strict';
import {readImages} from '../apps/chrome/src/background/images.ts';
const prepare=async()=>[{type:'image' as const,data:'jpeg',mimeType:'image/jpeg' as const,width:10,height:20,originalWidth:10,originalHeight:20}];
test('shared images support unrelated skill CDNs, preserve signatures, omit cookies and reuse cached bytes',async()=>{
 let calls=0;const url='https://cdn.example.org/picture.jpg?token=signature';const fetcher:typeof fetch=async(u,init)=>{calls++;assert.equal(String(u),url);assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');return new Response('jpeg',{headers:{'content-type':'image/jpeg'}});};
 const first=await readImages([url],fetcher,prepare);assert.ok('images' in first[0]);await readImages([url],fetcher,prepare);assert.equal(calls,1);
});
test('shared image reads reject non-image responses and preserve success in mixed batches',async()=>{
 const r=await readImages(['https://another.example/good.png','https://another.example/bad'],async u=>new Response('data',{headers:{'content-type':String(u).endsWith('png')?'image/png':'text/html'}}),prepare);
 assert.ok('images' in r[0]);assert.ok('error' in r[1]);
 await assert.rejects(readImages(Array(4).fill('https://cdn.example/a.jpg')),/one to three/);
 const bad=await readImages(['http://cdn.example/a.jpg']);assert.ok('error' in bad[0]);
});
