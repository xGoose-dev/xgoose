import test from 'node:test';
import assert from 'node:assert/strict';
import {detachResultImages,resultImageParts} from '../packages/core/src/resultImages.ts';

const messages:any[]=[];
(globalThis as any).chrome={runtime:{sendMessage:async(message:any)=>{messages.push(message);
  return message.payload.urls.map((url:string)=>url.includes('broken')?{url,error:'NGA image returned HTTP 404'}:{url,images:[{type:'image',data:`bytes-${url.split('/').pop()}`,mimeType:'image/jpeg',width:20,height:10}]});}}};
const {attachHostImages}=await import('../apps/chrome/src/content/agent/hostImages.ts');
const context=(urls:string[])=>({requested:true,delivery:'urls_only_until_host_attaches',totalImages:urls.length,images:urls.map((url,i)=>({image:i+1,url,postUrl:'https://bbs.nga.cn/read.php?pid=7',postNumber:3}))});

test('host-delivered images found anywhere in a result become model image parts, at most three per call', async () => {
  messages.length=0;
  const raw={topic:{tid:1},reads:[{status:'fulfilled',value:{sources:[],imageContext:context(['https://img.nga.178.com/attachments/a.jpg','https://img.nga.178.com/attachments/broken.jpg'])}},
    {status:'fulfilled',value:{imageContext:context(['https://img.nga.178.com/attachments/b.jpg','https://img.nga.178.com/attachments/c.jpg'])}}]};
  const detached=detachResultImages(await attachHostImages(raw)) as any;
  assert.deepEqual(messages.map(m=>[m.kind,m.payload.urls.length]),[['sw:read_images',3]]);
  const [first,second]=detached.reads.map((r:any)=>r.value.imageContext);
  assert.equal(first.delivery,'image_parts');
  assert.deepEqual(first.images.map((i:any)=>[i.image,i.attached,i.status,i.error]),[[1,1,undefined,undefined],[2,undefined,'unavailable','NGA image returned HTTP 404']]);
  assert.deepEqual(second.images.map((i:any)=>[i.attached,i.status]),[[2,undefined],[undefined,'unavailable']]);
  assert.match(second.images[1].error,/Only 3 pictures/);
  assert.ok(!JSON.stringify(detached).includes('bytes-'));
  const parts=resultImageParts(detached);
  assert.deepEqual(parts.filter(p=>p.type==='file-data').map((p:any)=>p.data),['bytes-a.jpg','bytes-b.jpg']);
  assert.deepEqual(raw.reads[0].value.imageContext.images[0],{image:1,url:'https://img.nga.178.com/attachments/a.jpg',postUrl:'https://bbs.nga.cn/read.php?pid=7',postNumber:3},'The skill result itself is not modified');
});

test('results without pending host images are returned as they are, without a background request', async () => {
  messages.length=0;
  const plain={imageContext:{requested:true,delivery:'image_parts',images:[]},sources:[{id:'1'}]};
  assert.equal(await attachHostImages(plain),plain);
  assert.equal(await attachHostImages('text'),'text');
  assert.equal(messages.length,0);
});

test('a background refusal marks the pictures unavailable instead of failing the skill result', async () => {
  (globalThis as any).chrome.runtime.sendMessage=async()=>({__error:'NGA image reads require an NGA page'});
  const out=await attachHostImages({imageContext:context(['https://img.nga.178.com/attachments/a.jpg'])}) as any;
  assert.equal(out.imageContext.delivery,'unavailable');assert.equal(out.imageContext.images[0].error,'NGA image reads require an NGA page');
});

test('Tieba image context becomes actual model image parts and retains its post/floor attribution',async()=>{
 (globalThis as any).chrome.runtime.sendMessage=async(message:any)=>message.payload.urls.map((url:string)=>({url,images:[{type:'image',data:'bytes-a.jpg',mimeType:'image/jpeg',width:20,height:10}]}));
 const url='https://tiebapic.baidu.com/forum/pic/item/a.jpg';
 const raw={readerVersion:1,sources:[{url:'https://tieba.baidu.com/p/123',text:'Image post'}],imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:[{url,postUrl:'https://tieba.baidu.com/p/123',postNumber:1}]}};
 const output=detachResultImages(await attachHostImages(raw)) as any;
 assert.equal(output.imageContext.delivery,'image_parts');assert.equal(output.imageContext.images[0].postNumber,1);assert.equal(output.imageContext.images[0].postUrl,'https://tieba.baidu.com/p/123');
 assert.equal(resultImageParts(output).filter(p=>p.type==='file-data').length,1);assert.ok(!JSON.stringify(output).includes('bytes-a.jpg'));
});

test('any skill CDN and long-image segments share the image transport and preserve source attribution',async()=>{
 const url='https://cdn.other-site.example/long.png?signature=keep';
 (globalThis as any).chrome.runtime.sendMessage=async(message:any)=>{assert.equal(message.kind,'sw:read_images');return [{url,images:[0,1].map(i=>({type:'image',data:'tile-'+i,mimeType:'image/jpeg',width:1828,height:1733,originalWidth:1828,originalHeight:3466,crop:{top:i*1733,left:0,width:1828,height:1733}}))}];};
 const output=detachResultImages(await attachHostImages({imageContext:{requested:true,delivery:'urls_only_until_host_attaches',images:[{url,postUrl:'https://other-site.example/topic/1',postNumber:4}]}})) as any;
 assert.equal(output.imageContext.delivery,'image_parts');assert.equal(output.imageContext.images.length,2);assert.equal(output.imageContext.images[1].crop.top,1733);assert.equal(output.imageContext.images[1].postNumber,4);assert.equal(output.imageContext.images[1].segment,2);
 assert.equal(resultImageParts(output).filter(p=>p.type==='file-data').length,2);assert.ok(!JSON.stringify(output).includes('tile-'));
});
