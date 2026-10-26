import test from 'node:test';
import assert from 'node:assert/strict';
import {readNgaImages} from '../apps/chrome/src/background/ngaImages.ts';
const prepare=async()=>({data:'fixture-image-data',mimeType:'image/jpeg' as const,width:1,height:1});
test('NGA image reader limits origin, attachment hosts and count, and omits cookies',async()=>{
 let calls=0;
 const fetcher:typeof fetch=async(input,init)=>{
  calls++;assert.equal(String(input),'https://img.nga.178.com/attachments/mon_202610/test.png');
  assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal(init?.method,'GET');assert.equal(init?.headers,undefined);
  return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
 };
 const result=await readNgaImages(['https://img.nga.178.com/attachments/mon_202610/test.png'],'https://bbs.nga.cn/read.php?tid=1',fetcher,prepare);
 assert.equal(calls,1);assert.equal('type' in result[0]&&result[0].type,'image');
 await assert.rejects(readNgaImages([], 'https://other.example/'),/NGA page/);
 await assert.rejects(readNgaImages(Array(4).fill('https://img.nga.178.com/attachments/test.png'),'https://bbs.nga.cn/'),/at most three/);
 const blocked=await readNgaImages(['https://img.nga.178.com.evil.example/attachments/test.png','https://img.nga.178.com/private','http://127.0.0.1/test.png'],'https://bbs.nga.cn/',fetcher,prepare);
 assert.ok(blocked.every(r=>'error' in r));assert.equal(calls,1);
});
test('NGA image errors preserve successful images and reject HTML and oversized payloads',async()=>{
 const urls=['https://img.nga.178.com/attachments/good.png','https://img.nga.178.com/attachments/bad.png','https://img.nga.178.com/attachments/large.png'];
 const fetched=await readNgaImages(urls,'https://ngabbs.com/read.php?tid=1',async input=>String(input).includes('/good')?new Response('png',{headers:{'content-type':'image/png'}}):String(input).includes('/large')?new Response('large',{headers:{'content-type':'image/png','content-length':String(6*1024*1024)}}):new Response('<html>Login</html>',{headers:{'content-type':'text/html'}}),prepare);
 assert.ok('type' in fetched[0]);assert.match('error' in fetched[1]?fetched[1].error:'',/Expected a PNG/);assert.match('error' in fetched[2]?fetched[2].error:'',/exceeds 5 MB/);
});
